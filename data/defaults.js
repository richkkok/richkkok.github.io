export const VERSION = "1.0.1";
export const SCOPES = {
  shared: "공동생활비",
  fixed: "공동고정비",
  p1: "구성원 1 개인",
  p2: "구성원 2 개인",
  excluded: "가계부 제외",
};
export const DIRECTIONS = {
  expense: "지출",
  income: "수입",
  refund: "환불",
  transfer: "이체·카드대금",
};
export const PERFORMANCE = {
  eligible: "실적인정",
  excluded: "제외",
  unknown: "미확인",
};
export const CATEGORIES = [
  ["groceries", "식비·마트", "basket"],
  ["dining", "외식·배달", "dining"],
  ["child", "육아", "heart"],
  ["housing", "주거·관리", "home"],
  ["transport", "차량·교통", "car"],
  ["health", "의료·건강", "cross"],
  ["shopping", "쇼핑", "bag"],
  ["leisure", "취미·여가", "sun"],
  ["finance", "금융·보험", "shield"],
  ["subscription", "통신·구독", "phone"],
  ["other", "기타", "dots"],
].map(([id, name, icon]) => ({ id, name, icon, archived: false }));
export function emptyState() {
  return {
    schemaVersion: 1,
    revision: 0,
    configured: false,
    demo: false,
    settings: {
      members: { p1: "구성원 1", p2: "구성원 2" },
      income: 0,
      incomeMode: "planned",
      sharedBudget: 0,
      personalBudgets: { p1: 0, p2: 0 },
      cardName: "우리카드",
      cardTarget: 300000,
      privacy: true,
      categoryBudgets: {},
      monthOverrides: {},
    },
    categories: structuredClone(CATEGORIES),
    transactions: [],
    rules: [],
    recurring: [],
    goals: [],
    imports: [],
  };
}
export function scopeName(scope, s) {
  return scope === "p1" || scope === "p2"
    ? `${s.settings.members[scope]} 개인`
    : SCOPES[scope] || scope;
}
export function memberName(owner, s) {
  return owner === "joint" ? "공동" : s.settings.members[owner] || owner;
}
