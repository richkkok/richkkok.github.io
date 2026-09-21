import test from "node:test";
import assert from "node:assert/strict";
import { emptyState as defaultState } from "../data/defaults.js";
import { parseCSV } from "../js/import/csv.js";
import {
  parseDate,
  parseAmount,
  normalizeRow,
} from "../js/import/normalize.js";
import { detectHeader } from "../js/import/mapper.js";
import { previewRows, parseBytes, parseWorkbook } from "../js/import/parser.js";
import { identify, dedupe } from "../js/import/dedupe.js";
import { classify } from "../js/rules.js";
import { monthBudget } from "../js/budget.js";
import { occurrence, matchRecurring } from "../js/recurring.js";
import { splitTransaction, validateState } from "../js/models.js";
import { analyze } from "../js/analytics.js";
import { filteredTransactions } from "../js/views/transactions.js";
import fs from "node:fs";
import vm from "node:vm";
const context = {};
vm.runInNewContext(fs.readFileSync("vendor/xlsx.full.min.js", "utf8"), context);
const XLSX = context.XLSX;
// Legacy calendar-month regression suite uses the supported day-1 setting.
const emptyState = () => {
  const s = defaultState();
  s.settings.periodStartDay = 1;
  return s;
};
const map = { date: 0, merchant: 1, amount: 2, payment: 3, type: 4 };
const tx = (amount, extra = {}) => ({
  ...normalizeRow(["2026-09-05", "가상 가게", amount, "우리카드", "지출"], map),
  id: crypto.randomUUID(),
  sourceId: crypto.randomUUID(),
  ...extra,
});
test("CSV: Korean, BOM, commas, quoted newlines, blank and bad quoting", () => {
  assert.equal(
    parseCSV(
      '\uFEFF날짜,가맹점,금액\n2026-09-01,"식료품, 가게","12,300"',
    )[1][2],
    "12,300",
  );
  assert.equal(parseCSV('a,b\n"두\n줄",2')[1][0], "두\n줄");
  assert.deepEqual(parseCSV(""), []);
  assert.throws(() => parseCSV('a,b\n"broken,2'));
});
test("Mapping finds actual header below a title; invalid header stays unconfident", () => {
  const d = detectHeader([
    ["내보낸 거래"],
    [],
    ["거래일시", "가맹점명", "이용금액", "카드명"],
  ]);
  assert.equal(d.index, 2);
  assert.equal(d.mapping.payment, 3);
  assert.equal(d.confident, true);
  assert.equal(detectHeader([["foo", "bar"]]).confident, false);
});
test("Korean/compact/Excel dates, 1904 dates, afternoon and validation", () => {
  assert.equal(parseDate("2026년 9월 7일").date, "2026-09-07");
  assert.equal(parseDate("20260917").date, "2026-09-17");
  assert.equal(parseDate(46282).date, "2026-09-17");
  assert.equal(parseDate(44820, "", true).date, "2026-09-17");
  assert.equal(
    parseDate("2026-09-17 오후 3:20:00").datetime,
    "2026-09-17T15:20:00",
  );
  assert.throws(() => parseDate("2026-02-31"));
});
test("Amounts: comma, explicit expense sign, refund, signed bank amounts, zero and invalid", () => {
  assert.equal(parseAmount("₩ 1,230원"), 1230);
  assert.equal(parseAmount("(1,230)"), -1230);
  assert.equal(tx(-100).direction, "expense");
  assert.equal(
    normalizeRow(["2026-09-05", "가게", -100, "카드", ""], map).direction,
    "refund",
  );
  assert.equal(
    normalizeRow(["2026-09-05", "가게", 100, "카드", "승인취소"], map)
      .direction,
    "refund",
  );
  assert.equal(
    normalizeRow(["2026-09-05", "가게", -100, "계좌", ""], map, {
      negativeMode: "signed",
    }).direction,
    "expense",
  );
  assert.equal(
    normalizeRow(["2026-09-05", "가게", 100, "계좌", ""], map, {
      negativeMode: "signed",
    }).direction,
    "income",
  );
  assert.equal(tx(0).amount, 0);
  assert.throws(() => parseAmount("1,abc"));
});
test("Bank debit/credit columns and settlement detection prevent double expenses", () => {
  const bank = { date: 0, merchant: 1, withdrawal: 2, deposit: 3, amount: -1 };
  assert.equal(
    normalizeRow(["2026-09-01", "가상 급여", "", 500], bank).direction,
    "income",
  );
  assert.throws(() => normalizeRow(["2026-09-01", "동시", 100, 100], bank));
  for (const name of [
    "카드대금",
    "카드결제대금 납부",
    "계좌간 이체",
    "내 계좌 이동",
    "적금 이동",
  ])
    assert.equal(
      normalizeRow(["2026-09-01", name, 100], map).direction,
      "transfer",
    );
  const s = emptyState();
  s.transactions = [
    tx(100),
    tx(100, { direction: "transfer", scope: "excluded", excluded: true }),
  ];
  assert.equal(monthBudget(s, "2026-09").spent, 100);
});
test("XLSX and XLS real binary round trip, sheets and Excel serial date", () => {
  for (const bookType of ["xlsx", "biff8"]) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["보고서"],
        ["날짜", "가맹점", "금액"],
        [46282, "가상 마트", 23000],
      ]),
      "거래내역",
    );
    const bytes = XLSX.write(wb, { type: "array", bookType });
    const result = parseWorkbook(bytes, XLSX);
    assert.equal(result[0].rows[2][1], "가상 마트");
    assert.equal(detectHeader(result[0].rows).index, 1);
  }
});
test("Empty/invalid files and preview errors are reported, valid rows survive", async () => {
  assert.throws(() => parseBytes(new ArrayBuffer(0), "a.csv"));
  assert.throws(() => parseBytes(new ArrayBuffer(1), "a.pdf"));
  const sheet = {
    rows: [
      ["날짜", "가맹점", "금액"],
      ["2026-09-01", "마트", 0],
      ["broken", "마트", 100],
    ],
    date1904: false,
  };
  const p = await previewRows(
    sheet,
    0,
    { date: 0, merchant: 1, amount: 2 },
    { owner: "p2" },
  );
  assert.equal(p.added.length, 1);
  assert.equal(p.errors.length, 1);
  assert.equal(p.added[0].owner, "p2");
});
test("Stable hashes dedupe repeat files, retain owner and same-file multiplicity", async () => {
  const rows = [tx(100), tx(100)],
    identified = await identify(rows);
  assert.notEqual(identified[0].id, identified[1].id);
  const repeated = await identify(rows);
  assert.equal(dedupe(repeated, identified).added.length, 0);
  assert.notEqual(
    (await identify([tx(100, { owner: "p2" })]))[0].id,
    identified[0].id,
  );
  const split = splitTransaction(identified[0], [
    { amount: 40 },
    { amount: 60 },
  ]);
  assert.equal(dedupe([identified[0]], split).duplicates, 1);
});
test("Rules: exact > keyword > merchant > heuristic; payment field; removal", () => {
  const t = tx(100, { merchantNormalized: "가상 마트" }),
    rules = [
      {
        id: "k",
        field: "merchant",
        match: "keyword",
        pattern: "마트",
        category: "groceries",
      },
      {
        id: "e",
        field: "merchant",
        match: "exact",
        pattern: "가상 마트",
        category: "shopping",
      },
    ];
  assert.equal(classify(t, rules).category, "shopping");
  assert.equal(classify(t, rules.slice(0, 1)).category, "groceries");
  assert.equal(classify(t, []).category, "groceries");
  assert.equal(
    classify(t, [
      {
        id: "p",
        field: "payment",
        match: "exact",
        pattern: "우리카드",
        scope: "p1",
      },
    ]).scope,
    "p1",
  );
});
test("Budget handles income 0, budget 0, overspend, refund and month isolation", () => {
  const s = emptyState();
  s.transactions = [
    tx(120),
    tx(20, { direction: "refund" }),
    tx(999, { date: "2026-08-01" }),
  ];
  const b = monthBudget(s, "2026-09", "2026-09-17");
  assert.equal(b.available, -100);
  assert.equal(b.shared, 100);
  s.settings.income = 300;
  s.settings.incomeMode = "actual";
  s.transactions.push(tx(200, { direction: "income" }));
  assert.equal(monthBudget(s, "2026-09").income, 200);
  assert.equal(monthBudget(s, "2026-10").spent, 0);
});
test("Recurring: partial match, overpayment, future effective date, refund, one count", () => {
  const s = emptyState();
  s.settings.income = 500;
  s.recurring = [
    {
      id: "r",
      name: "가상통신",
      amount: 100,
      day: 5,
      start: "2026-01-01",
      end: "",
      merchantPattern: "가상통신",
      scope: "fixed",
      category: "subscription",
      changes: [{ effective: "2027-01-01", amount: 130 }],
    },
  ];
  const actual = matchRecurring(
    tx(100, { merchantNormalized: "가상통신" }),
    s.recurring,
  );
  s.transactions = [actual];
  let b = monthBudget(s, "2026-09");
  assert.equal(b.available, 400);
  assert.equal(b.fixed, 100);
  assert.equal(b.outstanding, 0);
  actual.amount = 70;
  b = monthBudget(s, "2026-09");
  assert.equal(b.outstanding, 30);
  assert.equal(b.available, 400);
  assert.equal(occurrence(s.recurring[0], "2027-01").amount, 130);
  assert.equal(occurrence(s.recurring[0], "2026-12").amount, 100);
  s.transactions.push(
    tx(20, { direction: "refund", recurringId: "r", scope: "fixed" }),
  );
  assert.equal(monthBudget(s, "2026-09").outstanding, 50);
});
test("Card eligible/unknown/excluded are parallel metrics, never extra expenditure", () => {
  const s = emptyState();
  s.settings.income = 1000;
  s.transactions = [
    tx(200, { scope: "fixed", performanceStatus: "eligible" }),
    tx(50, { performanceStatus: "unknown" }),
    tx(20, { direction: "refund", performanceStatus: "eligible" }),
    tx(30, { performanceStatus: "excluded" }),
  ];
  const b = monthBudget(s, "2026-09");
  assert.equal(b.spent, 260);
  assert.equal(b.available, 740);
  assert.equal(b.cardEligible, 180);
  assert.equal(b.cardUnknown, 50);
});
test("Split preserves totals; soft-delete and restore; no mutation of original", () => {
  const s = emptyState(),
    original = tx(100);
  s.transactions = splitTransaction(original, [
    { amount: 40, scope: "shared" },
    { amount: 60, scope: "p1" },
  ]);
  assert.equal(monthBudget(s, "2026-09").spent, 100);
  assert.equal(monthBudget(s, "2026-09").personal.p1, 60);
  assert.equal(original.splitParent, undefined);
  s.transactions[1].deletedAt = "now";
  assert.equal(monthBudget(s, "2026-09").spent, 60);
  s.transactions[1].deletedAt = null;
  assert.equal(monthBudget(s, "2026-09").spent, 100);
  assert.throws(() =>
    splitTransaction(original, [{ amount: 40 }, { amount: 40 }]),
  );
});
test("Privacy prevents merchant search leakage; no invented comparison without history", () => {
  const s = emptyState();
  s.transactions = [
    tx(10, {
      scope: "p1",
      merchantRaw: "PrivateStore",
      merchantNormalized: "privatestore",
    }),
  ];
  assert.equal(
    filteredTransactions(s, "2026-09", { query: "PrivateStore" }).length,
    0,
  );
  s.settings.privacy = false;
  assert.equal(
    filteredTransactions(s, "2026-09", { query: "PrivateStore" }).length,
    1,
  );
  assert.equal(analyze(s, "2026-09").compared, false);
});
test("Backup state rejects invalid amounts and schema", () => {
  assert.throws(() => validateState({}));
  const s = emptyState();
  s.transactions = [tx(-1)];
  s.transactions[0].amount = -1;
  assert.throws(() => validateState(s));
});
test("Concentration excludes fixed payments and protected categories", () => {
  const s = emptyState();
  s.transactions = Array.from({ length: 10 }, (_, i) =>
    tx(20000, { category: i < 6 ? "groceries" : "dining" }),
  );
  s.transactions.push(tx(1000000, { category: "housing", scope: "fixed" }));
  const insights = analyze(s, "2026-09", "2026-09-17").insights;
  assert(
    insights.some((i) => i.type === "concentration" && i.text.includes("60%")),
  );
  s.recurring = [
    {
      id: "protected",
      name: "Protected",
      amount: 0,
      day: 1,
      category: "groceries",
      protected: true,
    },
  ];
  assert(
    !analyze(s, "2026-09", "2026-09-17").insights.some(
      (i) => i.type === "concentration",
    ),
  );
});
