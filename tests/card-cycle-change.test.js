import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from '../data/defaults.js';
import {savePaymentProfile,billingWindow,billingStartDay,validateBillingCycle,billingTermsAt} from '../js/payment-channels.js';
import {ensureControl,cardCharges,cardBills,controlOverview,settleBill} from '../js/control.js';
import {previewCardCycle,applyCardCycle} from '../js/card-cycle-change.js';
import {cashSummary,cashProjection} from '../js/cash.js';
import {Repository} from '../js/db.js';
import {IDBFactory} from 'fake-indexeddb';
const tx=(id,date,amount=100,extra={})=>({id,sourceId:id,date,datetime:date+'T10:01:00',amount,direction:'expense',owner:'p1',scope:'shared',category:'groceries',merchantRaw:'검증',merchantNormalized:'검증',sourceType:'manual',paymentMethod:'신한카드',...extra});
const setup=()=>{const s=emptyState();s.configured=true;s.settings.periodStartDay=1;s.settings.variableBudget=2500000;s.transactions=[];s.recurring=[];ensureControl(s);savePaymentProfile(s,'신한카드','credit',3,17,0);return s;};
const metadata=(effective='2026-10-01')=>({startDay:4,effective,accountId:'bank',holidayPolicy:'none',holidays:[]});
test('사용자 예시 다섯 거래와 미래 결제월 선반영: 9/8 사용은 10월',()=>{
 const s=setup();s.transactions=[tx('a','2026-09-03',30000),tx('b','2026-09-08',50000),tx('c','2026-09-25',100000),tx('d','2026-10-02',20000),tx('e','2026-10-04',40000)];ensureControl(s);
 assert.deepEqual(cardCharges(s,'2026-10-21').map(r=>r.month),['2026-09','2026-10','2026-10','2026-10','2026-11']);
 assert.equal(controlOverview(s,'2026-10','2026-09-20').variable,50000);
 assert.equal(controlOverview(s,'2026-09','2026-10-21').variable,30000);
 assert.equal(controlOverview(s,'2026-10','2026-10-21').variable,170000);
 assert.equal(controlOverview(s,'2026-11','2026-10-21').variable,40000);
 assert.deepEqual(s.transactions.map(t=>t.date),['2026-09-03','2026-09-08','2026-09-25','2026-10-02','2026-10-04']);
});
test('120만 카드 +30만 체크 현금 =150만 /250만, 사용월 통계 원본 불변',()=>{
 const s=setup();s.settings.periodStartDay=10;s.transactions=[tx('card','2026-09-08',1200000),tx('check','2026-10-02',200000,{paymentMethod:'체크카드'}),tx('cash','2026-10-31',100000,{paymentMethod:'현금'}),tx('next','2026-11-01',999,{paymentMethod:'현금'})];ensureControl(s);const before=structuredClone(s.transactions);
 const o=controlOverview(s,'2026-10','2026-11-03');assert.equal(o.variable,1500000);assert.equal(o.remaining,1000000);assert.deepEqual(s.transactions,before);
});
test('시작/마감 겹침과 누락 거절, 모든 월과 윤년 날짜를 정확히 한 주기에 포함',()=>{
 assert.throws(()=>validateBillingCycle(4,4),/겹치거나/);assert.throws(()=>validateBillingCycle(5,3),/빠지는/);
 for(const year of [2026,2028])for(const close of [3,28,29,30,31])for(let m=1;m<=12;m++){
  const month=`${year}-${String(m).padStart(2,'0')}`;
  for(let d=1;d<=new Date(year,m,0).getDate();d++){
   const date=month+'-'+String(d).padStart(2,'0');const p={kind:'credit',startDay:close%31+1,closingDay:close,paymentDay:17,lagMonths:1};
   const w=billingWindow(date,p);assert.ok(w.start<=date&&date<=w.end);
   const prev=new Date(w.start+'T12:00:00Z');prev.setUTCDate(prev.getUTCDate()-1);
   assert.equal(billingWindow(prev.toISOString().slice(0,10),p).end,prev.toISOString().slice(0,10));
  }
 }
});
test('카드별 주기, 연말, 할부 회차와 환불 합산',()=>{
 const s=setup();savePaymentProfile(s,'다른 카드','credit',31,10,1);s.transactions=[tx('a','2026-09-08',100),tx('b','2026-09-08',200,{paymentMethod:'다른 카드'}),tx('year','2026-12-31',100001,{installments:3}),tx('refund','2026-09-10',30,{direction:'refund'})];ensureControl(s);
 assert.equal(controlOverview(s,'2026-10','2026-10-21').variable,270);
 assert.deepEqual(cardCharges(s,'2027-01-01').filter(r=>r.txId==='year').map(r=>[r.month,r.amount]),[['2027-01',33334],['2027-02',33334],['2027-03',33333]]);
});
test('휴일로 출금월이 달라져도 소비한도는 원래 약정 결제월',()=>{
 const s=setup();savePaymentProfile(s,'휴일 카드','credit',31,1,1,undefined,{startDay:1,effective:'2026-01-01',holidayPolicy:'previous',holidays:['2027-01-01']});s.transactions=[tx('a','2026-12-20',50000,{paymentMethod:'휴일 카드'})];ensureControl(s);
 const r=cardCharges(s,'2027-01-02')[0];assert.equal(r.month,'2027-01');assert.equal(r.nominal,'2027-01-01');assert.equal(r.paymentDate,'2026-12-31');
 assert.equal(controlOverview(s,'2026-12','2027-01-02').variable,0);assert.equal(controlOverview(s,'2027-01','2027-01-02').variable,50000);
});
test('편집, 카드변경, 환불, 삭제 즉시 재계산',()=>{
 const s=setup();savePaymentProfile(s,'다른 카드','credit',20,25,0);s.transactions=[tx('a','2026-09-08',50000)];ensureControl(s);
 s.transactions[0].paymentMethod='다른 카드';ensureControl(s);assert.equal(controlOverview(s,'2026-09','2026-10-21').variable,50000);assert.equal(controlOverview(s,'2026-10','2026-10-21').variable,0);
 s.transactions[0].date='2026-09-25';s.transactions[0].amount=70000;ensureControl(s);assert.equal(controlOverview(s,'2026-10','2026-10-21').variable,70000);
 s.transactions.push(tx('refund','2026-09-26',20000,{direction:'refund',paymentMethod:'다른 카드'}));ensureControl(s);assert.equal(controlOverview(s,'2026-10','2026-10-21').variable,50000);
 s.transactions[0].deletedAt='deleted';assert.equal(controlOverview(s,'2026-10','2026-10-21').variable,-20000);
});
test('설정 미리보기는 읽기 전용, 영향 확인 없는 재집계 거절, 변경 이력 보존',()=>{
 const s=setup();s.transactions=[tx('a','2026-09-08',50000),tx('b','2026-10-02',20000)];ensureControl(s);
 const before=structuredClone(s), m={...metadata('2026-09-01'),startDay:21};
 const p=previewCardCycle(s,'신한카드','credit',20,25,0,m,'2026-10-21');
 assert.deepEqual(s,before);assert.equal(p.changes.length,2);assert.deepEqual(p.totals,[['2026-09',50000],['2026-10',-50000]]);
 assert.throws(()=>applyCardCycle(s,'신한카드','credit',20,25,0,m,false,'2026-10-21'),/확인/);assert.deepEqual(s,before);
 applyCardCycle(s,'신한카드','credit',20,25,0,m,true,'2026-10-21');assert.equal(controlOverview(s,'2026-09','2026-10-21').variable,50000);assert.deepEqual(s.transactions,before.transactions);
 assert.equal(s.settings.paymentProfiles['신한카드'].cycleChangeLog.length,1);
});
test('이미 납부된 청구분과 이전 적용일 원본, 계좌연결, 납부기록 보존',()=>{
 const s=setup();s.cashAccounts=[{id:'bank',name:'은행',owner:'p1',openingAt:'2026-09-01T00:00:00',openingBalance:1000000,reserved:0,paymentMethod:'은행',autoMatch:false}];
 s.transactions=[tx('a','2026-09-08',50000),tx('future','2026-10-20',20000)];ensureControl(s);
 settleBill(s,cardBills(s,'2026-10-21').find(b=>b.month==='2026-10'),50000,'2026-10-17','bank');
 const before=structuredClone(s), m={...metadata('2026-09-01'),startDay:21};
 const p=previewCardCycle(s,'신한카드','credit',20,25,0,m,'2026-10-21');assert.equal(p.protectedCount,1);
 applyCardCycle(s,'신한카드','credit',20,25,0,m,true,'2026-10-21');
 assert.deepEqual(s.transactions,before.transactions);assert.deepEqual(s.cashLinks,before.cashLinks);assert.deepEqual(s.cardSettlements,before.cardSettlements);assert.deepEqual(s.cashAccounts,before.cashAccounts);
 assert.equal(cardCharges(s,'2026-10-21').find(r=>r.txId==='a').paymentDate,'2026-10-17');
});
test('카드 사용은 현금 미차감, 납부시 현금만 한 번 차감하고 소비한도 불변',()=>{
 const s=setup();s.cashAccounts=[{id:'bank',name:'은행',owner:'p1',openingAt:'2026-09-01T00:00:00',openingBalance:1000000,reserved:0,paymentMethod:'은행',autoMatch:false}];s.transactions=[tx('a','2026-09-08',50000)];ensureControl(s);
 const at='2026-10-21T12:00:00';assert.equal(cashProjection(s,cashSummary(s,at),at).usable,1000000);
 const b=cardBills(s,'2026-10-21')[0];settleBill(s,b,50000,'2026-10-17','bank');
 assert.equal(controlOverview(s,'2026-10','2026-10-21').variable,50000);assert.equal(cashSummary(s,at).expected,950000);assert.equal(cashProjection(s,cashSummary(s,at),at).usable,950000);assert.equal(cardBills(s,'2026-10-21')[0].status,'matched');
 assert.throws(()=>settleBill(s,b,50000,'2026-10-17','bank',s.cardSettlements[0].txId),/이미/);
});
test('기존 은행 출금 연결시 새 거래 없이 현금 반영, 납부액 차이 유지',()=>{
 const s=setup();s.cashAccounts=[{id:'bank',name:'은행',owner:'p1',openingAt:'2026-09-01T00:00:00',openingBalance:1000000,reserved:0,paymentMethod:'은행',autoMatch:false}];s.transactions=[tx('a','2026-09-08',50000),tx('paid','2026-10-17',49000,{direction:'transfer',paymentMethod:'은행',excluded:true,scope:'excluded'})];ensureControl(s);
 settleBill(s,cardBills(s,'2026-10-21')[0],49000,'2026-10-17','bank','paid');assert.equal(s.transactions.length,2);assert.equal(cashSummary(s,'2026-10-21T12:00:00').expected,951000);assert.equal(cardBills(s,'2026-10-21')[0].difference,-1000);assert.equal(controlOverview(s,'2026-10','2026-10-21').variable,50000);
});
test('기존 시작일은 마감 다음날로 표시만 하고 설정과 과거 한도 자동변경 없음',()=>{
 const s=setup();s.transactions=[tx('a','2026-09-08',50000)];ensureControl(s);const before=structuredClone(s);
 assert.equal(billingStartDay(s.settings.paymentProfiles['신한카드']),4);previewCardCycle(s,'신한카드','credit',3,17,0,metadata(),'2026-10-21');assert.deepEqual(s,before);
 applyCardCycle(s,'신한카드','credit',3,17,0,metadata(),false,'2026-10-21');assert.equal(controlOverview(s,'2026-10','2026-10-21').variable,50000);
});
test('처음 주기를 설정한 미설정 카드도 적용일 이전 거래를 임의 이동하지 않음',()=>{
 const s=setup();delete s.settings.paymentProfiles['신한카드'];s.transactions=[tx('a','2026-09-08',50000),tx('b','2026-10-20',20000)];ensureControl(s);
 const r=applyCardCycle(s,'신한카드','credit',3,17,0,metadata('2026-10-21'),false,'2026-10-21');assert.equal(r.changes.length,0);assert.equal(controlOverview(s,'2026-09','2026-10-21').variable,50000);assert.equal(controlOverview(s,'2026-10','2026-10-21').variable,20000);
 s.transactions.push(tx('new','2026-10-21',100));ensureControl(s);assert.equal(controlOverview(s,'2026-11','2026-10-21').variable,100);
});
test('설정 저장 후 재조회: 시작일/마감일/결제일/이력/원본 보존',async()=>{
 const s=setup();s.transactions=[tx('a','2026-09-08',50000)];ensureControl(s);applyCardCycle(s,'신한카드','credit',3,17,0,metadata(),false,'2026-10-21');
 const repo=new Repository('card-cycle-test',new IDBFactory());await repo.replace(s);repo.close();const read=await repo.read();assert.equal(read.settings.paymentProfiles['신한카드'].startDay,4);assert.equal(read.settings.paymentProfiles['신한카드'].closingDay,3);assert.deepEqual(read.transactions,s.transactions);repo.close();
});
