import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { emptyState } from '../data/defaults.js';
import { controlOverview, ensureControl, confirmFixed } from '../js/control.js';
import { fixedGroups, insurancePerson } from '../js/fixed-groups.js';
import { controlView } from '../js/control-ui.js';

function setup(){const s=emptyState();s.settings.periodStartDay=1;s.settings.members={p1:'박태영',p2:'김은영'};s.transactions=[];s.recurring=[];ensureControl(s);return s;}
const bill=(id,name,day,amount,extra={})=>({id,name,day,amount,category:'finance',scope:'fixed',changes:[],...extra});
const pay=(id,recurringId,amount,date)=>({id,recurringId,amount,date,direction:'expense',scope:'fixed',paymentMethod:'은행'});
test('미납·예정은 결제일순, 납부완료는 맨 아래; 부분납부와 초과납부를 남은 금액에 반영',()=>{
 const s=setup();s.recurring=[bill('paid','월세',2,100),bill('later','통신',25,200),bill('partial','구독',10,100),bill('future','관리비',21,300)];
 s.transactions=[pay('p','paid',150,'2026-10-02'),pay('part','partial',40,'2026-10-10'),pay('future-pay','future',300,'2026-10-21')];
 let o=controlOverview(s,'2026-10','2026-10-20');assert.deepEqual(o.fixedItems.map(r=>r.id),['partial','future','later','paid']);
 assert.equal(o.fixedRemaining,560);assert.equal(o.fixedOverdue,60);
 confirmFixed(s,{...o.fixedItems[0],month:'2026-10'},null,'2026-10-20');
 o=controlOverview(s,'2026-10','2026-10-20');assert.equal(o.fixedRemaining,500);assert.equal(o.fixedOverdue,0);
 const later=controlOverview(s,'2026-10','2026-10-21');assert.equal(later.fixedRemaining,200);
});
test('보험 대상은 명시 설정·항목명·사용자 순, 자녀 보험을 납부자에게 잘못 묶지 않음',()=>{
 const s=setup();assert.equal(insurancePerson(bill('a','박서우 어린이보험',1,10,{owner:'p1'}),s),'박서우');
 assert.equal(insurancePerson(bill('a','보험',1,10,{owner:'p2'}),s),'김은영');
 assert.equal(insurancePerson(bill('a','서우 보험',1,10,{insurancePerson:'박태영'}),s),'박태영');
 assert.equal(insurancePerson(bill('a','보험',1,10,{owner:'joint'}),s),'사용자 미지정');
 assert.equal(insurancePerson(bill('a','주택대출',1,10,{owner:'p1'}),s),null);
});
test('사용자별 보험료 합계와 접힌 목록, 완료 보험은 완료 영역에만 배치',()=>{
 const s=setup();s.recurring=[bill('t1','태영 보험 A',5,100),bill('t2','태영 보험 B',25,200),bill('e','은영 보험',10,300),bill('child','서우 보험',15,400),bill('paid','태영 보험 납부',1,50),bill('rent','월세',8,500)];s.transactions=[pay('p','paid',50,'2026-10-01')];
 const o=controlOverview(s,'2026-10','2026-10-20'),groups=fixedGroups(o.fixedItems,s);
 assert.equal(groups[0].items[0].person,'박태영');assert.equal(groups[0].items[0].remaining,300);assert.equal(groups[0].items[0].rows.length,2);
 assert.equal(groups[1].items[0].remaining,0);assert.equal(groups[1].items[0].actual,50);
 const doc=new JSDOM(controlView(s,'2026-10',o)).window.document;
 assert.equal(doc.querySelectorAll('.fixed-insurance-group').length,4);assert.equal(doc.querySelectorAll('.fixed-insurance-group[open]').length,0);
 assert.equal(doc.querySelector('[data-control-value=fixedRemaining]').textContent,'1,500원');
 assert.equal(doc.querySelector('[data-fixed-status=paid] [data-id=paid]').textContent.includes('납부완료'),true);
 assert.equal(doc.querySelector('[data-fixed-status=pending] [data-id=paid]'),null);
 assert.equal(doc.querySelector('[data-id=paid] .fixed-payment-paid').textContent.includes('납부완료'),true);
 assert.equal(doc.querySelector('[data-id=t1] .fixed-payment-overdue').textContent.includes('미납'),true);
 assert.equal(doc.querySelector('[data-id=t2] .fixed-payment-pending').textContent.includes('납부예정'),true);
 const keys=[...doc.querySelectorAll('.fixed-insurance-group')].map(el=>el.dataset.focusFold);
 assert.equal(new Set(keys).size,keys.length);
 assert.ok(keys.every(Boolean));

 assert.match(doc.querySelector('[data-fixed-status=pending]').textContent,/박태영 보험료/);
});
test('빈 월과 모든 항목 납부완료는 남은 금액 0원',()=>{
 const s=setup();assert.equal(controlOverview(s,'2026-10','2026-10-20').fixedRemaining,0);
 s.recurring=[bill('x','보험',1,100)];s.transactions=[pay('x','x',100,'2026-10-01')];assert.equal(controlOverview(s,'2026-10','2026-10-20').fixedRemaining,0);
});
