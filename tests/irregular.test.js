import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { emptyState } from '../data/defaults.js';
import { saveIrregular, detachIrregular, irregularRows, irregularCandidates } from '../js/irregular.js';
import { irregularView } from '../js/irregular-ui.js';
import { controlOverview, ensureControl, cardBills, settleBill } from '../js/control.js';
import { controlView } from '../js/control-ui.js';
import { monthBudget } from '../js/budget.js';
import { spendingDetails } from '../js/spending-details.js';
import { savePaymentProfile } from '../js/payment-channels.js';
import { validateState, splitTransaction } from '../js/models.js';
import { migrate } from '../js/migrate.js';
import { syncAutoRecurring } from '../js/recurring.js';
import { mergeValue, mergeStates } from '../js/sync-merge.js';
import { Repository } from '../js/db.js';
import { encryptBackup, decryptBackup } from '../js/backup.js';
import { possibleDuplicates } from '../js/import/duplicates.js';
import { dedupe } from '../js/import/dedupe.js';

const at='2026-10-20';
const setup=()=>{const s=emptyState();s.configured=true;s.settings.periodStartDay=1;s.settings.members={p1:'박태영',p2:'김은영'};ensureControl(s);return s;};
const item=(id='tax',extra={})=>({id,name:'재산세',dueDate:'2026-10-25',amount:300000,payer:'p2',note:'',...extra});
const tx=(id='expense',extra={})=>({id,sourceId:id,date:'2026-10-15',datetime:'2026-10-15T11:00:00',amount:280000,direction:'expense',scope:'shared',owner:'p2',paymentMethod:'우리 은행',merchantRaw:'가상 세금',merchantNormalized:'가상 세금',category:'tax',sourceType:'manual',...extra});
const save=(s,i=item(),p=null,old=null)=>saveIrregular(s,i,p,old,at);

test('예정 등록은 거래·소비한도·월고정비·여유자금을 변경하지 않는다',()=>{
 const s=setup();s.transactions=[tx('income',{amount:1000000,direction:'income',merchantRaw:'급여'})];
 const before=controlOverview(s,'2026-10',at);save(s);
 assert.deepEqual(controlOverview(s,'2026-10',at),before);assert.equal(s.transactions.length,1);assert.equal(s.recurring.length,0);validateState(s);
});
test('기존 계좌 지출 연결은 한 번 집계하고 실제 금액·날짜를 원거래에서 읽는다',()=>{
 const s=setup();s.transactions=[tx()];const original=structuredClone(s.transactions[0]);save(s,item(),{txId:'expense'});
 let o=controlOverview(s,'2026-10',at);assert.equal(o.variable,0);assert.equal(o.fixed,0);assert.equal(o.fixedPlanned,0);assert.equal(o.irregular,280000);assert.equal(o.free,-280000);
 assert.equal(s.transactions.length,1);assert.equal(s.transactions[0].date,original.date);assert.equal(s.transactions[0].amount,original.amount);
 assert.equal(monthBudget(s,'2026-10',at).spent,280000);assert.equal(monthBudget(s,'2026-10',at).fixedActual,0);assert.equal(spendingDetails(s,'2026-10',at).total,0);
 s.transactions[0].amount=270000;s.transactions[0].date='2026-10-16';assert.equal(irregularRows(s,at)[0].actual,270000);assert.equal(irregularRows(s,at)[0].paidDate,'2026-10-16');
 validateState(s);
});
test('카드 할부·청구월·출금 이체가 비정기 지출을 중복 집계하지 않는다',()=>{
 const s=setup();savePaymentProfile(s,'검증 카드','credit',3,17,0);
 s.transactions=[tx('card',{paymentMethod:'검증 카드',amount:300001,installments:3}),tx('bank',{date:'2026-11-17',direction:'transfer',scope:'excluded',excluded:true,amount:100001})];
 save(s,item(),{txId:'card'});ensureControl(s);
 assert.equal(controlOverview(s,'2026-10',at).irregular,0);
 assert.equal(controlOverview(s,'2026-11','2026-11-20').irregular,100001);
 const bill=cardBills(s,'2026-11-20').find(b=>b.month==='2026-11');settleBill(s,bill,100001,'2026-10-20','','bank');
 const overview=controlOverview(s,'2026-11','2026-11-20');assert.equal(overview.free,-100001);assert.equal(overview.variable,0);assert.equal(overview.fixed,0);
 assert.equal(['2026-11','2026-12','2027-01'].reduce((n,m)=>n+controlOverview(s,m,'2027-01-20').irregular,0),300001);
 assert.equal(spendingDetails(s,'2026-11','2026-11-20').total,0);assert.equal(monthBudget(s,'2026-10',at).spent,300001);
});
test('수동 납부는 재시도·다른 기기 중복 완료·동일 거래 중복 생성을 막는다',()=>{
 const s=setup(),p={date:'2026-10-19',amount:280000,method:'우리 은행'};save(s,item(),p);
 assert.equal(s.transactions.length,1);assert.equal(s.transactions[0].owner,'p2');
 assert.throws(()=>save(s,item(),p),/변경/);
 const old=structuredClone(s.irregularExpenses[0]);assert.throws(()=>save(s,item(),p,old),/해제/);
 assert.throws(()=>save(s,item('other'),p),/같은 날짜/);assert.equal(s.transactions.length,1);
 detachIrregular(s,'tax',old);const pending=structuredClone(s.irregularExpenses[0]);assert.throws(()=>save(s,item(),p,pending),/이미/);
 save(s,item(),{txId:s.transactions[0].id},pending);assert.equal(s.transactions.length,1);validateState(s);
});
test('납부일 8일·7일·당일·지난 날 경계와 연도별 완료 최근순',()=>{
 const s=setup();for(const [id,dueDate] of [['far','2026-10-28'],['soon','2026-10-27'],['today',at],['late','2026-10-19'],['next','2027-01-01']])save(s,item(id,{dueDate}));
 s.transactions=[tx('a'),tx('b',{date:'2026-10-18'})];save(s,item('done1'),{txId:'a'});save(s,item('done2'),{txId:'b'});
 const rows=irregularRows(s,at);assert.deepEqual(rows.map(r=>r.id),['late','today','soon','far','next','done2','done1']);
 assert.equal(rows.find(r=>r.id==='far').urgent,false);assert.equal(rows.find(r=>r.id==='soon').urgent,true);assert.equal(rows[0].label,'납부일 경과');assert.equal(rows[1].label,'오늘 납부');
 const doc=new JSDOM(irregularView(s,'2027',at)).window.document;assert.equal(doc.querySelectorAll('[data-action=irregular-edit]').length,1);assert.match(doc.body.textContent,/300,000원/);
 const home=new JSDOM(controlView(s,'2026-10',controlOverview(s,'2026-10',at))).window.document;assert.ok(home.querySelector('.control-home').lastElementChild.classList.contains('irregular-card'));
});
test('연결·일정 삭제는 실제 거래를 삭제하지 않으며 삭제한 거래는 완료로 보이지 않는다',()=>{
 const s=setup();s.transactions=[tx()];save(s,item(),{txId:'expense'});
 s.transactions[0].deletedAt='now';assert.equal(irregularRows(s,at)[0].paid,false);assert.equal(irregularRows(s,at)[0].label,'연결 거래 확인 필요');assert.equal(controlOverview(s,'2026-10',at).irregular,0);
 delete s.transactions[0].deletedAt;assert.equal(irregularRows(s,at)[0].paid,true);
 detachIrregular(s,'tax',structuredClone(s.irregularExpenses[0]),true);assert.equal(irregularRows(s,at).length,0);assert.equal(s.transactions.length,1);assert.equal(controlOverview(s,'2026-10',at).irregular,280000);
 validateState(s);
});
test('월 고정지출·이체·삭제·중복 거래는 연결 대상이 아니며 이미 연결된 거래는 재사용하지 못한다',()=>{
 const s=setup();s.transactions=[tx('ok'),tx('monthly',{recurringId:'month'}),tx('transfer',{direction:'transfer'}),tx('deleted',{deletedAt:'now'}),tx('duplicate',{duplicateOf:'ok'})];
 assert.deepEqual(irregularCandidates(s,'tax',at).map(t=>t.id),['ok']);save(s,item(),{txId:'ok'});assert.throws(()=>save(s,item('second'),{txId:'ok'}),/연결/);
 assert.throws(()=>splitTransaction(s.transactions[0],[{amount:140000},{amount:140000}]),/비정기/);
});
test('비정기 납부 기록으로 월 반복비를 자동 생성하거나 연결하지 않는다',()=>{
 const s=setup();s.recurring=[{id:'monthly',name:'보험',amount:280000,day:15,merchantPattern:'가상 세금',category:'finance',changes:[]}];
 s.transactions=['08','09','10'].map((m,i)=>tx('t'+i,{date:`2026-${m}-15`,irregularFixed:true,scope:'fixed',costKind:'fixed'}));
 syncAutoRecurring(s);assert.equal(s.recurring.length,1);assert.ok(s.transactions.every(t=>!t.recurringId));
});
test('구버전 자료 보존·신규 항목 암호화 백업 복원·저장 재시작',async()=>{
 const old=setup();delete old.irregularExpenses;old.transactions=[tx()];const original=structuredClone(old.transactions);const s=migrate(old);assert.deepEqual(s.transactions,original);assert.deepEqual(s.irregularExpenses,[]);
 save(s,item(),{txId:'expense'});const text=await encryptBackup(s,'test-password');const restored=(await decryptBackup(text,'test-password')).state;assert.deepEqual(restored,s);
 const factory=new IDBFactory(),repo=new Repository('irregular-test',factory);await repo.replace(s);repo.close();const reloaded=new Repository('irregular-test',factory);assert.equal((await reloaded.read()).irregularExpenses[0].txId,'expense');reloaded.close();
});
test('두 기기 독립 추가·수정·삭제 병합과 같은 항목 충돌 보존',()=>{
 const base=setup();save(base);const left=structuredClone(base),right=structuredClone(base);
 save(left,item('left'));save(right,item('right'));let merged=mergeValue(base,left,right);assert.equal(merged.irregularExpenses.length,3);validateState(merged);
 const old=structuredClone(base.irregularExpenses[0]);save(left,item('tax',{name:'수정된 재산세'}),null,old);detachIrregular(right,'tax',old,true);const result=mergeStates(base,left,right);assert.equal(result.conflicts.length,1);assert.match(result.conflicts[0].path,/irregularExpenses/);
 assert.throws(()=>mergeValue(base,left,right),/동기화 충돌/);
});
test('두 기기가 같은 거래를 다른 일정에 연결하면 충돌을 표시하고 한 연결만 유지한다',()=>{
 const base=setup();base.transactions=[tx()];save(base,item('a'));save(base,item('b'));
 const left=structuredClone(base),right=structuredClone(base);save(left,item('a'),{txId:'expense'},left.irregularExpenses[0]);save(right,item('b'),{txId:'expense'},right.irregularExpenses[1]);
 const result=mergeStates(base,left,right);assert.ok(result.conflicts.some(c=>c.path==='irregularLinks[expense]'));assert.throws(()=>mergeValue(base,left,right),/충돌/);
 const resolved=mergeStates(base,left,right,{'irregularLinks[expense]':'remote'}).state;validateState(resolved);assert.equal(resolved.irregularExpenses.filter(r=>r.txId).length,1);assert.equal(controlOverview(resolved,'2026-10',at).irregular,280000);
});
test('수동 비정기 납부 후 가져온 카드·계좌 내역은 중복 확인 대상으로 제시한다',()=>{
 const s=setup();save(s,item(),{date:'2026-10-19',amount:280000,method:'우리 은행'});
 const imported=tx('imported',{date:'2026-10-19',merchantRaw:'다른 적요',merchantNormalized:'다른 적요',sourceType:'bank-csv',owner:'p1'});
 assert.equal(possibleDuplicates([imported],s.transactions).length,1);
});
test('잘못된 날짜·금액·중복 연결 백업을 거부한다',()=>{
 const s=setup();assert.throws(()=>save(s,item('bad',{dueDate:'2026-02-30'})),/확인/);assert.throws(()=>save(s,item('bad',{amount:-1})),/확인/);
 s.transactions=[tx()];save(s,item(),{txId:'expense'});s.irregularExpenses.push({...s.irregularExpenses[0],id:'other'});assert.throws(()=>validateState(s),/여러/);
});
test('비정기 수동 납부를 가져올 때 같은 건만 제외하고 날짜가 다른 별도 납부는 보존한다',()=>{
 const s=setup();save(s,item(),{date:'2026-10-19',amount:280000,method:'우리 은행'});
 const imported=tx('imported',{date:'2026-10-19',merchantRaw:'재산세',merchantNormalized:'재산세',sourceType:'bank-csv',scope:'fixed'});
 assert.equal(dedupe([imported],s.transactions).duplicates,1);
 assert.equal(dedupe([{...imported,date:'2026-10-18'}],s.transactions).added.length,1);
});
