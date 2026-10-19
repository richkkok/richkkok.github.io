import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browserPath = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(p => fs.existsSync(p));
assert.ok(browserPath, "Chromium must be available for UI regression");
const server = spawn(process.execPath, ["scripts/serve.cjs"],
  { env: { ...process.env, PORT: "4194" }, stdio: "inherit" });
let browser;
try {
  await new Promise(resolve => setTimeout(resolve, 700));
  browser = await chromium.launch({ headless: true, executablePath: browserPath, args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 920 }, timezoneId: "Asia/Seoul", serviceWorkers: "block",
  });
  await context.route(/supabase\.co/, request => request.abort());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", err => errors.push(err.message));
  page.setDefaultTimeout(12000);
  await page.goto("http://127.0.0.1:4194/#settings", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { emptyState } = await import("./data/defaults.js");
    const { Repository } = await import("./js/db.js");
    const { cashNow, cashFingerprint } = await import("./js/cash.js");
    const { addDays } = await import("./js/period.js");
    const s = emptyState(), today = cashNow().slice(0, 10);
    s.configured = true; s.settings.privacy = false;
    s.settings.members = { p1: "태영", p2: "은영" };
    s.settings.cardName = "M107"; s.settings.paymentMethods = ["M107", "다른 카드", "신한카드"];
    s.cashAccounts = [{ id: "qa-bank", name: "QA 생활계좌", owner: "p1",
      openingBalance: 1000000, openingAt: addDays(today, -120) + "T10:00:00",
      reserved: 0, paymentMethod: "BANK107", autoMatch: false, archived: false }];
    const make = (id, paymentMethod, date, patch = {}) => ({
      id, sourceId: id, date, datetime: date + "T12:30:00", amount: 2500,
      direction: "expense", owner: "p1", scope: "shared", costKind: "variable",
      paymentMethod, merchantRaw: id, merchantNormalized: id, category: "groceries",
      sourceType: "manual", deletedAt: null, ...patch,
    });
    s.transactions = Array.from({ length: 54 }, (_, i) =>
      make("qa-card-" + i, "M107", addDays(today, -(i + 2))));
    s.transactions.push(make("qa-old", "M107", addDays(today, -360)));
    s.transactions.push(make("qa-delete", "M107", addDays(today, -8), { amount: 9000 }));
    s.transactions.push(make("qa-trash", "M107", addDays(today, -41),
      { deletedAt: today + "T00:00:00Z" }));
    s.transactions.push(make("qa-alias", "BANK107", addDays(today, -8)));
    const linked = make("qa-linked", "별도 입출금", addDays(today, -3), { amount: 12000 });
    s.transactions.push(linked);
    s.cashLinks = [{ id: linked.id, basis: cashFingerprint(linked), ignored: false,
      legs: [{ accountId: "qa-bank", direction: "out", at: linked.datetime }] }];
    const repo = new Repository();
    await repo.replace(s); repo.close();
  });
  await page.reload({ waitUntil: "networkidle" });
  const read = () => page.evaluate(async () => {
    const { Repository } = await import("./js/db.js");
    const r = new Repository(), s = await r.read(); r.close(); return s;
  });
  // Entry point used for bulk name changes must lead to every registered transaction.
  await page.locator('[data-action="payment-settings"]').click();
  assert.match(await page.locator("#dialog h2").innerText(), /카드·계좌 이름 일괄 관리/);
  const key = "m:" + encodeURIComponent("M107");
  assert.match(await page.locator('#dialog .payment-manage-row').filter({has: page.locator('[data-action="instrument-review"][data-key="' + key + '"]')}).innerText(), /57건/);
  assert.ok(await page.locator('#dialog [data-action="instrument-profile"][data-method="M107"]').isVisible());
  await page.locator('#dialog [data-action="instrument-review"][data-key="' + key + '"]').click();
  await page.waitForURL(/#cash$/);
  assert.equal(await page.locator("#dialog[open]").count(), 0);
  assert.equal(await page.locator('[name="instrument-period"]').inputValue(), "all");
  assert.equal(await page.locator(".instrument-row-main").count(), 57);
  assert.equal(await page.locator('[data-action="instrument-more"]').count(), 0);
  assert.ok(await page.locator('.instrument-row-main[data-edit="qa-old"]').isVisible());
  assert.equal(await page.locator(".instrument-row.is-deleted").count(), 1);
  // A tap opens the existing editor, with reassignment shown without any advanced settings.
  await page.locator('.instrument-row-main[data-edit="qa-old"]').click();
  assert.match(await page.locator("#dialog h2").innerText(), /내역 수정/);
  const newPayment = page.locator("#dialog .editor-primary [name=paymentMethod]");
  assert.equal(await newPayment.isVisible(), true);
  await page.locator("#dialog [name=merchantRaw]").fill("변경된 작년 내역");
  await newPayment.fill("신한카드");
  await page.locator("#dialog [type=submit]").click();
  await page.locator("#dialog[open]").waitFor({ state: "hidden" });
  let state = await read();
  assert.equal(state.transactions.find(t => t.id === "qa-old").paymentMethod, "신한카드");
  assert.equal(state.transactions.find(t => t.id === "qa-old").merchantRaw, "변경된 작년 내역");
  assert.equal(await page.locator('.instrument-row-main[data-edit="qa-old"]').count(), 0);
  await page.locator(`.instrument-directory-history[data-key="m:${encodeURIComponent("신한카드")}"]`).click();
  assert.ok(await page.locator('.instrument-row-main[data-edit="qa-old"]').isVisible());
  await page.locator('.instrument-directory-history[data-key="'+key+'"]').click();
  // Deletion must require deliberate confirmation; the discarded item stays recoverable.
  await page.locator('.instrument-row-main[data-edit="qa-delete"]').click();
  await page.locator('#dialog [data-delete-transaction="qa-delete"]').click();
  assert.match(await page.locator("#dialog h2").innerText(), /거래 삭제 확인/);
  assert.equal((await read()).transactions.find(t => t.id === "qa-delete").deletedAt, null);
  await page.locator("#dialog [type=submit]").click();
  await page.locator("#dialog[open]").waitFor({ state: "hidden" });
  state = await read();
  assert.ok(state.transactions.find(t => t.id === "qa-delete").deletedAt);
  assert.match(await page.locator('.instrument-row-main[data-edit="qa-delete"]').innerText(), /복원/);
  await page.locator('.instrument-row-main[data-edit="qa-delete"]').click();
  await page.locator('#dialog [data-restore-transaction="qa-delete"]').click();
  await page.locator("#dialog[open]").waitFor({ state: "hidden" });
  assert.equal((await read()).transactions.find(t => t.id === "qa-delete").deletedAt, null);
  // Linked transactions are shown even when their payment name differs from the account.
  await page.locator('.instrument-directory-history[data-key="a:qa-bank"]').click();
  assert.ok(await page.locator('.instrument-row-main[data-edit="qa-alias"]').isVisible());
  assert.ok(await page.locator('.instrument-row-main[data-edit="qa-linked"]').isVisible());
  await page.locator('.instrument-row-main[data-edit="qa-linked"]').click();
  assert.equal(await page.locator("#dialog .editor-primary [name=paymentMethod]").inputValue(), "별도 입출금");
  await page.locator("#dialog [data-close]").first().click();
  // Responsive layout and all stored transaction identities remain intact.
  const layouts = [];
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.evaluate(() => ({
      width: innerWidth, documentWidth: document.documentElement.scrollWidth,
    }));
    assert.ok(metrics.documentWidth <= metrics.width + 1, JSON.stringify(metrics));
    layouts.push(metrics);
  }
  assert.deepEqual(errors, []);
  fs.mkdirSync("qa-results", { recursive: true });
  fs.writeFileSync("qa-results/instrument-history-browser.json",
    JSON.stringify({ result: "PASS", layouts, errors, checks: [
      "rename-settings-history-navigation", "historical-and-deleted-all-visible",
      "tap-to-edit", "payment-reassignment", "confirmed-soft-delete",
      "restore", "explicit-bank-link-history", "320px-mobile",
    ] }, null, 2));
  console.log("PASS full card/account history browser workflow");
} finally {
  await browser?.close();
  server.kill();
}
