import { keyText } from './format.js';
import { validDate } from './period.js';
// All cash cutoffs are explicit Korea wall-clock times, independent of budget periods.
export function cashNow() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 19);
}
export const validCashTime = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(v) && validDate(v.slice(0, 10));
export const cashTime = v => String(v || '').length === 16 ? v + ':00' : String(v || '');
const money = n => Number.isSafeInteger(n) && n >= 0 && n <= 1e12;
export function ensureCash(s) { s.cashAccounts ??= []; s.cashChecks ??= []; s.cashLinks ??= []; return s; }
export function cashRoots(s) { return s.transactions.filter(t => !t.deletedAt && !t.parentId); }
export const cashFingerprint = t => JSON.stringify([t.id, t.date, t.datetime, t.amount, t.direction, t.paymentMethod, t.owner]);
export function cashHidden(t, s) {
  return !!s.settings.privacy && (["p1", "p2"].includes(t.scope) || (t.splitParent && s.transactions.some(c => c.parentId === t.id && ["p1", "p2"].includes(c.scope))));
}
const cardRecord = t => /^card-/.test(t.sourceType || '') || /카드|card|마스터|master|visa|비자/i.test(t.paymentMethod || '');
export function validateCash(s) {
  for (const key of ['cashAccounts','cashChecks','cashLinks']) {
    if (s[key] === undefined) continue;
    if (!Array.isArray(s[key]) || s[key].length > 100000) throw Error('계좌·잔액 자료 형식을 확인해 주세요.');
    const ids = new Set();
    for (const x of s[key]) {
      if (!x || typeof x.id !== 'string' || !x.id || ids.has(x.id)) throw Error('계좌·잔액 자료 ID가 중복되거나 잘못됐어요.');
      ids.add(x.id);
    }
  }
  const accounts = s.cashAccounts || [], ids = new Set(accounts.map(a => a.id));
  if (accounts.length > 200) throw Error('계좌는 200개까지 등록할 수 있어요.');
  const bindings = new Set();
  for (const a of accounts) {
    if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 80 || !['p1','p2','joint'].includes(a.owner) || !money(a.openingBalance) || !money(a.reserved) || !validCashTime(a.openingAt) || typeof a.paymentMethod !== 'string' || a.paymentMethod.length > 100 || typeof a.autoMatch !== 'boolean') throw Error('계좌 이름·기준잔액·기준시각을 확인해 주세요.');
    if (!a.archived && a.autoMatch) {
      const k = a.owner + '|' + keyText(a.paymentMethod);
      if (!keyText(a.paymentMethod) || cardRecord({paymentMethod:a.paymentMethod}) || bindings.has(k)) throw Error('자동 연결은 중복되지 않는 실제 은행계좌명으로만 설정해 주세요. 카드명은 연결할 수 없어요.');
      bindings.add(k);
    }
  }
  for (const c of s.cashChecks || [])
    if (!ids.has(c.accountId) || !validCashTime(c.at) || !money(c.actual) || !Number.isSafeInteger(c.expected) || !Number.isSafeInteger(c.difference) || (!Number.isSafeInteger(c.pending) || c.pending < 0) || c.difference !== c.actual-c.expected || typeof c.note !== 'string' || c.note.length > 1000) throw Error('잔액 확인 기록을 확인해 주세요.');
  for (const l of s.cashLinks || []) {
    if (typeof l.ignored !== 'boolean' || typeof l.basis !== 'string' || !Array.isArray(l.legs) || l.legs.length > 2 || (l.ignored ? l.legs.length !== 0 : !l.legs.length)) throw Error('계좌 거래 연결 형식을 확인해 주세요.');
    const seen = new Set();
    for (const leg of l.legs) {
      if (!ids.has(leg.accountId) || !['in','out'].includes(leg.direction) || !validCashTime(leg.at) || seen.has(leg.accountId)) throw Error('출금·입금 계좌 또는 실제 처리시각을 확인해 주세요.');
      seen.add(leg.accountId);
    }
    if (l.legs.length === 2 && new Set(l.legs.map(x=>x.direction)).size !== 2) throw Error('계좌 간 이동은 출금·입금 한 쌍으로 연결해 주세요.');
  }
}
// Excluding something from household spending does NOT exclude it from bank cash flow.
export function cashConnection(t, s, links) {
  const link = links ? links.get(t.id) : (s.cashLinks || []).find(l => l.id === t.id);
  if (link) {
    if (link.basis !== cashFingerprint(t)) return { status:'review', reason:'원거래가 변경됐어요. 계좌 연결을 다시 확인해 주세요.', legs:[], affected:link.legs.map(l=>l.accountId), reviewTimes:link.legs.map(l=>l.at) };
    return { status:link.ignored ? 'ignored' : 'linked', legs:link.legs, reason:link.ignored ? '계좌 계산에서만 제외' : '직접 확인한 계좌 연결' };
  }
  const accounts = (s.cashAccounts || []).filter(a => !a.archived && a.autoMatch && a.owner === t.owner && keyText(a.paymentMethod) && keyText(a.paymentMethod) === keyText(t.paymentMethod));
  if (accounts.length === 1 && !cardRecord(t)) {
    const a = accounts[0];
    if (t.direction === 'transfer') return {status:'review',reason:'이체의 입금·출금 방향을 확인해 주세요.',legs:[],affected:[a.id]};
    const at = cashTime(t.datetime);
    if (!validCashTime(at) || at.endsWith('T00:00:00') || at.endsWith('T12:00:00')) return {status:'review',reason:'원본에 정확한 거래시각이 있는지 확인해 주세요.',legs:[],affected:[a.id]};
    return {status:'auto',legs:[{accountId:a.id,direction:t.direction === 'expense' ? 'out' : 'in',at}],reason:'확인한 은행계좌명과 사용자 일치'};
  }
  return {status:cardRecord(t) ? 'card' : 'unlinked', legs:[], reason:cardRecord(t) ? '카드 이용은 현금 출금이 아님 · 체크카드라면 직접 연결' : '현금 거래인지, 어느 계좌인지 확인 필요'};
}
export function cashRows(s) { const links=new Map((s.cashLinks||[]).map(l=>[l.id,l])); return cashRoots(s).map(t => ({t,...cashConnection(t,s,links)})); }
export function cashLedger(s, a, at = cashNow(), rows = cashRows(s)) {
  let incoming=0, outgoing=0;
  const entries=[], pending=[];
  for (const r of rows) {
    const relevant = (r.t.date >= a.openingAt.slice(0,10) && r.t.date <= at.slice(0,10)) || r.reviewTimes?.some(v=>v>a.openingAt&&v<=at);
    if (r.status === 'review' && r.affected?.includes(a.id) && relevant) pending.push(r);
    for (const leg of r.legs) if (leg.accountId === a.id && leg.at > a.openingAt && leg.at <= at) {
      if (leg.direction === 'in') incoming += r.t.amount; else outgoing += r.t.amount;
      entries.push({...r,leg});
    }
  }
  const expected = a.openingBalance + incoming - outgoing;
  if (![expected,incoming,outgoing].every(Number.isSafeInteger)) throw Error('계좌 합계가 안전한 계산 범위를 넘었어요.');
  return {incoming,outgoing,expected,entries,pending};
}
export function cashSummary(s, at = cashNow()) {
  const rows=cashRows(s), active=(s.cashAccounts || []).filter(a=>!a.archived);
  const accounts=active.map(a=>{
    const checks=(s.cashChecks||[]).filter(c=>c.accountId===a.id&&!c.voidedAt&&c.at>=a.openingAt&&c.at<=at).sort((x,y)=>y.at.localeCompare(x.at)||String(y.createdAt).localeCompare(String(x.createdAt)));
    const last=checks[0], measuredAt=last?.at||a.openingAt, actual=last?.actual??a.openingBalance;
    const checked=cashLedger(s,a,measuredAt,rows), now=cashLedger(s,a,at,rows);
    const difference=last?actual-checked.expected:null;
    return {...a,last,checks,measuredAt,actual,usable:actual-a.reserved,checked,now,difference,
      recalculated:!!last&&(last.expected!==checked.expected||last.pending!==checked.pending.length),
      status:!last?'baseline':checked.pending.length?'review':difference===0?'matched':'different'};
  });
  const first=active.map(a=>a.openingAt.slice(0,10)).sort()[0];
  const pending=rows.filter(r=>['unlinked','review'].includes(r.status)&&first&&r.t.date>=first&&r.t.date<=at.slice(0,10));
  return {accounts,rows,pending,actual:accounts.reduce((n,a)=>n+a.actual,0),usable:accounts.reduce((n,a)=>n+a.usable,0),
    reserved:accounts.reduce((n,a)=>n+a.reserved,0),expected:accounts.reduce((n,a)=>n+a.now.expected,0),
    mismatchCount:accounts.filter(a=>a.difference!==null&&a.difference!==0).length,
    absoluteDifference:accounts.reduce((n,a)=>n+Math.abs(a.difference||0),0),
    baselineCount:accounts.filter(a=>!a.last).length,oldest:accounts.map(a=>a.measuredAt).sort()[0]||''};
}
export function saveCashAccount(s, input, original = null, at=cashNow()) {
  ensureCash(s);
  const existing=s.cashAccounts.find(a=>a.id===input.id);
  if (original && JSON.stringify(existing)!==JSON.stringify(original)) throw Error('다른 기기에서 계좌 설정이 변경됐어요. 다시 열어 주세요.');
  if (input.openingAt>at) throw Error('미래 시각을 기준잔액으로 저장할 수 없어요.');
  if (existing && (input.openingAt!==existing.openingAt || input.openingBalance!==existing.openingBalance)) throw Error('기준잔액은 기존 확인 이력 보존을 위해 바꿀 수 없어요. 잘못 등록한 계좌는 사용 종료 후 다시 등록해 주세요.');
  if (existing && !original) throw Error('계좌가 이미 등록돼 있어요.');
  const next={...existing,...input};
  const preview={...s,cashAccounts:[...s.cashAccounts.filter(a=>a.id!==next.id),next]};
  validateCash(preview);s.cashAccounts=preview.cashAccounts;return next;
}
export function saveCashLink(s, id, legs, ignored=false, expectedBasis='', at=cashNow()) {
  ensureCash(s);
  const t=cashRoots(s).find(t=>t.id===id);
  if (!t || cashHidden(t,s)) throw Error('이 거래는 없거나 개인 내역이 숨겨져 있어요.');
  if (expectedBasis && cashFingerprint(t)!==expectedBasis) throw Error('원거래가 변경됐어요. 다시 확인해 주세요.');
  if (legs.some(l=>l.at>at)) throw Error('미래의 출금·입금을 실제 거래로 연결할 수 없어요.');
  const item={id,basis:cashFingerprint(t),legs,ignored,updatedAt:new Date().toISOString()};
  const next={...s,cashLinks:[...s.cashLinks.filter(l=>l.id!==id),item]};validateCash(next);s.cashLinks=next.cashLinks;
}
export function saveCashCheck(s, {id,accountId,at,actual,note=''}, now=cashNow()) {
  ensureCash(s);const a=s.cashAccounts.find(a=>a.id===accountId&&!a.archived);
  if (!a || !validCashTime(at) || at<=a.openingAt || at>now || !money(actual)) throw Error('기준시각 이후의 실제 잔액과 확인시각을 입력해 주세요.');
  if(s.cashChecks.some(c=>!c.voidedAt&&c.accountId===accountId&&c.at===at)) throw Error('같은 시각의 잔액 확인이 이미 있어요. 이력에서 잘못된 확인을 취소한 뒤 다시 입력해 주세요.');
  const b=cashLedger(s,a,at), check={id,accountId,at,actual,note:String(note).slice(0,1000),expected:b.expected,difference:actual-b.expected,pending:b.pending.length,createdAt:new Date().toISOString()};
  const preview={...s,cashChecks:[...s.cashChecks,check]};validateCash(preview);s.cashChecks=preview.cashChecks;return check;
}
