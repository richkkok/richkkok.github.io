import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { CATEGORIES, emptyState } from "../data/defaults.js";
import { migrate, PRODUCT_VERSION } from "../js/migrate.js";
import { Repository } from "../js/db.js";
import { classify } from "../js/rules.js";
import { budgetView } from "../js/views/budget.js";
import { quickEntry } from "../js/behavior-actions.js";

const delivery = { id: "delivery", name: "배달", icon: "dining", archived: false };
const makeTx = (id, category, overrides = {}) => ({
  id,
  sourceId: id,
  date: "2026-10-12",
  datetime: "2026-10-12T09:40:00",
  amount: 27000,
  direction: "expense",
  scope: "shared",
  owner: "p1",
  category,
  merchantRaw: "QA 배달 기록",
  merchantNormalized: "qa배달기록",
  paymentMethod: "QA 카드",
  categoryConfirmed: true,
  createdAt: "2026-10-12T01:00:00.000Z",
  updatedAt: "2026-10-12T01:00:00.000Z",
  ...overrides,
});

function legacy() {
  const s = emptyState();
  s.productVersion = 2;
  s.configured = true;
  s.categories.splice(2, 0, structuredClone(delivery));
  s.categories.find((c) => c.id === "dining").name = "외식·배달";
  s.transactions.push(
    makeTx("old-delivery", "delivery", { note: "수기 입력 그대로", recurringId: "monthly", tags: ["user"] }),
    makeTx("already-dining", "dining", { amount: 42000 }),
    makeTx("deleted-delivery", "delivery", { deletedAt: "2026-10-12T11:00:00Z", amount: 8000 }),
    makeTx("split-parent", "delivery", { splitParent: true, amount: 9000 }),
  );
  s.rules.push({
    id: "rule-delivery",
    field: "merchant",
    match: "keyword",
    pattern: "배달의민족",
    category: "delivery",
    enabled: true,
  });
  s.recurring.push({
    id: "monthly", name: "QA 정기 주문", day: 20,
    amount: 20000, category: "delivery", changes: [],
  });
  s.settings.categoryBudgets = { delivery: 50000, dining: 100000, health: 20000 };
  s.settings.monthOverrides = {
    "2026-10": { categoryBudgets: { delivery: 10000, dining: 20000 }, sharedBudget: 1000000 },
    "2026-11": { categoryBudgets: { delivery: 40000 }, sharedBudget: 1300000 },
  };
  return s;
}

test("delivery defaults removed; existing dining label remains a single target", () => {
  const ids = CATEGORIES.map((c) => c.id);
  assert.equal(ids.includes("delivery"), false);
  assert.equal(ids.filter((id) => id === "dining").length, 1);
  assert.equal(CATEGORIES.find((c) => c.id === "dining").name, "외식·배달");
  for (const merchant of ["배달의민족", "요기요", "쿠팡이츠"]) {
    assert.equal(classify({ merchantNormalized: merchant }, []).category, "dining", merchant);
  }
});

test("migration merges all transactions including deleted/split plus linked rules, recurring, monthly budgets", () => {
  const s = legacy();
  const saved = structuredClone(s);
  const totalBefore = s.transactions.reduce((sum, t) => sum + t.amount, 0);
  const migrated = migrate(s);
  assert.equal(migrated.productVersion, PRODUCT_VERSION);
  assert.equal(s.transactions.length, 4);
  assert.equal(s.transactions.reduce((sum, t) => sum + t.amount, 0), totalBefore);
  assert.deepEqual(s.categories.filter((c) => c.id === "delivery"), []);
  assert.equal(s.categories.find((c) => c.id === "dining").name, "외식·배달");
  assert.ok(s.transactions.every((t) => t.category === "dining"));
  for (let i = 0; i < s.transactions.length; i++) {
    assert.deepEqual(
      { ...s.transactions[i], category: saved.transactions[i].category },
      saved.transactions[i],
      "Only category ID must change, never any transaction field",
    );
  }
  assert.equal(s.rules[0].category, "dining");
  assert.equal(s.recurring[0].category, "dining");
  assert.deepEqual(s.settings.categoryBudgets, { dining: 150000, health: 20000 });
  assert.deepEqual(s.settings.monthOverrides["2026-10"].categoryBudgets, { dining: 30000 });
  assert.deepEqual(s.settings.monthOverrides["2026-11"].categoryBudgets, { dining: 40000 });
  assert.deepEqual(s.settings.monthOverrides["2026-10"].sharedBudget, 1000000);
  const once = JSON.stringify(s);
  migrate(s);
  assert.equal(JSON.stringify(s), once, "Migration must be idempotent");
  assert.equal(s.categories.filter((c) => c.id === "dining").length, 1);
});

test("migration renames only original built-in dining label, not user custom labels", () => {
  const s = legacy();
  s.categories.find((c) => c.id === "dining").name = "외식";
  migrate(s);
  assert.equal(s.categories.find((c) => c.id === "dining").name, "외식·배달");
  s.categories.find((c) => c.id === "dining").name = "우리집 식사";
  migrate(s);
  assert.equal(s.categories.find((c) => c.id === "dining").name, "우리집 식사");
});

test("legacy IndexedDB is backed up, migrated durably on read, and marks cloud copy dirty", async () => {
  const repo = new Repository("delivery-migration-test", new IDBFactory());
  const s = legacy();
  await repo.writeKey("state", s);
  await repo.writeKey("cloudMeta", { sessionToken: "synthetic-session", revision: 1, dirty: false });
  const first = await repo.read();
  assert.equal(first.productVersion, PRODUCT_VERSION);
  assert.equal(first.transactions[0].category, "dining");
  assert.equal((await repo.readKey("pre-v3-backup")).transactions[0].category, "delivery");
  assert.equal((await repo.readKey("cloudMeta")).dirty, true);
  const originalRevision = first.revision;
  repo.close();
  const again = await repo.read();
  assert.equal(again.revision, originalRevision, "Migration should not re-save on every read");
  assert.deepEqual(again.categories.filter((c) => c.id === "delivery"), []);
  const backup = await repo.readKey("pre-v3-backup");
  assert.equal(backup.rules[0].category, "delivery");
  repo.close();
});

test("restoring a legacy backup or accepting old cloud snapshots cannot recreate the delivery category", async () => {
  const repo = new Repository("delivery-restore-test", new IDBFactory());
  const s = legacy();
  await repo.replace(s);
  let current = await repo.read();
  assert.equal(current.transactions[0].category, "dining");
  await repo.acceptRemote(current, legacy(), { revision: 5 });
  current = await repo.read();
  assert.equal(current.transactions[0].category, "dining");
  assert.equal(current.rules[0].category, "dining");
  assert.ok(!current.categories.some((c) => c.id === "delivery"));
  await repo.replaceExact(legacy());
  current = await repo.read();
  assert.equal(current.transactions[0].category, "dining");
  assert.ok(!current.categories.some((c) => c.id === "delivery"));
  repo.close();
});

test("category selection UI never offers '배달' after a legacy state is opened", () => {
  const previous = globalThis.document;
  const dom = new JSDOM('<dialog id="dialog"></dialog><div id="toast" hidden></div>');
  globalThis.document = dom.window.document;
  const dialog = document.querySelector("#dialog");
  dialog.showModal = () => dialog.setAttribute("open", "");
  dialog.close = () => dialog.removeAttribute("open");
  try {
    const state = migrate(legacy());
    quickEntry({ state });
    const options = Array.from(dialog.querySelectorAll('[name="category"] option'), (x) => [x.value, x.textContent]);
    assert.ok(options.some(([id, name]) => id === "dining" && name === "외식·배달"));
    assert.ok(!options.some(([id, name]) => id === "delivery" || name === "배달"));
    const html = budgetView(state, "2026-10");
    assert.ok(html.includes("외식·배달"));
    assert.ok(!html.includes('tone-delivery'));
  } finally {
    globalThis.document = previous;
    dom.window.close();
  }
});
