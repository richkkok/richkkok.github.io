import { moneyOverview } from './money.js';
import { cashSummary, cashNow } from './cash.js';
import { planFor } from './budget.js';

// Presentation model only. Never rewrite stored transactions or infer actual bank balances.
export function focusOverview(state, month, at = cashNow()) {
  const money = moneyOverview(state, month, at.slice(0, 10));
  const d = money.d, cash = cashSummary(state, at);
  const limit = d.requested, used = d.actual, remaining = limit - used;
  const cashChanged = cash.accounts.some(a => a.now.entries.some(r => r.leg.at > a.measuredAt) || a.recalculated);
  const cashStale = !!cash.oldest && cash.oldest.slice(0, 10) < at.slice(0, 10);
  const cashIssue = cash.mismatchCount > 0 || cash.pending.length > 0 || cashChanged || cashStale || cash.usable < 0;
  let advice;
  if (money.stale) advice = { title: '거래기록부터 최신으로 맞춰줘', text: '빠진 지출이 있으면 남은 한도가 실제보다 크게 보여. 기록을 채운 뒤 절약계획을 조정해.', action: 'go-import', label: '내역 가져오기' };
  else if (!cash.accounts.length) advice = { title: '계좌에 남은 현금을 입력해줘', text: '남은 소비한도와 실제 가진 돈은 달라. 은행에서 확인한 잔액을 따로 등록해.', action: 'cash-account', label: '잔액 입력' };
  else if (cashIssue) advice = { title: '실제 잔액을 한 번 더 확인해줘', text: '입력 이후 입출금이나 미연결 거래가 있을 수 있어. 예산을 늘리기 전에 현금부터 맞춰봐.', action: 'go-cash', label: '현금 확인' };
  else if (!limit) advice = { title: '이번 기간 소비한도를 정해줘', text: '공동 생활비와 두 사람의 용돈을 합친 금액이야. 고정지출은 별도로 관리해.', action: 'focus-plan', label: '한도 설정' };
  else if (remaining < 0) advice = { title: '계획한 소비한도를 넘었어', text: '한도를 늘려 초과를 감추기보다, 고정지출과 남은 현금을 확인하고 남은 소비를 조정해.', action: 'focus-plan', label: '절약계획 조정' };
  else if (limit > d.affordability) advice = { title: '수입·저축 목표에 맞춰 한도를 줄여봐', text: '정한 소비한도가 고정지출과 저축 목표를 뺀 범위보다 커. 실제 현금도 함께 확인해.', action: 'focus-plan', label: '절약계획 조정' };
  else advice = { title: '남은 한도 안에서 마감까지 쓰기', text: '한도를 줄여보면 앞으로 쓸 금액이 바로 보여. 고정지출은 납부내역을 확인한 뒤 조정해.', action: 'focus-plan', label: '절약계획 조정' };
  return { money, cash, limit, used, remaining, cashChanged, cashStale, cashIssue, advice };
}

export function limitValues(total, p1, p2) {
  if (![total, p1, p2].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1e12))
    throw Error('소비한도와 용돈은 0 이상의 정수로 입력해줘.');
  if (total < p1 + p2) throw Error('소비한도가 두 사람의 용돈 합계보다 작아. 용돈도 함께 조정해줘.');
  return { variableBudget: total, sharedBudget: total - p1 - p2, personalBudgets: { p1, p2 } };
}
export const limitBasis = (state, month) => {
  const p = planFor(state, month);
  return JSON.stringify([p.variableBudget, p.sharedBudget, p.personalBudgets.p1, p.personalBudgets.p2]);
};
export function saveFocusLimit(state, month, values, expectedBasis) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('적용할 가계부 기간을 확인해줘.');
  if (limitBasis(state, month) !== expectedBasis) throw Error('다른 기기에서 한도가 바뀌었어. 다시 열어서 확인해줘.');
  const next = limitValues(values.variableBudget, values.personalBudgets.p1, values.personalBudgets.p2);
  state.settings.monthOverrides ||= {};
  state.settings.monthOverrides[month] = { ...state.settings.monthOverrides[month], ...next };
}
