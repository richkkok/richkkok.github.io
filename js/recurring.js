import { period, startDay, dayDiff } from "./period.js";
import { keyText, daysInMonth } from "./format.js";
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};
const mode = (values) => {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
};
const monthIndex = (month) => {
  const [year, value] = month.split("-").map(Number);
  return year * 12 + value;
};
const autoHash = (value) => {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};
const isLiveExpense = (tx) =>
  !tx.deletedAt &&
  !tx.splitParent &&
  !tx.excluded &&
  tx.scope !== "excluded" &&
  tx.direction === "expense" &&
  tx.costKind !== "oneoff";

function autoDescriptor(tx) {
  const key = keyText(tx.merchantNormalized || tx.merchantRaw);
  if (!key) return null;
  const raw = String(tx.merchantRaw || tx.merchantNormalized || "").trim();
  const result = {
    key,
    pattern: raw,
    name: raw,
    strong: false,
    variableAmount: false,
    amountMatch: false,
    protected: ["finance", "housing", "child"].includes(tx.category),
  };
  if (key.includes("아파트관리비"))
    return {
      ...result,
      key: "apartment-management",
      pattern: "아파트관리비",
      name: "아파트 관리비",
      strong: true,
      variableAmount: true,
      protected: true,
    };
  if (key.includes("배민클럽"))
    return {
      ...result,
      key: "baemin-club",
      pattern: "배민클럽",
      name: "배민클럽",
      strong: true,
      protected: false,
    };
  if (/^ace20\d{4}$/.test(key))
    return {
      ...result,
      key: "ace-insurance",
      pattern: "ACE 20",
      name: "ACE 보험",
      strong: true,
      protected: true,
    };
  if (key.includes("nh손보"))
    return {
      ...result,
      key: "nh-insurance",
      pattern: "NH손보",
      name: "NH손해보험",
      strong: true,
      protected: true,
    };
  if (key.startsWith("현대해"))
    return {
      ...result,
      key: `hyundai-insurance:${tx.amount}`,
      pattern: "현대해",
      name: `현대해상 보험 ${Math.round(tx.amount).toLocaleString("ko-KR")}원`,
      strong: true,
      amountMatch: true,
      protected: true,
    };
  if (key.includes("skt"))
    return {
      ...result,
      key,
      pattern: raw,
      name: "SKT 통신비",
      strong: true,
      protected: true,
    };
  if (key.includes("어린이집"))
    return {
      ...result,
      key,
      pattern: raw,
      name: raw,
      strong: true,
      protected: true,
    };
  if (key.includes("유치원"))
    return {
      ...result,
      key,
      pattern: raw,
      name: raw,
      strong: true,
      protected: true,
    };
  return result;
}

export function detectRecurringCandidates(transactions, existing = []) {
  const groups = new Map();
  for (const tx of transactions.filter(isLiveExpense)) {
    const descriptor = autoDescriptor(tx);
    if (!descriptor) continue;
    const payment =
      tx.paymentMethod && tx.paymentMethod !== "미지정"
        ? keyText(tx.paymentMethod)
        : "";
    const groupKey = [descriptor.key, tx.owner || "joint", payment].join("|");
    if (!groups.has(groupKey))
      groups.set(groupKey, { descriptor, rows: [], payment });
    groups.get(groupKey).rows.push(tx);
  }

  const candidates = [];
  for (const [groupKey, group] of groups) {
    const rows = group.rows.sort((a, b) => a.date.localeCompare(b.date));
    const fixedMarked = rows.some(
      (tx) => tx.scope === "fixed" || tx.costKind === "fixed",
    );
    const category = mode(rows.map((tx) => tx.category || "other"));
    const strong =
      group.descriptor.strong ||
      fixedMarked ||
      ["subscription", "housing", "finance"].includes(category);
    if (!strong) continue;

    const monthly = new Map();
    for (const tx of rows) monthly.set(tx.date.slice(0, 7), tx);
    const occurrences = [...monthly.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    if (occurrences.length < 3) continue;

    const months = occurrences.map((tx) => tx.date.slice(0, 7));
    if (
      months
        .slice(1)
        .some((month, index) => monthIndex(month) - monthIndex(months[index]) !== 1)
    )
      continue;

    const days = occurrences.map((tx) => Number(tx.date.slice(8)));
    if (Math.max(...days) - Math.min(...days) > 10) continue;

    const amounts = occurrences.map((tx) => tx.amount);
    const typical = median(amounts);
    if (
      !group.descriptor.variableAmount &&
      Math.max(...amounts) - Math.min(...amounts) >
        Math.max(500, typical * 0.1)
    )
      continue;

    const latest = occurrences.at(-1);
    const amount = group.descriptor.variableAmount ? latest.amount : typical;
    const paymentMethod =
      latest.paymentMethod === "미지정" ? "" : latest.paymentMethod || "";
    const autoKey = [groupKey, category].join("|");
    const candidate = {
      id: `auto-recurring-${autoHash(autoKey)}`,
      autoDetected: true,
      autoKey,
      name: group.descriptor.name || latest.merchantRaw,
      amount,
      day: median(days),
      category,
      paymentMethod,
      owner: latest.owner || "joint",
      scope: "fixed",
      start: occurrences[0].date,
      end: "",
      merchantPattern: group.descriptor.pattern || latest.merchantRaw,
      protected: group.descriptor.protected,
      changes: [],
      evidenceMonths: months,
      detectedThrough: latest.date,
      ...(group.descriptor.amountMatch
        ? { matchAmountTolerance: Math.max(100, Math.round(amount * 0.015)) }
        : {}),
    };

    const duplicate = existing.some((item) => {
      if (item.autoKey && item.autoKey === candidate.autoKey) return true;
      const a = keyText(item.merchantPattern);
      const b = keyText(candidate.merchantPattern);
      const ownerMatches =
        !item.owner ||
        item.owner === "joint" ||
        candidate.owner === "joint" ||
        item.owner === candidate.owner;
      const paymentMatches =
        !item.paymentMethod ||
        !candidate.paymentMethod ||
        keyText(item.paymentMethod) === keyText(candidate.paymentMethod);
      return !!a && !!b && ownerMatches && paymentMatches && (a.includes(b) || b.includes(a));
    });
    if (!duplicate) candidates.push(candidate);
  }
  return candidates;
}

export function syncAutoRecurring(state) {
  const added = detectRecurringCandidates(state.transactions, state.recurring);
  if (added.length) state.recurring.push(...added);
  let linked = 0;
  state.transactions = state.transactions.map((tx) => {
    const next = matchRecurring(tx, state.recurring);
    if (
      next.recurringId !== tx.recurringId ||
      next.scope !== tx.scope ||
      next.costKind !== tx.costKind ||
      next.category !== tx.category
    )
      linked += 1;
    return next;
  });
  return { added: added.length, linked, changed: added.length > 0 || linked > 0 };
}

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
      (!r.owner || r.owner === "joint" || r.owner === tx.owner) &&
      (r.matchAmountTolerance === undefined ||
        Math.abs(tx.amount - current.amount) <= r.matchAmountTolerance)
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
