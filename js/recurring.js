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
        scope: matches[0].scope || tx.scope,
        category: matches[0].category || tx.category,
      }
    : tx;
}
export function recurringLedger(state, month, transactions) {
  return state.recurring
    .map((r) => occurrence(r, month))
    .filter(Boolean)
    .map((r) => {
      const actual = transactions
        .filter((t) => t.recurringId === r.id)
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
