import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../data/defaults.js';
import { ensureControl } from '../js/control.js';
import { savePaymentProfile } from '../js/payment-channels.js';
import { spendingDetails } from '../js/spending-details.js';
import { spendingDetailsView, controlView } from '../js/control-ui.js';

function setup() {
  const s=emptyState();s.transactions=[];s.recurring=[];s.settings.periodStartDay=10;s.settings.privacy=false;
  savePaymentProfile(s,'A 카드','credit',3,17,0);
  savePaymentProfile(s,'B 카드','credit',25,10,1);
  savePaymentProfile(s,'생활 체크','immediate');
  s.cashAccounts=[{id:'bank',name:'생활 계좌',paymentMethod:'은행 이체'}];
  ensureControl(s);return s;
}
const tx=(id,date,paymentMethod,extra={})=>({id,date,datetime:date+'T10:00:00',paymentMethod,amount:100,direction:'expense',scope:'shared',merchantRaw:id,category:'groceries',...extra});
const details=s=>{ensureControl(s);return spendingDetails(s,'2026-10','2026-11-09');};
test('국민카드 생활비·우리카드 생활비는 카드 이름이며 변동 거래와 기타소비는 한도 포함',()=>{
  const s=setup();
  savePaymentProfile(s,'국민카드 생활비','credit',3,17,0);
  savePaymentProfile(s,'우리카드 생활비','credit',25,10,1);
  s.transactions=[
    tx('kb','2026-10-01','국민카드 생활비',{merchantRaw:'마트',category:'groceries',amount:120}),
    tx('woori','2026-09-24','우리카드 생활비',{merchantRaw:'식당',category:'dining',amount:230}),
    tx('kb-other','2026-10-02','국민카드 생활비',{merchantRaw:'기타 구매',category:'other',amount:40}),
    tx('other','2026-10-11','미지정',{category:'other',amount:50}),
    tx('cash','2026-10-11','현금',{category:'other',amount:60}),
    tx('fixed','2026-10-01','국민카드 생활비',{merchantRaw:'보험',costKind:'fixed',amount:1000}),
    tx('paid','2026-10-11','은행 이체',{direction:'transfer',amount:1000})
  ];
  const original=JSON.stringify(s.transactions),d=details(s);
  assert.equal(d.total,500);assert.equal(d.overview.variable,500);
  assert.deepEqual(d.groups.flatMap(g=>g.rows.map(r=>r.txId)).sort(),['kb','woori','kb-other','other','cash'].sort());
  assert.equal(d.groups.find(g=>g.name==='국민카드 생활비').total,160);
  assert.equal(d.groups.find(g=>g.name==='우리카드 생활비').total,230);
  assert.equal(JSON.stringify(s.transactions),original);
  const html=spendingDetailsView(s,'2026-10','2026-11-09');
  assert.match(html,/국민카드 생활비/);assert.match(html,/우리카드 생활비/);assert.match(html,/기타소비/);
  assert.doesNotMatch(html,/data-edit="fixed"|data-edit="paid"/);
});
test('고정지출 제외 후 생활비·기타소비를 포함하고 목록 합계와 한도 사용액 일치',()=>{
  const s=setup();
  s.transactions=[
    tx('card','2026-10-01','A 카드'),tx('bank','2026-10-11','은행 이체'),tx('debit','2026-10-11','생활 체크'),
    tx('card-fixed','2026-10-01','A 카드',{costKind:'fixed'}),
    tx('bank-fixed','2026-10-11','은행 이체',{scope:'fixed'}),
    tx('debit-fixed','2026-10-11','생활 체크',{recurringId:'insurance'}),
    tx('fixed-refund','2026-10-02','A 카드',{costKind:'fixed',direction:'refund',amount:20}),
    tx('cash','2026-10-11','현금'),tx('unknown','2026-10-11','미지정'),tx('prepaid','2026-10-11','선불카드'),
    tx('repayment','2026-10-11','은행 이체',{direction:'transfer'}),
    tx('excluded-card','2026-10-01','A 카드',{excluded:true}),
    tx('refund','2026-10-12','생활 체크',{direction:'refund',amount:30})
  ];
  const before=JSON.stringify(s.transactions);
  let d=details(s);const b=d.overview.due[0];
  s.billAdjustments.push({id:'fixed-adjust',billId:b.id,instrumentId:b.instrumentId,paymentDate:b.paymentDate,amount:-5,reason:'고정 할인',kind:'fixed'});
  d=details(s);
  assert.deepEqual(d.groups.flatMap(g=>g.rows.map(r=>r.txId)).sort(),['card','bank','debit','refund','cash','unknown','prepaid'].sort());
  assert.equal(d.total,570);assert.equal(d.total,d.overview.variable);
  assert.equal(d.overview.free,d.overview.income-d.overview.fixed-270-300);
  assert.equal(JSON.stringify(s.transactions),before);
  // Reclassification updates both the limit and detail list immediately.
  s.transactions.find(t=>t.id==='card').scope='fixed';d=details(s);
  assert.equal(d.total,470);assert.equal(d.total,d.overview.variable);
  const html=spendingDetailsView(s,'2026-10','2026-11-09');
  assert.doesNotMatch(html,/data-edit="(?:card|card-fixed|bank-fixed|debit-fixed|repayment)"/);
});
test('카드별 청구기간과 계좌 체크 실제 사용월을 구분하며 급여 결산기간과 독립',()=>{
  const s=setup();s.transactions=[tx('a-before','2026-09-03','A 카드'),tx('a-start','2026-09-04','A 카드'),tx('a-end','2026-10-03','A 카드'),tx('a-next','2026-10-04','A 카드'),tx('b-start','2026-08-26','B 카드'),tx('b-end','2026-09-25','B 카드'),tx('b-next','2026-09-26','B 카드'),tx('bank-before','2026-10-09','은행 이체'),tx('bank-start','2026-10-10','은행 이체'),tx('bank-end','2026-11-09','생활 계좌'),tx('bank-next','2026-11-10','은행 이체'),tx('check','2026-11-09','생활 체크')];
  const d=details(s);assert.deepEqual(d.groups.map(g=>g.type),['credit','credit','account']);
  assert.deepEqual(d.groups.flatMap(g=>g.rows.map(r=>r.txId)).sort(),['a-start','a-end','b-start','b-end','bank-before','bank-start'].sort());
  assert.equal(d.total,600);assert.equal(d.groups.reduce((n,g)=>n+g.variable,0),d.overview.variable);
  assert.equal(d.groups.find(g=>g.type==='account').rows.length,2);
});
test('고정·제외 내역을 숨기고 환불·할부·조정만 한도에 반영',()=>{
  const s=setup();s.transactions=[tx('installment','2026-10-01','A 카드',{amount:300,installments:3}),tx('refund','2026-10-02','A 카드',{amount:20,direction:'refund'}),tx('fixed','2026-10-11','생활 체크',{scope:'fixed'}),tx('excluded','2026-10-11','은행 이체',{excluded:true}),tx('transfer','2026-10-11','은행 이체',{direction:'transfer'}),tx('deleted','2026-10-11','은행 이체',{deletedAt:'yes'}),tx('duplicate','2026-10-11','은행 이체',{duplicateOf:'fixed'})];
  let d=details(s);const b=d.overview.due[0];s.billAdjustments.push({id:'adjust',billId:b.id,instrumentId:b.instrumentId,paymentDate:b.paymentDate,amount:-10,reason:'할인',kind:'variable'});
  d=details(s);assert.equal(d.total,70);assert.equal(d.overview.variable,70);assert.equal(d.groups.reduce((n,g)=>n+g.variable,0),70);assert.equal(d.groups.flatMap(g=>g.rows).length,3);
  const html=spendingDetailsView(s,'2026-10','2026-11-09');assert.match(html,/할부 1\/3회/);assert.doesNotMatch(html,/data-edit="fixed"|data-edit="excluded"/);
});
test('미설정 카드·개인 숨김·빈 목록·100건 이상 전체 표시와 소비한도 진입점',()=>{
  const s=setup();s.settings.privacy=true;s.transactions=Array.from({length:125},(_,i)=>tx('row'+i,'2026-10-11','미설정 카드',{scope:'p1',merchantRaw:'<private>'}));
  const d=details(s);assert.equal(d.groups[0].unconfigured,true);assert.equal(d.groups[0].rows.length,125);
  const html=spendingDetailsView(s,'2026-10','2026-11-09');assert.equal((html.match(/data-edit=/g)||[]).length,125);assert.doesNotMatch(html,/private/);assert.match(html,/청구기간 미설정/);
  assert.match(controlView(s,'2026-10'),/data-action="control-spending"/);
  s.transactions=[];assert.match(spendingDetailsView(s,'2026-10'),/소비한도에 반영되는 내역이 없어요/);
});
