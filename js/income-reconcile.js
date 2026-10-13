import { today, shiftMonth } from "./format.js";
import { period, startDay, addDays, inPeriod, transactionPeriod } from "./period.js";
import { liveIncome } from "./income-schedule.js";

// Pure view model: never synthesize deposits or modify transactions.
export function incomeReconciliation(state, month, asOf = today()) {
  const selected = period(month, startDay(state));
  const records = state.transactions
    .filter(t => !t.deletedAt && !t.splitParent && t.direction === "income" && t.date <= asOf)
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.datetime || "").localeCompare(String(a.datetime || "")));
  const current = records.filter(t => liveIncome(t, state) && inPeriod(t, state, month));
  // Surface recent early deposits that the user might wish to allocate to
  // this cycle, without presuming they were paid for the upcoming cycle.
  const nearby = records.filter(t =>
    liveIncome(t, state) && !inPeriod(t, state, month) &&
    t.date >= addDays(selected.start, -7) && t.date < selected.start &&
    t.date <= asOf
  );
  return {
    records,
    current,
    nearby,
    amount: current.reduce((sum, t) => sum + t.amount, 0),
    nearbyAmount: nearby.reduce((sum, t) => sum + t.amount, 0),
  };
}

export function incomeAssignmentOptions(state, month, transaction) {
  return [...new Set([
    month,
    transactionPeriod(transaction, state),
    shiftMonth(month, -1),
    shiftMonth(month, 1),
  ])].filter(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)).map(m => [m, m + " 운영월"]);
}

export function reassignRecordedIncome(state, id, month, expected) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw Error("반영할 운영월을 확인해 줘.");
  const transaction = state.transactions.find(t => t.id === id);
  if (!transaction || JSON.stringify(transaction) !== JSON.stringify(expected))
    throw Error("기존 입금 내역이 변경됐어. 다시 확인해 줘.");
  if (!liveIncome(transaction, state) || transaction.date > today())
    throw Error("이 내역은 실제 생활수입으로 집계할 수 없어.");
  const previousMonth = transactionPeriod(transaction, state);
  if (previousMonth === month) return false;
  transaction.operatingMonth = month;
  // A dated income schedule link belongs to its previous cycle, and must
  // never become a second/synthetic credit when reassigned.
  delete transaction.incomeScheduleId;
  transaction.updatedAt = new Date().toISOString();
  return true;
}

export function findDuplicateIncome(state, { date, amount, owner, merchant }) {
  const normalized = String(merchant || "").trim();
  return state.transactions.find(t =>
    !t.deletedAt && !t.splitParent && t.direction === "income" &&
    t.date === date && t.amount === amount && t.owner === owner &&
    t.merchantRaw === normalized
  ) || null;
}
