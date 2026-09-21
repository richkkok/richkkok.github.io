import { period, startDay, dayDiff } from "./period.js";
import { keyText, daysInMonth } from "./format.js";
export function occurrence(item, month) {
  const date = `${month}-${String(Math.min(item.day || 1, daysInMonth(month))).padStart(2, "0")}`;
  if ((item.start && date < item.start) || (item.end && date > item.end))
    return null;
  const changes = [...(item.changes || [])]
    .filter((c) => c.effective <= date)
    .sort((a, b) => a.effective.localeCompare(b.effective));
  return { ...item, date, amount: changes.at(-1)?.amount ?? item.amount };
}
export function matchRecurring(tx, items) {
  if (
    tx.recurringId ||
    !["expense", "refund"].includes(tx.direction) ||
    tx.scope === "excluded"
  )
    return tx;
  const matches = items.filter((r) => {
    const current = occurrence(r, tx.date.slice(0, 7));
    if (!current || !r.merchantPattern) return false;
    return (
      keyText(tx.merchantNormalized).includes(keyText(r.merchantPattern)) &&
      (!r.paymentMethod ||
        keyText(tx.paymentMethod) === keyText(r.paymentMethod)) &&
      (!r.owner || r.owner === "joint" || r.owner === tx.owner)
    );
  });
  return matches.length === 1
    ? {
        ...tx,
        recurringId: matches[0].id,
        costKind: "fixed",
        scope: matches[0].scope || tx.scope,
        category: matches[0].category || tx.category,
      }
    : tx;
}
export function recurringLedger(state, month, transactions) {
  const p = period(month, startDay(state));
  const months = [...new Set([p.start.slice(0, 7), p.end.slice(0, 7)])];
  const scheduled = state.recurring.flatMap((r) =>
    months
      .map((m) => occurrence(r, m))
      .filter((r) => r && r.date >= p.start && r.date <= p.end),
  );
  return scheduled.map((r) => {
    const actual = transactions
      .filter(
        (t) =>
          t.recurringId === r.id &&
          scheduled
            .filter((x) => x.id === r.id)
            .sort(
              (a, b) =>
                Math.abs(dayDiff(a.date, t.date)) -
                Math.abs(dayDiff(b.date, t.date)),
            )[0]?.date === r.date,
      )
      .reduce(
        (n, t) =>
          n +
          (t.direction === "expense"
            ? t.amount
            : t.direction === "refund"
              ? -t.amount
              : 0),
        0,
      );
    return {
      ...r,
      actual,
      outstanding: Math.max(0, r.amount - actual),
      paid: actual >= r.amount,
    };
  });
}
