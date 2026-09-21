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
  s.settings.members = { p1: "박태영", p2: "김은영" };
  return s;
}

test("masked cardholder names map to the unique household member", () => {
  for (const label of ["박*영", "박＊영", "박●영"]) {
    const resolved = resolveCardEntries(
      [
        {
          date: "2026-08-01",
          merchant: "테스트",
          amount: 1000,
          payment: "우리카드",
          type: "지출",
          note: "",
          ownerHint: { kind: "name", label },
        },
      ],
      state(),
      "p2",
    );
    assert.equal(resolved.entries[0].owner, "p1");
    assert.equal(resolved.warnings.length, 0);
  }
});


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
        {
          text: "납부하실 금액",
          items: [
            { text: "납부하실", x: 410, y: 720, width: 30 },
            { text: "금액", x: 418, y: 710, width: 16 },
          ],
        },
        { text: "(M111)카드의정석2 EVERY DISCOUNT", items: [] },
        {
          text: "한농홈푸드 주식회사 동탄",
          items: [{ text: "한농홈푸드 주식회사 동탄", x: 120, y: 685 }],
        },
        {
          text: "08/13 17,030 17,030 할인 136 16,894",
          items: [
            { text: "08/13", x: 50, y: 680 },
            { text: "17,030", x: 190, y: 680, width: 24 },
            { text: "17,030", x: 278, y: 680, width: 24 },
            { text: "할인", x: 350, y: 680, width: 16 },
            { text: "136", x: 380, y: 680, width: 12 },
            { text: "16,894", x: 420, y: 680, width: 24 },
          ],
        },
        {
          text: "1지점",
          items: [{ text: "1지점", x: 120, y: 675 }],
        },
        {
          text: "다음 거래의 가맹점",
          items: [{ text: "다음 거래의 가맹점", x: 120, y: 650 }],
        },
        { text: "소계(박*영) 17,030", items: [] },
        { text: "(M057)카드의정석2 EVERY DISCOUNT", items: [] },
        {
          text: "08/14 이마트 동탄점 91,920 91,920 할인 735 91,185",
          items: [
            { text: "08/14", x: 50, y: 620 },
            { text: "이마트 동탄점", x: 120, y: 620 },
            { text: "91,920", x: 190, y: 620, width: 24 },
            { text: "91,920", x: 278, y: 620, width: 24 },
            { text: "735", x: 380, y: 620, width: 12 },
            { text: "91,185", x: 420, y: 620, width: 24 },
          ],
        },
        { text: "소계(김은영) 91,920", items: [] },
        { text: "청구합계-우리은행 100*******333 108,950", items: [] },
        { text: "기환급내역", items: [] },
        {
          text: "08/14 5317-****-****-2057 할인캐시백 -40",
          items: [
            { text: "08/14", x: 50, y: 580 },
            { text: "5317-****-****-2057 할인캐시백", x: 120, y: 580 },
            { text: "-40", x: 320, y: 580 },
          ],
        },
      ],
    },
  ];
  const parsed = parseWooriPdf(pages);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].merchant, "한농홈푸드 주식회사 동탄 1지점");
  assert.equal(parsed.entries[0].date, "2026-08-13");
  assert.equal(parsed.entries[0].grossAmount, 17030);
  assert.equal(parsed.entries[0].amount, 16894);
  assert.equal(parsed.entries[0].cardBenefitAmount, 136);
  assert.equal(parsed.entries[0].ownerHint.label, "박*영");
  assert.equal(parsed.entries[1].ownerHint.label, "김은영");
  const resolved = resolveCardEntries(parsed.entries, state(), "p1");
  assert.deepEqual(
    resolved.entries.map((entry) => entry.owner),
    ["p1", "p2"],
  );
});


test("Woori PDF keeps annual-fee merchant text and stores payable amount", async () => {
  const pages = [
    {
      page: 1,
      lines: [
        { text: "우리카드 이용대금 명세서", items: [] },
        { text: "2026년 06월 17일", items: [] },
        {
          text: "납부하실 금액",
          items: [
            { text: "납부하실", x: 410, y: 720, width: 30 },
            { text: "금액", x: 418, y: 710, width: 16 },
          ],
        },
        { text: "(M057)카드의정석2 EVERY DISCOUNT", items: [] },
        {
          text: "연회비-(제휴)카드의정석2",
          items: [{ text: "연회비-(제휴)카드의정석2", x: 120, y: 685, width: 110 }],
        },
        {
          text: "05/13 12,000 12,000 12,000",
          items: [
            { text: "05/13", x: 50, y: 680, width: 20 },
            { text: "12,000", x: 190, y: 680, width: 24 },
            { text: "12,000", x: 278, y: 680, width: 24 },
            { text: "12,000", x: 420, y: 680, width: 24 },
          ],
        },
        {
          text: "EVERY DISCOUNT",
          items: [{ text: "EVERY DISCOUNT", x: 120, y: 675, width: 70 }],
        },
        { text: "소계(김은영) 12,000", items: [] },
        { text: "청구합계-우리은행 12,000", items: [] },
      ],
    },
  ];
  const parsed = parseWooriPdf(pages);
  assert.equal(parsed.entries.length, 1);
  assert.equal(
    parsed.entries[0].merchant,
    "연회비-(제휴)카드의정석2 EVERY DISCOUNT",
  );
  assert.equal(parsed.entries[0].amount, 12000);
  assert.equal(parsed.entries[0].cardBenefitAmount, 0);
  const preview = await previewCardEntries(parsed.entries, state(), {
    primaryOwner: "p1",
    sourceType: "card-pdf",
  });
  assert.equal(preview.valid[0].category, "finance");
  assert.equal(preview.valid[0].owner, "p2");
});

test("Woori PDF refund uses actual payable refund and benefit metadata", async () => {
  const pages = [
    {
      page: 1,
      lines: [
        { text: "우리카드 이용대금 명세서", items: [] },
        { text: "2026년 09월 17일", items: [] },
        {
          text: "납부하실 금액",
          items: [{ text: "납부하실", x: 410, y: 720, width: 30 }],
        },
        { text: "(M057)카드의정석2 EVERY DISCOUNT", items: [] },
        {
          text: "08/25 취소-인터넷상거래 -432,300 -420,196 -420,196",
          items: [
            { text: "08/25", x: 50, y: 680, width: 20 },
            { text: "취소-인터넷상거래", x: 120, y: 680, width: 90 },
            { text: "-432,300", x: 190, y: 680, width: 30 },
            { text: "-420,196", x: 278, y: 680, width: 30 },
            { text: "-420,196", x: 420, y: 680, width: 30 },
          ],
        },
        { text: "소계(김은영) -432,300", items: [] },
        { text: "청구합계-우리은행 0", items: [] },
      ],
    },
  ];
  const parsed = parseWooriPdf(pages);
  const preview = await previewCardEntries(parsed.entries, state(), {
    primaryOwner: "p1",
    sourceType: "card-pdf",
  });
  assert.equal(preview.valid[0].direction, "refund");
  assert.equal(preview.valid[0].amount, 420196);
  assert.equal(preview.valid[0].grossAmount, 432300);
  assert.equal(preview.valid[0].cardBenefitAmount, 12104);
});
