import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { emptyState } from '../data/defaults.js';
import { splitTransaction } from '../js/models.js';
import { focusOverview, limitBasis, limitValues, saveFocusLimit } from '../js/focus.js';
import { focusHome } from '../js/focus-ui.js';
import { cardDueForOperatingMonth, savePaymentProfile } from '../js/payment-channels.js';

const month = '2026-10'; // operating month Oct 10 – Nov 9
const now = '2026-10-14T13:40:00';
function household() {
  const s = emptyState();
  s.configured = true;
  Object.assign(s.settings, {
    variableBudget: 2500000, income: 6500000,
    trackingSince: '2026-10-10', privacy: false,
  });
  return s;
}
function transaction(id, amount, date, paymentMethod = '우리카드', extra = {}) {
  return {
    id, sourceId: id, date, datetime: date + 'T12:00:00',
    amount, direction: 'expense', owner: 'p1', scope: 'shared',
    costKind: 'variable', paymentMethod, category: 'groceries',
    merchantRaw: 'QA 매장', merchantNormalized: 'qa 매장', ...extra,
  };
}
const val = (document, key) =>
  document.querySelector('[data-focus-value="' + key + '"]')?.textContent;

test('per-card due dates aggregate in selected salary cycle, adding only prior variable card use', () => {
  const s = household();
  savePaymentProfile(s, '우리카드', 'credit', 25, 14, 1);
  savePaymentProfile(s, '신한카드', 'credit', 9, 5, 1);
  s.transactions.push(
    transaction('woori-prior', 300000, '2026-09-20'),
    transaction('woori-fixed', 120000, '2026-09-22', '우리카드', {scope:'fixed', costKind:'fixed'}),
    transaction('woori-refund', 20000, '2026-09-23', '우리카드', {direction:'refund'}),
    transaction('woori-excluded', 90000, '2026-09-24', '우리카드', {scope:'excluded',excluded:true}),
    transaction('shinhan-prior', 80000, '2026-10-08', '신한카드'),
    transaction('woori-new', 200000, '2026-10-12'),
    transaction('bank-new', 150000, '2026-10-13', '계좌이체'),
    transaction('settlement', 500000, '2026-10-13', '우리카드', {direction:'transfer',scope:'excluded'}),
    transaction('future', 1000000, '2026-10-17'),
    transaction('deleted', 1200000, '2026-09-24', '우리카드', {deletedAt:'2026-10-01T01:00:00Z'}),
  );
  const before = structuredClone(s);
  const due = cardDueForOperatingMonth(s, month, now.slice(0, 10));
  assert.deepEqual(due.payments.map(p => [p.name, p.paymentDate, p.estimatedAmount, p.additional]), [
    ['우리카드','2026-10-14',490000,280000],
    ['신한카드','2026-11-05',80000,80000],
  ]);
  assert.equal(due.dueTotal, 570000);
  assert.equal(due.addedToLimit, 360000);
  assert.equal(due.dueFixed, 120000);
  assert.equal(due.dueExcluded, 90000);
  const f = focusOverview(s, month, now);
  assert.equal(f.purchaseUsed, 350000);
  assert.equal(f.used, 510000);
  assert.equal(f.instantUsed, 150000);
  assert.equal(due.settlementVariable, 360000);
  assert.equal(f.remaining, 1990000);
  assert.equal(f.channels.credit, 200000);
  assert.equal(f.channels.immediate, 150000);
  const dom = new JSDOM(focusHome(s, month, {}, now)).window.document;
  assert.equal(val(dom, 'used'), '51만원');
  assert.equal(val(dom, 'purchase-used'), '350,000원');
  assert.equal(val(dom, 'settlement-variable'), '360,000원');
  assert.equal(val(dom, 'card-due-total'), '570,000원');
  assert.equal(val(dom, 'remaining'), '1,990,000원');
  assert.match(dom.querySelector('[data-card-payment="2026-11-05"]').textContent, /신한카드/);
  assert.deepEqual(s, before, 'Deriving card bills must never mutate financial records');
});

test('same-cycle credit card purchase and its card payment count only once', () => {
  const s = household();
  savePaymentProfile(s, '우리카드','credit',20,28,0);
  s.transactions.push(
    transaction('new', 220000, '2026-10-11'),
    transaction('not-yet-purchased', 300000, '2026-10-17'),
  );
  const due = cardDueForOperatingMonth(s, month, '2026-10-14');
  assert.equal(due.dueTotal, 220000);
  assert.equal(due.payments[0].alreadyCounted, 220000);
  assert.equal(due.addedToLimit, 0);
  assert.equal(due.payments[0].incomplete, true);
  assert.equal(focusOverview(s,month,now).used, 220000);
});

test('explicit operatingMonth reassignment is respected, not double charged', () => {
  const s = household();
  savePaymentProfile(s, '우리카드', 'credit', 25, 14, 1);
  s.transactions.push(transaction('manual', 300000, '2026-09-20', '우리카드',
    {operatingMonth: '2026-10'}));
  const f = focusOverview(s,month,now);
  assert.equal(f.purchaseUsed,300000);
  assert.equal(f.cardDue.dueTotal,300000);
  assert.equal(f.cardDue.addedToLimit,0);
  assert.equal(f.used,300000);
});

test('paid card-bill transfers, refunds, fixed and excluded spending never become duplicate consumer charges', () => {
  const s = household();
  savePaymentProfile(s, '우리카드', 'credit', 25, 14, 1);
  s.transactions.push(
    transaction('variable', 100000, '2026-09-20'),
    transaction('fixed', 150000, '2026-09-20', '우리카드', {scope:'fixed',costKind:'fixed'}),
    transaction('excluded', 250000, '2026-09-20', '우리카드', {scope:'excluded',excluded:true}),
    transaction('refund', 30000, '2026-09-21', '우리카드', {direction:'refund'}),
    transaction('settled', 470000, '2026-10-14', '우리카드', {direction:'transfer',scope:'excluded'}),
  );
  const due = cardDueForOperatingMonth(s,month,now.slice(0,10));
  assert.equal(due.dueTotal,470000);
  assert.equal(due.addedToLimit,70000);
  assert.equal(focusOverview(s,month,now).used,70000);
});

test('net card charge less than prior variable spending caps added liability at estimated payable amount', () => {
  const s = household();
  savePaymentProfile(s,'우리카드','credit',25,14,1);
  s.transactions.push(
    transaction('a', 400000, '2026-09-20'),
    transaction('fixed-refund', 350000, '2026-09-21', '우리카드',
      {scope:'fixed',costKind:'fixed',direction:'refund'}),
  );
  const due = cardDueForOperatingMonth(s,month,now.slice(0,10));
  assert.equal(due.dueTotal,50000);
  assert.equal(due.addedToLimit,50000);
});

test('missing issuer billing schedule is flagged and no bank debit or card amount is invented', () => {
  const s=household();
  s.transactions.push(transaction('old',500000,'2026-09-20'));
  const due=cardDueForOperatingMonth(s,month,now.slice(0,10));
  assert.deepEqual(due.missingProfiles,['우리카드']);
  assert.deepEqual(due.payments,[]);
  assert.equal(due.dueTotal,0);
  assert.equal(due.addedToLimit,0);
  const dom=new JSDOM(focusHome(s,month,{},now)).window.document;
  assert.match(dom.querySelector('.focus-due-missing').textContent,/우리카드/);
  assert.equal(val(dom,'used'),'0원');
});

test('split children are recognized once, with fixed part excluded from variable budget', () => {
  const s=household();
  savePaymentProfile(s,'우리카드','credit',25,14,1);
  const split=splitTransaction(transaction('root',350000,'2026-09-20'),[
    {amount:230000,scope:'shared',costKind:'variable'},
    {amount:120000,scope:'fixed',costKind:'fixed'},
  ]);
  s.transactions=split;
  const due=cardDueForOperatingMonth(s,month,now.slice(0,10));
  assert.equal(due.dueTotal,350000);
  assert.equal(due.addedToLimit,230000);
  assert.equal(due.payments[0].recordCount,2);
});

test('budget adjustment previews use the due-inclusive amount without changing card records', () => {
  const s=household();
  savePaymentProfile(s,'우리카드','credit',25,14,1);
  s.transactions.push(transaction('old',100000,'2026-09-20'));
  const f=focusOverview(s,month,now),basis=limitBasis(s,month);
  assert.equal(f.used,100000);
  const before=structuredClone(s.transactions);
  saveFocusLimit(s,month,limitValues(500000,0,0),basis);
  assert.equal(focusOverview(s,month,now).remaining,400000);
  assert.deepEqual(s.transactions,before);
});

test('selected historical and nonstandard operating months follow payment date, not purchase month', () => {
  const s=household();
  s.settings.periodStartDay=15;
  savePaymentProfile(s,'우리카드','credit',25,14,1);
  s.transactions.push(transaction('old',200000,'2026-10-20'));
  const due=cardDueForOperatingMonth(s,'2026-11','2026-11-12');
  assert.equal(due.cycle.start,'2026-11-15');
  assert.equal(due.cycle.end,'2026-12-14');
  // Oct 26 - Nov 25 settles Dec 14, inside Nov 15 – Dec 14.
  assert.deepEqual(due.payments.map(p=>p.paymentDate),['2026-12-14']);
  assert.equal(due.payments[0].estimatedAmount,0);
  // The transaction on Oct 20 belonged to the Sep 26 - Oct 25 bill paid Nov 14,
  // outside this custom Nov salary month. Nothing fictitious is added.
  assert.equal(due.addedToLimit,0);
});

test('month-end and leap-year cards clamp days and keep independent statement dates', () => {
  const s=household();savePaymentProfile(s,'우리카드','credit',31,31,1);
  s.transactions.push(transaction('feb',50000,'2028-02-28'));
  const due=cardDueForOperatingMonth(s,'2028-03','2028-03-21');
  assert.equal(due.cycle.start,'2028-03-10');
  assert.deepEqual(due.payments.map(p=>[p.paymentDate,p.start,p.end,p.estimatedAmount]),[
    ['2028-03-31','2028-02-01','2028-02-29',50000],
  ]);
});

test('future bill outside this salary cycle is not added early',()=>{
  const s=household();savePaymentProfile(s,'우리카드','credit',25,14,1);
  s.transactions.push(transaction('current',300000,'2026-10-11'));
  const f=focusOverview(s,month,now);
  assert.equal(f.purchaseUsed,300000);
  assert.equal(f.cardDue.addedToLimit,0);
  assert.equal(f.used,0, 'Card spending paid next cycle is not charged to the present settlement');
  assert.equal(f.cardDue.dueTotal,0);
});
