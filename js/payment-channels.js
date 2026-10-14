import { daysInMonth, keyText, shiftMonth } from './format.js';
import { addDays } from './period.js';
import { liveExpense, costKind } from './behavior.js';
import { expenseValue } from './budget.js';

const methodKey = name => keyText(name);
const dayInMonth = (month, day) =>
  month + '-' + String(Math.min(day, daysInMonth(month))).padStart(2, '0');

// Transaction payment methods (not the intermediary paymentChannel) decide
// whether spending is settled later. User confirmation overrides name guesses.
export function paymentKind(state, paymentMethod, sourceType = '') {
  const name = String(paymentMethod || '').trim(), key = methodKey(name);
  if (!key || key === methodKey('미지정')) return 'unknown';
  const account = (state.cashAccounts || []).some(a =>
    !a.archived && [a.name, a.paymentMethod].some(v => v && methodKey(v) === key));
  if (account) return 'immediate';
  const profile = state.settings.paymentProfiles?.[key];
  if (profile?.kind === 'credit' || profile?.kind === 'immediate') return profile.kind;
  if (/체크\s*카드|직불|선불|debit\s*card|prepaid/i.test(name)) return 'immediate';
  if (/현금|cash|계좌|은행|통장|이체/i.test(name)) return 'immediate';
  if (/^card-/i.test(sourceType) || /신용\s*카드|credit\s*card|카드|\bvisa\b|mastercard/i.test(name))
    return 'credit';
  if (state.settings.cardName && methodKey(state.settings.cardName) === key) return 'credit';
  return 'unknown'; // e.g. Naver Pay/Kakao Pay: underlying card or bank is unknown.
}

export function spendingChannels(state, transactions) {
  const totals = { credit: 0, immediate: 0, unknown: 0 };
  const unknown = new Set();
  for (const t of transactions) {
    if (!liveExpense(t) || costKind(t) === 'fixed') continue;
    const kind = paymentKind(state, t.paymentMethod, t.sourceType);
    totals[kind] += expenseValue(t);
    if (kind === 'unknown' && t.paymentMethod) unknown.add(t.paymentMethod);
  }
  const total = totals.credit + totals.immediate + totals.unknown;
  if (!Object.values(totals).every(Number.isSafeInteger) || !Number.isSafeInteger(total))
    throw Error('결제방식별 소비금액 계산 범위를 확인해 주세요.');
  return { ...totals, total, unknownMethods: [...unknown].sort((a, b) => a.localeCompare(b, 'ko')) };
}

export function validatePaymentProfiles(state) {
  const profiles = state.settings.paymentProfiles;
  if (profiles === undefined) return;
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles) || Object.keys(profiles).length > 200)
    throw Error('결제방식 설정 형식을 확인해 주세요.');
  for (const [key, p] of Object.entries(profiles)) {
    if (!key || key.length > 100 || !p || typeof p !== 'object' || Array.isArray(p) ||
        !p.name || typeof p.name !== 'string' || p.name.length > 100 ||
        methodKey(p.name) !== key || !['credit', 'immediate'].includes(p.kind))
      throw Error('카드·계좌 결제방식을 확인해 주세요.');
    const hasDates = p.closingDay != null || p.paymentDay != null;
    if (hasDates && (p.kind !== 'credit' ||
        !Number.isInteger(p.closingDay) || p.closingDay < 1 || p.closingDay > 31 ||
        !Number.isInteger(p.paymentDay) || p.paymentDay < 1 || p.paymentDay > 31 ||
        !Number.isInteger(p.lagMonths) || p.lagMonths < 0 || p.lagMonths > 2 ||
        (p.lagMonths === 0 && p.paymentDay < p.closingDay)))
      throw Error('카드 이용 마감일·결제일·결제월을 확인해 주세요.');
  }
}

export function savePaymentProfile(state, name, kind, closingDay = null, paymentDay = null, lagMonths = 1, expected = undefined) {
  const trimmed = String(name || '').trim(), key = methodKey(trimmed);
  if (!key || key === methodKey('미지정') || trimmed.length > 100 ||
      !['credit', 'immediate'].includes(kind))
    throw Error('결제수단 이름과 유형을 확인해 주세요.');
  if ((state.cashAccounts || []).some(a =>
    !a.archived && [a.name, a.paymentMethod].some(v => v && methodKey(v) === key)))
    throw Error('이미 등록된 은행계좌야. 계좌·잔액 관리에서 확인해 주세요.');
  const daysPresent = closingDay !== null || paymentDay !== null;
  if (kind === 'credit' && daysPresent &&
      (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31 ||
       !Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31 ||
       !Number.isInteger(lagMonths) || lagMonths < 0 || lagMonths > 2 ||
       (lagMonths === 0 && paymentDay < closingDay)))
    throw Error('카드 이용 마감일·결제일·결제월을 함께 확인해 주세요.');
  const before = state.settings.paymentProfiles?.[key];
  if (expected !== undefined && JSON.stringify(before) !== JSON.stringify(expected))
    throw Error('다른 기기에서 카드 설정이 변경됐어. 다시 열어서 확인해 줘.');
  const profile = { name: trimmed, kind };
  if (kind === 'credit' && daysPresent)
    Object.assign(profile, { closingDay, paymentDay, lagMonths });
  const next = { ...state.settings.paymentProfiles, [key]: profile };
  validatePaymentProfiles({ settings: { paymentProfiles: next } });
  state.settings.paymentProfiles = next;
  state.settings.paymentMethods ||= [];
  if (![...state.settings.paymentMethods, state.settings.cardName].some(v => methodKey(v) === key))
    state.settings.paymentMethods.push(trimmed);
  return profile;
}

// One card's *estimated* usage-to-payment cycle, independent of household
// salary/operating months. This is not an issuer statement or a bank debit.
export function billingWindow(asOf, profile) {
  if (!profile || profile.kind !== 'credit' || !profile.closingDay || !profile.paymentDay) return null;
  const month = asOf.slice(0, 7);
  const firstClose = dayInMonth(month, profile.closingDay);
  const closeMonth = asOf <= firstClose ? month : shiftMonth(month, 1);
  const end = dayInMonth(closeMonth, profile.closingDay);
  const prevClose = dayInMonth(shiftMonth(closeMonth, -1), profile.closingDay);
  const start = addDays(prevClose, 1);
  const payment = dayInMonth(shiftMonth(closeMonth, profile.lagMonths ?? 1), profile.paymentDay);
  return { start, end, payment };
}

export function cardBillingSummary(state, asOf) {
  const methods = new Map();
  for (const t of state.transactions) {
    const name = String(t.paymentMethod || '').trim(), key = methodKey(name);
    if (key && !methods.has(key)) methods.set(key, name);
  }
  for (const name of state.settings.paymentMethods || []) {
    const key = methodKey(name);
    if (key && !methods.has(key)) methods.set(key, name);
  }
  for (const profile of Object.values(state.settings.paymentProfiles || {})) {
    const key = methodKey(profile.name);
    if (!methods.has(key)) methods.set(key, profile.name);
  }
  return [...methods].filter(([key, name]) => paymentKind(state, name) === 'credit').map(([key, name]) => {
    const profile = state.settings.paymentProfiles?.[key] || null;
    const window = billingWindow(asOf, profile);
    // Card bill estimates include recorded fixed, personal and excluded usage.
    // Transfers/card-payment debits never create fresh consumption or card usage.
    const usage = cycle => cycle ? state.transactions.reduce((sum, t) => {
      if (t.deletedAt || t.splitParent || methodKey(t.paymentMethod) !== key ||
          t.date < cycle.start || t.date > cycle.end || t.date > asOf) return sum;
      return sum + (t.direction === 'expense' ? t.amount : t.direction === 'refund' ? -t.amount : 0);
    }, 0) : null;
    const previousWindow = window ? billingWindow(addDays(window.start, -1), profile) : null;
    const upcomingPayment = previousWindow?.payment >= asOf
      ? { ...previousWindow, usage: usage(previousWindow) } : null;
    return { name, profile, window, estimatedUsage: usage(window), upcomingPayment };
  }).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
