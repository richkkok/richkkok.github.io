import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { emptyState } from "../data/defaults.js";
import { instrumentChoices, instrumentLedgerView } from "../js/instrument-ledger.js";
import { cashView } from "../js/cash-ui.js";
import { focusHome } from "../js/focus-ui.js";

function fixture() {
  const state = emptyState();
  state.configured = true;
  state.settings.privacy = true;
  state.settings.paymentMethods = ["M107", "우리카드", "신한카드"];
  state.cashAccounts.push({
    id: "qa-a", name: "생활비 통장", owner: "p1", paymentMethod: "BANK107",
    openingBalance: 1500000, openingAt: "2026-10-10T08:00:00",
    autoMatch: false, reserved: 100000, archived: false,
  });
  state.transactions.push({
    id: "qa-card", sourceId: "qa-card", date: "2026-10-13",
    datetime: "2026-10-13T10:00:00", owner: "p2", direction: "expense",
    amount: 22000, category: "groceries", scope: "p2",
    paymentMethod: "M107", merchantRaw: "비공개 매장", merchantNormalized: "비공개 매장",
    costKind: "variable", sourceType: "manual", deletedAt: null,
  });
  return state;
}
const doc = html => new JSDOM(html).window.document;

test("cards and accounts can be chosen immediately, without expanding any hidden pane", () => {
  const s = fixture(), original = structuredClone(s);
  const html = instrumentLedgerView(s, { instrument: "m:" + encodeURIComponent("M107") });
  const document = doc(html);
  assert.ok(document.querySelector(".instrument-picker"));
  assert.match(document.querySelector(".instrument-picker h2").textContent, /카드·계좌 선택/);
  const picker = document.querySelector('select[name="instrument-target"]');
  assert.ok(picker, "Native full-list selector is always visible");
  assert.ok(!picker.closest("details"), "Choosing a payment must not require expanding details");
  assert.equal(picker.options.length, instrumentChoices(s).length);
  assert.ok([...picker.options].some(o => o.textContent.includes("M107")));
  assert.ok([...picker.options].some(o => o.textContent.includes("생활비 통장")));
  assert.ok(document.querySelector('.instrument-choice[data-action="instrument-select"]'));
  assert.ok(document.querySelector('.instrument-selected [data-action="instrument-profile"][data-method="M107"]'));
  assert.ok(document.querySelector('.instrument-picker [data-action="instrument-method"]'));
  assert.ok(document.querySelector('.instrument-picker [data-action="cash-account"]'));
  assert.equal(document.querySelector("details.instrument-advanced").open, false);
  assert.ok(document.querySelector('select[name="instrument-owner"]'));
  assert.deepEqual(s, original, "UI rendering never alters money");
});

test("choosing an account gives a direct rename and cash-check action", () => {
  const s = fixture();
  const document = doc(instrumentLedgerView(s, { instrument: "a:qa-a" }));
  assert.equal(document.querySelector('select[name="instrument-target"]').value, "a:qa-a");
  assert.ok(document.querySelector('.instrument-selected [data-action="cash-account"][data-id="qa-a"]'));
  assert.ok(document.querySelector('.instrument-selected [data-action="cash-check"][data-id="qa-a"]'));
  assert.ok(document.querySelector('.instrument-selected [data-action="instrument-add"][data-key="a:qa-a"]'));
  assert.equal(document.querySelector('.instrument-choice[aria-pressed="true"]').dataset.key, "a:qa-a");
});

test("bank proof is available but collapsed behind one clearly named section", () => {
  const s = fixture(), original = JSON.stringify(s);
  const document = doc(cashView(s, {}, instrumentLedgerView(s)));
  const sections = [...document.querySelector(".cash-page").children];
  assert.ok(sections.findIndex(el => el.classList.contains("instrument-panel")) <
            sections.findIndex(el => el.classList.contains("cash-admin")));
  const admin = document.querySelector("details.cash-admin");
  assert.ok(admin);
  assert.equal(admin.open, false);
  assert.match(admin.querySelector("summary").textContent, /계좌 잔액·이력 자세히/);
  assert.ok(admin.querySelector('.cash-admin-toolbar [data-action="cash-account"]'));
  assert.ok(admin.querySelector('.cash-account [data-action="cash-check"]'));
  assert.ok(admin.querySelector(".cash-links"));
  assert.ok(admin.querySelector(".cash-history-row") || admin.querySelector(".cash-page .cash-admin-body>.card"));
  assert.equal(JSON.stringify(s), original);
});

test("home exposes a direct card/account picker button before budget secondary details", () => {
  const s = fixture();
  const document = doc(focusHome(s, "2026-10", {}, "2026-10-14T12:00:00"));
  const shortcut = document.querySelector('.focus-budget .focus-payment-manage [data-action="go-cash"]');
  assert.ok(shortcut);
  assert.match(shortcut.textContent, /카드·계좌 선택/);
  assert.equal(shortcut.closest("details"), null);
  assert.equal(document.querySelector(".focus-spend-detail").open, false);
  assert.ok(document.querySelector('[data-focus-value="card-due-total"]'));
  assert.ok(document.querySelector('[data-focus-value="remaining"]'));
});

test("escaped payment names never inject markup in picker chips and dropdown", () => {
  const s = fixture();
  s.settings.paymentMethods.push('<img src=x onerror=alert(1)>');
  const html = instrumentLedgerView(s);
  assert.ok(!html.includes("<img src=x"));
  assert.match(html, /&lt;img src=x/);
  assert.equal(doc(html).querySelectorAll('img').length, 0);
});

test("no instruments shows card and account setup without fabricated balances", () => {
  const s = emptyState();s.configured=true;s.settings.cardName="";s.settings.paymentMethods=[];
  const document = doc(instrumentLedgerView(s));
  assert.match(document.querySelector(".instrument-picker-empty").textContent, /등록된 카드나 계좌가 없어/);
  assert.equal(document.querySelectorAll('select[name="instrument-target"]').length, 0);
  assert.equal(document.querySelectorAll('.instrument-totals').length, 0);
  assert.equal(s.transactions.length, 0);
});
