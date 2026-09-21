import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { sampleState } from "../data/sample.js";
import { currentMonth } from "../js/format.js";
import {
  controlHome as homeView,
  controlAnalysis as analyticsView,
} from "../js/views/behavior.js";
import { transactionsView } from "../js/views/transactions.js";
import { budgetView } from "../js/views/budget.js";
import { settingsView } from "../js/views/settings.js";
import { importView } from "../js/views/import.js";
import { onboardingView } from "../js/views/onboarding.js";
import { field, transactionRow } from "../js/ui.js";
test("All views render meaningful accessible controls, escape user text and mask personal merchants", () => {
  const s = sampleState();
  s.settings.members.p1 = "<script>alert(1)</script>";
  const month = currentMonth();
  for (const html of [
    homeView(s, month),
    transactionsView(s, month, {}),
    budgetView(s, month),
    analyticsView(s, month),
    settingsView(s),
    importView(s, { owner: "p1" }),
    ...[1, 2, 3].map((n) => onboardingView(s, n)),
  ]) {
    const doc = new JSDOM(html).window.document;
    assert.ok(doc.body.textContent.trim().length > 20);
    assert.equal(doc.querySelectorAll("script").length, 0);
    assert.equal(doc.querySelectorAll("img[onerror]").length, 0);
    for (const input of doc.querySelectorAll(
      "input:not([type=hidden]):not([type=file])",
    ))
      assert.ok(
        input.closest("label") || input.getAttribute("aria-label"),
        "Missing input label",
      );
  }
  const home = homeView(s, month),
    feed = transactionsView(s, month, {});
  assert.ok(!home.includes("가상 개인 서점"));
  assert.ok(!feed.includes("가상 개인 서점"));
});
test("Transaction chevron and numeric input constraints keep their component boundaries", () => {
  const s = sampleState(),
    tx = s.transactions.find((t) => t.scope === "shared");
  const doc = new JSDOM(
    transactionRow(tx, s) +
      field("Day", "day", 1, "number", 'min="1" max="31"'),
  ).window.document;
  assert.equal(doc.querySelector(".transaction-row").children.length, 4);
  assert.equal(
    doc.querySelector(".row-chevron").parentElement.className,
    "transaction-row ",
  );
  assert.equal(doc.querySelector("input").min, "1");
  assert.equal(doc.querySelector("input").max, "31");
});
