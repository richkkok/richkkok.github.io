import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { emptyState } from "../data/defaults.js";
import { incomeReconciliation, incomeAssignmentOptions, reassignRecordedIncome, findDuplicateIncome } from "../js/income-reconcile.js";
import { monthBudget } from "../js/budget.js";
import { focusOverview } from "../js/focus.js";
import { focusHome } from "../js/focus-ui.js";
import { moneyAction } from "../js/money-actions.js";
import { period, periodKey, shiftMonth, addDays, transactionPeriod, startDay } from "../js/period.js";
import { today } from "../js/format.js";
const curr = periodKey(today(), 10), prev = shiftMonth(curr, -1);
const beforeStart = addDays(period(curr, 10).start, -2);
const tx = (extra = {}) => ({
  id: "existing-early-pay", sourceId: "existing-early-pay",
  date: beforeStart, datetime: beforeStart + "T09:00:00",
  amount: 3000000, direction: "income", owner: "p1",
  scope: "shared", category: "other", merchantRaw: "급여",
  merchantNormalized: "급여", paymentMethod: "QA 계좌", excluded: false,
  operatingMonth: prev, createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...extra,
});
const base = () => {const s=emptyState();s.configured=true;s.settings.privacy=false;s.transactions=[tx()];return s;};
test("earlier recorded pay stays in original cycle and is displayed as near-cycle attribution, not invented as new income", () => {
  const s=base(),saved=structuredClone(s);
  const summary=incomeReconciliation(s,curr);
  assert.equal(summary.amount,0);
  assert.equal(summary.nearby.length,1);
  assert.equal(summary.nearbyAmount,3000000);
  assert.equal(focusOverview(s,curr).cashReceived,0);
  assert.match(focusHome(s,curr),/지난 운영월에 등록된 최근 입금/);
  assert.match(focusHome(s,curr),/3,000,000원/);
  assert.deepEqual(s,saved);
});
test("moving same recorded pay changes attribution only and updates home amount without changing bank balance", () => {
  const s=base();const original=structuredClone(s.transactions[0]);
  const count=s.transactions.length,otherFields={...s.transactions[0]};
  assert.equal(reassignRecordedIncome(s,original.id,curr,original),true);
  assert.equal(s.transactions.length,count);
  assert.equal(transactionPeriod(s.transactions[0],s),curr);
  assert.equal(monthBudget(s,curr).actualIncome,3000000);
  assert.equal(monthBudget(s,prev).actualIncome,0);
  assert.equal(focusOverview(s,curr).cashReceived,3000000);
  assert.equal(incomeReconciliation(s,curr).nearby.length,0);
  assert.equal(s.cashAccounts.length,0);
  assert.deepEqual({...s.transactions[0],operatingMonth:otherFields.operatingMonth,updatedAt:otherFields.updatedAt},otherFields);
  assert.equal(reassignRecordedIncome(s,original.id,curr,structuredClone(s.transactions[0])),false);
});
test("preserve IDs, dates, amounts; unlink outdated dated schedule link when reassigning", () => {
  const s=base();s.transactions[0].incomeScheduleId="previous-pay";
  const expected=structuredClone(s.transactions[0]);
  reassignRecordedIncome(s,expected.id,curr,expected);
  assert.equal(s.transactions[0].incomeScheduleId,undefined);
  assert.equal(s.transactions[0].date,expected.date);
  assert.equal(s.transactions[0].amount,expected.amount);
  assert.equal(s.transactions[0].id,expected.id);
});
test("same receipt is detected even when its operating month differs", () => {
  const s=base(),t=s.transactions[0];
  assert.equal(findDuplicateIncome(s,{date:t.date,amount:t.amount,owner:t.owner,merchant:t.merchantRaw})?.id,t.id);
  assert.equal(findDuplicateIncome(s,{date:t.date,amount:t.amount+1,owner:t.owner,merchant:t.merchantRaw}),null);
  assert.ok(incomeAssignmentOptions(s,curr,t).some(([value])=>value===curr));
  assert.ok(incomeAssignmentOptions(s,curr,t).some(([value])=>value===prev));
});
test("stale version, invalid month, deleted and nonoperating deposits cannot be reassigned silently", () => {
  const s=base(),snapshot=structuredClone(s.transactions[0]);
  s.transactions[0].amount+=1;
  assert.throws(()=>reassignRecordedIncome(s,snapshot.id,curr,snapshot),/변경/);
  assert.throws(()=>reassignRecordedIncome(s,snapshot.id,"bad-month",s.transactions[0]),/운영월/);
  s.transactions[0].incomeKind="transfer";
  assert.throws(()=>reassignRecordedIncome(s,snapshot.id,curr,structuredClone(s.transactions[0])),/생활수입/);
  s.transactions[0].incomeKind="earned";
  s.transactions[0].deletedAt=new Date().toISOString();
  assert.throws(()=>reassignRecordedIncome(s,snapshot.id,curr,structuredClone(s.transactions[0])),/생활수입/);
});
test("income ledger displays all existing income with its month, an edit button and a reassignment option", async () => {
  const s=base();
  const dom=new JSDOM('<dialog id="dialog"></dialog><div id="toast" hidden></div>');
  const previous=globalThis.document;globalThis.document=dom.window.document;
  const dialog=document.querySelector("#dialog");dialog.showModal=()=>dialog.setAttribute("open","");dialog.close=()=>dialog.removeAttribute("open");
  try{
    const app={state:s,month:curr,mode:"real",cashFilters:{}};
    const done=await moneyAction(app,"money-income",{dataset:{}});
    assert.equal(done,true);
    assert.match(dialog.querySelector("h2").textContent,/실제 입금 내역/);
    assert.equal(dialog.querySelectorAll(".income-record-row").length,1);
    assert.match(dialog.querySelector(".income-record-row").textContent,/다른 달로 반영/);
    const reassign=dialog.querySelector('[data-action="money-income-move"]');
    assert.ok(reassign);
    assert.equal(reassign.dataset.id,"existing-early-pay");
    assert.ok(dialog.querySelector('[data-edit="existing-early-pay"]'));
    assert.match(dialog.querySelector(".income-ledger-attention").textContent,/선입금/);
  }finally{globalThis.document=previous;dom.window.close();}
});
test("unrelated old or excluded income does not appear in actionable early-pay hint", () => {
  const s=base();s.transactions.push(tx({id:"older",date:"2025-09-10",datetime:"2025-09-10T09:00:00",operatingMonth:"2025-09",amount:9999}));
  s.transactions.push(tx({id:"transfer",date:beforeStart,amount:9000,incomeKind:"transfer"}));
  const ledger=incomeReconciliation(s,curr);
  assert.equal(ledger.nearby.length,1);
  assert.equal(ledger.records.length,3);
});
