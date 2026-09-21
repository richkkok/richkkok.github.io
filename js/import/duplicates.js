import { keyText } from "../format.js";

export function approvalMoment(tx) {
  const datetime = String(tx?.datetime || "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(datetime)) return "";
  return datetime.endsWith("T00:00:00") ? "" : datetime;
}

export function amountKeys(tx) {
  return [
    Number(tx?.amount),
    Number(tx?.grossAmount),
    Number(tx?.payableAmount),
  ].filter((value, index, values) =>
    Number.isSafeInteger(value) && value >= 0 && values.indexOf(value) === index
  );
}

export function amountsEquivalent(a, b) {
  const right = new Set(amountKeys(b));
  return amountKeys(a).some((value) => right.has(value));
}

export function merchantEquivalent(a, b, fuzzy = false) {
  const left = keyText(a?.merchantNormalized || a?.merchantRaw || "");
  const right = keyText(b?.merchantNormalized || b?.merchantRaw || "");
  if (!left || !right) return false;
  if (left === right) return true;
  return fuzzy && Math.min(left.length, right.length) >= 3 &&
    (left.includes(right) || right.includes(left));
}

function sameOwner(a, b) {
  return a?.owner === b?.owner || a?.owner === "joint" || b?.owner === "joint";
}

export function exactApprovalDuplicate(a, b) {
  const left = approvalMoment(a),
    right = approvalMoment(b);
  return !!left &&
    left === right &&
    sameOwner(a, b) &&
    a.direction === b.direction &&
    merchantEquivalent(a, b) &&
    amountsEquivalent(a, b);
}

export function fixedManualDuplicate(a, b) {
  const aFixed = a?.costKind === "fixed" || a?.scope === "fixed" || a?.recurringId;
  const bFixed = b?.costKind === "fixed" || b?.scope === "fixed" || b?.recurringId;
  if (!aFixed || !bFixed || !sameOwner(a, b) || a.direction !== b.direction)
    return false;
  const sameRecurring =
    a.recurringId && b.recurringId && a.recurringId === b.recurringId;
  const manualPair =
    a.sourceType === "manual" || b.sourceType === "manual";
  if (!sameRecurring && !manualPair) return false;
  if (String(a.date || "").slice(0, 7) !== String(b.date || "").slice(0, 7))
    return false;
  return merchantEquivalent(a, b, true) && amountsEquivalent(a, b);
}

export function possibleDuplicates(incoming, existing) {
  const groups = new Map();
  for (const t of existing.filter((t) => !t.splitParent && !t.deletedAt)) {
    const k = [t.owner, t.date, t.direction].join("|");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  return incoming.flatMap((t) => {
    const rows =
      groups.get([t.owner, t.date, t.direction].join("|")) || [];
    const match = rows.find((x) => {
      if (x.sourceId === t.sourceId) return false;
      if (exactApprovalDuplicate(x, t) || fixedManualDuplicate(x, t)) return true;
      const xMoment = approvalMoment(x),
        tMoment = approvalMoment(t);
      if (xMoment && tMoment && xMoment !== tMoment) return false;
      return amountsEquivalent(x, t) &&
        (merchantEquivalent(x, t) ||
          (/페이|pay/i.test(
            String(x.paymentMethod || "") +
              " " +
              String(t.paymentMethod || "") +
              " " +
              String(x.merchantRaw || "") +
              " " +
              String(t.merchantRaw || ""),
          ) &&
            (!xMoment || !tMoment || xMoment === tMoment)));
    });
    const key = [t.owner, t.date, t.direction].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
    return match ? [{ incoming: t, existing: match }] : [];
  });
}
