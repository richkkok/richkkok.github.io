import { today, daysInMonth, keyText } from "./format.js";
import { period, startDay, inPeriod, dayDiff } from "./period.js";
import { recurringLedger } from "./recurring.js";
export const activeTransactions = (state, month) =>
  state.transactions.filter(
    (t) =>
      !t.deletedAt &&
      !t.splitParent &&
      inPeriod(t, state, month) &&
      !t.excluded &&
      t.scope !== "excluded" &&
      t.direction !== "transfer",
  );
export const expenseValue = (t) =>
  t.direction === "expense"
    ? t.amount
    : t.direction === "refund"
      ? -t.amount
      : 0;
export const sumExpense = (rows) =>
  rows.reduce((n, t) => n + expenseValue(t), 0);
export function planFor(state, month) {
  const s = state.settings,
    o = s.monthOverrides?.[month] || {};
  return {
    ...s,
    ...o,
    personalBudgets: { ...s.personalBudgets, ...o.personalBudgets },
    categoryBudgets: { ...s.categoryBudgets, ...o.categoryBudgets },
  };
}
export function monthBudget(state, month, asOf = today()) {
  const plan = planFor(state, month),
    tx = activeTransactions(state, month).filter((t) => t.date <= asOf),
    recurring = recurringLedger(state, month, tx);
  const actualIncome = tx
    .filter((t) => t.direction === "income")
    .reduce((n, t) => n + t.amount, 0);
  const income = plan.incomeMode === "actual" ? actualIncome : plan.income;
  const spent = sumExpense(tx),
    fixedActual = sumExpense(
      tx.filter(
        (t) => t.costKind === "fixed" || t.scope === "fixed" || t.recurringId,
      ),
    );
  const outstanding = recurring.reduce((n, r) => n + r.outstanding, 0),
    fixed = Math.max(fixedActual + outstanding, plan.fixedReserve || 0);
  const goals = state.goals
    .filter((g) => (!g.start || g.start <= month) && (!g.end || g.end >= month))
    .reduce((n, g) => n + g.monthly, 0);
  const variable = spent - fixedActual,
    shared = sumExpense(
      tx.filter((t) => t.scope === "shared" && !t.recurringId),
    );
  const personal = {
    p1: sumExpense(tx.filter((t) => t.scope === "p1")),
    p2: sumExpense(tx.filter((t) => t.scope === "p2")),
  };
  const p = period(month, startDay(state)),
    days = p.days,
    elapsed = Math.max(0, Math.min(days, dayDiff(p.start, asOf) + 1)),
    remaining = asOf > p.end ? 0 : Math.min(days, days - elapsed + 1);
  const available = income - spent - outstanding - goals,
    forecast = fixed + (elapsed ? (variable / elapsed) * days : variable);
  const cardRows = state.transactions.filter(
    (t) =>
      !t.deletedAt &&
      !t.splitParent &&
      t.date.startsWith(month) &&
      keyText(t.paymentMethod).includes(keyText(plan.cardName)) &&
      keyText(plan.cardName) &&
      ["expense", "refund"].includes(t.direction),
  );
  const cardEligible = sumExpense(
      cardRows.filter((t) => t.performanceStatus === "eligible"),
    ),
    cardUnknown = sumExpense(
      cardRows.filter((t) => t.performanceStatus === "unknown"),
    );
  const categories = state.categories.map((c) => ({
    ...c,
    used: sumExpense(
      tx.filter(
        (t) => t.category === c.id && ["shared", "fixed"].includes(t.scope),
      ),
    ),
    budget: plan.categoryBudgets[c.id] || 0,
  }));
  return {
    plan,
    tx,
    recurring,
    income,
    actualIncome,
    spent,
    fixedActual,
    fixed,
    outstanding,
    goals,
    variable,
    shared,
    personal,
    available,
    forecast,
    expectedBalance: income - forecast - goals,
    days,
    elapsed,
    remaining,
    cardEligible,
    cardUnknown,
    cardRows,
    categories,
  };
}
