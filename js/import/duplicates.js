import { keyText } from "../format.js";
export function possibleDuplicates(incoming, existing) {
  const groups = new Map();
  for (const t of existing.filter((t) => !t.splitParent && !t.deletedAt)) {
    const k = [t.owner, t.date, t.amount, t.direction].join("|");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  return incoming.flatMap((t) => {
    const rows =
      groups.get([t.owner, t.date, t.amount, t.direction].join("|")) || [];
    const match = rows.find(
      (x) =>
        x.sourceId !== t.sourceId &&
        (keyText(x.merchantNormalized) === keyText(t.merchantNormalized) ||
          (/페이|pay/i.test(
            x.paymentMethod +
              " " +
              t.paymentMethod +
              " " +
              x.merchantRaw +
              " " +
              t.merchantRaw,
          ) &&
            x.datetime === t.datetime)),
    );
    const key = [t.owner, t.date, t.amount, t.direction].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
    return match ? [{ incoming: t, existing: match }] : [];
  });
}
