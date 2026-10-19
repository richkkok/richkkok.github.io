import { keyText, shiftMonth, daysInMonth, today, uid } from './format.js';
import { billingWindow, paymentKind } from './payment-channels.js';
import { period, startDay, inPeriod, validDate, addDays } from './period.js';
import { planFor, expenseValue } from './budget.js';
import { costKind, dayStatus } from './behavior.js';
import { classification } from './money.js';
import { budgetIncomeValue } from './import/normalize.js';
import { cashFingerprint, saveCashLink } from './cash.js';
import { occurrence } from './recurring.js';

const active = t => !t.deletedAt && !t.splitParent && !t.duplicateOf;
const counted = t => active(t) && !t.excluded && t.scope !== 'excluded';
const money = v => Number.isSafeInteger(v) && v >= 0 && v <= 1e12;
const stamp = () => new Date().toISOString();
const unsafeKey = key => ['__proto__','prototype','constructor'].includes(key);
const day = (m, d) => m + '-' + String(Math.min(d, daysInMonth(m))).padStart(2, '0');
const methodId = (s, name) => s.settings.instrumentIds?.[keyText(name)] || 'method:' + encodeURIComponent(keyText(name));
export const instrumentId = (s, t) => s.transactionControl?.[t.id]?.instrumentId || t.instrumentId || methodId(s, t.paymentMethod);
export const transactionBasis = t => JSON.stringify([t.date,t.amount,t.direction,t.paymentMethod,t.installments,t.billingMonth]);

// Additive migration. Stable IDs and payment-date snapshots do not alter original records.
export function ensureControl(s) {
  s.settings.instrumentIds ||= {};
  s.cardSettlements ||= [];
  s.billAdjustments ||= [];
  s.incomeReviews ||= [];
  s.limitHistory ||= [];
  s.fixedPayments ||= [];
  s.transactionControl ||= {};
  const names = new Set([...(s.settings.paymentMethods || []), ...s.transactions.map(t => t.paymentMethod), ...s.recurring.map(r => r.paymentMethod)]);
  for (const p of Object.values(s.settings.paymentProfiles || {})) names.add(p.name);
  for (const name of names) if (name && name !== '미지정') {
    const key = keyText(name), p = s.settings.paymentProfiles?.[key];
    if (unsafeKey(key)) throw Error('결제수단 이름을 확인해 주세요.');
    s.settings.instrumentIds[key] ||= p?.id || 'method:' + encodeURIComponent(key);
    if (p) p.id = s.settings.instrumentIds[key];
  }
  for (const t of s.transactions) {
    if (!t.paymentMethod) continue;
    // A changed payment label is deliberately rebound; rename preserves the ID map.
    if (!t.id) continue;
    if (unsafeKey(t.id)) throw Error('안전하지 않은 거래 ID예요.');
    const meta=s.transactionControl[t.id] ||= {};
    meta.instrumentId = methodId(s, t.paymentMethod);
    const p = s.settings.paymentProfiles?.[keyText(t.paymentMethod)];
    const basis = transactionBasis(t);
    if (p?.closingDay && p?.paymentDay && (!meta.billingSnapshot || meta.billingSnapshot.basis !== basis)) {
      const history = [...(p.billingHistory || [])].filter(h => h.effective <= t.date).sort((a,b)=>a.effective.localeCompare(b.effective));
      const terms = history.at(-1) || p;
      const window = billingWindow(t.date, { ...terms, kind:'credit' });
      meta.billingSnapshot = { ...window, basis, terms: { closingDay:terms.closingDay,paymentDay:terms.paymentDay,lagMonths:terms.lagMonths,holidayPolicy:terms.holidayPolicy || 'none', holidays:terms.holidays || [] } };
    }
  }
  return s;
}

export function adjustedDate(date, profile = {}) {
  if (!['next','previous'].includes(profile.holidayPolicy)) return date;
  const step = profile.holidayPolicy === 'next' ? 1 : -1;
  const holidays = new Set(profile.holidays || []);
  for (let n=0;n<370;n++) {
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(date)) return date;
    date = addDays(date, step);
  }
  throw Error('휴일 설정이 너무 길어요. 결제일을 확인해 주세요.');
}

export function cardCharges(s, asOf = today()) {
  const result = [];
  for (const t of s.transactions) {
    if (!active(t) || t.date > asOf || !['expense','refund'].includes(t.direction) || paymentKind(s,t.paymentMethod,t.sourceType) !== 'credit') continue;
    const p = s.settings.paymentProfiles?.[keyText(t.paymentMethod)];
    const snapshot=s.transactionControl?.[t.id]?.billingSnapshot || t.billingSnapshot;
    const saved = snapshot?.basis === transactionBasis(t) ? snapshot : null;
    const window = saved || billingWindow(t.date,p);
    if (!window) continue;
    const terms = saved?.terms || p;
    const count = t.direction === 'refund' ? 1 : (t.installments || 1);
    const startMonth = t.billingMonth || window.payment.slice(0,7);
    for (let i=0;i<count;i++) {
      const amount = Math.floor(t.amount/count) + (i < t.amount % count ? 1 : 0);
      const month = shiftMonth(startMonth,i);
      const nominal = day(month,terms.paymentDay);
      const paymentDate = adjustedDate(nominal,terms);
      result.push({txId:t.id,instrumentId:instrumentId(s,t),name:p?.name || t.paymentMethod,
        billId:instrumentId(s,t)+'|'+month,month,paymentDate,nominal,start:window.start,end:window.end,
        amount:amount*(t.direction==='refund'?-1:1),kind:t.excluded || t.scope==='excluded'?'excluded':costKind(t),part:i+1,parts:count});
    }
  }
  return result;
}

export function cardBills(s, asOf=today(), charges=cardCharges(s,asOf)) {
  const map = new Map();
  const add = r => {
    if (!map.has(r.billId)) map.set(r.billId,{id:r.billId,instrumentId:r.instrumentId,name:r.name,month:r.month,paymentDate:r.paymentDate,start:r.start,end:r.end,estimated:0,variable:0,fixed:0,excluded:0,rows:[]});
    const b=map.get(r.billId); b.estimated+=r.amount;
    b[r.kind==='fixed'?'fixed':r.kind==='excluded'?'excluded':'variable']+=r.amount;
    b.rows.push(r); b.start=[b.start,r.start].filter(Boolean).sort()[0]; b.end=[b.end,r.end].filter(Boolean).sort().at(-1);
  };
  for (const r of charges) add(r);
  for (const a of s.billAdjustments || []) if (!a.voidedAt) {
    const p=Object.values(s.settings.paymentProfiles || {}).find(p=>p.id===a.instrumentId);
    const month=a.billId.split('|').at(-1);
    add({...a,name:p?.name||a.name,month,paymentDate:a.paymentDate,kind:a.kind || 'variable'});
  }
  for (const b of map.values()) {
    const settlements=(s.cardSettlements || []).filter(r=>r.billId===b.id && !r.voidedAt);
    b.settlements=settlements.filter(r=>s.transactions.some(t=>t.id===r.txId && active(t) && t.direction==='transfer'));
    b.actual=b.settlements.reduce((n,r)=>n+s.transactions.find(t=>t.id===r.txId).amount,0);
    b.difference=b.actual-b.estimated;
    b.status=b.settlements.length ? b.difference===0?'matched':'mismatch':'pending';
    b.paymentDate=b.settlements.at(-1)?.scheduledDate || b.paymentDate;
  }
  return [...map.values()].sort((a,b)=>a.paymentDate.localeCompare(b.paymentDate)||a.name.localeCompare(b.name));
}

export function duplicateIncomes(s) {
  const buckets=new Map(), external=new Map(), pairs=[], reviewed=new Set((s.incomeReviews||[]).map(r=>(r.pairId||r.id)+'\n'+r.basis));
  for (const t of s.transactions) {
    if (!counted(t) || t.direction!=='income') continue;
    const key=[t.date,t.amount,instrumentId(s,t)].join('|');
    const group=buckets.get(key)||[];
    const externalKey=t.externalId ? instrumentId(s,t)+'|'+t.externalId : '';
    for (const a of new Set([...group,...(external.get(externalKey)||[])])) {
      const sameExternal=t.externalId && t.externalId===a.externalId;
      const sameName=keyText(t.merchantNormalized||t.merchantRaw)===keyText(a.merchantNormalized||a.merchantRaw);
      const seconds=Math.abs(Date.parse(t.datetime||t.date)-Date.parse(a.datetime||a.date))/1000;
      if (!sameExternal && !(sameName && seconds<=300)) continue;
      const id=[a.id,t.id].sort().join('|');
      const basis=JSON.stringify([a,t].sort((a,b)=>a.id.localeCompare(b.id)).map(x=>[x.id,x.date,x.datetime,x.amount,x.paymentMethod,x.merchantRaw,x.externalId,x.note]));
      if (!reviewed.has(id+'\n'+basis)) pairs.push({id,basis,a,b:t});
    }
    group.push(t);buckets.set(key,group);
    if(externalKey){const items=external.get(externalKey)||[];items.push(t);external.set(externalKey,items);}
  }
  return pairs;
}
export function resolveIncome(s,pair,duplicate) {
  const live=duplicateIncomes(s).find(p=>p.id===pair.id && p.basis===pair.basis);
  if (!live) throw Error('입금 기록이 변경됐어요. 다시 확인해 주세요.');
  const original=structuredClone(live.b);
  if (duplicate) {
    const t=live.b;
    t.duplicateOf=live.a.id;t.excluded=true;t.updatedAt=stamp();
  }
  s.incomeReviews.push({id:uid(),pairId:pair.id,basis:pair.basis,result:duplicate?'duplicate':'separate',original,at:stamp()});
}

export function fixedRows(s,month,asOf=today()) {
  const p=period(month,startDay(s)), months=[...new Set([p.start.slice(0,7),p.end.slice(0,7)])];
  return s.recurring.flatMap(r=>months.map(m=>occurrence(r,m)).filter(x=>x && x.date>=p.start && x.date<=p.end)).map(r=>{
    const explicit=(s.fixedPayments||[]).find(x=>x.id===r.id+'|'+r.date);
    const tx=s.transactions.filter(t=>counted(t) && t.date<=asOf && t.recurringId===r.id && (t.recurringDate ? t.recurringDate===r.date : inPeriod(t,s,month)));
    const actual=tx.reduce((n,t)=>n+expenseValue(t),0);
    const validExplicit=explicit && explicit.basis===JSON.stringify(tx.map(t=>[t.id,t.amount,t.direction,t.deletedAt]).sort());
    const paid=!!validExplicit || (tx.length>0 && actual>=r.amount);
    return {...r,categoryName:s.categories.find(c=>c.id===r.category)?.name||'',actual,transactions:tx,paid,status:paid?'paid':actual?'check':r.date<asOf?'overdue':'pending',outstanding:paid?0:Math.max(0,r.amount-actual)};
  }).sort((a,b)=>a.date.localeCompare(b.date));
}
export function confirmFixed(s, row, nextAmount, asOf=today()) {
  const current=fixedRows(s,row.month,asOf).find(r=>r.id===row.id && r.date===row.date);
  if (!current || !current.transactions.length) throw Error('실제 거래를 입력하거나 연결한 후 납부 확인해 주세요.');
  const item=s.recurring.find(r=>r.id===row.id);
  const id=row.id+'|'+row.date;
  const record={id,amount:current.actual,basis:JSON.stringify(current.transactions.map(t=>[t.id,t.amount,t.direction,t.deletedAt]).sort()),at:stamp()};
  const previous=s.fixedPayments.find(x=>x.id===id);
  record.history=[...(previous?.history||[]),...(previous?[{amount:previous.amount,at:previous.at}]:[])];
  s.fixedPayments=[...s.fixedPayments.filter(x=>x.id!==id),record];
  const nextMonth=shiftMonth(row.date.slice(0,7),1), effective=day(nextMonth,item.day);
  item.changes ||= [];
  const manual=item.changes.some(c=>c.effective.slice(0,7)===nextMonth && c.source!=='actual');
  if (nextAmount!==null || !manual) {
    const amount=nextAmount ?? Math.max(0,current.actual);
    if (!money(amount)) throw Error('다음 달 예정액을 확인해 주세요.');
    item.changes=item.changes.filter(c=>!(c.effective===effective && (nextAmount!==null || c.source==='actual')));
    item.changes.push({effective,amount,source:nextAmount===null?'actual':'manual',from:id});
  }
}

export function controlOverview(s,month,asOf=today()) {
  const p=period(month,startDay(s)), charges=cardCharges(s,asOf), allBills=cardBills(s,asOf,charges);
  const due=allBills.filter(b=>b.month===month), next=allBills.filter(b=>b.month===shiftMonth(month,1));
  const rows=s.transactions.filter(t=>counted(t) && inPeriod(t,s,month) && t.date<=asOf);
  const income=rows.reduce((n,t)=>n+budgetIncomeValue(t,s),0);
  const known=new Set(charges.map(r=>r.txId));
  const variable=rows.filter(t=>costKind(t)!=='fixed' && !known.has(t.id)).reduce((n,t)=>n+expenseValue(t),0)+due.reduce((n,b)=>n+b.variable,0);
  const fixed=rows.filter(t=>costKind(t)==='fixed').reduce((n,t)=>n+expenseValue(t),0);
  const plan=planFor(s,month), limit=limitFor(s,month,plan);
  const fixedItems=fixedRows(s,month,asOf), duplicates=duplicateIncomes(s);
  const alerts=[];
  if (asOf>=p.start && asOf<=p.end) {
    const d=dayStatus(s,asOf);
    if (!d.count && !(d.closed && d.record?.mode==='zero')) alerts.push({id:'day:'+asOf,menu:'transactions',label:'오늘 지출 기록 확인',action:'control-zero'});
  }
  for (const r of fixedItems) if (!r.paid && r.date<=addDays(asOf,3)) alerts.push({id:'fixed:'+r.id+'|'+r.date,menu:'home',label:r.name+' · '+(r.date<asOf?'미납 확인':'납부 예정'),action:'control-fixed',key:r.id,date:r.date});
  for (const b of due) if (b.status==='mismatch') alerts.push({id:'bill:'+b.id,menu:'cash',label:b.name+' · 청구·출금액 차이',action:'control-bill',key:b.id});
  for (const d of duplicates) alerts.push({id:'income:'+d.id,menu:'transactions',label:'중복 의심 입금 확인',action:'control-duplicate',key:d.id});
  for (const t of rows) if (classification(t,s).pending) alerts.push({id:'category:'+t.id,menu:'transactions',label:'거래 분류 확인',action:'money-review',key:t.id});
  if (![income,variable,fixed,limit].every(Number.isSafeInteger)) throw Error('합계 금액 범위를 확인해 주세요.');
  return {p,income,variable,fixed,limit,remaining:limit-variable,free:income-fixed-variable,fixedItems,due,next,allBills,duplicates,alerts,
    unconfigured:rows.filter(t=>paymentKind(s,t.paymentMethod,t.sourceType)==='credit' && !known.has(t.id) && ['expense','refund'].includes(t.direction))};
}
export function limitFor(s,month,plan=planFor(s,month)) {
  const exact=[...(s.limitHistory||[])].filter(r=>r.month===month && !r.repeat).at(-1);
  const repeating=[...(s.limitHistory||[])].filter(r=>r.repeat && r.month<=month).sort((a,b)=>a.month.localeCompare(b.month)||a.at.localeCompare(b.at)).at(-1);
  return exact?.amount ?? (s.settings.monthOverrides?.[month]?.variableBudget ?? repeating?.amount ?? plan.variableBudget ?? (plan.sharedBudget+plan.personalBudgets.p1+plan.personalBudgets.p2));
}
export function saveLimit(s,month,amount,repeat=false) {
  if (!money(amount) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('월 소비한도를 확인해 주세요.');
  s.limitHistory.push({id:uid(),month,amount,repeat,at:stamp()});
}

export function settleBill(s,bill,amount,date,accountId,existingId='') {
  if (!money(amount) || !validDate(date) || date>today()) throw Error('실제 납부일과 금액을 확인해 주세요.');
  let tx=s.transactions.find(t=>t.id===existingId && active(t));
  if (existingId && (!tx || tx.direction!=='transfer' || tx.amount!==amount)) throw Error('연결할 카드대금 이체의 금액을 확인해 주세요.');
  if (tx && s.cardSettlements.some(r=>r.txId===tx.id && !r.voidedAt)) throw Error('이미 청구분에 연결된 이체예요.');
  if (!tx) {
    if (!s.cashAccounts?.some(a=>a.id===accountId && !a.archived)) throw Error('결제계좌를 먼저 등록해 주세요.');
    const account=s.cashAccounts.find(a=>a.id===accountId), id=uid();
    tx={id,sourceId:id,date,datetime:date+'T00:00:00',amount,direction:'transfer',scope:'excluded',excluded:true,owner:account.owner||'joint',category:'finance',categoryConfirmed:true,paymentMethod:account.paymentMethod||account.name,merchantRaw:bill.name+' 카드대금',merchantNormalized:bill.name+' 카드대금',sourceType:'manual',note:'카드 사용내역 정산',createdAt:stamp(),updatedAt:stamp()};
    s.transactions.push(tx);
    saveCashLink(s,id,[{accountId,direction:'out',at:tx.datetime}],false,cashFingerprint(tx));
  }
  s.cardSettlements.push({id:uid(),billId:bill.id,instrumentId:bill.instrumentId,txId:tx.id,scheduledDate:bill.paymentDate,at:stamp()});
}
export function validateControl(s) {
  for (const key of ['cardSettlements','billAdjustments','fixedPayments','incomeReviews','limitHistory']) {
    if (s[key]===undefined) continue;
    if (!Array.isArray(s[key]) || s[key].length>100000) throw Error('가계부 확인 이력 형식을 확인해 주세요.');
    if (s[key].some(r=>!r || typeof r.id!=='string' || !r.id)) throw Error('확인 이력 ID를 확인해 주세요.');
  }
  for (const t of s.transactions) {
    if (t.installments!==undefined && (!Number.isInteger(t.installments)||t.installments<1||t.installments>120)) throw Error('할부개월은 1~120개월이에요.');
    if (t.billingMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(t.billingMonth)) throw Error('청구월을 확인해 주세요.');
  }
  for (const a of s.billAdjustments || []) if (!Number.isSafeInteger(a.amount) || Math.abs(a.amount)>1e12 || !a.reason || !validDate(a.paymentDate)) throw Error('카드 청구 조정값을 확인해 주세요.');
  for (const l of s.limitHistory || []) if (!money(l.amount)) throw Error('소비한도 기록을 확인해 주세요.');
}
