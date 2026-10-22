import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { emptyState } from "../data/defaults.js";
import { paymentChoices, requirePaymentChoice } from "../js/payment-picker.js";
import { quickEntry, resolveEntryPayment } from "../js/behavior-actions.js";
import { editTransaction } from "../js/editors.js";

function fixture() {
  const state = emptyState();
  state.configured = true;
  state.settings.cardName = "";
  state.settings.privacy = false;
  state.settings.paymentMethods = ["생활 카드", "현금", "숨긴 카드"];
  state.settings.hiddenPaymentMethods = ["숨긴카드"];
  state.settings.paymentAliases = { oldcard: "생활 카드" };
  state.cashAccounts = [
    { id: "bank", name: "생활비 계좌", paymentMethod: "BANK107", owner: "p1" },
    { id: "closed", name: "종료 계좌", paymentMethod: "CLOSED", archived: true },
    { id: "hidden", name: "숨긴 계좌", paymentMethod: "HIDDEN" },
  ];
  state.settings.hiddenCashAccounts = ["hidden"];
  return state;
}

test("saved payment choices preserve bank aliases and exclude hidden/closed instruments", () => {
  const state = fixture(), before = structuredClone(state);
  assert.deepEqual(paymentChoices(state).map(c => c.value), ["생활 카드", "현금", "BANK107"]);
  assert.equal(requirePaymentChoice(state, "생활비 계좌"), "BANK107");
  assert.equal(requirePaymentChoice(state, "oldcard"), "생활 카드");
  for (const value of ["새 카드", "", "미지정", "숨긴 카드", "종료 계좌", "HIDDEN"]) {
    assert.throws(() => requirePaymentChoice(state, value), /등록된 결제수단/);
  }
  assert.deepEqual(state, before);
});

test("last-used preferences resolve aliases but never restore an unregistered payment", () => {
  const state = fixture();
  const storage = value => ({ getItem: () => value });
  assert.equal(resolveEntryPayment(state, "p1", [], storage("oldcard")), "생활 카드");
  assert.equal(resolveEntryPayment(state, "p1", [], storage("생활비 계좌")), "BANK107");
  for (const value of ["새 카드", "숨긴 카드", "CLOSED", "HIDDEN"]) {
    assert.equal(resolveEntryPayment(state, "p1", [], storage(value)), "생활 카드");
  }
  state.settings.paymentMethods = [];
  state.cashAccounts = [];
  assert.equal(resolveEntryPayment(state, "p1", [], storage("새 카드")), "");
});

function prepare(state) {
  const dom = new JSDOM('<dialog id="dialog"></dialog><div id="toast"></div>', { url: "https://example.test" });
  const globals = Object.fromEntries(["document", "FormData", "localStorage"].map(key => [key, globalThis[key]]));
  for (const key of Object.keys(globals)) globalThis[key] = dom.window[key];
  const dialog = document.querySelector("dialog");
  dialog.showModal = () => dialog.setAttribute("open", "");
  dialog.close = () => dialog.removeAttribute("open");
  const app = { state, update: async update => {
    const next = structuredClone(app.state);
    update(next);
    app.state = next;
  } };
  return { app, dialog, dom, close() {
    for (const key of Object.keys(globals)) globalThis[key] = globals[key];
    dom.window.close();
  } };
}
const submit = dialog => dialog.querySelector("form").onsubmit({ preventDefault() {} });
const fill = (dialog, name, value) => { dialog.querySelector(`[name=${name}]`).value = value; };

for (const [name, open] of [["quick entry", quickEntry], ["transaction entry", editTransaction]]) {
  test(`${name} only saves selected existing payments, including after state changes`, async () => {
    const env = prepare(fixture()), { app, dialog, dom } = env;
    try {
      open(app);
      const selector = dialog.querySelector("[name=paymentMethod]");
      assert.equal(selector.tagName, "SELECT");
      assert.equal(selector.required, true);
      assert.equal(dialog.querySelector('input[name=paymentMethod], #payment-options'), null);
      fill(dialog, "amount", "4500");
      fill(dialog, name === "quick entry" ? "merchant" : "merchantRaw", "검증 마트");
      selector.add(new dom.window.Option("새 카드", "새 카드"));
      selector.value = "새 카드";
      await submit(dialog);
      assert.equal(app.state.transactions.length, 0);
      assert.match(dialog.querySelector(".form-error").textContent, /등록된 결제수단/);
      selector.value = "현금";
      app.state = structuredClone(app.state);
      app.state.settings.hiddenPaymentMethods.push("현금");
      await submit(dialog);
      assert.equal(app.state.transactions.length, 0, "A payment hidden while the form is open must be rejected");
      selector.value = "BANK107";
      await submit(dialog);
      assert.equal(app.state.transactions.length, 1);
      assert.equal(app.state.transactions[0].paymentMethod, "BANK107");
      assert.equal(app.state.transactions[0].amount, 4500);
      assert.equal(dialog.open, false);
    } finally { env.close(); }
  });

  test(`${name} with no saved payments gives setup guidance and cannot save`, async () => {
    const state = emptyState(); state.settings.cardName = "";
    const env = prepare(state), { app, dialog } = env;
    try {
      open(app);
      fill(dialog, "amount", "1000");
      fill(dialog, name === "quick entry" ? "merchant" : "merchantRaw", "검증 매장");
      assert.equal(dialog.querySelector("[name=paymentMethod]").checkValidity(), false);
      assert.match(dialog.textContent, /결제수단 메뉴에서 카드·계좌를 먼저 등록/);
      await submit(dialog);
      assert.equal(app.state.transactions.length, 0);
      assert.equal(dialog.open, true);
    } finally { env.close(); }
  });
}

test("editing an existing hidden payment retains its original value and can select an active payment", async () => {
  const state = fixture();
  state.transactions.push({ id: "old", sourceId: "old", date: "2026-09-10", datetime: "2026-09-10T12:00:00",
    amount: 1000, merchantRaw: "기존 기록", owner: "p1", direction: "expense", scope: "shared", category: "other", paymentMethod: "숨긴 카드" });
  const env = prepare(state), { app, dialog } = env;
  try {
    editTransaction(app, "old");
    assert.equal(dialog.querySelector("[name=paymentMethod]").value, "숨긴 카드");
    fill(dialog, "amount", "2000");
    await submit(dialog);
    assert.equal(app.state.transactions[0].paymentMethod, "숨긴 카드");
    assert.equal(app.state.transactions[0].amount, 2000);
    editTransaction(app, "old");
    fill(dialog, "paymentMethod", "생활 카드");
    await submit(dialog);
    assert.equal(app.state.transactions[0].paymentMethod, "생활 카드");
    assert.equal(app.state.transactions[0].date, "2026-09-10");
  } finally { env.close(); }
});

test("owner changes keep valid defaults and respect an explicitly selected payment", () => {
  const env = prepare(fixture()), { app, dialog, dom } = env;
  try {
    localStorage.setItem("richkkok-payment-p1", "생활 카드");
    localStorage.setItem("richkkok-payment-p2", "현금");
    quickEntry(app);
    const payment = dialog.querySelector("[name=paymentMethod]"), owner = dialog.querySelector("[name=owner]");
    owner.value = "p2"; owner.dispatchEvent(new dom.window.Event("change"));
    assert.equal(payment.value, "현금");
    payment.value = "BANK107"; payment.dispatchEvent(new dom.window.Event("change"));
    owner.value = "p1"; owner.dispatchEvent(new dom.window.Event("change"));
    assert.equal(payment.value, "BANK107");
  } finally { env.close(); }
});
