import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { emptyState } from "../data/defaults.js";
import { focusHome } from "../js/focus-ui.js";
import { cashView, cashAction } from "../js/cash-ui.js";

const when = "2026-10-13T16:00:00";
const month = "2026-10";
function state(withAccount = false) {
  const s = emptyState();
  s.configured = true;
  s.settings.income = 6500000;
  if (withAccount)
    s.cashAccounts.push({
      id: "bank-existing", name: "QA 생활비통장",
      owner: "p1", openingAt: "2026-10-12T10:00:00",
      openingBalance: 1500000, reserved: 100000,
      paymentMethod: "", autoMatch: false,
    });
  return s;
}
const render = html => new JSDOM(html).window.document;

test("onboarding: the cash home card exposes a prominent direct first-baseline action", () => {
  const s = state();
  const before = JSON.stringify(s);
  const doc = render(focusHome(s, month, {}, when));
  const cash = doc.querySelector(".focus-cash");
  const actions = [...cash.querySelectorAll(".focus-cash-entry-actions button")];
  assert.equal(actions.length, 2);
  assert.equal(actions[0].dataset.action, "cash-account");
  assert.match(actions[0].textContent, /처음 기준잔액 입력/);
  assert.ok(actions[0].classList.contains("primary"), "Primary first-baseline CTA must be conspicuous");
  assert.equal(actions[1].dataset.action, "money-income");
  assert.match(actions[1].textContent, /입금 조회·반영/);
  assert.equal(cash.querySelector('[data-focus-value="cash"]').textContent, "입력 필요");
  assert.equal(cash.querySelector('.focus-cash-entry-links [data-action="money-add-income"]').textContent.trim(), "새 입금 입력");
  assert.equal(JSON.stringify(s), before, "Help UI should never mutate money");
});

test("existing bank baseline: an obvious action updates CURRENT balance without overwriting the original", () => {
  const s = state(true);
  const before = JSON.stringify(s);
  const doc = render(focusHome(s, month, {}, when));
  const cash = doc.querySelector(".focus-cash");
  const primary = cash.querySelector(".focus-cash-entry-actions .btn.primary");
  assert.equal(primary.dataset.action, "cash-check");
  assert.match(primary.textContent, /현재 잔액 입력/);
  assert.equal(cash.querySelector('[data-action="cash-account"]').textContent.trim(), "새 계좌 등록");
  assert.equal(cash.querySelector('[data-action="money-income"]').textContent.trim(), "입금 조회·반영");
  assert.equal(cash.querySelector('.focus-cash-entry-links [data-action="money-add-income"]').textContent.trim(), "새 입금 입력");
  assert.equal(cash.querySelector('[data-focus-value="cash"]').textContent, "140만원");
  assert.equal(JSON.stringify(s), before);
});

test("cash account page visibly distinguishes immutable first baseline and later verification", () => {
  const s = state(true);
  const doc = render(cashView(s));
  assert.equal(doc.querySelector(".cash-admin .cash-admin-toolbar [data-action='cash-account']").textContent.trim(), "새 계좌 등록");
  assert.equal(doc.querySelector(".cash-admin").open, false);
  assert.match(doc.querySelector(".cash-admin>summary").textContent, /계좌 잔액/);
  assert.equal(doc.querySelector(".cash-baseline-snapshot strong").textContent, "1,500,000원");
  assert.match(doc.querySelector(".cash-baseline-snapshot").textContent, /이력 보존으로 수정 불가/);
  assert.match(doc.querySelector(".cash-notice").textContent, /처음 기준잔액/);
  assert.match(doc.querySelector(".cash-notice").textContent, /현재 잔액 입력/);
  assert.match(doc.querySelector(".cash-account [data-action='cash-check']").textContent, /현재 잔액 입력/);
});

test("entry dialogs provide explicit labels and never confuse baseline with checking balance", async () => {
  const s = state(true);
  const snapshot = JSON.stringify(s);
  const dom = new JSDOM('<dialog id="dialog"></dialog><div id="toast" hidden></div>');
  const prev = globalThis.document;
  globalThis.document = dom.window.document;
  const dialog = document.querySelector("#dialog");
  dialog.showModal = () => dialog.setAttribute("open", "");
  dialog.close = () => dialog.removeAttribute("open");
  try {
    const app = { state: s, cashFilters: {} };
    await cashAction(app, "cash-check", { dataset: { id: "bank-existing" } });
    assert.match(dialog.querySelector("h2").textContent, /현재 현금잔액 입력/);
    assert.ok(dialog.querySelector('[name="actual"]'));
    assert.ok(!dialog.querySelector('[name="openingBalance"]'), "Checking must never change starting baseline");
    await cashAction(app, "cash-account", { dataset: { id: "" } });
    assert.match(dialog.querySelector("h2").textContent, /첫 기준잔액 입력/);
    assert.ok(dialog.querySelector('[name="openingBalance"]'));
    assert.ok(dialog.querySelector('[name="openingAt"]'));
    assert.match(dialog.querySelector('[name="openingBalance"]').closest("label").textContent, /처음 기준잔액/);
    await cashAction(app, "cash-account", { dataset: { id: "bank-existing" } });
    assert.match(dialog.querySelector("h2").textContent, /계좌 설정/);
    assert.ok(!dialog.querySelector('[name="openingBalance"]'), "Existing baseline remains read-only");
    assert.match(dialog.textContent, /현재 잔액 입력/);
  } finally {
    globalThis.document = prev;
    dom.window.close();
  }
  assert.equal(JSON.stringify(s), snapshot);
});
