import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { emptyState } from '../data/defaults.js';
import { validateState, splitTransaction } from '../js/models.js';
import { migrate } from '../js/migrate.js';
import { focusOverview } from '../js/focus.js';
import { focusHome } from '../js/focus-ui.js';
import { billingWindow, cardBillingSummary, paymentKind, savePaymentProfile, spendingChannels } from '../js/payment-channels.js';

const month = '2026-10'; // household operating cycle is Oct 10 – Nov 9
const at = '2026-10-20T16:00:00';
function state() {
  const s = emptyState();
  s.configured = true;
  Object.assign(s.settings, { income: 6500000, variableBudget: 1500000, trackingSince: '2026-10-10' });
  return s;
}
function tx(id, amount, date = '2026-10-15', extra = {}) {
  return {
    id, sourceId: id, date, datetime: date + 'T12:00:00',
    amount, direction: 'expense', owner: 'p1', scope: 'shared',
    merchantRaw: '테스트 가맹점', merchantNormalized: 'qa',
    paymentMethod: '우리카드', costKind: 'variable', category: 'groceries', ...extra,
  };
}
function home(s, date=at) { return new JSDOM(focusHome(s, month, {}, date)).window.document; }
const value = (document, key) => document.querySelector('[data-focus-value="'+key+'"]')?.textContent;

test('one total adds credit and immediate spending, with unknown clearly separate', () => {
  const s = state();
  s.transactions.push(
    tx('credit', 250000),
    tx('bank', 100000, '2026-10-17', { paymentMethod: '계좌이체' }),
    tx('debit', 20000, '2026-10-17', { paymentMethod: '신한 체크카드', sourceType: 'card-csv' }),
    tx('unknown', 30000, '2026-10-17', { paymentMethod: '네이버페이' }),
    tx('refund', 50000, '2026-10-18', { direction: 'refund' }),
    tx('fixed', 200000, '2026-10-18', { scope: 'fixed', costKind: 'fixed' }),
    tx('excluded', 999999, '2026-10-17', { excluded: true, scope: 'excluded' }),
    tx('settlement', 100000, '2026-10-18', { direction: 'transfer', scope: 'excluded' }),
    tx('future', 90000, '2026-10-25'),
    tx('deleted', 100000, '2026-10-18', { deletedAt: '2026-10-19T03:00:00Z' }),
  );
  const original = structuredClone(s);
  const f = focusOverview(s, month, at);
  assert.equal(f.used, 350000);
  assert.deepEqual(
    {credit:f.channels.credit,immediate:f.channels.immediate,unknown:f.channels.unknown,total:f.channels.total},
    {credit:200000,immediate:120000,unknown:30000,total:350000},
  );
  assert.equal(f.remaining, 1150000);
  const doc = home(s);
  assert.equal(value(doc,'used'), '35만원');
  assert.equal(value(doc,'credit-spent'), '200,000원');
  assert.equal(value(doc,'immediate-spent'), '120,000원');
  assert.equal(value(doc,'unknown-spent'), '30,000원');
  assert.match(doc.querySelector('.focus-billing-detail').textContent, /청구기간/);
  assert.match(doc.querySelector('.focus-billing-detail').innerHTML, /data-method="네이버페이"/);
  assert.deepEqual(s, original, 'Rendering must be read-only');
});

test('manual method profile corrects unknown and credit/debit assumptions, without changing original usage', () => {
  const s = state();
  s.transactions.push(tx('unknown', 30000, '2026-10-17', {paymentMethod:'카카오페이'}));
  assert.equal(paymentKind(s,'카카오페이'),'unknown');
  const previous = structuredClone(s.transactions);
  const saved = savePaymentProfile(s,'카카오페이','credit',20,14,1);
  assert.equal(paymentKind(s,'카카오페이'),'credit');
  assert.equal(spendingChannels(s,s.transactions).credit,30000);
  assert.equal(cardBillingSummary(s,'2026-10-18').find(c=>c.name==='카카오페이').estimatedUsage,30000);
  assert.throws(()=>savePaymentProfile(s,'카카오페이','immediate',null,null,1,{}),/다른 기기/);
  savePaymentProfile(s,'카카오페이','immediate',null,null,1,saved);
  assert.equal(spendingChannels(s,s.transactions).immediate,30000);
  assert.equal(cardBillingSummary(s,'2026-10-18').some(c=>c.name==='카카오페이'),false);
  assert.deepEqual(s.transactions,previous);
  validateState(s);
});

test('different card statement periods do not follow the salary cycle and never shift purchase month', () => {
  const s=state();
  savePaymentProfile(s,'우리카드','credit',25,14,1);
  savePaymentProfile(s,'신한카드','credit',9,5,1);
  s.transactions.push(
    tx('w-old', 100000, '2026-09-25'), // previous Woori bill
    tx('w-current', 200000, '2026-10-10'), // Woori Sep 26 - Oct 25
    tx('w-later', 300000, '2026-10-27'), // next Woori bill
    tx('s-current', 40000, '2026-10-08', { paymentMethod:'신한카드' }), // Shinhan Oct 10 - Nov 9? no
    tx('s-new', 80000, '2026-10-12', { paymentMethod:'신한카드' }),
    tx('s-extra', 50000, '2026-10-19', { paymentMethod:'신한카드' }),
    tx('transfer', 1000000, '2026-10-16', { direction:'transfer', scope:'excluded' }),
    tx('w-refund', 10000, '2026-10-17', { direction:'refund' }),
  );
  const bills = cardBillingSummary(s,'2026-10-20');
  const w=bills.find(x=>x.name==='우리카드'), sh=bills.find(x=>x.name==='신한카드');
  assert.deepEqual(w.window, {start:'2026-09-26',end:'2026-10-25',payment:'2026-11-14'});
  assert.equal(w.estimatedUsage,190000);
  assert.deepEqual(sh.window,{start:'2026-10-10',end:'2026-11-09',payment:'2026-12-05'});
  assert.equal(sh.estimatedUsage,130000);
  assert.deepEqual(sh.upcomingPayment, {start:'2026-09-10',end:'2026-10-09',payment:'2026-11-05',usage:40000});
  assert.equal(w.upcomingPayment,null);
  assert.equal(focusOverview(s,month,at).used,320000);
  assert.equal(s.transactions.find(x=>x.id==='w-old').date,'2026-09-25');
  assert.equal(s.transactions.find(x=>x.id==='w-current').date,'2026-10-10');
});

test('billing cycle handles 31st, leap February and immediate following-day cycle', () => {
  const profile = {kind:'credit',closingDay:31,paymentDay:30,lagMonths:1};
  assert.deepEqual(billingWindow('2028-02-29',profile), {
    start:'2028-02-01',end:'2028-02-29',payment:'2028-03-30',
  });
  assert.deepEqual(billingWindow('2026-04-30',profile), {
    start:'2026-04-01',end:'2026-04-30',payment:'2026-05-30',
  });
  assert.deepEqual(billingWindow('2026-10-31',{kind:'credit',closingDay:20,paymentDay:28,lagMonths:0}),{
    start:'2026-10-21',end:'2026-11-20',payment:'2026-11-28',
  });
  assert.equal(billingWindow('2026-10-20',{kind:'credit'}),null);
});

test('unconfigured card billing period stays blank, not a fabricated issuer date', () => {
  const s=state();
  s.transactions.push(tx('credit',100000));
  const card=cardBillingSummary(s,'2026-10-20').find(x=>x.name==='우리카드');
  assert.equal(card.window,null);
  assert.equal(card.estimatedUsage,null);
  const doc=home(s);
  assert.match(doc.querySelector('.focus-billing-detail').textContent,/청구주기 미설정/);
  assert.equal(doc.querySelectorAll('.focus-board>.focus-card').length,3);
  assert.equal(doc.querySelectorAll('[data-focus-fold]').length,4);
});

test('card billing includes recorded fixed and excluded card charges, but not the transfer that pays it', () => {
  const s=state();
  savePaymentProfile(s,'우리카드','credit',25,15,1);
  s.transactions.push(
    tx('variable',200000), tx('fixed', 50000,'2026-10-13',{scope:'fixed',costKind:'fixed'}),
    tx('private',100000,'2026-10-15',{scope:'excluded',excluded:true}),
    tx('billPaid', 350000, '2026-10-18', {direction:'transfer',scope:'excluded'}),
  );
  assert.equal(focusOverview(s,month,at).used,200000);
  assert.equal(cardBillingSummary(s,'2026-10-20').find(x=>x.name==='우리카드').estimatedUsage,350000);
});

test('split transactions count only children and survive refunds, no duplicated parent usage', () => {
  const s=state();
  const root=tx('split',150000,'2026-10-15');
  s.transactions=splitTransaction(root,[
    {amount:100000,scope:'shared',costKind:'variable'},
    {amount:50000,scope:'fixed',costKind:'fixed'},
  ]);
  const result=focusOverview(s,month,at);
  assert.equal(result.used,100000);
  assert.equal(result.channels.credit,100000);
  assert.equal(cardBillingSummary(s,'2026-10-15')[0].estimatedUsage,null);
  savePaymentProfile(s,'우리카드','credit',25,15,1);
  assert.equal(cardBillingSummary(s,'2026-10-15')[0].estimatedUsage,150000);
});

test('invalid profiles and bank-name collision are rejected; old backup stays valid', () => {
  const s=state();
  const old=structuredClone(s);delete old.settings.paymentProfiles;
  validateState(old);migrate(old);validateState(old);
  assert.deepEqual(old.transactions,s.transactions);
  assert.throws(()=>savePaymentProfile(s,'신한카드','credit',25,null,1),/확인/);
  assert.throws(()=>savePaymentProfile(s,'신한카드','credit',32,15,1),/확인/);
  assert.throws(()=>savePaymentProfile(s,'신한카드','credit',25,15,3),/확인/);
  assert.throws(()=>savePaymentProfile(s,'신한카드','credit',25,15,0),/확인/);
  s.cashAccounts.push({id:'cash',name:'실제 계좌',owner:'p1',openingBalance:0,openingAt:'2026-10-10T09:00:00',reserved:0,paymentMethod:'',autoMatch:false});
  assert.throws(()=>savePaymentProfile(s,'실제 계좌','credit'),/은행계좌/);
  assert.equal(paymentKind(s,'실제 계좌'),'immediate');
});
