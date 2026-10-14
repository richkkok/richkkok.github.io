import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../data/defaults.js';
import { migrate } from '../js/migrate.js';
import { validateState } from '../js/models.js';
import { daySignature, closeDay } from '../js/behavior.js';
import { cashFingerprint, cashSummary, cashConnection, saveCashLink, saveCashCheck } from '../js/cash.js';
import { focusOverview } from '../js/focus.js';
import { cardBillingSummary, cardDueForOperatingMonth, savePaymentProfile } from '../js/payment-channels.js';
import {
  paymentNameSummary, paymentRenameBasis, renamePaymentMethod,
  saveRenamedCashAccount, resolvePaymentAlias,
} from '../js/payment-rename.js';

const now='2026-10-14T15:50:00';
const asOf='2026-10-14T23:00:00';
function state(){
  const s=emptyState();s.configured=true;s.settings.privacy=false;
  s.settings.members={p1:'태영',p2:'은영'};
  s.settings.income=6000000;s.settings.variableBudget=2200000;
  return s;
}
function tx(id,amount,paymentMethod='M107',date='2026-10-12',extra={}){
  return {id,sourceId:'raw:'+id,amount,date,datetime:date+'T10:30:00',
    direction:'expense',owner:'p1',scope:'shared',category:'groceries',
    merchantRaw:'QA 소비',merchantNormalized:'qa 소비',costKind:'variable',
    paymentMethod,sourceType:'manual',createdAt:'2026-10-12T03:00:00Z',
    updatedAt:'2026-10-12T03:00:00Z',...extra};
}
function bank(s,name='은행 107',paymentMethod='BANK107',id='bank1'){
  const a={id,name,paymentMethod,owner:'p1',openingBalance:1500000,
    openingAt:'2026-10-10T10:00:00',reserved:100000,autoMatch:false,archived:false};
  s.cashAccounts.push(a);return a;
}

test('all owners including deleted transactions, split pieces, recurring, profiles and reconciliation are renamed once',()=>{
  const s=state();
  savePaymentProfile(s,'M107','credit',25,14,1);
  s.settings.cardName='M107';s.settings.paymentMethods.push('m-107');
  s.settings.monthOverrides={'2026-10':{cardName:'m 107'}};
  s.transactions=[
    tx('one',100000),
    tx('two',300000,'m-107','2026-10-11',{owner:'p2'}),
    tx('deleted',12000,'M107','2026-09-01',{deletedAt:'2026-10-12T00:00:00Z'}),
    tx('splitParent',30000,'M107','2026-10-12',{splitParent:true}),
    tx('part1',12000,'M107','2026-10-12',{parentId:'splitParent'}),
    tx('part2',18000,'M107','2026-10-12',{parentId:'splitParent'}),
    tx('other',5000,'현금'),
  ];
  s.recurring=[{id:'insurance',name:'보험료',amount:100000,day:12,owner:'p1',
    start:'2026-01-01',paymentMethod:'M107',changes:[],category:'finance',scope:'fixed'}];
  s.reconciliations=[{id:'r',payment:'M107',start:'2026-10-10',end:'2026-10-12',
    actual:400000,recorded:400000,difference:0}];
  s.rules=[{id:'rule',field:'payment',match:'exact',pattern:'M107',
    category:'groceries',enabled:true}];
  closeDay(s,'2026-10-12','complete','p1');
  const oldClose=s.dailyCloses['2026-10-12'].signature;
  const before=structuredClone(s);
  const x=paymentNameSummary(s,'m107');
  assert.equal(x.transactions,6);
  assert.deepEqual(x.owners,{p1:5,p2:1,joint:0});
  const result=renamePaymentMethod(s,'M107','태영 신한카드',paymentRenameBasis(s,'M107'));
  assert.equal(result.transactions,6);
  assert.equal(result.recurring,1);
  assert.equal(result.reconciliations,1);
  assert.equal(result.closedDays,1);
  assert.equal(s.transactions.find(t=>t.id==='other').paymentMethod,'현금');
  for(const t of s.transactions.filter(t=>t.id!=='other'))
    assert.equal(t.paymentMethod,'태영 신한카드');
  for(let i=0;i<before.transactions.length;i++)
    for(const k of ['id','sourceId','amount','date','datetime','owner','scope','merchantRaw','deletedAt','parentId','splitParent'])
      assert.deepEqual(s.transactions[i][k],before.transactions[i][k],k);
  assert.equal(s.settings.cardName,'태영 신한카드');
  assert.equal(s.settings.monthOverrides['2026-10'].cardName,'태영 신한카드');
  assert.deepEqual(s.settings.paymentMethods,['태영 신한카드']);
  assert.ok(s.settings.paymentProfiles['태영신한카드']);
  assert.equal(s.settings.paymentProfiles['태영신한카드'].closingDay,25);
  assert.equal(s.settings.paymentProfiles.m107,undefined);
  assert.equal(s.recurring[0].paymentMethod,'태영 신한카드');
  assert.equal(s.reconciliations[0].payment,'태영 신한카드');
  assert.equal(s.rules[0].pattern,'태영 신한카드');
  assert.equal(resolvePaymentAlias(s,'M107'),'태영 신한카드');
  assert.equal(resolvePaymentAlias(s,'m-107'),'태영 신한카드');
  assert.equal(s.dailyCloses['2026-10-12'].signature,daySignature(s,'2026-10-12'));
  assert.notEqual(oldClose,s.dailyCloses['2026-10-12'].signature);
  assert.equal(s.transactions.find(t=>t.id==='deleted').deletedAt,before.transactions.find(t=>t.id==='deleted').deletedAt);
  validateState(s);
});

test('card bill dates and spending, fixed payment IDs and amount totals remain unchanged',()=>{
  const s=state();
  savePaymentProfile(s,'M107','credit',25,14,1);
  s.transactions=[tx('early',100000,'M107','2026-09-25'),tx('new',120000,'M107','2026-10-12')];
  const priorDue=cardDueForOperatingMonth(s,'2026-10',now.slice(0,10));
  const priorCurrent=cardBillingSummary(s,now.slice(0,10));
  const priorFocus=focusOverview(s,'2026-10',now);
  renamePaymentMethod(s,'M107','태영 신한카드',paymentRenameBasis(s,'M107'));
  const afterDue=cardDueForOperatingMonth(s,'2026-10',now.slice(0,10));
  const afterCurrent=cardBillingSummary(s,now.slice(0,10));
  const afterFocus=focusOverview(s,'2026-10',now);
  assert.equal(afterDue.dueTotal,priorDue.dueTotal);
  assert.equal(afterDue.addedToLimit,priorDue.addedToLimit);
  assert.deepEqual(afterDue.payments.map(p=>[p.paymentDate,p.estimatedAmount]),
    priorDue.payments.map(p=>[p.paymentDate,p.estimatedAmount]));
  assert.equal(afterCurrent[0].estimatedUsage,priorCurrent[0].estimatedUsage);
  assert.equal(afterFocus.used,priorFocus.used);
  assert.equal(afterFocus.remaining,priorFocus.remaining);
});

test('cash links and bank balances stay valid while bank payment label changes',()=>{
  const s=state(), a=bank(s);
  s.transactions=[tx('bank',25000,'BANK107','2026-10-12'),tx('other',10000,'우리카드','2026-10-12')];
  saveCashLink(s,'bank',[{accountId:a.id,direction:'out',at:'2026-10-12T11:00:00'}],false,'',asOf);
  saveCashCheck(s,{id:'check',accountId:a.id,at:'2026-10-13T12:00:00',actual:1475000,note:''},asOf);
  closeDay(s,'2026-10-12','complete','p1');
  const beforeCash=cashSummary(s,asOf), beforeFingerprint=s.cashLinks[0].basis;
  const original=structuredClone(a),updated={...a,name:'태영 생활비 계좌',paymentMethod:'태영 생활비 계좌'};
  assert.throws(()=>saveRenamedCashAccount(s,updated,original,false),/확인/);
  assert.equal(s.cashAccounts[0].name,'은행 107');
  const result=saveRenamedCashAccount(s,updated,original,true);
  assert.equal(result.transactions,1);assert.equal(result.links,1);
  assert.equal(s.cashAccounts[0].id,a.id);
  assert.equal(s.cashAccounts[0].openingBalance,1500000);
  assert.equal(s.cashAccounts[0].openingAt,a.openingAt);
  assert.equal(s.cashAccounts[0].reserved,100000);
  assert.equal(s.cashAccounts[0].paymentMethod,'태영 생활비 계좌');
  assert.equal(s.transactions.find(t=>t.id==='bank').paymentMethod,'태영 생활비 계좌');
  assert.equal(s.transactions.find(t=>t.id==='other').paymentMethod,'우리카드');
  assert.notEqual(s.cashLinks[0].basis,beforeFingerprint);
  assert.equal(s.cashLinks[0].basis,cashFingerprint(s.transactions[0]));
  assert.equal(cashConnection(s.transactions[0],s).status,'linked');
  assert.deepEqual(s.cashChecks,[...s.cashChecks]);
  const afterCash=cashSummary(s,asOf);
  for(const k of ['actual','expected','usable','reserved','mismatchCount','absoluteDifference'])
    assert.equal(afterCash[k],beforeCash[k],k);
  assert.equal(s.dailyCloses['2026-10-12'].signature,daySignature(s,'2026-10-12'));
  assert.equal(resolvePaymentAlias(s,'BANK107'),'태영 생활비 계좌');
  validateState(s);
});

test('bank display and separate import aliases of a single bank can converge safely',()=>{
  const s=state(),a=bank(s,'은행 A','입금 통장 107','a');
  s.transactions=[tx('visible',1000,'은행 A'),tx('source',2500,'입금 통장 107')];
  const updated={...a,name:'공동 생활비',paymentMethod:'공동 생활비'};
  const result=saveRenamedCashAccount(s,updated,structuredClone(a),true);
  assert.equal(result.transactions,2);
  assert.ok(s.transactions.every(t=>t.paymentMethod==='공동 생활비'));
  assert.equal(resolvePaymentAlias(s,'은행 A'),'공동 생활비');
  assert.equal(resolvePaymentAlias(s,'입금 통장 107'),'공동 생활비');
});

test('stale form, other account names and existing payment names refuse merging',()=>{
  const s=state();
  savePaymentProfile(s,'M107','credit');
  s.transactions=[tx('main',100000)];
  const basis=paymentRenameBasis(s,'M107');
  s.transactions.push(tx('new',5000));
  assert.throws(()=>renamePaymentMethod(s,'M107','태영 카드',basis),/다른 기기/);
  const fresh=paymentRenameBasis(s,'M107');
  s.settings.paymentMethods.push('태영 카드');
  assert.throws(()=>renamePaymentMethod(s,'M107','태영 카드',paymentRenameBasis(s,'M107')),/겹쳐/);
  assert.equal(s.transactions[0].paymentMethod,'M107');
  const a=bank(s,'계좌1','BANK107','a');
  bank(s,'계좌2','BANK108','b');
  assert.throws(()=>saveRenamedCashAccount(s,{...a,name:'계좌2'},structuredClone(a),true),/겹쳐/);
  assert.throws(()=>renamePaymentMethod(s,'M107','계좌2',paymentRenameBasis(s,'M107')),/겹쳐/);
});

test('invalid names, bank collision, stale cash fingerprints and false closes are rejected or preserved',()=>{
  const s=state(),a=bank(s,'은행107','BANK107');
  savePaymentProfile(s,'M107','credit');
  s.transactions=[tx('t',100000)];
  const basis=paymentRenameBasis(s,'M107');
  for(const invalid of ['', '  ', '미지정', 'a'.repeat(101)])
    assert.throws(()=>renamePaymentMethod(s,'M107',invalid,basis));
  assert.throws(()=>renamePaymentMethod(s,'M107','은행107',basis),/겹쳐/);
  s.dailyCloses['2026-10-12']={mode:'complete',signature:'invalid-old-check'};
  s.cashLinks.push({id:'t',basis:'outdated-before-change',legs:[],ignored:true});
  renamePaymentMethod(s,'M107','태영 신한카드',basis);
  assert.equal(s.dailyCloses['2026-10-12'].signature,'invalid-old-check');
  assert.equal(s.cashLinks[0].basis,'outdated-before-change');
  assert.equal(cashConnection(s.transactions[0],s).status,'review');
});

test('rename chain updates old codes, reverting remains idempotent and old backup migrates',()=>{
  const s=state();delete s.settings.paymentAliases;
  migrate(s);
  s.transactions=[tx('m',5000)];
  renamePaymentMethod(s,'M107','태영 카드',paymentRenameBasis(s,'M107'));
  renamePaymentMethod(s,'태영 카드','태영 신한카드',paymentRenameBasis(s,'태영 카드'));
  assert.equal(resolvePaymentAlias(s,'M107'),'태영 신한카드');
  assert.equal(resolvePaymentAlias(s,'태영 카드'),'태영 신한카드');
  renamePaymentMethod(s,'태영 신한카드','M107',paymentRenameBasis(s,'태영 신한카드'));
  assert.equal(resolvePaymentAlias(s,'태영 신한카드'),'M107');
  assert.equal(s.transactions[0].paymentMethod,'M107');
  validateState(s);
});

test('renaming a card never changes other similarly named or same-merchant cards',()=>{
  const s=state();
  s.transactions=[
    tx('code',1000,'M107'),
    tx('another',2000,'M107A'),
    tx('sibling',3000,'M170'),
    tx('cash',4000,'현금'),
  ];
  renamePaymentMethod(s,'M107','은영 삼성카드',paymentRenameBasis(s,'M107'));
  assert.deepEqual(s.transactions.map(t=>t.paymentMethod),
    ['은영 삼성카드','M107A','M170','현금']);
  assert.equal(s.transactions[0].owner,'p1');
});
