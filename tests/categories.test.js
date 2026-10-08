import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../data/defaults.js";
import { migrate } from "../js/migrate.js";
import { classify } from "../js/rules.js";
import { normalizeRow } from "../js/import/normalize.js";
import { monthBudget } from "../js/budget.js";
import { validateState } from "../js/models.js";
import { budgetView } from "../js/views/budget.js";
import { settingsView } from "../js/views/settings.js";
import { syncCategories } from "../js/money.js";
const map = { date: 0, merchant: 1, amount: 2, payment: 3, type: 4 };
const row = (name, extra = {}) => ({
  ...normalizeRow(["2026-09-15", name, 10000, "검증용 카드", "지출"], map),
  ...extra,
});

test("fresh and existing ledgers expose tax and housing without duplicate IDs", () => {
  const s = emptyState();
  assert.equal(s.categories.find(c => c.id === "tax").name, "세금공과금");
  assert.equal(s.categories.find(c => c.id === "housing").name, "주거비");
  s.categories = s.categories.filter(c => c.id !== "tax");
  s.categories.find(c => c.id === "housing").name = "주거·관리";
  migrate(s);
  assert.equal(s.categories.find(c => c.id === "housing").name, "주거비");
  assert.equal(s.categories.filter(c => c.id === "tax").length, 1);
  assert.equal(new Set(s.categories.map(c => c.id)).size, s.categories.length);
  const once = JSON.stringify(s);
  migrate(s);
  assert.equal(JSON.stringify(s), once);
});

test("migration preserves transactions, recurring links, budgets, IDs and manual labels", () => {
  const s = emptyState();
  s.transactions = [row("아파트관리비", { category: "housing", recurringId: "r", categoryConfirmed: true }), row("주민세", { category: "finance", categoryConfirmed: true })];
  s.settings.categoryBudgets.housing = 300000;
  s.recurring = [{ id: "r", category: "housing", amount: 10000, day: 15, changes: [] }];
  s.categories.find(c => c.id === "housing").name = "우리집 주택비";
  s.categories.find(c => c.id === "tax").archived = true;
  const protectedData = JSON.stringify([s.transactions, s.recurring, s.settings.categoryBudgets]);
  migrate(s);
  assert.equal(JSON.stringify([s.transactions, s.recurring, s.settings.categoryBudgets]), protectedData);
  assert.equal(s.categories.find(c => c.id === "housing").name, "우리집 주택비");
  assert.equal(s.categories.find(c => c.id === "tax").archived, true);
  assert.equal(syncCategories(s), 0);
});

test("new taxes and utility bills use the tax category", () => {
  for (const name of ["재산세", "주민세", "자동차세", "종합소득세", "지방세납부", "공과금", "한국전력", "전기요금", "도시가스", "수도요금", "상하수도요금"])
    assert.equal(row(name).category, "tax", name);
});

test("housing payments stay separate from utilities and ambiguous purchases", () => {
  for (const name of ["아파트관리비", "주택 월세", "주택임차료", "관리단"])
    assert.equal(row(name).category, "housing", name);
  for (const name of ["전기면도기", "수도꼭지 구매", "알 수 없는 이체"])
    assert.equal(classify({ merchantNormalized: name }).category, "other", name);
  assert.equal(row("농협생명").category, "finance");
});

test("one-off taxes and recurring utilities keep distinct spending behavior", () => {
  for (const name of ["재산세", "자동차세", "종합소득세", "위택스"])
    assert.equal(row(name).costKind, "oneoff", name);
  for (const name of ["전기요금", "도시가스", "월세", "아파트관리비"])
    assert.equal(row(name).costKind, "fixed", name);
  const bank = { date: 0, merchant: 1, amount: 2, payment: 3, type: 4, costKind: 5 };
  const explicit = normalizeRow(["2026-09-15", "전기요금", 10000, "카드", "지출", "variable"], bank);
  assert.equal(explicit.costKind, "variable");
});

test("custom classification rules remain authoritative", () => {
  const t = { merchantNormalized: "전기요금", amount: 10000, category: "other" };
  const result = classify(t, [{ id: "own", enabled: true, field: "merchant", match: "exact", pattern: "전기요금", category: "housing" }]);
  assert.equal(result.category, "housing");
  assert.equal(result.ruleId, "own");
});

test("tax and housing appear in settings and budget and preserve expense totals", () => {
  const s = emptyState();
  s.configured = true;
  s.transactions = [row("재산세", { id: "a", amount: 20000 }), row("월세", { id: "b", amount: 30000 })];
  validateState(s);
  const b = monthBudget(s, "2026-09", "2026-10-08");
  assert.equal(b.spent, 50000);
  assert.equal(b.categories.find(c => c.id === "tax").used, 20000);
  assert.equal(b.categories.find(c => c.id === "housing").used, 30000);
  const html = budgetView(s, "2026-09");
  assert.ok(html.includes("세금공과금"));
  assert.ok(html.includes("주거비"));
  assert.ok(settingsView(s).includes(`${s.categories.length}개 사용 중`));
});
