import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const executablePath = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
].find((path) => fs.existsSync(path));
const server = spawn(process.execPath, ["scripts/serve.cjs"], {
  env: { ...process.env, PORT: "4181" },
  stdio: "inherit",
});
let browser;
try {
  await new Promise((resolve) => setTimeout(resolve, 750));
  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    timezoneId: "Asia/Seoul",
    serviceWorkers: "block",
    hasTouch: true,
  });
  await context.route(/supabase\.co/, (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(8000);
  await page.goto("http://127.0.0.1:4181/#home", { waitUntil: "networkidle" });
  // The test state exists ONLY in the temporary browser context.
  await page.evaluate(async () => {
    const { emptyState } = await import("./data/defaults.js");
    const { Repository } = await import("./js/db.js");
    const s = emptyState();
    s.configured = true;
    s.settings.privacy = false;
    s.settings.income = 6000000;
    s.settings.sharedBudget = 1800000;
    const r = new Repository();
    await r.replace(s);
    r.close();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".control-home");
  const read = () =>
    page.evaluate(async () => {
      const { Repository } = await import("./js/db.js");
      const r = new Repository();
      const state = await r.read();
      r.close();
      return state;
    });
  const original = await read();
  const viewports = [
    [320, 700], [360, 800], [375, 667], [390, 844], [430, 932],
    [600, 860], [768, 1024], [821, 832], [834, 1112], [1024, 768],
    [1280, 800], [1366, 768], [1440, 900], [1920, 1080], [844, 390],
  ];
  const layouts = [];
  fs.mkdirSync("qa-results", { recursive: true });
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await page.goto("http://127.0.0.1:4181/#home", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".control-home");
    const shell = await page.evaluate(() => {
      const nav = document.querySelector("#navigation");
      const sidebar = document.querySelector(".sidebar");
      const navigation = nav.getBoundingClientRect();
      return {
        viewport: innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        count: nav.querySelectorAll("a.nav-item").length,
        navTop: Math.round(navigation.top),
        sidebarTop: Math.round(sidebar.getBoundingClientRect().top),
      };
    });
    assert.equal(shell.count, 4, "All main navigation routes remain present");
    assert.ok(shell.pageWidth <= width + 1, JSON.stringify({ width, shell }));
    if (width <= 700) {
      assert.ok(shell.navTop > height / 2, "Bottom navigation must stay at screen bottom");
    } else {
      assert.ok(shell.navTop < height / 2, "Tablet / desktop navigation must stay in side rail");
    }
    await page.locator(".import-entry[data-action=quick-expense]").click();
    assert.equal(await page.locator("#dialog.dialog-expense-entry[open]").count(), 1);
    const dialog = await page.evaluate(() => {
      const d = document.querySelector("#dialog");
      const body = d.querySelector(".dialog-body");
      const grid = d.querySelector(".quick-core-grid");
      const selector = (name) => d.querySelector("[name=" + name + "]");
      const x = (name) => Math.round(selector(name).getBoundingClientRect().left);
      const names = [...grid.querySelectorAll(":scope > .quick-field input, :scope > .quick-field select")]
        .map((el) => el.name);
      const rect = d.getBoundingClientRect();
      const footer = d.querySelector(".dialog-footer").getBoundingClientRect();
      const cards = [...grid.querySelectorAll(":scope > .quick-field")];
      return {
        gridHeight: Math.round(grid.getBoundingClientRect().height),
        cardHeights: cards.map((card) => Math.round(card.getBoundingClientRect().height)),
        coreChildren: cards.length,
        merchantPlaceholder: selector("merchant").getAttribute("placeholder"),
        paymentPlaceholder: selector("paymentMethod").getAttribute("placeholder"),
        merchantListValid: d.querySelector("#recent-merchants")?.parentElement?.classList.contains("quick-field-merchant"),
        paymentListValid: d.querySelector("#payment-options")?.parentElement?.classList.contains("quick-field-payment"),
        dateSettingsValid: !!d.querySelector(".dialog-body > details.quick-adjust"),
        summaryValid: d.querySelector("#auto-entry-summary")?.parentElement?.classList.contains("quick-entry-primary"),
        footerValid: !!d.querySelector(".dialog-body + .dialog-footer"),
        dialogHeight: Math.round(rect.height),
        formHeight: Math.round(d.querySelector(":scope > form")?.getBoundingClientRect().height || 0),
        formScrollHeight: d.querySelector(":scope > form")?.scrollHeight,
        dialogScrollHeight: d.scrollHeight,
        children: [...d.children].map((node) => node.tagName.toLowerCase() + "." + node.className),
        innerFormElements: d.querySelectorAll(":scope > form").length,
        dialogComputedHeight: getComputedStyle(d).height,
        variant: d.className,
        names,
        width: d.clientWidth,
        scrollWidth: d.scrollWidth,
        bodyWidth: body.clientWidth,
        bodyScrollWidth: body.scrollWidth,
        gridWidth: grid.clientWidth,
        gridScrollWidth: grid.scrollWidth,
        amountLeft: x("amount"),
        merchantLeft: x("merchant"),
        rectLeft: rect.left,
        rectRight: rect.right,
        rectBottom: rect.bottom,
        footerTop: footer.top,
        footerBottom: footer.bottom,
      };
    });
    assert.deepEqual(dialog.names, ["amount", "merchant", "paymentMethod", "owner"]);
    assert.equal(dialog.coreChildren, 4, "Exactly four cards; no accidentally nested fields");
    assert.equal(dialog.innerFormElements, 1, "Dialog must contain a single form: " + JSON.stringify(dialog));
    assert.deepEqual(dialog.children, ["form."], "Dialog must not have stray elements outside the form");
    assert.equal(dialog.merchantPlaceholder, "예: 스타벅스, 이마트, 병원", "Merchant placeholder must be valid HTML");
    assert.equal(dialog.paymentPlaceholder, "예: 우리카드, 현금, 네이버페이", "Payment placeholder must be valid HTML");
    assert.equal(dialog.merchantListValid, true, "Recent merchant suggestions must be outside the input label");
    assert.equal(dialog.paymentListValid, true, "Payment suggestions must be outside the input label");
    assert.equal(dialog.dateSettingsValid, true, "Date / category options must be outside the core cards");
    assert.equal(dialog.summaryValid, true, "Auto classification summary must follow the field grid");
    assert.equal(dialog.footerValid, true, "Save / cancel buttons must remain in the form footer");
    assert.ok(dialog.cardHeights.every((cardHeight) => cardHeight > 75 && cardHeight < 180),
      "Input cards should fit their content, never stretch to fill the dialog: " + JSON.stringify({ width, dialog }));
    if (width > 700 && height >= 650) {
      assert.ok(dialog.gridHeight < 340, "Two desktop rows must be compact: " + JSON.stringify({ width, dialog }));
      assert.ok(dialog.dialogHeight < 650, "Desktop dialog must not fill the entire screen: " + JSON.stringify({ width, dialog }));
      assert.ok(dialog.dialogHeight <= dialog.formHeight + 24,
        "Popup must shrink-wrap its form without extra blank space: " + JSON.stringify({ width, dialog }));
    }
    for (const key of [["scrollWidth", "width"], ["bodyScrollWidth", "bodyWidth"], ["gridScrollWidth", "gridWidth"]]) {
      assert.ok(dialog[key[0]] <= dialog[key[1]] + 2, JSON.stringify({ width, dialog, key }));
    }
    assert.ok(dialog.rectLeft >= -1 && dialog.rectRight <= width + 1, JSON.stringify({ width, dialog }));
    assert.ok(dialog.footerTop >= -1 && dialog.footerBottom <= height + 1, JSON.stringify({ width, dialog }));
    if (width <= 700) assert.ok(Math.abs(dialog.amountLeft - dialog.merchantLeft) <= 2, "Phone fields must stack");
    else assert.ok(dialog.merchantLeft > dialog.amountLeft + 50, "Tablet / desktop fields must be two columns");
    if ([320, 390, 768, 821, 1366, 1440].includes(width) || (width === 844 && height === 390)) {
      await page.screenshot({ path: "qa-results/expense-" + width + "x" + height + ".png" });
    }
    layouts.push({ width, height, shell, dialog });
    await page.locator("#dialog .dialog-header [data-close]").click();
    assert.equal(await page.locator("#dialog[open]").count(), 0);
  }
  assert.deepEqual(await read(), original, "Opening and cancelling form must never mutate money");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:4181/#home");
  await page.waitForSelector(".control-home");
  await page.locator(".import-entry[data-action=quick-expense]").click();
  await page.locator("#dialog [name=amount]").fill("12340");
  await page.locator("#dialog [name=merchant]").fill("QA 반응형마트");
  await page.locator("#dialog [name=owner]").selectOption("p2");
  await page.locator("#dialog [name=paymentMethod]").fill("QA 체크카드");
  await page.locator("#dialog [type=submit]").click();
  await page.waitForSelector("#dialog[open]", { state: "hidden" });
  const after = await read();
  assert.equal(after.transactions.length, original.transactions.length + 1);
  const saved = after.transactions.find((tx) => tx.merchantRaw === "QA 반응형마트");
  assert.ok(saved);
  assert.equal(saved.amount, 12340);
  assert.equal(saved.owner, "p2");
  assert.equal(saved.paymentMethod, "QA 체크카드");
  await page.goto("http://127.0.0.1:4181/#transactions");
  await page.waitForSelector(".transactions-list");
  await page.locator(".transaction-row", { hasText: "QA 반응형마트" }).click();
  assert.equal(await page.locator("#dialog.dialog-transaction-editor[open]").count(), 1);
  await page.locator("#dialog [data-close]").first().click();
  assert.deepEqual(await read(), after, "Cancel edit must not mutate saved transaction");
  assert.deepEqual(errors, [], "Browser must have no runtime errors");
  fs.writeFileSync(
    "qa-results/adaptive-entry-browser.json",
    JSON.stringify({
      result: "PASS", layouts, errors,
      checks: ["15 viewport/orientation combinations", "5 navigation routes",
        "valid placeholders and datalists", "intact field DOM hierarchy", "compact input cards and short desktop dialog",
        "no overflow", "mobile single-column form", "tablet/PC two-column form",
        "dialog footer in view", "cancel does not save", "expense persists",
        "transaction edit dialog", "no production access"],
    }, null, 2),
  );
  const pc = layouts.find((entry) => entry.width === 821);
  console.log("PASS adaptive spending form across 15 viewports, navigation, save/cancel and existing edit; desktop " +
    pc.dialog.dialogHeight + "px high, 2-row grid " + pc.dialog.gridHeight + "px high");
} finally {
  await browser?.close();
  server.kill();
}
