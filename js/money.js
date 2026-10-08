import { incomeScheduleFor, incomeDate } from "./income-schedule.js";
import { dashboard, liveExpense, costKind } from "./behavior.js";
import { expenseValue } from "./budget.js";
import { classify } from "./rules.js";
import { today, keyText, shiftMonth } from "./format.js";
import { inPeriod, dayDiff, periodKey, period, startDay } from "./period.js";
import { occurrence } from "./recurring.js";

// A payment channel is not evidence of what was purchased.
export function ambiguousMerchant(t) {
  const name = keyText(t.merchantNormalized || t.merchantRaw || "");
  return /^(네이버페이|네이버파이낸셜|카카오페이|토스페이|토스페이먼츠|쿠팡|쿠팡페이|페이코|나이스페이|나이스페이먼츠|kcp|nhnkcp|kg이니시스|이니시스|스마트로|인터넷상거래|온라인결제|전자결제|간편결제|결제대행)(주식회사|주|결제|[0-9])*$/i.test(name);
}
function userCategory(t, s) {
  const result = classify(t, s.rules);
  const rule = s.rules.find((r) => r.id === result.ruleId && r.category);
  return rule ? { category: result.category, ruleId: rule.id } : null;
}
export function classification(t, s) {
  if (!liveExpense(t) || costKind(t) === "fixed") return { pending: false };
  if (t.categoryConfirmed) return { pending: false };
  const explicit = userCategory(t, s);
  if (explicit && !ambiguousMerchant(t)) return { pending: false, ...explicit };
  if (ambiguousMerchant(t))
    return { pending: true, reason: "결제명만으로 구매 용도를 알 수 없어요" };
  if (!t.category || t.category === "other" || !s.categories.some(c => c.id === t.category)) {
    const inferred = classify(t, s.rules);
    if (inferred.category !== "other" && s.categories.some(c => c.id === inferred.category))
      return { pending: false, category: inferred.category, ruleId: inferred.ruleId };
    return { pending: true, reason: "사용처 또는 구매 용도를 확인해 주세요" };
  }
  return { pending: false };
}
export function syncCategories(s) {
  let changed = 0;
  for (const t of s.transactions) {
    // Preserve all explicit/manual decisions, amounts, dates, scopes and recurring links.
    if (t.categoryConfirmed || (t.category && t.category !== "other")) continue;
    const r = classification(t, s);
    if (!r.pending && r.category && (r.category !== t.category || r.ruleId !== t.ruleId)) {
      t.category = r.category;
      t.ruleId = r.ruleId;
      t.categoryStatus = "auto";
      changed++;
    }
  }
  return changed;
}
export function reviewRows(s, month, all = false) {
  return s.transactions.filter(t => (all || inPeriod(t, s, month)) && classification(t, s).pending)
    .sort((a, b) => b.date.localeCompare(a.date) || String(a.id).localeCompare(String(b.id)));
}
export function confirmCategory(s, id, category, note, learn = false) {
  const t = s.transactions.find(t => t.id === id && !t.deletedAt && !t.splitParent);
  if (!t || !s.categories.some(c => c.id === category && !c.archived))
    throw Error("거래 또는 카테고리가 변경됐어요. 다시 확인해 주세요.");
  t.category = category;
  t.categoryConfirmed = true;
  t.categoryStatus = "confirmed";
  t.note = String(note || "").slice(0, 1000);
  t.updatedAt = new Date().toISOString();
  if (learn && !ambiguousMerchant(t)) {
    const pattern = t.merchantNormalized || t.merchantRaw;
    s.rules = s.rules.filter(r => !(r.learned && keyText(r.pattern) === keyText(pattern)));
    s.rules.unshift({ id: "category-" + crypto.randomUUID(), field: "merchant", match: "exact", pattern,
      category, learned: true, enabled: true });
    // Only resolve unconfirmed records with exactly the same merchant; never overwrite user edits.
    for (const other of s.transactions) {
      if (other.id !== id && !other.categoryConfirmed && liveExpense(other) && costKind(other) !== "fixed" &&
          keyText(other.merchantNormalized || other.merchantRaw) === keyText(pattern) && classification(other, s).category === category) {
        other.category = category;
        other.ruleId = s.rules[0].id;
        other.categoryStatus = "auto";
      }
    }
  }
}
export function paymentStatus(r, asOf = today()) {
  if (r.paid) return "paid";
  if (r.actual > 0) return "partial";
  return r.date <= asOf ? "check" : "upcoming";
}
export const PAYMENT_LABELS = { paid: "납부 확인", partial: "일부 기록 · 확인 필요", check: "납부 확인 필요", upcoming: "예정" };
export function moneyOverview(s, month, asOf = today()) {
  const d = dashboard(s, month, asOf);
  const variable = d.b.tx.filter(t => liveExpense(t) && costKind(t) !== "fixed");
  const sharedUsed = variable.filter(t => !["p1", "p2"].includes(t.scope)).reduce((n, t) => n + expenseValue(t), 0);
  const allowances = ["p1", "p2"].map(id => {
    const used = variable.filter(t => t.scope === id).reduce((n, t) => n + expenseValue(t), 0);
    const budget = d.plan.personalBudgets[id] || 0;
    return { id, used, budget, remaining: budget - used };
  });
  const allowanceReserve = allowances.reduce((n, p) => n + Math.max(0, p.remaining), 0);
  const sharedRemaining = Math.min(d.plan.sharedBudget - sharedUsed, d.remaining - allowanceReserve);
  const latest = s.transactions.filter(t => liveExpense(t) && t.date <= asOf)
    .map(t => t.date).sort().at(-1) || "";
  const targetDate = asOf < d.p.start ? "" : asOf > d.p.end ? d.p.end : asOf;
  const gapDays = targetDate ? latest ? Math.max(0, dayDiff(latest, targetDate)) : null : 0;
  const pending = reviewRows(s, month), allPending = reviewRows(s, month, true);
  const recurring = d.b.recurring.map(r => ({ ...r, status: paymentStatus(r, asOf) }));
  const total = recurring.reduce((n, r) => n + r.amount, 0);
  const paid = recurring.reduce((n, r) => n + r.actual, 0);
  const unpaid = recurring.reduce((n, r) => n + r.outstanding, 0);
  const daily = d.p.start > asOf ? d.p.days : d.p.end < asOf ? 0 : dayDiff(asOf, d.p.end) + 1;
  const configuredIncome = incomeScheduleFor(s, month);
  const salaryDates = configuredIncome ? configuredIncome.entries.map(r => incomeDate(s, month, r)).sort() : [...new Set(s.settings.salaryDays || [10, 15])].flatMap(day =>
    [...new Set([d.p.start.slice(0, 7), d.p.end.slice(0, 7)])].map(m => occurrence({ day, amount: 0, changes: [] }, m)?.date)
      .filter(date => date && date >= d.p.start && date <= d.p.end)).sort();
  return { d, asOf, recurring, total, paid, unpaid, allowances, allowanceReserve, sharedUsed, sharedRemaining,
    daily, perDay: daily ? Math.floor(Math.max(0, d.remaining) / daily) : 0,
    pending, allPending, pendingAmount: pending.reduce((n, t) => n + expenseValue(t), 0),
    latest, gapDays, stale: targetDate && (gapDays === null || gapDays > 1), salaryDates,
    current: periodKey(asOf, startDay(s)) === month,
    grossIncome: d.b.tx.filter(t => t.direction === "income").reduce((n, t) => n + t.amount, 0) };
}
export function registeredPayments(s, month, asOf = today()) {
  const o = moneyOverview(s, month, asOf);
  return s.recurring.map(r => {
    const cycle = o.recurring.filter(x => x.id === r.id);
    const next = Array.from({length: 25}, (_, i) => occurrence(r, shiftMonth(month, i)))
      .find(x => x && x.date >= o.d.p.start);
    return { ...r, cycle, next, status: cycle.length ? cycle[0].status : (r.end && r.end < o.d.p.start ? "ended" : "outside") };
  });
}
export function cycleText(s, month) {
  const p = period(month, startDay(s));
  return `${p.start.replaceAll("-", ".")} ~ ${p.end.replaceAll("-", ".")}`;
}
