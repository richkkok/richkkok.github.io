import { emptyState } from "../data/defaults.js";
const scopes = ["shared", "fixed", "p1", "p2", "excluded"],
  directions = ["expense", "income", "refund", "transfer"];
const isMoney = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 1e12;
const isDate = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
export function validateState(input) {
  const forbidden = new Set(["__proto__", "prototype", "constructor"]);
  const inspect = (value, depth = 0) => {
    if (depth > 20) throw Error("백업 구조가 너무 복잡해요.");
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        if (forbidden.has(key)) throw Error("안전하지 않은 백업 키가 있어요.");
        inspect(child, depth + 1);
      }
  };
  inspect(input);
  if (
    !input ||
    input.schemaVersion !== 1 ||
    !input.settings ||
    !Array.isArray(input.transactions)
  )
    throw Error("지원하는 리치콕 백업이 아니에요.");
  if (input.transactions.length > 100000)
    throw Error("거래는 100,000건까지 복원할 수 있어요.");
  const state = structuredClone(input),
    s = state.settings;
  if (
    !isMoney(s.income) ||
    !isMoney(s.sharedBudget) ||
    !isMoney(s.cardTarget) ||
    !["planned", "actual"].includes(s.incomeMode) ||
    typeof s.members?.p1 !== "string" ||
    typeof s.members?.p2 !== "string"
  )
    throw Error("가구 설정 값이 올바르지 않아요.");
  for (const k of ["p1", "p2"])
    if (!isMoney(s.personalBudgets?.[k]))
      throw Error("개인 예산 값이 올바르지 않아요.");
  for (const key of ["categories", "rules", "recurring", "goals", "imports"])
    if (!Array.isArray(state[key])) throw Error("백업 구성이 올바르지 않아요.");
  const ids = new Set();
  for (const t of state.transactions) {
    if (
      typeof t.id !== "string" ||
      ids.has(t.id) ||
      !isMoney(t.amount) ||
      !isDate(t.date) ||
      !directions.includes(t.direction) ||
      !scopes.includes(t.scope) ||
      !["p1", "p2", "joint"].includes(t.owner) ||
      typeof t.merchantRaw !== "string" ||
      typeof t.merchantNormalized !== "string" ||
      typeof t.paymentMethod !== "string"
    )
      throw Error("복원할 거래의 형식이 올바르지 않아요.");
    ids.add(t.id);
  }
  if (
    s.periodStartDay !== undefined &&
    (!Number.isInteger(s.periodStartDay) ||
      s.periodStartDay < 1 ||
      s.periodStartDay > 31)
  )
    throw Error("운영월 시작일을 확인해 주세요.");
  if (
    s.salaryDays !== undefined &&
    (!Array.isArray(s.salaryDays) ||
      s.salaryDays.some((n) => !Number.isInteger(n) || n < 1 || n > 31))
  )
    throw Error("급여일을 확인해 주세요.");
  for (const p of [s, ...Object.values(s.monthOverrides || {})])
    for (const k of ["variableBudget", "savingsTarget", "fixedReserve"])
      if (p[k] !== undefined && !isMoney(p[k]))
        throw Error("소비·저축 목표 금액을 확인해 주세요.");
  for (const t of state.transactions) {
    if (t.operatingMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(t.operatingMonth))
      throw Error("귀속 운영월을 확인해 주세요.");
    if (t.costKind && !["fixed", "variable", "oneoff"].includes(t.costKind))
      throw Error("지출 성격을 확인해 주세요.");
  }
  if (
    s.baseline &&
    (!isDate(s.baseline.start) ||
      !isDate(s.baseline.end) ||
      s.baseline.start > s.baseline.end)
  )
    throw Error("분석기간이 올바르지 않아요.");
  if (
    state.dailyCloses &&
    (Array.isArray(state.dailyCloses) ||
      Object.entries(state.dailyCloses).some(
        ([d, c]) =>
          !isDate(d) ||
          !c ||
          typeof c.signature !== "string" ||
          !["complete", "zero"].includes(c.mode),
      ))
  )
    throw Error("하루 마감 자료를 확인해 주세요.");
  if (
    state.reconciliations &&
    (!Array.isArray(state.reconciliations) ||
      state.reconciliations.some(
        (r) =>
          typeof r.id !== "string" ||
          !isDate(r.start) ||
          !isDate(r.end) ||
          ![r.actual, r.recorded, r.difference].every(Number.isSafeInteger),
      ))
  )
    throw Error("보정 자료를 확인해 주세요.");
  if (
    !Number.isSafeInteger(state.transactions.reduce((n, t) => n + t.amount, 0))
  )
    throw Error("총 거래금액이 안전한 계산 범위를 넘었어요.");
  for (const r of state.recurring)
    if (
      !isMoney(r.amount) ||
      !r.id ||
      typeof r.name !== "string" ||
      !Number.isInteger(r.day) ||
      r.day < 1 ||
      r.day > 31 ||
      (r.changes || []).some((c) => !isMoney(c.amount) || !isDate(c.effective))
    )
      throw Error("반복비 설정이 올바르지 않아요.");
  for (const g of state.goals)
    if (!isMoney(g.monthly) || !isMoney(g.target) || !isMoney(g.saved))
      throw Error("목표 설정이 올바르지 않아요.");
  for (const c of state.categories)
    if (typeof c.id !== "string" || typeof c.name !== "string")
      throw Error("카테고리 설정이 올바르지 않아요.");
  for (const r of state.rules)
    if (
      typeof r.id !== "string" ||
      typeof r.pattern !== "string" ||
      !["exact", "keyword"].includes(r.match) ||
      !["merchant", "payment"].includes(r.field)
    )
      throw Error("분류 규칙이 올바르지 않아요.");
  for (const v of Object.values(s.categoryBudgets || {}))
    if (!isMoney(v)) throw Error("카테고리 예산을 확인해 주세요.");
  for (const [month, override] of Object.entries(s.monthOverrides || {})) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw Error("예산 월이 올바르지 않아요.");
    for (const key of ["income", "incomeBase", "incomeExtra", "sharedBudget"])
      if (override[key] !== undefined && !isMoney(override[key]))
        throw Error("월별 금액을 확인해 주세요.");
    for (const value of Object.values(override.personalBudgets || {}))
      if (!isMoney(value)) throw Error("월별 용돈을 확인해 주세요.");
    for (const value of Object.values(override.categoryBudgets || {}))
      if (!isMoney(value)) throw Error("월별 예산을 확인해 주세요.");
  }
  return state;
}
export function splitTransaction(tx, parts) {
  if (
    tx.splitParent ||
    tx.parentId ||
    parts.length < 2 ||
    parts.reduce((n, p) => n + p.amount, 0) !== tx.amount ||
    parts.some((p) => !isMoney(p.amount) || p.amount === 0)
  )
    throw Error("분할 금액의 합은 원래 금액과 같아야 해요.");
  const updatedAt = new Date().toISOString();
  return [
    { ...tx, splitParent: true, updatedAt },
    ...parts.map((p, i) => ({
      ...tx,
      ...p,
      id: `${tx.id}:part:${i + 1}`,
      sourceId: `${tx.sourceId}:part:${i + 1}`,
      parentId: tx.id,
      splitParent: false,
      updatedAt,
    })),
  ];
}
export function restoreEnvelope(value) {
  if (value?.format === "richkkok-backup" && value.version === 1)
    return validateState(value.state);
  if (value?.format === "richkkok-private-setup" && value.version === 1) {
    const state = emptyState();
    state.settings = { ...state.settings, ...value.settings };
    state.recurring = value.recurring || [];
    state.configured = true;
    return validateState(state);
  }
  throw Error("리치콕 백업 또는 초기설정 파일을 선택해 주세요.");
}
