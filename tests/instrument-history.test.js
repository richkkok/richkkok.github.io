import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { emptyState } from "../data/defaults.js";
import { ensureCash, cashFingerprint } from "../js/cash.js";
import { instrumentChoices, instrumentHistoryRows, instrumentLedgerView } from "../js/instrument-ledger.js";

function fixture() {
  const s = emptyState();
  s.configured = true;
  ensureCash(s);
  s.settings.paymentMethods = ["M107", "우리카드"];
  s.cashAccounts = [{
    id: "bank", name: "우리집 계좌", paymentMethod: "BANK107", owner: "p1",
    openingAt: "2024-01-01T10:00:00", openingBalance: 300000,
    reserved: 0, autoMatch: false, archived: false,
  }];
  return s;
}
function tx(s, id, overrides = {}) {
  const t = {
    id, sourceId: id, date: "2025-04-02", datetime: "2025-04-02T13:10:00",
    amount: 12000, direction: "expense", owner: "p1", scope: "shared",
    category: "groceries", costKind: "variable", paymentMethod: "M107",
    merchantRaw: id, merchantNormalized: id, note: "", sourceType: "manual",
    deletedAt: null, ...overrides,
  };
  s.transactions.push(t);
  return t;
}
const choice = (s, name) => instrumentChoices(s).find(x => x.name === name);
const html = (s, key, opts = {}) =>
  new JSDOM("<main>" + instrumentLedgerView(s, { instrument: key, ...opts }) + "</main>").window.document;

test("card history shows every year, split, deleted and future-dated stored item without a 40-row cap", () => {
  const s = fixture();
  for (let i = 0; i < 63; i++)
    tx(s, "entry-" + i, { date: i < 40 ? "2025-02-01" : "2026-09-01",
      datetime: (i < 40 ? "2025-02-01" : "2026-09-01") + "T12:00:00" });
  tx(s, "deleted", { deletedAt: "2025-04-04T00:00:00Z" });
  tx(s, "future", { date: "2028-02-01", datetime: "2028-02-01T10:00:00" });
  tx(s, "split", { parentId: "legacy-root" });
  tx(s, "other-card", { paymentMethod: "우리카드" });
  const before = JSON.stringify(s);
  const card = choice(s, "M107");
  const history = instrumentHistoryRows(s, card);
  assert.equal(history.rows.length, 66);
  assert.equal(history.trash, 1);
  assert.equal(history.active, 65);
  assert.equal(history.rows[0].t.id, "future");
  assert.equal(JSON.stringify(s), before, "read-only history must not modify savings data");
  const doc = html(s, card.key);
  assert.equal(doc.querySelector('[name="instrument-period"]').value, "all");
  assert.equal(doc.querySelectorAll(".instrument-row").length, 66);
  assert.equal(doc.querySelectorAll(".instrument-row-main[data-instrument-edit='1']").length, 66);
  assert.equal(doc.querySelectorAll(".instrument-row.is-deleted").length, 1);
  assert.equal(doc.querySelector('[data-action="instrument-more"]'), null);
  assert.match(doc.querySelector(".instrument-ledger-heading").textContent, /전체 66건/);
  for (const row of doc.querySelectorAll(".instrument-row"))
    assert.equal(row.querySelectorAll("button button").length, 0, "nested buttons block mobile taps");
});

test("bank history includes linked transactions under other method names, old aliases, deleted and split children", () => {
  const s = fixture(), acc = choice(s, "우리집 계좌");
  tx(s, "alias", { paymentMethod: "BANK107" });
  tx(s, "display-name", { paymentMethod: "우리집 계좌", deletedAt: "2025-04-04T00:00:00Z" });
  tx(s, "unrelated");
  const linked = tx(s, "linked", { paymentMethod: "다른 결제수단", amount: 55000 });
  s.cashLinks.push({ id: linked.id, basis: cashFingerprint(linked), ignored: false,
    legs: [{ accountId: "bank", direction: "out", at: linked.datetime }] });
  tx(s, "child", { paymentMethod: "다른 결제수단", parentId: "linked", amount: 17000 });
  const rows = instrumentHistoryRows(s, acc);
  assert.deepEqual(new Set(rows.rows.map(r => r.t.id)),
    new Set(["alias", "display-name", "linked", "child"]));
  assert.equal(rows.trash, 1);
  assert.equal(rows.rows.find(r => r.t.id === "alias").needsLink, true);
  assert.equal(rows.rows.find(r => r.t.id === "linked").canLink, true);
  assert.equal(rows.rows.find(r => r.t.id === "child").canLink, false);
  const doc = html(s, acc.key);
  assert.equal(doc.querySelectorAll(".instrument-row-main").length, 4);
  assert.equal(doc.querySelectorAll(".instrument-row-link").length, 2);
  assert.equal(doc.querySelector(".instrument-selected [data-action='cash-check']").disabled, false);
});

test("archived accounts remain browsable for corrections without new deposits or balance edits", () => {
  const s = fixture();
  s.cashAccounts[0].archived = true;
  tx(s, "past", { paymentMethod: "BANK107" });
  const acc = choice(s, "우리집 계좌");
  assert.ok(acc);
  const doc = html(s, acc.key);
  assert.match(doc.querySelector(".instrument-selected-name").textContent, /사용 종료 계좌/);
  assert.equal(doc.querySelectorAll(".instrument-row").length, 1);
  assert.equal(doc.querySelector(".instrument-selected [data-action='instrument-add']"), null);
  assert.equal(doc.querySelector(".instrument-selected [data-action='cash-check']"), null);
  assert.equal(doc.querySelector(".instrument-selected [data-action='cash-account']").dataset.id, "bank");
});

test("filters apply only on demand and keep deleted transactions available for restoration", () => {
  const s = fixture(), card = choice(s, "M107");
  tx(s, "old", { owner: "p2", direction: "refund", date: "2025-01-01",
    datetime: "2025-01-01T12:00:00", deletedAt: "2025-01-02T00:00:00Z" });
  tx(s, "current", { owner: "p1", date: "2026-10-11", datetime: "2026-10-11T12:00:00" });
  assert.equal(instrumentHistoryRows(s, card).rows.length, 2);
  assert.equal(instrumentHistoryRows(s, card, { instrumentOwner: "p2" }).rows.length, 1);
  assert.equal(instrumentHistoryRows(s, card, { instrumentDirection: "in" }).rows.length, 1);
  assert.equal(instrumentHistoryRows(s, card, { instrumentPeriod: "custom",
    instrumentFrom: "2026-10-01", instrumentTo: "2026-10-15" }, "2026-10-15").rows.length, 1);
  const doc = html(s, card.key);
  const deleted = doc.querySelector(".instrument-row.is-deleted [data-edit='old']");
  assert.ok(deleted);
  assert.match(deleted.textContent, /복원/);
});

test("masked merchants, notes and malicious names cannot leak through history markup or aria labels", () => {
  const s = fixture(), card = choice(s, "M107");
  tx(s, "private", { scope: "p1", merchantRaw: '<img src=x onerror=alert(1)>',
    note: "비공개 상담", amount: 1000 });
  s.settings.privacy = true;
  const view = instrumentLedgerView(s, { instrument: card.key });
  assert.ok(!view.includes("onerror=alert"));
  assert.ok(!view.includes("비공개 상담"));
  const doc = new JSDOM(view).window.document;
  assert.match(doc.querySelector(".instrument-row-main").textContent, /개인 내역 숨김/);
  assert.match(doc.querySelector(".instrument-row-main").getAttribute("aria-label"), /개인 내역 숨김/);
  assert.equal(doc.querySelector("img"), null);
});
