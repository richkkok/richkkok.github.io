import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { emptyState } from '../data/defaults.js';
import { Repository } from '../js/db.js';
import { ensureControl, controlOverview, cardCharges, cardBills, settleBill, confirmFixed, fixedRows, duplicateIncomes, resolveIncome, saveLimit, adjustedDate, validateControl } from '../js/control.js';
import { savePaymentProfile } from '../js/payment-channels.js';
import { renamePaymentMethod, paymentRenameBasis } from '../js/payment-rename.js';
import { closeDay } from '../js/behavior.js';
import { mergeValue } from '../js/sync-merge.js';
import { classify } from '../js/rules.js';
const setup=()=>{const s=emptyState();s.configured=true;s.settings.periodStartDay=1;s.settings.privacy=false;s.settings.variableBudget=2500000;s.transactions=[];s.recurring=[];ensureControl(s);savePaymentProfile(s,'테스트 카드','credit',3,17,0);return s;};
const tx=(id,amount,date='2026-10-01',extra={})=>({id,sourceId:id,date,datetime:date+'T10:11:00',amount,direction:'expense',owner:'p1',scope:'shared',category:'groceries',categoryConfirmed:true,merchantRaw:'가상 거래',merchantNormalized:'가상 거래',paymentMethod:'테스트 카드',sourceType:'manual',...extra});
test('9/4~10/3 사용분은 10/17 청구, 경계 거래 누락·중복 없음',()=>{
 const s=setup();s.transactions=['2026-09-03','2026-09-04','2026-10-03','2026-10-04'].map((d,i)=>tx('t'+i,100,d));ensureControl(s);
 assert.deepEqual(cardCharges(s,'2026-10-19').map(r=>r.month),['2026-09','2026-10','2026-10','2026-11']);
 const b=cardBills(s,'2026-10-19').find(b=>b.month==='2026-10');assert.equal(b.estimated,200);assert.equal(b.paymentDate,'2026-10-17');assert.equal(b.start,'2026-09-04');
});
test('130만원 소비한도 유지: 카드대금 납부는 두 번 차감하지 않음',()=>{
 const s=setup();s.transactions=[tx('card',800000),tx('debit',200000,'2026-10-02',{paymentMethod:'체크카드'}),tx('bank',300000,'2026-10-03',{paymentMethod:'은행'}),tx('paid',800000,'2026-10-17',{direction:'transfer',paymentMethod:'은행',scope:'excluded',excluded:true})];ensureControl(s);
 let o=controlOverview(s,'2026-10','2026-10-19');assert.equal(o.variable,1300000);assert.equal(o.limit,2500000);settleBill(s,o.due[0],800000,'2026-10-17','','paid');o=controlOverview(s,'2026-10','2026-10-19');assert.equal(o.variable,1300000);assert.equal(o.due[0].status,'matched');
});
test('650만 입금 -150만 실제 고정비 -120만 변동소비 =380만 여유자금',()=>{
 const s=setup();s.transactions=[tx('salary',6500000,'2026-10-10',{direction:'income',paymentMethod:'은행',merchantRaw:'급여'}),tx('fixed',1500000,'2026-10-15',{scope:'fixed',costKind:'fixed',paymentMethod:'은행'}),tx('variable',1200000),tx('internal',700000,'2026-10-10',{direction:'transfer',paymentMethod:'은행'})];ensureControl(s);const o=controlOverview(s,'2026-10','2026-10-19');assert.equal(o.income,6500000);assert.equal(o.fixed,1500000);assert.equal(o.free,3800000);
 s.transactions.push(tx('debit',1200000,'2026-10-17',{direction:'transfer'}));assert.equal(controlOverview(s,'2026-10','2026-10-19').free,3800000);
});
test('카드 150만 청구 /148만 출금 차이 2만, 할인 조정 후 일치',()=>{
 const s=setup();s.transactions=[tx('a',1500000),tx('p',1480000,'2026-10-17',{direction:'transfer'})];ensureControl(s);const bill=cardBills(s,'2026-10-19')[0];settleBill(s,bill,1480000,'2026-10-17','','p');assert.equal(cardBills(s,'2026-10-19')[0].difference,-20000);s.billAdjustments.push({id:'adjust',billId:bill.id,instrumentId:bill.instrumentId,paymentDate:bill.paymentDate,amount:-20000,reason:'할인',kind:'variable'});assert.equal(cardBills(s,'2026-10-19')[0].status,'matched');assert.equal(controlOverview(s,'2026-10','2026-10-19').variable,1480000);
});
test('할부 원 단위 보존·연도 변경·부분 환불',()=>{
 const s=setup();s.transactions=[tx('a',100001,'2026-10-01',{installments:3}),tx('refund',10000,'2026-10-02',{direction:'refund'})];ensureControl(s);const charges=cardCharges(s,'2026-10-19');assert.deepEqual(charges.filter(r=>r.txId==='a').map(r=>r.amount),[33334,33334,33333]);assert.equal(charges.reduce((n,r)=>n+r.amount,0),90001);s.transactions=[tx('year',100,'2026-12-05')];ensureControl(s);assert.equal(cardCharges(s,'2027-01-20')[0].month,'2027-01');
});
test('카드마다 다른 주기와 월말/윤년 경계',()=>{
 const s=setup();savePaymentProfile(s,'다른 카드','credit',31,10,1);s.transactions=[tx('a',100,'2028-02-29',{paymentMethod:'다른 카드'}),tx('b',200,'2028-03-01',{paymentMethod:'다른 카드'})];ensureControl(s);assert.deepEqual(cardCharges(s,'2028-03-02').map(r=>r.month),['2028-03','2028-04']);
});
test('결제일 변경은 저장된 과거 청구일을 보존',()=>{
 const s=setup();s.transactions=[tx('a',100)];ensureControl(s);savePaymentProfile(s,'테스트 카드','credit',5,20,0,undefined,{effective:'2026-10-19'});ensureControl(s);assert.equal(cardCharges(s,'2026-10-19')[0].paymentDate,'2026-10-17');s.transactions.push(tx('b',100,'2026-10-19'));ensureControl(s);assert.equal(cardCharges(s,'2026-10-19')[1].paymentDate,'2026-11-20');
});
test('휴일 처리: 주말과 입력한 공휴일·연도 경계',()=>{
 assert.equal(adjustedDate('2026-10-17',{holidayPolicy:'next',holidays:['2026-10-19']}),'2026-10-20');assert.equal(adjustedDate('2027-01-01',{holidayPolicy:'previous',holidays:['2027-01-01']}),'2026-12-31');
});
test('고정비 실제 118만 납부완료, 다음 달 118만 납부예정',()=>{
 const s=setup();s.recurring=[{id:'insurance',name:'보험',amount:1200000,day:15,category:'finance',start:'2026-01-01',changes:[]}];s.transactions=[tx('f',1180000,'2026-10-15',{scope:'fixed',costKind:'fixed',recurringId:'insurance',paymentMethod:'은행'})];ensureControl(s);const r=fixedRows(s,'2026-10','2026-10-19')[0];confirmFixed(s,{...r,month:'2026-10'},null,'2026-10-19');assert.equal(fixedRows(s,'2026-10','2026-10-19')[0].paid,true);const next=fixedRows(s,'2026-11','2026-11-20')[0];assert.equal(next.amount,1180000);assert.equal(next.paid,false);assert.equal(next.actual,0);assert.equal(s.recurring[0].amount,1200000);
});
test('수동 다음 달 예정금액 우선, 과거 실제 납부 보존',()=>{
 const s=setup();s.recurring=[{id:'f',name:'보험',amount:1200000,day:15,category:'finance',changes:[{effective:'2026-11-15',amount:990000}]}];s.transactions=[tx('a',1180000,'2026-10-15',{scope:'fixed',recurringId:'f',paymentMethod:'은행'})];ensureControl(s);confirmFixed(s,{...fixedRows(s,'2026-10','2026-10-19')[0],month:'2026-10'},null,'2026-10-19');assert.equal(fixedRows(s,'2026-11','2026-11-20')[0].amount,990000);s.transactions[0].amount=1170000;assert.equal(fixedRows(s,'2026-10','2026-10-19')[0].paid,false);
});
test('같은 금액의 반복 입금은 자동 제외하지 않으며 사용자 확정만 반영',()=>{
 const s=setup();s.transactions=[tx('a',100000,'2026-10-10',{direction:'income',paymentMethod:'은행'}),tx('b',100000,'2026-10-10',{direction:'income',paymentMethod:'은행'}),tx('c',100000,'2026-10-11',{direction:'income',paymentMethod:'은행'})];ensureControl(s);assert.equal(controlOverview(s,'2026-10','2026-10-19').income,300000);assert.equal(duplicateIncomes(s).length,1);resolveIncome(s,duplicateIncomes(s)[0],true);assert.equal(s.transactions.length,3);assert.equal(controlOverview(s,'2026-10','2026-10-19').income,200000);assert.equal(duplicateIncomes(s).length,0);
});
test('별개 입금 확인 후 다시 알림하지 않으며 수정되면 재검토',()=>{
 const s=setup();s.transactions=[tx('a',100,'2026-10-10',{direction:'income'}),tx('b',100,'2026-10-10',{direction:'income'})];ensureControl(s);resolveIncome(s,duplicateIncomes(s)[0],false);assert.equal(duplicateIncomes(s).length,0);s.transactions[0].datetime='2026-10-10T10:12:00';assert.equal(duplicateIncomes(s).length,1);
});
test('무지출 확인과 미납 알림·분류 알림은 각각 한 건',()=>{
 const s=setup();const date='2026-10-19';assert.equal(controlOverview(s,'2026-10',date).alerts.length,1);closeDay(s,date,'zero');assert.equal(controlOverview(s,'2026-10',date).alerts.length,0);s.transactions.push(tx('unknown',100,date,{category:'other',categoryConfirmed:false,merchantRaw:'알수없음',merchantNormalized:'알수없음'}));assert.equal(controlOverview(s,'2026-10',date).alerts.length,1);
});
test('한도 기본 반복·월별 우선·과거 금액 보존',()=>{
 const s=setup();saveLimit(s,'2026-10',2300000,true);saveLimit(s,'2026-11',2100000);assert.equal(controlOverview(s,'2026-09').limit,2500000);assert.equal(controlOverview(s,'2026-10').limit,2300000);assert.equal(controlOverview(s,'2026-11').limit,2100000);assert.equal(controlOverview(s,'2026-12').limit,2300000);assert.equal(s.limitHistory.length,2);
});
test('카드 이름 변경 후 고유 ID와 청구·납부 연결 유지',()=>{
 const s=setup();s.transactions=[tx('a',100)];ensureControl(s);const id=s.transactionControl[s.transactions[0].id].instrumentId,bill=cardBills(s,'2026-10-19')[0].id;renamePaymentMethod(s,'테스트 카드','이름 변경 카드',paymentRenameBasis(s,'테스트 카드'));ensureControl(s);assert.equal(s.transactionControl[s.transactions[0].id].instrumentId,id);assert.equal(cardBills(s,'2026-10-19')[0].id,bill);
});
test('거래 수정·삭제·복원 후 즉시 계산',()=>{
 const s=setup();s.transactions=[tx('a',100)];ensureControl(s);assert.equal(controlOverview(s,'2026-10','2026-10-19').variable,100);s.transactions[0].amount=200;ensureControl(s);assert.equal(controlOverview(s,'2026-10','2026-10-19').variable,200);s.transactions[0].deletedAt='now';assert.equal(controlOverview(s,'2026-10','2026-10-19').variable,0);s.transactions[0].deletedAt=null;assert.equal(controlOverview(s,'2026-10','2026-10-19').variable,200);
});
test('마이너스 여유자금 표시, 고정비는 변동에 포함하지 않음',()=>{
 const s=setup();s.transactions=[tx('a',100),tx('f',200,'2026-10-01',{scope:'fixed'})];ensureControl(s);const o=controlOverview(s,'2026-10','2026-10-19');assert.equal(o.variable,100);assert.equal(o.fixed,200);assert.equal(o.free,-300);
});
test('v4 마이그레이션 백업과 재접속·복원 보존',async()=>{
 const s=setup();s.productVersion=3;s.transactions=[tx('a',100)];const original=structuredClone(s),repo=new Repository('control-qa',new IDBFactory());await repo.writeKey('state',s);await repo.writeKey('cloudMeta',{sessionToken:'synthetic'});const migrated=await repo.read();assert.equal(migrated.productVersion,4);assert.deepEqual(await repo.readKey('pre-v4-backup'),original);await repo.mutate(st=>saveLimit(st,'2026-10',500));repo.close();const after=await repo.read();assert.equal(after.transactions[0].id,'a');assert.equal(after.transactions[0].amount,100);assert.equal(after.limitHistory.length,1);assert.equal((await repo.readKey('cloudMeta')).sessionToken,'synthetic');repo.close();
});
test('같은 납부 레코드 동시수정은 명시적 충돌, 다른 한도 기록은 보존',()=>{
 const base=setup();base.cardSettlements=[{id:'x',txId:'a',billId:'b'}];const l=structuredClone(base),r=structuredClone(base);l.cardSettlements[0].txId='l';r.cardSettlements[0].txId='r';assert.throws(()=>mergeValue(base,l,r));
});
test('무료 규칙 분류와 사용자 확정 규칙 우선',()=>{
 assert.equal(classify({merchantNormalized:'스타벅스'}).category,'cafe');assert.equal(classify({merchantNormalized:'배달의민족'}).category,'dining');assert.equal(classify({merchantNormalized:'새로운 거래처'}).category,'other');assert.equal(classify({merchantNormalized:'스타벅스'},[{id:'r',field:'merchant',match:'exact',pattern:'스타벅스',category:'other'}]).category,'other');
});
test('잘못된 할부 값은 거절',()=>{const s=setup();s.transactions=[tx('a',100,'2026-10-01',{installments:0})];assert.throws(()=>validateControl(s));});
test('외부 입금 ID는 날짜 차이도 검토하며 재검토 이력을 모두 보존',()=>{
 const s=setup();s.transactions=[tx('a',100,'2026-10-10',{direction:'income',externalId:'bank-1'}),tx('b',100,'2026-10-11',{direction:'income',externalId:'bank-1'})];ensureControl(s);
 assert.equal(duplicateIncomes(s).length,1);resolveIncome(s,duplicateIncomes(s)[0],false);s.transactions[1].note='수정';resolveIncome(s,duplicateIncomes(s)[0],false);
 assert.equal(s.incomeReviews.length,2);assert.notEqual(s.incomeReviews[0].id,s.incomeReviews[1].id);assert.equal(duplicateIncomes(s).length,0);
});
test('청구일 변경 후 카드 이름을 바꿔도 과거 청구일 유지',()=>{
 const s=setup();s.transactions=[tx('a',100)];ensureControl(s);savePaymentProfile(s,'테스트 카드','credit',5,20,0);
 renamePaymentMethod(s,'테스트 카드','새 카드 이름',paymentRenameBasis(s,'테스트 카드'));ensureControl(s);assert.equal(cardCharges(s,'2026-10-19')[0].paymentDate,'2026-10-17');
});
test('급여는 자동 분류하고 사용자 규칙은 급여 기본 규칙보다 우선',()=>{
 assert.equal(classify({direction:'income',merchantNormalized:'회사 급여'}).category,'salary');
 assert.equal(classify({direction:'income',merchantNormalized:'회사 급여'},[{id:'custom',field:'merchant',match:'exact',pattern:'회사 급여',category:'other'}]).category,'other');
});
