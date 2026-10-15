import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { emptyState } from "../data/defaults.js";
import { validateState } from "../js/models.js";
import { savePaymentProfile, cardDueForOperatingMonth } from "../js/payment-channels.js";
import { paymentRenameBasis, resolvePaymentAlias } from "../js/payment-rename.js";
import { cashFingerprint, cashSummary } from "../js/cash.js";
import { instrumentChoices, instrumentHistoryRows, instrumentLedgerView } from "../js/instrument-ledger.js";
import { cardIdentityCode, mergeCardInto, autoMergeCardCode, hideInstrument, restoreInstrument,
  instrumentUsage, methodNames } from "../js/instrument-cleanup.js";
import { resolveEntryPayment } from "../js/behavior-actions.js";

const d = "2026-10-12", stamp = d + "T12:00:00";
function fixture() {
  const s = emptyState();
  s.configured = true;
  s.settings.cardName = "M107";
  s.settings.paymentMethods = ["M107","태영 신한카드","은영 우리카드"];
  s.settings.members = {p1:"태영",p2:"은영"};
  s.cashAccounts.push({id:"bank", name:"생활비 계좌",paymentMethod:"BANK107",
    owner:"p1",openingBalance:100000,openingAt:"2026-10-01T10:00:00",
    reserved:0,autoMatch:false,archived:false});
  return s;
}
function tx(s,id,method="M107",other={}) {
  const row = {id,sourceId:id,date:d,datetime:stamp,merchantRaw:id,
    merchantNormalized:id,owner:"p1",scope:"shared",amount:10000,
    category:"groceries",direction:"expense",sourceType:"manual",
    deletedAt:null,paymentMethod:method,note:"",...other};
  s.transactions.push(row);
  return row;
}
const choice=(s,name)=>instrumentChoices(s,{includeHidden:true}).find(x=>x.name===name);
const doc = html => new JSDOM("<main>"+html+"</main>").window.document;

test("only confirmed non-sensitive issuer/internal card codes are accepted",()=>{
  assert.equal(cardIdentityCode(" m-107 "), "M107");
  assert.equal(cardIdentityCode("M 107"), "M107");
  assert.equal(cardIdentityCode(""), "");
  for(const code of ["1234","1234567890123456","4111 1111 1111 1111","****1234","M1234567890123456","AB","evil<script>"])
    assert.throws(()=>cardIdentityCode(code));
});

test("M107 imported spending merges automatically with its explicitly identified owner's card",()=>{
  const s=fixture();
  savePaymentProfile(s,"태영 신한카드","credit",25,14,1,undefined,{identifier:"M107",owner:"p1"});
  tx(s,"card1");
  tx(s,"card2","M-107",{deletedAt:d+"T16:00:00Z"});
  tx(s,"personal","M107",{scope:"p1"});
  s.recurring.push({id:"r",name:"보험",amount:1000,day:15,start:"2026-01-01",
    paymentMethod:"M107",owner:"p1",category:"finance",scope:"fixed",changes:[]});
  s.rules.push({id:"rule",pattern:"M107",field:"payment",match:"exact",enabled:true});
  s.reconciliations.push({id:"check",payment:"M107",start:d,end:d,actual:20000,recorded:20000,difference:0});
  s.cashLinks.push({id:"card1",basis:cashFingerprint(s.transactions[0]),ignored:true,legs:[]});
  const before=structuredClone(s.transactions.map(x=>[x.id,x.sourceId,x.amount,x.date,x.owner,x.deletedAt]));
  const merged=autoMergeCardCode(s,"태영 신한카드");
  assert.equal(merged.merged,1);
  assert.equal(merged.transactions,3);
  assert.ok(s.transactions.every(t=>t.paymentMethod==="태영 신한카드"));
  assert.equal(s.recurring[0].paymentMethod,"태영 신한카드");
  assert.equal(s.reconciliations[0].payment,"태영 신한카드");
  assert.equal(s.rules[0].pattern,"태영 신한카드");
  assert.deepEqual(s.transactions.map(x=>[x.id,x.sourceId,x.amount,x.date,x.owner,x.deletedAt]),before);
  assert.equal(s.cashLinks[0].basis,cashFingerprint(s.transactions[0]));
  assert.equal(resolvePaymentAlias(s,"M107"),"태영 신한카드");
  assert.equal(instrumentChoices(s).some(x=>x.name==="M107"),false);
  assert.doesNotThrow(()=>validateState(s));
});

test("different owners and mixed-owner generic codes must NEVER auto merge",()=>{
  const s=fixture();
  tx(s,"husband","M107");
  tx(s,"wife","M107",{owner:"p2"});
  savePaymentProfile(s,"태영 신한카드","credit",25,14,1,undefined,{identifier:"M107",owner:"p1"});
  const original=JSON.stringify(s.transactions);
  assert.equal(autoMergeCardCode(s,"태영 신한카드").merged,0);
  assert.equal(JSON.stringify(s.transactions),original);
  savePaymentProfile(s,"은영 우리카드","credit",25,14,1,undefined,{identifier:"M107",owner:"p2"});
  assert.equal(autoMergeCardCode(s,"태영 신한카드").merged,0);
  assert.equal(autoMergeCardCode(s,"은영 우리카드").merged,0);
  assert.doesNotThrow(()=>validateState(s));
});

test("mismatched card billing cycles abort merge before any mutation",()=>{
  const s=fixture();
  savePaymentProfile(s,"M107","credit",25,14,1,undefined,{identifier:"M107",owner:"p1"});
  savePaymentProfile(s,"태영 신한카드","credit",20,15,1,undefined,{identifier:"M107",owner:"p1"});
  tx(s,"card");
  const before=JSON.stringify(s);
  assert.throws(()=>autoMergeCardCode(s,"태영 신한카드"),/청구일/);
  assert.equal(JSON.stringify(s),before);
});

test("explicit merge preserves card statement windows and original transactions",()=>{
  const s=fixture();
  savePaymentProfile(s,"M107","credit",25,14,1);
  savePaymentProfile(s,"태영 신한카드","credit",25,14,1);
  tx(s,"one","M107",{amount:7000});
  tx(s,"two","태영 신한카드",{amount:9000});
  const before=cardDueForOperatingMonth(s,"2026-10","2026-10-15");
  const expectedBasis={source:paymentRenameBasis(s,"M107"),destination:paymentRenameBasis(s,"태영 신한카드")};
  const result=mergeCardInto(s,"M107","태영 신한카드",expectedBasis);
  assert.equal(result.transactions,1);
  assert.equal(s.settings.paymentProfiles.m107,undefined);
  assert.equal(s.transactions.length,2);
  assert.equal(s.transactions.reduce((v,t)=>v+t.amount,0),16000);
  assert.ok(!instrumentChoices(s).some(x=>x.name==="M107"));
  assert.equal(before.payments.reduce((n,p)=>n+p.estimatedAmount,0),
    cardDueForOperatingMonth(s,"2026-10","2026-10-15").payments.reduce((n,p)=>n+p.estimatedAmount,0));
  assert.throws(()=>mergeCardInto(s,"M107","태영 신한카드",expectedBasis),/변경|선택|카드/);
});

test("hide a card with real records: full history stays and old imports map without resurrecting picker",()=>{
  const s=fixture();
  savePaymentProfile(s,"M107","credit",25,14,1);
  tx(s,"paid");
  tx(s,"deleted","M107",{deletedAt:d+"T16:00:00Z"});
  const before=structuredClone(s.transactions);
  const op=hideInstrument(s,choice(s,"M107"));
  assert.equal(op,"hidden");
  assert.equal(instrumentChoices(s).some(x=>x.name==="M107"),false);
  assert.equal(instrumentChoices(s,{includeHidden:true}).find(x=>x.name==="M107").hidden,true);
  assert.equal(instrumentHistoryRows(s,choice(s,"M107")).rows.length,2);
  assert.deepEqual(s.transactions,before);
  assert.equal(resolveEntryPayment(s,"p1",s.transactions,{getItem:()=> "M107"}),"태영 신한카드");
  assert.equal(cardDueForOperatingMonth(s,"2026-10","2026-10-15").missingProfiles.includes("M107"),false);
  assert.ok(s.settings.paymentProfiles.m107, "billing profile must remain configured");
  restoreInstrument(s,choice(s,"M107"));
  assert.equal(instrumentChoices(s).some(x=>x.name==="M107"),true);
  assert.doesNotThrow(()=>validateState(s));
});

test("unused card can actually be deleted, not silently resurrected by saved placeholder",()=>{
  const s=fixture();
  s.settings.cardName="";s.settings.paymentMethods.push("미사용 카드");
  savePaymentProfile(s,"미사용 카드","credit",null,null,1);
  assert.equal(hideInstrument(s,choice(s,"미사용 카드")),"deleted");
  assert.equal(s.settings.paymentMethods.includes("미사용 카드"),false);
  assert.equal(s.settings.paymentProfiles["미사용카드"],undefined);
  assert.equal(instrumentChoices(s,{includeHidden:true}).some(x=>x.name==="미사용 카드"),false);
  assert.doesNotThrow(()=>validateState(s));
});

test("account removal hides and archives nonzero balance, retains checks, links and allows restore",()=>{
  const s=fixture();
  const spent=tx(s,"bank","BANK107",{amount:1300});
  s.cashLinks.push({id:spent.id,basis:cashFingerprint(spent),
    legs:[{accountId:"bank",direction:"out",at:stamp}],ignored:false});
  const before=structuredClone({transactions:s.transactions,cashLinks:s.cashLinks,cashAccounts:s.cashAccounts});
  const op=hideInstrument(s,choice(s,"생활비 계좌"));
  assert.equal(op,"archived");
  assert.equal(s.cashAccounts[0].archived,true);
  assert.equal(s.cashAccounts[0].openingBalance,before.cashAccounts[0].openingBalance);
  assert.deepEqual(s.transactions,before.transactions);
  assert.deepEqual(s.cashLinks,before.cashLinks);
  assert.ok(!instrumentChoices(s).some(x=>x.name==="생활비 계좌"));
  assert.equal(instrumentChoices(s,{includeHidden:true}).find(x=>x.name==="생활비 계좌").hidden,true);
  restoreInstrument(s,choice(s,"생활비 계좌"));
  assert.equal(s.cashAccounts[0].archived,true,"restoring the menu must not silently recreate bank liquidity");
  assert.ok(instrumentChoices(s).some(x=>x.name==="생활비 계좌"));
  assert.doesNotThrow(()=>validateState(s));
});

test("zero-balance account with no financial references can be removed permanently",()=>{
  const s=fixture();
  s.cashAccounts[0].openingBalance=0;
  assert.equal(hideInstrument(s,choice(s,"생활비 계좌")),"deleted");
  assert.equal(s.cashAccounts.length,0);
  assert.equal(s.settings.hiddenCashAccounts.length,0);
  assert.doesNotThrow(()=>validateState(s));
});

test("do not physically delete zero bank account still referenced by recurring rules",()=>{
  const s=fixture();
  s.cashAccounts[0].openingBalance=0;
  s.recurring.push({id:"bill",name:"납부",amount:1000,day:12,start:"2026-01-01",
    paymentMethod:"BANK107",owner:"p1",category:"finance",scope:"fixed",changes:[]});
  assert.equal(hideInstrument(s,choice(s,"생활비 계좌")),"archived");
  assert.equal(s.cashAccounts.length,1);
  assert.equal(s.recurring.length,1);
});

test("new picker and manager controls are accessible without reading or changing underlying cash",()=>{
  const s=fixture();
  tx(s,"one");
  const before=JSON.stringify(s);
  const html=instrumentLedgerView(s,{instrument:"m:M107",instrumentPeriod:"all"});
  const page=doc(html);
  assert.equal(page.querySelector('.instrument-selected [data-action="instrument-remove"]').dataset.key,"m:M107");
  assert.ok(page.querySelector('.instrument-selected [data-action="instrument-merge"]'));
  assert.equal(page.querySelectorAll('.instrument-row-main').length,1);
  assert.equal(JSON.stringify(s),before);
});
