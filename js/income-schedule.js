import { today, daysInMonth } from './format.js';
import { period, startDay, inPeriod, validDate } from './period.js';
import { budgetIncomeValue } from './import/normalize.js';

const validMonth = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '');
const isMoney = n => Number.isSafeInteger(n) && n >= 0 && n <= 1e12;
export function validateIncomeEntries(entries, allowDate = true) {
  if (!Array.isArray(entries) || entries.length > 30) throw Error('날짜별 수입은 30개까지 설정할 수 있어요.');
  const ids = new Set();
  for (const r of entries) {
    if (!r || typeof r.id !== 'string' || !r.id || ids.has(r.id) || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 80 || !isMoney(r.amount) || !Number.isInteger(r.day) || r.day < 1 || r.day > 31 || !['p1','p2','joint'].includes(r.owner)) throw Error('수입 이름·금액·입금일·수입자를 확인해 주세요.');
    if (r.date && (!allowDate || !validDate(r.date))) throw Error('이번 기간의 예외 입금일을 확인해 주세요.');
    ids.add(r.id);
  }
  const total = entries.reduce((sum,r)=>sum+r.amount,0);
  if (!isMoney(total)) throw Error('계획 수입 합계는 1조 원 이하로 설정해 주세요.');
  return total;
}
export function validateIncomeSchedules(s) {
  const versions = s.settings.incomeSchedules;
  if (versions !== undefined && (!versions || typeof versions !== 'object' || Array.isArray(versions))) throw Error('날짜별 수입 설정 형식이 올바르지 않아요.');
  for (const [month,entries] of Object.entries(versions || {})) {
    if (!validMonth(month)) throw Error('수입 적용 시작월을 확인해 주세요.');
    validateIncomeEntries(entries, false);
  }
  for (const [month,o] of Object.entries(s.settings.monthOverrides || {})) if (o.incomeSchedule !== undefined) {
    if (!validMonth(month)) throw Error('수입 적용월을 확인해 주세요.');
    validateIncomeEntries(o.incomeSchedule);
  }
}
// A dated plan replaces the old monthly total. It never adds synthetic income transactions.
export function incomeScheduleFor(s, month) {
  const o = s.settings.monthOverrides?.[month] || {};
  if (Array.isArray(o.incomeSchedule)) return {entries:o.incomeSchedule,source:'month',since:month};
  // Preserve previously saved, explicit month totals until that month is edited.
  if (o.income !== undefined) return null;
  if (validMonth(s.settings.incomeStartMonth) && month < s.settings.incomeStartMonth) return null;
  const since = Object.keys(s.settings.incomeSchedules || {}).filter(m=>m<=month).sort().at(-1);
  return since ? {entries:s.settings.incomeSchedules[since],source:'default',since} : null;
}
export function scheduledIncome(s, month) {
  const schedule = incomeScheduleFor(s,month);
  return schedule ? validateIncomeEntries(schedule.entries) : null;
}
export function incomeDate(s, month, row) {
  if (row.date) return row.date;
  const p=period(month,startDay(s));
  const candidates=[...new Set([p.start.slice(0,7),p.end.slice(0,7)])].map(m=>`${m}-${String(Math.min(row.day,daysInMonth(m))).padStart(2,'0')}`);
  return candidates.find(d=>d>=p.start&&d<=p.end) || candidates.at(-1);
}
export const liveIncome = (t,s) => !t.deletedAt && !t.splitParent && !t.excluded && t.scope !== 'excluded' && t.direction === 'income' && budgetIncomeValue(t,s) > 0;
export function incomeScheduleLedger(s,month,asOf=today()) {
  const schedule=incomeScheduleFor(s,month);
  const actual=s.transactions.filter(t=>liveIncome(t,s)&&inPeriod(t,s,month)&&t.date<=asOf);
  const rows=(schedule?.entries||[]).map(r=>{
    const date=incomeDate(s,month,r), linked=actual.filter(t=>t.incomeScheduleId===r.id);
    const received=linked.reduce((n,t)=>n+t.amount,0);
    return {...r,date,linked,received,remaining:Math.max(0,r.amount-received),difference:linked.length?received-r.amount:null,
      status:linked.length?(received===r.amount?'received':'different'):r.amount===0?'none':(date>asOf?'upcoming':'check')};
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  const ids=new Set(rows.map(r=>r.id));
  return {schedule,rows,total:rows.reduce((n,r)=>n+r.amount,0),received:rows.reduce((n,r)=>n+r.received,0),
    remaining:rows.reduce((n,r)=>n+r.remaining,0),unassigned:actual.filter(t=>!ids.has(t.incomeScheduleId))};
}
// Fingerprint only income configuration; unrelated expense edits may merge safely.
export function incomePlanBasis(s,month) {
  const o=s.settings.monthOverrides?.[month]||{};
  return JSON.stringify([s.settings.income,s.settings.incomeStartMonth,s.settings.incomeSchedules,o.income,o.incomeBase,o.incomeExtra,o.incomeSchedule]);
}
export function saveIncomeSchedule(s,month,entries,future=false,basis) {
  if (!validMonth(month)) throw Error('적용할 가계부 월을 확인해 주세요.');
  if (basis !== undefined && basis !== incomePlanBasis(s,month)) throw Error('다른 기기에서 수입 설정이 변경됐어요. 다시 열어 확인해 주세요.');
  const total=validateIncomeEntries(entries);
  const kept=new Set(entries.map(r=>r.id)), previous=incomeScheduleFor(s,month)?.entries || [];
  if(previous.some(r=>!kept.has(r.id)&&s.transactions.some(t=>liveIncome(t,s)&&inPeriod(t,s,month)&&t.incomeScheduleId===r.id))) throw Error('실제 입금이 연결된 일정은 먼저 입금 연결을 해제한 뒤 빼 주세요.');
  s.settings.monthOverrides ||= {};
  s.settings.monthOverrides[month]={...s.settings.monthOverrides[month],income:total,incomeSchedule:structuredClone(entries)};
  if(future){
    s.settings.incomeSchedules ||= {};
    s.settings.incomeSchedules[month]=entries.map(({date,...r})=>structuredClone(r));
  }
  return total;
}
export function linkScheduledIncome(s,month,rowId,txId,original) {
  const row=incomeScheduleFor(s,month)?.entries.find(r=>r.id===rowId);
  const t=s.transactions.find(t=>t.id===txId);
  if (!row || !t || !liveIncome(t,s) || t.date>today()) throw Error('연결할 실제 수입을 다시 확인해 주세요.');
  if (original && JSON.stringify(original)!==JSON.stringify(t)) throw Error('입금 내역이 다른 기기에서 변경됐어요. 다시 확인해 주세요.');
  if(t.incomeScheduleId && (t.incomeScheduleId!==rowId||!inPeriod(t,s,month))) throw Error('이미 다른 수입 일정에 연결돼 있어요. 먼저 연결을 해제해 주세요.');
  t.incomeScheduleId=rowId;
  t.operatingMonth=month;
  t.updatedAt=new Date().toISOString();
}
