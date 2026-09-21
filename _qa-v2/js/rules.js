import { keyText } from "./format.js";
import { merchantRules } from "../data/merchant-rules.js";
export function classify(tx, rules = []) {
  const sorted = rules
    .filter((r) => r.enabled !== false)
    .map((r, i) => ({ ...r, index: i }))
    .sort(
      (a, b) =>
        (a.match === "exact" ? 0 : 1) - (b.match === "exact" ? 0 : 1) ||
        (a.priority || 0) - (b.priority || 0) ||
        a.index - b.index,
    );
  const rule = sorted.find((r) => {
    const v = keyText(
        r.field === "payment" ? tx.paymentMethod : tx.merchantNormalized,
      ),
      pattern = keyText(r.pattern);
    return (
      pattern && (r.match === "exact" ? v === pattern : v.includes(pattern))
    );
  });
  if (rule)
    return {
      ...tx,
      ...Object.fromEntries(
        ["category", "scope", "performanceStatus"]
          .filter((k) => rule[k])
          .map((k) => [k, rule[k]]),
      ),
      ruleId: rule.id,
    };
  const text = keyText(tx.merchantNormalized);
  const base = merchantRules.find((r) =>
    r.words.some((w) => text.includes(keyText(w))),
  );
  let category = base?.category;
  if (!category)
    category = /마트|슈퍼|식자재|정육/.test(text)
      ? "groceries"
      : /식당|카페|커피|치킨|피자|식사/.test(text)
        ? "dining"
        : /병원|약국|의원/.test(text)
          ? "health"
          : /관리비|월세|전기|도시가스|수도/.test(text)
            ? "housing"
            : /대출|보험|이자/.test(text)
              ? "finance"
              : /교통|버스|택시|주차/.test(text)
                ? "transport"
                : /서점|영화|여행/.test(text)
                  ? "leisure"
                  : /쿠팡|쇼핑|백화점/.test(text)
                    ? "shopping"
                    : "other";
  return { ...tx, category, ruleId: base ? "default" : "heuristic" };
}
export function applyRules(transactions, rules) {
  return transactions.map((tx) =>
    tx.deletedAt || tx.splitParent ? tx : classify(tx, rules),
  );
}
