import { today, keyText } from "./format.js";
import {
  period,
  periodKey,
  startDay,
  periodDates,
  dayDiff,
  addDays,
} from "./period.js";
import { monthBudget, expenseValue, planFor } from "./budget.js";
import { baselineAnalysis, dailyWeights } from "./baseline.js";

export const liveExpense = (t) =>
  !t.deletedAt &&
  !t.splitParent &&
  !t.excluded &&
  t.scope !== "excluded" &&
  ["expense", "refund"].includes(t.direction);
export const costKind = (t) =>
  t.costKind || (t.scope === "fixed" || t.recurringId ? "fixed" : "variable");
export function allocate(total, weights) {
  const sum = weights.reduce((n, v) => n + v, 0) || 1;
  const raw = weights.map((v) => (Math.max(0, total) * v) / sum),
    out = raw.map(Math.floor);
  const remain =
    Math.round(Math.max(0, total)) - out.reduce((n, v) => n + v, 0);
  raw
    .map((v, i) => ({ i, r: v - out[i] }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .slice(0, remain)
    .forEach((x) => out[x.i]++);
  return out;
}
export function daySignature(state, date) {
  return JSON.stringify(
    state.transactions
      .filter((t) => t.date === date && !t.deletedAt && !t.splitParent)
      .map((t) => [
        t.id,
        t.amount,
        t.direction,
        t.scope,
        t.excluded,
        t.category,
        t.operatingMonth,
        t.paymentMethod,
      ])
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}
export function dayStatus(state, date) {
  const rows = state.transactions.filter(
    (t) => t.date === date && liveExpense(t),
  );
  const record = state.dailyCloses?.[date];
  return {
    date,
    rows,
    count: rows.filter((t) => t.direction === "expense").length,
    total: rows.reduce((n, t) => n + expenseValue(t), 0),
    closed: !!record && record.signature === daySignature(state, date),
    record,
  };
}
export function closeDay(state, date, mode = "complete", by = "joint") {
  if (date > today()) throw Error("미래 날짜는 마감할 수 없어요.");
  const d = dayStatus(state, date);
  if (mode === "zero" && d.count)
    throw Error("지출 기록이 있어 무지출로 마감할 수 없어요.");
  state.dailyCloses ||= {};
  state.dailyCloses[date] = {
    mode,
    by,
    signature: daySignature(state, date),
    updatedAt: new Date().toISOString(),
  };
}
export function dashboard(state, month, asOf = today()) {
  const b = monthBudget(state, month, asOf),
    p = period(month, startDay(state));
  const history = baselineAnalysis(state, month);
  const plan = planFor(state, month),
    regularRows = b.tx.filter(
      (t) => liveExpense(t) && costKind(t) === "variable",
    ),
    oneOff = b.tx
      .filter((t) => liveExpense(t) && costKind(t) === "oneoff")
      .reduce((n, t) => n + expenseValue(t), 0);
  const fixedActual = b.tx
    .filter((t) => liveExpense(t) && costKind(t) === "fixed")
    .reduce((n, t) => n + expenseValue(t), 0);
  const fixed = fixedActual + b.outstanding;
  const savingsTarget = plan.savingsTarget ?? b.goals;
  const requested =
    plan.variableBudget ??
    plan.sharedBudget + plan.personalBudgets.p1 + plan.personalBudgets.p2;
  const affordability = Math.max(0, b.income - fixed - savingsTarget);
  const budget = Math.max(0, Math.min(requested, affordability));
  const dates = periodDates(p),
    weights = dailyWeights(state, p, history);
  const daily = allocate(budget, weights);
  const elapsed = Math.max(0, Math.min(p.days, dayDiff(p.start, asOf) + 1));
  const ratio =
    weights.slice(0, elapsed).reduce((n, v) => n + v, 0) /
    weights.reduce((n, v) => n + v, 0);
  const regular = regularRows.reduce((n, t) => n + expenseValue(t), 0),
    actual = regular + oneOff;
  const planned = daily.slice(0, elapsed).reduce((n, v) => n + v, 0),
    delta = planned - actual;
  const future = Math.max(0, p.days - elapsed);
  const todayRows = b.tx.filter(
    (t) => t.date === asOf && liveExpense(t) && costKind(t) !== "fixed",
  );
  const todaySpent = todayRows.reduce((n, t) => n + expenseValue(t), 0);
  const todayPlan = dates.includes(asOf) ? daily[elapsed - 1] : 0;
  const carry = planned - todayPlan - (actual - todaySpent);
  const todayAvailable = dates.includes(asOf)
    ? Math.min(budget - actual, todayPlan + carry - todaySpent)
    : 0;
  const hasObservations =
    b.tx.some(liveExpense) ||
    dates.slice(0, elapsed).some((d) => dayStatus(state, d).closed);
  const projectedVariable =
    elapsed === p.days
      ? actual
      : !hasObservations || ratio === 0
        ? budget
        : Math.max(0, Math.round(regular / ratio)) + oneOff;
  const forecast = fixed + projectedVariable;
  const projectedSavings = b.income - forecast;
  const maximumSavings = b.income - fixed - actual;
  const status =
    maximumSavings < savingsTarget
      ? "현재 불가능"
      : projectedSavings < savingsTarget
        ? "위험"
        : "달성 가능";
  const categories = state.categories
    .filter((c) => !c.archived || b.tx.some((t) => t.category === c.id))
    .map((c) => {
      const used = b.tx
        .filter(
          (t) =>
            t.category === c.id && liveExpense(t) && costKind(t) !== "fixed",
        )
        .reduce((n, t) => n + expenseValue(t), 0);
      const target = plan.categoryBudgets?.[c.id];
      const planned = target === undefined ? null : Math.round(target * ratio);
      const change = target === undefined ? null : used - planned;
      const single = b.tx
        .filter(
          (t) =>
            t.category === c.id && liveExpense(t) && costKind(t) === "oneoff",
        )
        .reduce((n, t) => n + expenseValue(t), 0);
      const predicted = ratio
        ? Math.round(Math.max(0, used - single) / ratio) + single
        : target || 0;
      return {
        ...c,
        used,
        target,
        planned,
        change,
        remaining: target === undefined ? null : target - used,
        reduce: target === undefined ? 0 : Math.max(0, predicted - target),
        protected:
          ["child", "health", "housing", "finance", "transport"].includes(
            c.id,
          ) || state.recurring.some((r) => r.protected && r.category === c.id),
      };
    });
  const cuts = categories
    .filter((c) => c.reduce > 0 && !c.protected)
    .sort((a, b) => b.reduce - a.reduce);
  const room = categories
    .filter((c) => c.remaining > 0 && c.change <= 0)
    .sort((a, b) => b.remaining - a.remaining);
  const missing = dates.filter(
    (d) =>
      d < asOf &&
      d >= (state.settings.trackingSince || p.start) &&
      !dayStatus(state, d).closed,
  );
  let cumulative = 0,
    actualCumulative = 0;
  const chart = dates.map((date, i) => {
    cumulative += daily[i];
    actualCumulative += b.tx
      .filter(
        (t) =>
          (t.date < p.start ? p.start : t.date) === date &&
          liveExpense(t) &&
          costKind(t) !== "fixed",
      )
      .reduce((n, t) => n + expenseValue(t), 0);
    return {
      date,
      planned: cumulative,
      actual: i < elapsed ? actualCumulative : null,
    };
  });
  return {
    b,
    p,
    history,
    plan,
    budget,
    requested,
    affordability,
    fixed,
    savingsTarget,
    actual,
    planned,
    delta,
    todayPlan,
    todaySpent,
    todayAvailable,
    forecast,
    projectedSavings,
    maximumSavings,
    status,
    categories,
    cuts,
    room,
    elapsed,
    future,
    ratio,
    chart,
    missing,
    provisional: elapsed < 7 || missing.length > 0 || !hasObservations,
    recovery: future ? Math.ceil(Math.max(0, -delta) / future) : 0,
    pace: planned ? Math.round((actual / planned - 1) * 100) : null,
    remaining: budget - actual,
    oneOff,
  };
}
export function reconcile(state, { payment, start, end, actual }) {
  if (!payment.trim() || start > end)
    throw Error("결제수단과 조회기간을 확인해 주세요.");
  const rows = state.transactions.filter(
    (t) =>
      liveExpense(t) &&
      keyText(t.paymentMethod) === keyText(payment) &&
      t.date >= start &&
      t.date <= end,
  );
  const recorded = rows.reduce((n, t) => n + expenseValue(t), 0);
  return { rows, recorded, difference: actual - recorded };
}
