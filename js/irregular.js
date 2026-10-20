import { today, normalizeText, keyText } from './format.js';
import { validDate, dayDiff } from './period.js';

export const irregularPayers = [['p1','박태영'],['p2','김은영'],['joint','공동'],['unknown','미정']];
const money = n => Number.isSafeInteger(n) && n > 0 && n <= 1e12;
const live = t => t && !t.deletedAt && !t.splitParent && !t.duplicateOf && !t.excluded && t.scope !== 'excluded';
export const isIrregular = t => t.irregularFixed === true;
export function irregularTransaction(s, r) {
  return s.transactions.find(t => t.id === r.txId && live(t) && t.direction === 'expense' && isIrregular(t));
}
export function irregularRows(s, asOf = today()) {
  return (s.irregularExpenses || []).filter(r => !r.deletedAt).map(r => {
    const tx = irregularTransaction(s,r), paid = !!tx && tx.date <= asOf;
    const days = dayDiff(asOf,r.dueDate);
    return {...r, tx, paid, actual:paid?tx.amount:0, paidDate:paid?tx.date:'',
      label:paid?'납부 완료':r.txId&&!tx?'연결 거래 확인 필요':days<0?'납부일 경과':days===0?'오늘 납부':days<=7?`${days}일 후 납부`:'납부 예정',
      urgent:!paid&&(days<=7 || (!!r.txId&&!tx))};
  }).sort((a,b)=>Number(a.paid)-Number(b.paid)||(a.paid?b.paidDate.localeCompare(a.paidDate):a.dueDate.localeCompare(b.dueDate))||a.name.localeCompare(b.name,'ko'));
}
export function irregularCandidates(s, id, asOf=today()) {
  const used=new Set((s.irregularExpenses||[]).filter(r=>!r.deletedAt && r.id!==id).map(r=>r.txId));
  return s.transactions.filter(t=>live(t)&&t.direction==='expense'&&t.date<=asOf&&!t.recurringId&&!used.has(t.id))
    .sort((a,b)=>b.date.localeCompare(a.date));
}
export function saveIrregular(s, input, payment=null, expected=null, asOf=today()) {
  s.irregularExpenses ||= [];
  const old=s.irregularExpenses.find(r=>r.id===input.id);
  if(JSON.stringify(old||null)!==JSON.stringify(expected)) throw Error('다른 기기에서 항목이 변경됐어요. 다시 열어 주세요.');
  if(old?.deletedAt) throw Error('삭제된 항목이에요.');
  const at=new Date().toISOString();
  const next={...old,id:input.id,name:String(input.name||'').trim(),dueDate:input.dueDate,amount:input.amount,payer:input.payer,note:String(input.note||'').trim(),updatedAt:at,createdAt:old?.createdAt||at};
  validateItem(next);
  if(payment) {
    if(old?.txId && payment.txId!==old.txId) throw Error('기존 납부 연결을 먼저 해제해 주세요.');
    let tx;
    if(payment.txId) {
      tx=irregularCandidates(s,next.id,asOf).find(t=>t.id===payment.txId);
      if(!tx) throw Error('연결할 거래가 변경되었거나 이미 다른 지출에 연결됐어요.');
      if(payment.basis && JSON.stringify(tx)!==payment.basis) throw Error('거래가 변경됐어요. 다시 선택해 주세요.');
    } else {
      if(!money(payment.amount)||!validDate(payment.date)||payment.date>asOf||!String(payment.method||'').trim()) throw Error('실제 납부일·금액·결제수단을 확인해 주세요.');
      // Stable ID makes repeated submissions and simultaneous offline completion idempotent.
      const id='irregular:'+next.id;
      if(s.transactions.some(t=>t.id===id)) throw Error('이 항목에서 만든 거래가 이미 있어요. 기존 거래를 연결하거나 휴지통에서 복원해 주세요.');
      if(s.transactions.some(t=>live(t)&&t.direction==='expense'&&t.date===payment.date&&t.amount===payment.amount&&keyText(t.paymentMethod)===keyText(payment.method)))
        throw Error('같은 날짜·금액·결제수단의 지출이 있어요. 기존 거래 연결에서 확인해 주세요.');
      const person=irregularPayers.find(([key])=>key===next.payer)?.[1];
      const owner=['p1','p2'].find(key=>s.settings.members[key]===person)||'joint';
      tx={id,sourceId:id,date:payment.date,datetime:payment.date+'T00:00:00',amount:payment.amount,direction:'expense',scope:'fixed',costKind:'fixed',owner,category:'other',categoryConfirmed:true,merchantRaw:next.name,merchantNormalized:normalizeText(next.name),paymentMethod:String(payment.method).trim(),sourceType:'manual',note:next.note,createdAt:at,updatedAt:at};
      s.transactions.push(tx);
    }
    tx.irregularFixed=true;
    tx.updatedAt=at;
    next.txId=tx.id;
  }
  if(old) s.irregularExpenses[s.irregularExpenses.indexOf(old)]=next;
  else s.irregularExpenses.push(next);
}
export function detachIrregular(s,id,expected,remove=false) {
  const r=(s.irregularExpenses||[]).find(x=>x.id===id&&!x.deletedAt);
  if(!r||JSON.stringify(r)!==JSON.stringify(expected)) throw Error('항목이 변경됐어요. 다시 열어 주세요.');
  // An actual expense is never erased by deleting a schedule or changing its status.
  if(remove) r.deletedAt=new Date().toISOString();
  else delete r.txId;
  r.updatedAt=new Date().toISOString();
}
function validateItem(r) {
  if(!r||typeof r.id!=='string'||!r.id||r.id.length>150||typeof r.name!=='string'||!r.name.trim()||r.name.length>150||!validDate(r.dueDate)||!money(r.amount)||!irregularPayers.some(([id])=>id===r.payer)||typeof r.note!=='string'||r.note.length>1000||(r.txId!==undefined&&typeof r.txId!=='string')) throw Error('비정기 고정지출의 이름·납부일·금액·납부자를 확인해 주세요.');
}
export function validateIrregular(s) {
  if(s.irregularExpenses===undefined)return;
  if(!Array.isArray(s.irregularExpenses)||s.irregularExpenses.length>100000)throw Error('비정기 고정지출 목록을 확인해 주세요.');
  const ids=new Set(),links=new Set();
  for(const r of s.irregularExpenses) {
    validateItem(r);
    if(ids.has(r.id))throw Error('비정기 지출 ID가 중복됐어요.');
    ids.add(r.id);
    if(!r.deletedAt&&r.txId){
      if(links.has(r.txId))throw Error('하나의 거래를 여러 비정기 지출에 연결할 수 없어요.');
      links.add(r.txId);
      const t=s.transactions.find(t=>t.id===r.txId);
      if(t&&live(t)&&(!isIrregular(t)||t.direction!=='expense'||t.recurringId))throw Error('연결된 비정기 지출은 홈에서 연결을 해제한 뒤 변경해 주세요.');
    }
  }
}
