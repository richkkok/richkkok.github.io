import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../data/defaults.js";
import { ensureCash, cashLedger, saveCashAccount, saveCashLink, cashFingerprint } from "../js/cash.js";
import { instrumentChoices, instrumentWindow, instrumentRows, instrumentLedgerView, saveCardTransaction } from "../js/instrument-ledger.js";
import { validateState } from "../js/models.js";
const now = "2026-10-11T22:00:00";
const at = "2026-10-11T12:30:00";
function state() { const s = emptyState(); s.configured = true; ensureCash(s); return s; }
function account(s) {
  const a = { id:"bank", name:"신한 생활비", owner:"p1", paymentMethod:"신한 생활비",
    openingAt:"2026-10-01T10:00:00", openingBalance:100000, reserved:0,
    autoMatch:false, archived:false };
  saveCashAccount(s,a,null,now); return a;
}
function tx(s,id,overrides={}) {
  const t = { id,sourceId:id,date:"2026-10-11",datetime:at,amount:1000,
    direction:"expense",owner:"p1",merchantRaw:id,merchantNormalized:id,
    paymentMethod:"우리카드",scope:"shared",category:"other",sourceType:"manual",
    deletedAt:null,...overrides };
  s.transactions.push(t);return t;
}
function card(s,overrides={},options={}) {
  return saveCardTransaction(s,{paymentMethod:"우리카드",merchant:"마트",amount:7000,
    direction:"expense",at,owner:"p1",scope:"shared",category:"groceries",
    note:"",...overrides},{now,...options});
}
test("choices include registered bank accounts, existing cards and imported methods without creating balances",()=>{
  const s=state(), a=account(s);tx(s,"bank tx",{paymentMethod:a.name});
  tx(s,"shinhan",{paymentMethod:"신한카드"});
  s.settings.paymentMethods=["우리카드","신한카드","신한 생활비","우리카드"];
  const before=JSON.stringify(s);
  const choices=instrumentChoices(s);
  assert.equal(choices.filter(x=>x.type==="account").length,1);
  assert.deepEqual(choices.filter(x=>x.type==="method").map(x=>x.name),["신한카드","우리카드"]);
  assert.equal(JSON.stringify(s),before);
});
test("account ledger includes confirmed cash legs once and flags exact-name unlinked entries without claiming balance",()=>{
  const s=state(), a=account(s);
  const linked=tx(s,"food",{paymentMethod:a.name,amount:4000});
  saveCashLink(s,linked.id,[{accountId:a.id,direction:"out",at}],false,cashFingerprint(linked),now);
  tx(s,"unlinked",{paymentMethod:a.name,amount:3000,datetime:"2026-10-11T13:00:00"});
  tx(s,"card expense",{amount:9000,paymentMethod:"우리카드"});
  const choice=instrumentChoices(s).find(x=>x.type==="account");
  const rows=instrumentRows(s,choice,{},now.slice(0,10));
  assert.equal(rows.rows.length,2);
  assert.equal(rows.outgoing,4000);
  assert.equal(rows.pending,1);
  assert.equal(cashLedger(s,a,now).expected,96000);
});
test("card list is exact to selected payment method and ownership and date range",()=>{
  const s=state();card(s);
  card(s,{paymentMethod:"신한카드",merchant:"택시"});
  card(s,{merchant:"카페",owner:"p2",amount:9000});
  card(s,{merchant:"작년",at:"2026-09-09T11:00:00"});
  const choice=instrumentChoices(s).find(x=>x.name==="우리카드");
  const current=instrumentRows(s,choice,{},now.slice(0,10));
  assert.equal(current.rows.length,2);
  assert.equal(current.outgoing,16000);
  const p1=instrumentRows(s,choice,{instrumentOwner:"p1"},now.slice(0,10));
  assert.equal(p1.rows.length,1);
  const last90=instrumentRows(s,choice,{instrumentPeriod:"90"},now.slice(0,10));
  assert.equal(last90.rows.length,3);
  const custom=instrumentRows(s,choice,{instrumentPeriod:"custom",instrumentFrom:"2026-10-12",instrumentTo:"2026-10-13"},now.slice(0,10));
  assert.equal(custom.rows.length,0);
});
test("manual card expense and refund are stored as real transactions, never linked to bank cash",()=>{
  const s=state(), a=account(s);
  card(s);card(s,{direction:"refund",merchant:"반품",amount:2000,at:"2026-10-11T13:00:00"});
  const choice=instrumentChoices(s).find(x=>x.name==="우리카드");
  const data=instrumentRows(s,choice,{},now.slice(0,10));
  assert.equal(data.outgoing,7000);assert.equal(data.incoming,2000);
  assert.equal(s.cashLinks.length,0);assert.equal(cashLedger(s,a,now).expected,100000);
  assert.equal(s.transactions.every(t=>t.sourceType==="manual"),true);
  assert.doesNotThrow(()=>validateState(s));
});
test("duplicate same-date card record is blocked before mutation unless user explicitly confirms separate use",()=>{
  const s=state();card(s);const before=JSON.stringify(s.transactions);
  assert.throws(()=>card(s,{at:"2026-10-11T15:10:00"}),/같은 날/);
  assert.equal(JSON.stringify(s.transactions),before);
  card(s,{at:"2026-10-11T15:10:00"},{allowDuplicate:true});
  assert.equal(s.transactions.length,2);
});
test("invalid future, scope, zero amount and unknown category never create a card entry",()=>{
  for(const patch of [{at:"2026-10-12T10:00:00"},{amount:0},{scope:"foreign"},{category:"invalid"}]){
    const s=state();assert.throws(()=>card(s,patch));assert.equal(s.transactions.length,0);
  }
});
test("settlement and internal transfers never appear as extra card spending",()=>{
  const s=state();card(s);
  tx(s,"settlement",{paymentMethod:"우리카드",direction:"transfer",amount:7000});
  const choice=instrumentChoices(s).find(x=>x.name==="우리카드");
  const r=instrumentRows(s,choice,{},now.slice(0,10));
  assert.equal(r.rows.length,2);assert.equal(r.outgoing,7000);assert.equal(r.incoming,0);
});
test("view escapes untrusted names, hides private merchant and does not mutate financial state",()=>{
  const s=state();card(s,{merchant:"<img src=x onerror=alert(1)>",scope:"p1"});
  s.settings.privacy=true;
  const original=JSON.stringify(s);
  const html=instrumentLedgerView(s,{instrument:"m:"+encodeURIComponent("우리카드"),instrumentPeriod:"all"});
  assert.match(html,/개인 내역 숨김/);
  assert.ok(!html.includes("<img src=x onerror"));
  assert.ok(!html.includes("&lt;img src=x onerror"));
  assert.match(html,/instrument-add/);
  assert.equal(JSON.stringify(s),original);
});
test("cycle window uses the 10th through 9th pay period, not a calendar month",()=>{
  const s=state();
  assert.deepEqual(instrumentWindow(s,{}, "2026-10-11"),{from:"2026-10-10",to:"2026-10-11"});
  assert.deepEqual(instrumentWindow(s,{}, "2026-10-09"),{from:"2026-09-10",to:"2026-10-09"});
});
