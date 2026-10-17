import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { emptyState } from "../data/defaults.js";
import { focusOverview } from "../js/focus.js";
import { focusHome } from "../js/focus-ui.js";
import { saveIncomeSchedule } from "../js/income-schedule.js";

const month = "2026-10";
const at12 = "2026-10-12T16:00:00";
const at16 = "2026-10-16T16:00:00";
function state() {
  const s = emptyState();
  s.configured = true;
  Object.assign(s.settings, {
    income: 6500000, sharedBudget: 2000000,
    personalBudgets: { p1: 250000, p2: 250000 },
    savingsTarget: 800000, trackingSince: "2026-10-10",
  });
  s.cashAccounts = [{
    id: "bank-1", name: "테스트 생활비", owner: "p1",
    openingBalance: 1500000, openingAt: "2026-10-11T10:00:00",
    reserved: 0, paymentMethod: "", autoMatch: false,
  }];
  return s;
}
function tx(id, amount, date, extra = {}) {
  return {
    id, sourceId: id, date, datetime: date + "T12:00:00",
    amount, direction: "expense", owner: "p1", scope: "shared",
    category: "groceries", costKind: "variable", merchantRaw: "QA 거래",
    merchantNormalized: "qa 거래", paymentMethod: "QA 카드", ...extra,
  };
}
function paycheck(id, amount, date, extra = {}) {
  return tx(id, amount, date, {
    direction: "income", category: "other", merchantRaw: "급여",
    merchantNormalized: "급여", ...extra,
  });
}
const dom = html => new JSDOM(html).window.document;
const value = (document, name) => document.querySelector(`[data-focus-value="${name}"]`)?.textContent;

test("only actually recorded income raises cash comparison on payday; scheduled future income is not counted", () => {
  const s = state();
  saveIncomeSchedule(s, month, [
    { id: "pay-10", name: "10일 급여", day: 10, amount: 3000000, owner: "p1" },
    { id: "pay-15", name: "15일 급여", day: 15, amount: 3500000, owner: "p2" },
  ]);
  const original = JSON.stringify(s);
  assert.equal(focusOverview(s, month, at12).cashReceived, 0,
    "Configured schedule must not create phantom cash income");
  s.transactions.push(paycheck("a", 3000000, "2026-10-10"));
  const before = focusOverview(s, month, at12);
  assert.equal(before.cash.usable, 1500000);
  assert.equal(before.cashReceived, 3000000);
  assert.equal(value(dom(focusHome(s, month, {}, at12)), "cash"), "150만원");
  assert.equal(value(dom(focusHome(s, month, {}, at12)), "cash-income"), "300만원");
  s.transactions.push(paycheck("b", 3500000, "2026-10-15"));
  assert.equal(focusOverview(s, month, at12).cashReceived, 3000000,
    "Future-dated transaction must not be included in a past as-of snapshot");
  const later = focusOverview(s, month, at16);
  assert.equal(later.cashReceived, 6500000);
  const document = dom(focusHome(s, month, {}, at16));
  assert.equal(value(document, "cash-income"), "650만원");
  assert.equal(later.cash.usable, 1500000, "The last observed bank balance remains unchanged");
  assert.equal(later.projectedCash.unlinkedIncome, 3500000,
    "Only the later, unlinked 15th payday is projected beyond the 11th baseline");
  assert.equal(value(document, "cash"), "500만원",
    "The estimated usable cash includes the later recorded paycheck");
  assert.match(document.querySelector(".focus-cash .focus-ratio").getAttribute("aria-label"), /실제 생활수입 누적 6,500,000원/);
  assert.match(document.querySelector(".focus-cash").textContent, /미연결 실제 입금 3,500,000원 임시 반영/);
  assert.equal(original.includes("pay-10"), true);
});

test("income is assigned to current payroll cycle even when an old month is being viewed", () => {
  const s = state();
  s.transactions.push(paycheck("current", 3300000, "2026-10-10"));
  const f = focusOverview(s, "2026-09", at12);
  assert.equal(f.cashMonth, "2026-10");
  assert.equal(f.cashReceived, 3300000);
  assert.equal(value(dom(focusHome(s, "2026-09", {}, at12)), "cash-income"), "330만원");
});

test("excluded, deleted and non-operating inflows are never treated as received household income", () => {
  const s = state();
  s.transactions.push(
    paycheck("salary", 3000000, "2026-10-10"),
    paycheck("future", 3500000, "2026-10-15"),
    paycheck("deleted", 700000, "2026-10-10", { deletedAt: "2026-10-12T01:00:00Z" }),
    paycheck("excluded", 500000, "2026-10-10", { excluded: true }),
    paycheck("transfer", 600000, "2026-10-10", { incomeKind: "transfer" }),
    paycheck("insurance", 800000, "2026-10-10", { incomeKind: "nonoperating" }),
    tx("refund", 100000, "2026-10-10", { direction: "refund" }),
  );
  assert.equal(focusOverview(s, month, at12).cashReceived, 3000000);
});

test("fixed spending includes entered actuals and refunds; registered scheduled total stays separate", () => {
  const s = state();
  s.recurring = [{
    id: "monthly", name: "정기 지출", day: 20, amount: 1900000,
    start: "2025-01-01", end: "", owner: "joint",
    scope: "fixed", category: "finance", paymentMethod: "QA 카드", changes: [],
  }];
  s.transactions.push(tx("monthly-paid", 1600000, "2026-10-20", {
    recurringId: "monthly", scope: "fixed", costKind: "fixed",
  }));
  s.transactions.push(tx("partial-refund", 100000, "2026-10-21", {
    direction: "refund", recurringId: "monthly", scope: "fixed", costKind: "fixed",
  }));
  const asOf = "2026-10-22T16:00:00";
  const f = focusOverview(s, month, asOf);
  assert.equal(f.fixedSpent, 1500000);
  assert.equal(f.fixedPlanned, 1900000);
  assert.equal(f.fixedDifference, 400000);
  const document = dom(focusHome(s, month, {}, asOf));
  assert.equal(value(document, "fixed-spent"), "150만원");
  assert.equal(value(document, "fixed"), "190만원");
  assert.equal(value(document, "fixed-difference"), "400,000원");
  assert.match(document.querySelector(".focus-fixed .focus-ratio").getAttribute("aria-label"), /1,500,000원.*1,900,000원/);
  s.transactions.push(tx("unlinked", 100000, "2026-10-21", {
    scope: "fixed", costKind: "fixed",
  }));
  const later = focusOverview(s, month, asOf);
  assert.equal(later.fixedSpent, 1600000);
  assert.equal(later.fixedPlanned, 1900000);
  assert.match(focusHome(s, month, {}, asOf), /예정 항목과 연결되지 않은 기록/);
});

test("fixed overrun is shown as a difference, not a negative unpaid balance", () => {
  const s = state();
  s.recurring.push({
    id: "rent", name: "임대료", day: 11, amount: 1900000, start: "2026-01-01",
    owner: "joint", scope: "fixed", category: "housing", paymentMethod: "QA 계좌", changes: [],
  });
  s.transactions.push(tx("fixed", 2100000, "2026-10-11", {
    scope: "fixed", recurringId: "rent", costKind: "fixed",
  }));
  const document = dom(focusHome(s, month, {}, at12));
  assert.match(document.querySelector(".focus-fixed .focus-counter").textContent, /예정 초과/);
  assert.equal(value(document, "fixed-difference"), "200,000원");
});

test("consumption ratio uses spent/limit and preserves exact remaining display and settings", () => {
  const s = state();
  s.settings.personalBudgets.p1 = 0;
  s.settings.personalBudgets.p2 = 0;
  s.settings.sharedBudget = 2500000;
  s.transactions.push(tx("groceries", 1000000, "2026-10-11"));
  const before = structuredClone(s);
  const document = dom(focusHome(s, month, {}, at12));
  assert.equal(value(document, "used"), "100만원");
  assert.equal(value(document, "limit"), "250만원");
  assert.equal(value(document, "remaining"), "1,500,000원");
  assert.equal(document.querySelectorAll(".focus-board > .focus-card").length, 3);
  assert.deepEqual(s, before, "Rendering must never mutate actual transactions or planning state");
  assert.match(document.querySelector(".focus-budget .focus-ratio").getAttribute("aria-label"), /소비액과 이번 기간 카드대금 추가반영 합계 1,000,000원.*2,500,000원/);
});

test("unmeasured cash displays missing data, never zero or planned salary as a balance", () => {
  const s = state();
  s.cashAccounts = [];
  s.transactions.push(paycheck("salary", 3000000, "2026-10-10"));
  const document = dom(focusHome(s, month, {}, at12));
  assert.equal(value(document, "cash"), "입력 필요");
  assert.equal(value(document, "cash-income"), "3,000,000원");
  assert.ok(!document.querySelector(".focus-cash .focus-ratio-right"));
});
