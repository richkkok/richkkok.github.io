import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { emptyState } from '../data/defaults.js';
import { cashSummary, cashProjection, saveCashLink, saveCashCheck } from '../js/cash.js';
import { focusOverview } from '../js/focus.js';
import { focusHome } from '../js/focus-ui.js';

const at = '2026-10-14T20:00:00';
const month = '2026-10';
function state() {
  const s = emptyState();
  s.configured = true;
  s.settings.privacy = false;
  s.settings.trackingSince = '2026-10-10';
  s.cashAccounts = [{
    id: 'a', name: '생활비 통장', owner: 'p1', openingBalance: 1500000,
    openingAt: '2026-10-11T10:00:00', reserved: 0,
    paymentMethod: '', autoMatch: false,
  }];
  s.recurring = [{
    id: 'rent', name: '정기지출', amount: 1900000, day: 20,
    start: '2026-01-01', end: '', owner: 'joint', scope: 'fixed',
    category: 'housing', paymentMethod: '은행 계좌', changes: [],
  }];
  return s;
}
function transaction(id, amount, date='2026-10-12', extra={}) {
  return {
    id, sourceId: id, date, datetime: date + 'T12:00:00',
    direction: 'expense', owner: 'p1', amount,
    scope: 'fixed', costKind: 'fixed', recurringId: 'rent', category: 'housing',
    paymentMethod: '은행 계좌', merchantRaw: 'QA 정기지출',
    merchantNormalized: 'qa 정기지출', ...extra,
  };
}
const homeCash = s =>
  new JSDOM(focusHome(s, month, {}, at)).window.document
    .querySelector('[data-focus-value="cash"]').textContent;

test('actual unpaid recurring plan is never treated as cash withdrawal', () => {
  const s = state();
  assert.equal(cashProjection(s, cashSummary(s, at), at).usable, 1500000);
  assert.equal(focusOverview(s, month, at).fixedSpent, 0);
  assert.equal(homeCash(s), '150만원');
});

test('newly recorded paid bank fixed cost reduces spendable cash, but not the stored bank observation', () => {
  const s = state();
  s.transactions.push(transaction('paid', 300000));
  const original = structuredClone(s);
  const f = focusOverview(s, month, at);
  assert.equal(f.cash.usable, 1500000, 'Verified bank observation remains unchanged');
  assert.equal(f.projectedCash.unlinkedFixed, 300000);
  assert.equal(f.projectedCash.unlinkedCount, 1);
  assert.equal(f.projectedCash.usable, 1200000);
  assert.equal(f.fixedSpent, 300000);
  assert.equal(f.fixedPlanned, 1900000);
  assert.equal(homeCash(s), '120만원');
  assert.match(focusHome(s, month, {}, at), /고정비 출금 추정 반영/);
  assert.deepEqual(s, original, 'Home projections never rewrite household finance records');
});

test('actual fixed refunds restore cash, future transactions and credit-card usage do not alter bank cash', () => {
  const s = state();
  s.transactions.push(
    transaction('paid', 300000),
    transaction('refund', 50000, '2026-10-13', { direction: 'refund' }),
    transaction('future', 500000, '2026-10-15'),
    transaction('credit', 400000, '2026-10-13', { paymentMethod: '우리카드' }),
    transaction('deleted', 80000, '2026-10-13', { deletedAt: '2026-10-14T01:00:00Z' }),
    transaction('ignored', 80000, '2026-10-13', { excluded: true }),
  );
  const f = focusOverview(s, month, at);
  assert.equal(f.projectedCash.unlinkedFixed, 250000);
  assert.equal(f.projectedCash.usable, 1250000);
  assert.equal(homeCash(s), '125만원');
});

test('bank-linked fixed payment is counted once and linked variable cash movements are also included', () => {
  const s = state();
  s.transactions.push(
    transaction('paid', 300000),
    transaction('groceries', 50000, '2026-10-13', {
      scope: 'shared', costKind: 'variable', recurringId: '',
      category: 'groceries',
    }),
    transaction('refund', 10000, '2026-10-13', { direction: 'refund' }),
  );
  for (const [id, time, direction] of [
    ['paid', '2026-10-12T13:12:00', 'out'],
    ['groceries', '2026-10-13T11:30:00', 'out'],
    ['refund', '2026-10-13T12:30:00', 'in'],
  ])
    saveCashLink(s, id, [{ accountId: 'a', direction, at: time }], false, '', at);
  const f = focusOverview(s, month, at);
  assert.equal(f.projectedCash.unlinkedFixed, 0);
  assert.equal(f.projectedCash.linkedChange, -340000);
  assert.equal(f.projectedCash.usable, 1160000);
  assert.equal(homeCash(s), '116만원');
});

test('reconfirmed actual bank balance already contains previous fixed debits and is never reduced twice', () => {
  const s = state();
  s.transactions.push(transaction('paid', 300000));
  saveCashCheck(s, {
    id: 'checked', accountId: 'a', at: '2026-10-13T14:00:00',
    actual: 1200000, note: '앱에 표시된 잔액 확인',
  }, at);
  const f = focusOverview(s, month, at);
  assert.equal(f.cash.usable, 1200000);
  assert.equal(f.projectedCash.unlinkedFixed, 0);
  assert.equal(f.projectedCash.usable, 1200000);
  assert.equal(homeCash(s), '120만원');
});

test('unlinked payment on the last balance-check date is not double-counted when exact time is unknown', () => {
  const s = state();
  s.transactions.push(transaction('same-day', 300000, '2026-10-11'));
  assert.equal(focusOverview(s, month, at).projectedCash.usable, 1500000);
  // Once a user verifies the actual bank outflow time, it can be applied.
  saveCashLink(s, 'same-day', [{accountId: 'a', direction: 'out', at: '2026-10-11T12:30:00'}], false, '', at);
  assert.equal(focusOverview(s, month, at).projectedCash.usable, 1200000);
});

test('multiple differently timed verified balances use the newest cutoff for unlinked debits', () => {
  const s = state();
  s.cashAccounts.push({
    id: 'b', name: '다른 통장', owner: 'joint', openingBalance: 700000,
    openingAt: '2026-10-13T08:00:00', reserved: 0, paymentMethod: '',
    autoMatch: false,
  });
  s.transactions.push(transaction('earlier', 100000, '2026-10-12'));
  s.transactions.push(transaction('later', 250000, '2026-10-14'));
  assert.equal(focusOverview(s, month, at).projectedCash.unlinkedFixed, 250000);
  assert.equal(focusOverview(s, month, at).projectedCash.usable, 1950000);
});

test('split parent counts fixed portion only once; explicitly ignored cash links remain excluded', () => {
  const s = state();
  s.transactions.push(
    transaction('parent', 300000, '2026-10-12', { scope: 'shared', costKind: 'variable', recurringId: '', splitParent: true }),
    transaction('child-fixed', 200000, '2026-10-12', { parentId: 'parent' }),
    transaction('child-var', 100000, '2026-10-12', { parentId: 'parent', scope: 'shared', costKind: 'variable', recurringId: '' }),
    transaction('ignored', 100000, '2026-10-12'),
  );
  saveCashLink(s, 'ignored', [], true, '', at);
  assert.equal(focusOverview(s, month, at).projectedCash.unlinkedFixed, 200000);
  assert.equal(homeCash(s), '130만원');
});

test('without a verified cash account, home requests an opening balance instead of fabricating money', () => {
  const s = state();
  s.cashAccounts = [];
  s.transactions.push(transaction('paid', 300000));
  assert.equal(focusOverview(s, month, at).projectedCash.usable, null);
  assert.equal(homeCash(s), '입력 필요');
});

function salary(id, amount, date='2026-10-12', extra={}) {
  return transaction(id, amount, date, {
    direction: 'income', scope: 'shared', costKind: 'variable', recurringId: '',
    category: 'other', merchantRaw: '급여', merchantNormalized: '급여',
    paymentMethod: '생활비 계좌', sourceType: 'manual', excluded: false, ...extra,
  });
}

test('a recorded, unlinked salary after the last bank observation immediately increases estimated usable cash', () => {
  const s = state();
  s.transactions.push(salary('pay', 6500000));
  const original = structuredClone(s);
  const f = focusOverview(s, month, at);
  assert.equal(f.cash.actual, 1500000, 'The bank observation is never rewritten');
  assert.equal(f.cashReceived, 6500000);
  assert.equal(f.projectedCash.unlinkedIncome, 6500000);
  assert.equal(f.projectedCash.unlinkedIncomeCount, 1);
  assert.equal(f.projectedCash.usable, 8000000);
  assert.equal(homeCash(s), '800만원');
  assert.match(focusHome(s, month, {}, at), /실제 입금 임시 반영/);
  assert.match(focusHome(s, month, {}, at), /미연결 실제 입금 6,500,000원 임시 반영/);
  assert.deepEqual(s, original, 'The dashboard must not create cash links or mutate transactions');
});

test('an already observed paycheck, future salary and excluded income never create a second cash balance', () => {
  const s = state();
  s.transactions.push(
    salary('before-baseline', 4000000, '2026-10-10'),
    salary('on-baseline-day', 3000000, '2026-10-11'),
    salary('future', 2000000, '2026-10-15'),
    salary('deleted', 600000, '2026-10-12', {deletedAt: '2026-10-12T12:00:00Z'}),
    salary('internal-transfer', 700000, '2026-10-12', {incomeKind: 'transfer'}),
    salary('nonoperating', 800000, '2026-10-12', {incomeKind: 'nonoperating'}),
    salary('excluded', 900000, '2026-10-12', {excluded: true}),
    salary('card', 1000000, '2026-10-12', {paymentMethod: '우리카드'}),
  );
  const f = focusOverview(s, month, at);
  assert.equal(f.projectedCash.unlinkedIncome, 0);
  assert.equal(f.projectedCash.usable, 1500000);
});

test('linked or reconfirmed incoming salary replaces rather than duplicates its provisional increase', () => {
  const s = state();
  s.transactions.push(salary('pay', 6500000));
  assert.equal(focusOverview(s, month, at).projectedCash.usable, 8000000);
  saveCashLink(s, 'pay', [{accountId:'a', direction:'in', at:'2026-10-12T14:00:00'}], false, '', at);
  const linked = focusOverview(s, month, at);
  assert.equal(linked.projectedCash.unlinkedIncome, 0);
  assert.equal(linked.projectedCash.linkedChange, 6500000);
  assert.equal(linked.projectedCash.usable, 8000000);
  saveCashCheck(s, {id:'confirmed',accountId:'a',at:'2026-10-13T18:00:00',actual:8000000}, at);
  const confirmed = focusOverview(s, month, at);
  assert.equal(confirmed.projectedCash.linkedChange, 0);
  assert.equal(confirmed.projectedCash.unlinkedIncome, 0);
  assert.equal(confirmed.projectedCash.usable, 8000000);
});

test('unmatched pay at a verified bank name with an unknown noon timestamp is provisional until linked', () => {
  const s = state();
  s.cashAccounts[0].autoMatch = true;
  s.cashAccounts[0].paymentMethod = '생활비 계좌';
  s.transactions.push(salary('manual-pay', 6500000));
  assert.equal(focusOverview(s, month, at).projectedCash.usable, 8000000);
  assert.equal(focusOverview(s, month, at).projectedCash.unlinkedIncome, 6500000);
});
