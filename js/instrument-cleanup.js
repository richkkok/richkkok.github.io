import { keyText } from "./format.js";
import { paymentRenameBasis, replacePaymentReferences } from "./payment-rename.js";

const key = value => keyText(String(value || ""));
const owners = new Set(["p1", "p2", "joint"]);

// A code like M107 is an internal/import identifier, NOT a PAN. Do not store
// complete payment card numbers or guess identity from the last four digits.
export function cardIdentityCode(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/(?:\d[\s-]?){13,19}/.test(raw) || /^\d+$/.test(raw) ||
      !/^[A-Za-z][A-Za-z0-9 ._-]{2,39}$/.test(raw))
    throw Error("카드번호 전체나 끝 4자리는 저장하지 않아. M107처럼 문자와 숫자로 된 카드사 식별코드를 입력해 줘.");
  return raw.toUpperCase().replace(/[\s._-]/g, "");
}

export function validateInstrumentCleanup(state) {
  const s = state.settings || {};
  for (const name of ["hiddenPaymentMethods", "hiddenCashAccounts"]) {
    const list = s[name];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length > 300 || list.some(x =>
      typeof x !== "string" || !x || x.length > 120) || new Set(list).size !== list.length)
      throw Error("카드·계좌 목록 정리 설정이 올바르지 않아.");
    if (name === "hiddenPaymentMethods" && list.some(x => key(x) !== x))
      throw Error("숨긴 카드 식별키가 올바르지 않아.");
  }
}

export function methodNames(state) {
  const bankKeys = new Set((state.cashAccounts || [])
    .flatMap(a => [a.name, a.paymentMethod]).filter(Boolean).map(key));
  const seen = new Set();
  const methods = [];
  for (const name of [
    ...(state.settings.paymentMethods || []), state.settings.cardName,
    ...Object.values(state.settings.paymentProfiles || {}).map(p => p.name),
    ...(state.transactions || []).map(t => t.paymentMethod),
    ...(state.recurring || []).map(r => r.paymentMethod),
    ...(state.reconciliations || []).map(r => r.payment),
  ]) {
    const label = String(name || "").trim(), id = key(label);
    if (!id || id === key("미지정") || label.length > 100 ||
        bankKeys.has(id) || seen.has(id)) continue;
    seen.add(id);
    methods.push(label);
  }
  return methods;
}

export function instrumentUsage(state, choice) {
  if (choice.type === "account") {
    const account = (state.cashAccounts || []).find(a => a.id === choice.accountId);
    if (!account) throw Error("계좌가 변경됐어. 다시 열어서 확인해 줘.");
    const names = new Set([account.name, account.paymentMethod].filter(Boolean).map(key));
    const transactions = (state.transactions || []).filter(t => names.has(key(t.paymentMethod)));
    const links = (state.cashLinks || []).filter(l => l.legs.some(p => p.accountId === account.id));
    const checks = (state.cashChecks || []).filter(c => c.accountId === account.id);
    const recurring = (state.recurring || []).filter(r => names.has(key(r.paymentMethod)));
    const reconciliations = (state.reconciliations || []).filter(r => names.has(key(r.payment)));
    const rules = (state.rules || []).filter(r => r.field === "payment" && names.has(key(r.pattern)));
    return { transactions: transactions.length, links: links.length, checks: checks.length,
      recurring: recurring.length + Object.values(state.settings.paymentProfiles || {}).filter(p=>p.accountId===account.id).length, reconciliations: reconciliations.length, rules: rules.length,
      initialBalance: account.openingBalance, reserved: account.reserved };
  }
  const id = key(choice.name);
  const count = values => values.filter(Boolean).length;
  return {
    transactions: count((state.transactions || []).filter(t => key(t.paymentMethod) === id)),
    recurring: count((state.recurring || []).filter(t => key(t.paymentMethod) === id)),
    reconciliations: count((state.reconciliations || []).filter(t => key(t.payment) === id)),
    rules: count((state.rules || []).filter(r => r.field === "payment" && key(r.pattern) === id)),
    profiles: state.settings.paymentProfiles?.[id] ? 1 : 0,
  };
}

export function hideInstrument(state, choice) {
  const s = state.settings;
  s.hiddenPaymentMethods ||= [];
  s.hiddenCashAccounts ||= [];
  if (choice.type === "account") {
    const account = (state.cashAccounts || []).find(a => a.id === choice.accountId);
    if (!account) throw Error("해당 계좌가 존재하지 않아.");
    const usage = instrumentUsage(state, choice);
    // Only an entirely empty zero-balance account is safe to physically delete.
    if (!usage.transactions && !usage.links && !usage.checks &&
        !usage.recurring && !usage.reconciliations && !usage.rules &&
        !usage.initialBalance && !usage.reserved) {
      state.cashAccounts = state.cashAccounts.filter(a => a.id !== account.id);
      s.hiddenCashAccounts = s.hiddenCashAccounts.filter(id => id !== account.id);
      return "deleted";
    }
    account.archived = true;
    account.autoMatch = false;
    if (!s.hiddenCashAccounts.includes(account.id)) s.hiddenCashAccounts.push(account.id);
    return "archived";
  }
  const name = String(choice.name), id = key(name);
  if (!methodNames(state).some(m => key(m) === id))
    throw Error("카드·결제수단이 변경됐어. 다시 확인해 줘.");
  const usage = instrumentUsage(state, choice);
  const referenced = usage.transactions || usage.recurring || usage.reconciliations ||
    usage.rules ||
    Object.values(s.monthOverrides || {}).some(o => key(o.cardName) === id) ||
    Object.values(s.paymentAliases || {}).some(v => key(v) === id);
  if (!referenced) {
    s.paymentMethods = (s.paymentMethods || []).filter(v => key(v) !== id);
    if (key(s.cardName) === id) s.cardName = "";
    if (s.paymentProfiles) delete s.paymentProfiles[id];
    s.hiddenPaymentMethods = s.hiddenPaymentMethods.filter(v => v !== id);
    // No archived transaction/linked source is removed when deleting an empty method.
    return "deleted";
  }
  if (!s.hiddenPaymentMethods.includes(id)) s.hiddenPaymentMethods.push(id);
  return "hidden";
}

export function restoreInstrument(state, choice) {
  const s = state.settings;
  if (choice.type === "account") {
    if (!(state.cashAccounts || []).some(a => a.id === choice.accountId))
      throw Error("복원할 계좌를 찾지 못했어.");
    s.hiddenCashAccounts = (s.hiddenCashAccounts || []).filter(id => id !== choice.accountId);
    // Keep archived status until the owner explicitly reactivates this bank account.
  } else {
    s.hiddenPaymentMethods = (s.hiddenPaymentMethods || []).filter(id => id !== key(choice.name));
  }
}

function confirmProfileCompatibility(source, target) {
  if (!source || !target) return;
  if (source.kind !== target.kind)
    throw Error("카드 결제방식이 달라서 자동으로 합칠 수 없어. 각각의 설정을 확인해 줘.");
  if (source.identifier && target.identifier &&
      cardIdentityCode(source.identifier) !== cardIdentityCode(target.identifier))
    throw Error("카드 식별코드가 서로 달라 합치지 않았어.");
  if (source.owner && target.owner && source.owner !== target.owner)
    throw Error("카드 사용자가 달라서 합치지 않았어.");
  if (source.closingDay && target.closingDay &&
      (source.closingDay !== target.closingDay || source.paymentDay !== target.paymentDay ||
       (source.lagMonths ?? 1) !== (target.lagMonths ?? 1)))
    throw Error("카드 청구일 설정이 충돌해서 자동으로 합치지 않았어.");
}

export function mergeCardInto(state, sourceName, destinationName, bases = {}) {
  const from = key(sourceName), to = key(destinationName);
  if (!from || !to || from === to) return { transactions: 0, merged: false };
  const methods = methodNames(state);
  if (!methods.some(m => key(m) === from) || !methods.some(m => key(m) === to))
    throw Error("합치려는 카드가 변경됐어. 다시 선택해 줘.");
  if (bases.source !== undefined &&
      paymentRenameBasis(state,sourceName) !== bases.source)
    throw Error("다른 기기에서 출발 카드가 수정됐어. 다시 확인해 줘.");
  if (bases.destination !== undefined &&
      paymentRenameBasis(state,destinationName) !== bases.destination)
    throw Error("다른 기기에서 대상 카드가 수정됐어. 다시 확인해 줘.");
  const profiles = state.settings.paymentProfiles || {};
  const src = profiles[from], dst = profiles[to];
  confirmProfileCompatibility(src, dst);
  // Save metadata for the surviving method before replacing references.
  let profile = dst ? { ...dst } : src ? { ...src, name: destinationName } : null;
  if (dst && src) {
    profile.identifier ||= src.identifier;
    profile.owner ||= src.owner;
    if (!dst.closingDay && src.closingDay)
      Object.assign(profile, {
        closingDay: src.closingDay, paymentDay: src.paymentDay, lagMonths: src.lagMonths,
      });
  }
  if (src) delete profiles[from];
  if (profile) profiles[to] = { ...profile, name: destinationName };
  const result = replacePaymentReferences(state,new Map([[from,String(destinationName)]]));
  state.settings.hiddenPaymentMethods = (state.settings.hiddenPaymentMethods || [])
    .filter(id => id !== from && id !== to);
  return { ...result, merged: true };
}

// User explicitly entered an identifying import code AND owner. This is much
// stronger than a matching last-four suffix; never infer a merge by suffix.
export function autoMergeCardCode(state, destinationName) {
  const dstKey = key(destinationName), profile = state.settings.paymentProfiles?.[dstKey];
  if (!profile?.identifier || !profile.owner || !owners.has(profile.owner))
    return { merged: 0, transactions: 0, candidates: 0 };
  const identity = cardIdentityCode(profile.identifier);
  const destinationTransactions = (state.transactions || [])
    .filter(t => key(t.paymentMethod) === dstKey);
  if (destinationTransactions.some(t => t.owner !== profile.owner))
    return { merged: 0, transactions: 0, candidates: 0 };
  let merged = 0, transactions = 0, candidates = 0;
  for (const name of methodNames(state)) {
    const sourceKey = key(name);
    if (sourceKey === dstKey) continue;
    const other = state.settings.paymentProfiles?.[sourceKey];
    const sameConfigured = other?.identifier &&
      cardIdentityCode(other.identifier) === identity && other.owner === profile.owner;
    // Old import code such as M107 can be resolved when all historical owners
    // unambiguously match the owner confirmed for the saved card.
    const codeName = sourceKey.toUpperCase() === identity.toUpperCase();
    const matchingTransactions = (state.transactions || []).filter(t => key(t.paymentMethod) === sourceKey);
    const ownerCertain = matchingTransactions.length &&
      matchingTransactions.every(t => t.owner === profile.owner);
    const anyMixed = matchingTransactions.some(t => t.owner !== profile.owner);
    const oldImport = !other?.identifier && codeName && ownerCertain &&
      !other?.owner;
    if (anyMixed || (!sameConfigured && !oldImport)) continue;
    candidates++;
    // Never merge conflicting cycles, kinds, owners or other confirmed codes.
    const result = mergeCardInto(state,name,destinationName);
    if (result.merged) { merged++; transactions += result.transactions; }
  }
  return { merged, transactions, candidates };
}
