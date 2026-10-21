import { savePaymentProfile, billingWindow } from './payment-channels.js';
import { ensureControl, cardCharges, adjustedDate, limitExpense } from './control.js';
import { keyText, today } from './format.js';

// Preview and save use the same isolated calculation. Never rewrite purchase records.
export function previewCardCycle(state, name, kind, close, payment, lag, metadata, asOf=today()) {
  const next=structuredClone(state);
  ensureControl(next);
  const key=keyText(name), before=next.settings.paymentProfiles?.[key];
  const oldCharges=cardCharges(next,asOf);
  const settledBills=new Set((next.cardSettlements||[]).filter(r=>!r.voidedAt && next.transactions.some(t=>t.id===r.txId&&!t.deletedAt&&t.direction==='transfer')).map(r=>r.billId));
  const protectedIds=new Set(oldCharges.filter(r=>settledBills.has(r.billId)).map(r=>r.txId));
  const ownTransactions=next.transactions.filter(t=>keyText(t.paymentMethod)===key);
  if (before?.kind==='credit' && kind!=='credit' && ownTransactions.some(t=>protectedIds.has(t.id)))
    throw Error('납부기록이 있는 신용카드는 결제방식을 바꿀 수 없어요. 별도 결제수단으로 등록해 주세요.');
  const profile=savePaymentProfile(next,name,kind,close,payment,lag,undefined,metadata);
  const termsChanged=JSON.stringify([before?.kind,before?.billingHistory,before?.closingDay,before?.paymentDay,before?.lagMonths])!==JSON.stringify([profile.kind,profile.billingHistory,profile.closingDay,profile.paymentDay,profile.lagMonths]);
  if (termsChanged) for (const tx of ownTransactions) {
    if (tx.date<metadata.effective || protectedIds.has(tx.id)) continue;
    if (next.transactionControl[tx.id]) delete next.transactionControl[tx.id].billingSnapshot;
  }
  ensureControl(next);
  const newCharges=cardCharges(next,asOf);
  const allocations=(charges,t)=>{
    const rows=charges.filter(r=>r.txId===t.id);
    return rows.length ? rows.map(r=>({month:r.month,amount:r.amount,payment:r.paymentDate,nominal:r.nominal,start:r.start,end:r.end})) : [{month:t.date.slice(0,7),amount:t.amount*(t.direction==='refund'?-1:1),payment:null}];
  };
  const changes=[], totals=new Map();
  for (const t of ownTransactions) {
    if(t.deletedAt||t.duplicateOf||t.splitParent||t.date>asOf||!['expense','refund'].includes(t.direction))continue;
    const old=allocations(oldCharges,t), after=allocations(newCharges,t);
    if(JSON.stringify(old)===JSON.stringify(after))continue;
    changes.push({id:t.id,date:t.date,amount:t.amount,before:old,after});
    if(limitExpense(next,t))for(const [sign,rows] of [[-1,old],[1,after]])for(const r of rows)totals.set(r.month,(totals.get(r.month)||0)+sign*r.amount);
  }
  const window=kind==='credit'?billingWindow(asOf,profile):null;
  // Only existing records in this actual usage window; no future purchase forecasts.
  const usage=window?ownTransactions.filter(t=>!t.deletedAt&&!t.duplicateOf&&!t.splitParent&&t.date>=window.start&&t.date<=window.end&&t.date<=asOf).reduce((sum,t)=>sum+(t.direction==='expense'?t.amount:t.direction==='refund'?-t.amount:0),0):0;
  return {next,changes,totals:[...totals].filter(([,amount])=>amount!==0).sort(([a],[b])=>a.localeCompare(b)),protectedCount:ownTransactions.filter(t=>protectedIds.has(t.id)).length,
    window:window?{...window,adjusted:adjustedDate(window.payment,profile)}:null,usage};
}
export function applyCardCycle(state, name, kind, close, payment, lag, metadata, confirmed=false, asOf=today()) {
  const result=previewCardCycle(state,name,kind,close,payment,lag,metadata,asOf);
  if(result.changes.length&&!confirmed)throw Error('변경 전후 반영월과 영향금액을 확인하고 변경 적용 확인란을 선택해 주세요.');
  const profile=result.next.settings.paymentProfiles[keyText(name)];
  if(result.changes.length){
    profile.cycleChangeLog=[...(profile.cycleChangeLog||[]),{at:new Date().toISOString(),effective:metadata.effective,changes:result.changes,totals:result.totals,protectedCount:result.protectedCount}];
  }
  state.settings.paymentProfiles=result.next.settings.paymentProfiles;
  state.settings.paymentMethods=result.next.settings.paymentMethods;
  state.settings.instrumentIds=result.next.settings.instrumentIds;
  state.transactionControl=result.next.transactionControl;
  return result;
}
