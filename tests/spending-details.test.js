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
test('카드별 청구기간과 계좌·체크 결산기간의 양끝을 포함하며 다음 기간은 제외',()=>{
  const s=setup();s.transactions=[tx('a-before','2026-09-03','A 카드'),tx('a-start','2026-09-04','A 카드'),tx('a-end','2026-10-03','A 카드'),tx('a-next','2026-10-04','A 카드'),tx('b-start','2026-08-26','B 카드'),tx('b-end','2026-09-25','B 카드'),tx('b-next','2026-09-26','B 카드'),tx('bank-before','2026-10-09','은행 이체'),tx('bank-start','2026-10-10','은행 이체'),tx('bank-end','2026-11-09','생활 계좌'),tx('bank-next','2026-11-10','은행 이체'),tx('check','2026-11-09','생활 체크')];
  const d=details(s);assert.deepEqual(d.groups.map(g=>g.type),['credit','credit','account','debit']);
  assert.deepEqual(d.groups.flatMap(g=>g.rows.map(r=>r.txId)).sort(),['a-start','a-end','b-start','b-end','bank-start','bank-end','check'].sort());
  assert.equal(d.total,700);assert.equal(d.groups.reduce((n,g)=>n+g.variable,0),d.overview.variable);
  assert.equal(d.groups.find(g=>g.type==='account').rows.length,2);
});
test('고정·제외 내역도 표시, 환불·할부·조정을 반영하고 이체·삭제·중복은 제외',()=>{
  const s=setup();s.transactions=[tx('installment','2026-10-01','A 카드',{amount:300,installments:3}),tx('refund','2026-10-02','A 카드',{amount:20,direction:'refund'}),tx('fixed','2026-10-11','생활 체크',{scope:'fixed'}),tx('excluded','2026-10-11','은행 이체',{excluded:true}),tx('transfer','2026-10-11','은행 이체',{direction:'transfer'}),tx('deleted','2026-10-11','은행 이체',{deletedAt:'yes'}),tx('duplicate','2026-10-11','은행 이체',{duplicateOf:'fixed'})];
  let d=details(s);const b=d.overview.due[0];s.billAdjustments.push({id:'adjust',billId:b.id,instrumentId:b.instrumentId,paymentDate:b.paymentDate,amount:-10,reason:'할인',kind:'variable'});
  d=details(s);assert.equal(d.total,270);assert.equal(d.overview.variable,70);assert.equal(d.groups.reduce((n,g)=>n+g.variable,0),70);assert.equal(d.groups.flatMap(g=>g.rows).length,5);
  const html=spendingDetailsView(s,'2026-10','2026-11-09');assert.match(html,/할부 1\/3회/);assert.match(html,/한도 제외/);assert.match(html,/고정지출 · 한도 별도/);
});
test('미설정 카드·개인 숨김·빈 목록·100건 이상 전체 표시와 소비한도 진입점',()=>{
  const s=setup();s.settings.privacy=true;s.transactions=Array.from({length:125},(_,i)=>tx('row'+i,'2026-10-11','미설정 카드',{scope:'p1',merchantRaw:'<private>'}));
  const d=details(s);assert.equal(d.groups[0].unconfigured,true);assert.equal(d.groups[0].rows.length,125);
  const html=spendingDetailsView(s,'2026-10','2026-11-09');assert.equal((html.match(/data-edit=/g)||[]).length,125);assert.doesNotMatch(html,/private/);assert.match(html,/청구기간 미설정/);
  assert.match(controlView(s,'2026-10'),/data-action="control-spending"/);
  s.transactions=[];assert.match(spendingDetailsView(s,'2026-10'),/기록된 소비 내역이 없어요/);
});
