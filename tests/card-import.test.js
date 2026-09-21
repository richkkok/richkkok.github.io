import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../data/defaults.js";
import {
  parseCardWorkbook,
  parseWooriPdf,
  resolveCardEntries,
  previewCardEntries,
} from "../js/import/card-statements.js";

function state() {
  const s = emptyState();
  s.settings.members = { p1: "태영", p2: "은영" };
  return s;
}

test("card workbook auto-splits primary/family and excludes subtotal/total rows", async () => {
  const sheets = [
    {
      name: "Sheet1",
      date1904: false,
      rows: [
        [null, "> 카드이용내역"],
        [null, "이용일자", "이용카드", "구분", "이용가맹점", null, "이용금액"],
        [null, "26.08.06", "마스터054", "일시불", "마트", null, 10000],
        [null, "본인회원 님의 이 용 소   계    1 건", null, null, null, null, 10000],
        [null, "26.08.07", "마스터823", "일시불", "배드민턴장", null, 2000],
        [null, "가족 박*영 님의 이 용 소   계    1 건", null, null, null, null, 2000],
        [null, "합   계    2 건", null, null, null, null, 12000],
      ],
    },
  ];
  const parsed = parseCardWorkbook(sheets);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.requiresPrimaryOwner, true);
  const resolved = resolveCardEntries(parsed.entries, state(), "p2");
  assert.deepEqual(
    resolved.entries.map((entry) => entry.owner),
    ["p2", "p1"],
  );
  const preview = await previewCardEntries(parsed.entries, state(), {
    primaryOwner: "p2",
    sourceType: "card-original",
  });
  assert.equal(preview.errors.length, 0);
  assert.equal(preview.valid[0].date, "2026-08-06");
  assert.equal(preview.ownerCounts.p2, 1);
  assert.equal(preview.ownerCounts.p1, 1);
});

test("Woori PDF parser uses full-name subtotals and wrapped merchant text", () => {
  const pages = [
    {
      page: 1,
      lines: [
        { text: "우리카드 이용대금 명세서", items: [] },
        { text: "2026년 09월 17일", items: [] },
        { text: "(M111)카드의정석2 EVERY DISCOUNT", items: [] },
        {
          text: "한농홈푸드 주식회사 동탄",
          items: [{ text: "한농홈푸드 주식회사 동탄", x: 120, y: 700 }],
        },
        {
          text: "08/13 17,030 17,030 할인 136 16,894",
          items: [
            { text: "08/13", x: 50, y: 680 },
            { text: "17,030", x: 320, y: 680 },
            { text: "17,030", x: 410, y: 680 },
            { text: "할인", x: 480, y: 680 },
          ],
        },
        {
          text: "1지점",
          items: [{ text: "1지점", x: 120, y: 660 }],
        },
        { text: "소계(박태영) 17,030", items: [] },
        { text: "(M057)카드의정석2 EVERY DISCOUNT", items: [] },
        {
          text: "08/14 이마트 동탄점 91,920 91,920 할인 735 91,185",
          items: [
            { text: "08/14", x: 50, y: 620 },
            { text: "이마트 동탄점", x: 120, y: 620 },
            { text: "91,920", x: 320, y: 620 },
            { text: "91,920", x: 410, y: 620 },
          ],
        },
        { text: "소계(김은영) 91,920", items: [] },
      ],
    },
  ];
  const parsed = parseWooriPdf(pages);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].merchant, "한농홈푸드 주식회사 동탄 1지점");
  assert.equal(parsed.entries[0].date, "2026-08-13");
  assert.equal(parsed.entries[0].ownerHint.label, "박태영");
  assert.equal(parsed.entries[1].ownerHint.label, "김은영");
  const resolved = resolveCardEntries(parsed.entries, state(), "p1");
  assert.deepEqual(
    resolved.entries.map((entry) => entry.owner),
    ["p1", "p2"],
  );
});
