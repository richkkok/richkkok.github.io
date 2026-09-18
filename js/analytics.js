import { monthBudget, expenseValue, sumExpense } from "./budget.js";
import { shiftMonth, won, today } from "./format.js";
export function analyze(state, month, asOf = today()) {
  const now = monthBudget(state, month, asOf),
    prev = monthBudget(state, shiftMonth(month, -1), asOf);
  const cutoff = now.elapsed || now.days;
  const atPoint = (b) => b.tx.filter((t) => Number(t.date.slice(8)) <= cutoff);
  const delta = sumExpense(atPoint(now)) - sumExpense(atPoint(prev));
  const compared = prev.tx.length > 0 && now.tx.length > 0;
  const changes = now.categories
    .map((c) => ({
      ...c,
      previous: sumExpense(
        atPoint(prev).filter(
          (t) => t.category === c.id && ["shared", "fixed"].includes(t.scope),
        ),
      ),
      current: sumExpense(
        atPoint(now).filter(
          (t) => t.category === c.id && ["shared", "fixed"].includes(t.scope),
        ),
      ),
    }))
    .map((c) => ({ ...c, delta: c.current - c.previous }));
  const insights = [];
  const protectedCategories = new Set(
    state.recurring.filter((r) => r.protected).map((r) => r.category),
  );
  if (compared) {
    const growth = changes
      .filter(
        (c) =>
          c.id !== "finance" &&
          !protectedCategories.has(c.id) &&
          c.delta > 30000,
      )
      .sort((a, b) => b.delta - a.delta)[0];
    if (growth)
      insights.push({
        title: `${growth.name} 흐름`,
        text: `지난달 같은 기간보다 ${won(growth.delta)} 늘었어요.`,
        type: "compare",
      });
  }
  if (
    now.tx.length &&
    now.plan.sharedBudget > 0 &&
    now.shared > now.plan.sharedBudget * 0.8
  )
    insights.push({
      title: "생활비 남은 예산",
      text:
        now.shared > now.plan.sharedBudget
          ? `목표보다 ${won(now.shared - now.plan.sharedBudget)} 더 사용했어요.`
          : `이번 달 공동생활비는 ${won(now.plan.sharedBudget - now.shared)} 남았어요.`,
      type: "budget",
    });
  const upcoming = now.recurring.filter(
    (r) =>
      r.outstanding > 0 &&
      r.date >= asOf &&
      r.date <=
        new Date(Date.parse(asOf + "T12:00:00Z") + 7 * 86400000)
          .toISOString()
          .slice(0, 10),
  );
  if (upcoming.length)
    insights.push({
      title: "다가오는 반복 결제",
      text: `앞으로 7일 동안 ${upcoming.length}건, ${won(upcoming.reduce((n, r) => n + r.outstanding, 0))} 예정이에요.`,
      type: "recurring",
    });
  const variableRows = now.tx.filter(
    (t) => t.scope === "shared" && !t.recurringId && t.direction === "expense",
  );
  if (insights.length < 3 && variableRows.length >= 5) {
    const amounts = variableRows.map((t) => t.amount).sort((a, b) => a - b),
      median = amounts[Math.floor(amounts.length / 2)],
      large = amounts.at(-1);
    if (large > Math.max(200000, median * 4))
      insights.push({
        title: "한 번 더 살펴볼 지출",
        text: `공동생활비에 ${won(large)}인 거래가 있어요. 일회성 지출인지 확인해 보세요.`,
        type: "outlier",
      });
  }
  if (compared && insights.length < 3) {
    const increased = now.recurring.find(
      (r) =>
        !r.protected &&
        prev.recurring.some((p) => p.id === r.id && r.amount > p.amount),
    );
    if (increased) {
      const old = prev.recurring.find((p) => p.id === increased.id);
      insights.push({
        title: "반복비 변화",
        text: `${increased.name}의 예정액이 지난달보다 ${won(increased.amount - old.amount)} 늘었어요.`,
        type: "recurring-growth",
      });
    }
  }
  if (insights.length < 3 && variableRows.length >= 10 && now.shared > 0) {
    const dominant = now.categories
      .filter((c) => !protectedCategories.has(c.id) && c.id !== "finance")
      .map((c) => ({
        ...c,
        used: sumExpense(
          now.tx.filter(
            (t) =>
              t.category === c.id && t.scope === "shared" && !t.recurringId,
          ),
        ),
      }))
      .find((c) => c.used > now.shared * 0.5 && c.used >= 100000);
    if (dominant)
      insights.push({
        title: "소비의 중심",
        text: `${dominant.name}에 공동생활비의 ${Math.round((dominant.used / now.shared) * 100)}%를 사용했어요.`,
        type: "concentration",
      });
  }
  const trend = [-2, -1, 0].map((n) => {
    const m = shiftMonth(month, n),
      b = monthBudget(state, m, asOf);
    return {
      month: m,
      income: b.actualIncome,
      spent: b.spent,
      available: b.available,
    };
  });
  const owners = ["joint", "p1", "p2"].map((owner) => ({
    owner,
    total: now.tx
      .filter((t) => t.owner === owner)
      .reduce((n, t) => n + expenseValue(t), 0),
  }));
  return {
    now,
    prev,
    delta,
    compared,
    changes,
    insights: insights.slice(0, 3),
    trend,
    owners,
  };
}
