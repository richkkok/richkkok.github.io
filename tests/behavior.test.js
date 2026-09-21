import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../data/defaults.js";
import {
  period,
  periodKey,
  transactionPeriod,
  periodDates,
  addDays,
} from "../js/period.js";
import {
  dashboard,
  allocate,
  closeDay,
  dayStatus,
  reconcile,
} from "../js/behavior.js";
import { baselineAnalysis, dailyWeights } from "../js/baseline.js";
import { mergeStates, mergeValue } from "../js/sync-merge.js";
import { normalizeRow } from "../js/import/normalize.js";
import { possibleDuplicates } from "../js/import/duplicates.js";
import { monthBudget } from "../js/budget.js";
import { validateState } from "../js/models.js";
import { migrate } from "../js/migrate.js";
import { Repository } from "../js/db.js";
import { IDBFactory } from "fake-indexeddb";
import { today } from "../js/format.js";
import { resolveEntryOwner, resolveEntryPayment } from "../js/behavior-actions.js";
const tx = (amount, date = "2026-09-10", extra = {}) => ({
  id: crypto.randomUUID(),
  sourceId: crypto.randomUUID(),
  amount,
  date,
  datetime: date + "T12:00:00",
  merchantRaw: "가상카페",
  merchantNormalized: "가상카페",
  paymentMethod: "가상카드",
  scope: "shared",
  owner: "p1",
  direction: "expense",
  category: "cafe",
  ...extra,
});
const setup = () => {
  const s = emptyState();
  s.configured = true;
  Object.assign(s.settings, {
    income: 4000000,
    variableBudget: 1500000,
    savingsTarget: 1500000,
    trackingSince: "2026-09-10",
  });
  return s;
};
function history() {
  const s = setup();
  s.settings.baseline = {
    start: "2026-06-01",
    end: "2026-08-31",
    confirmed: true,
  };
  for (let m = 6; m <= 8; m++) {
    const mm = String(m).padStart(2, "0");
    s.transactions.push(
      tx(4000000, `2026-${mm}-09`, { direction: "income" }),
      tx(1000000, `2026-${mm}-10`, {
        category: "housing",
        scope: "fixed",
        costKind: "fixed",
      }),
    );
    for (let d = 1; d <= new Date(2026, m, 0).getDate(); d++) {
      const date = `2026-${mm}-${String(d).padStart(2, "0")}`;
      const weekend = [0, 6].includes(new Date(date).getUTCDay());
      s.transactions.push(
        tx(weekend ? 30000 : 10000, date, {
          category: "dining",
          merchantRaw: "가상식당",
          merchantNormalized: "가상식당",
        }),
      );
    }
  }
  return s;
}
test("10일~9일, 연말·연초·윤년과 31일 기준", () => {
  assert.equal(periodKey("2026-09-09"), "2026-08");
  assert.equal(periodKey("2026-09-10"), "2026-09");
  assert.deepEqual(period("2026-12"), {
    month: "2026-12",
    start: "2026-12-10",
    end: "2027-01-09",
    days: 31,
  });
  assert.equal(period("2028-02", 31).start, "2028-02-29");
  assert.equal(period("2028-02", 31).end, "2028-03-30");
});
test("급여 선입금 귀속월은 실제 날짜와 독립", () => {
  const s = setup();
  const t = tx(3000000, "2026-09-09", {
    direction: "income",
    operatingMonth: "2026-09",
  });
  s.transactions = [t];
  assert.equal(transactionPeriod(t, s), "2026-09");
  assert.equal(monthBudget(s, "2026-09").actualIncome, 3000000);
  assert.equal(t.date, "2026-09-09");
});
test("고정비 예정일은 운영월 안으로 한 번만 배정", () => {
  const s = setup();
  s.recurring = [
    {
      id: "r",
      name: "가상정기비",
      amount: 500000,
      day: 5,
      start: "2026-01-01",
    },
  ];
  const b = monthBudget(s, "2026-09");
  assert.equal(b.recurring[0].date, "2026-10-05");
  s.transactions = [
    tx(500000, "2026-10-05", { recurringId: "r", scope: "fixed" }),
  ];
  assert.equal(monthBudget(s, "2026-09", "2026-10-09").outstanding, 0);
});
test("균등 계획의 더/덜 써야 하는 금액과 오늘 허용액", () => {
  const s = setup();
  s.transactions = [tx(30000)];
  const b = dashboard(s, "2026-09", "2026-09-10");
  assert.equal(b.planned, 50000);
  assert.equal(b.delta, 20000);
  assert.equal(b.todayAvailable, 20000);
  assert.equal(b.projectedSavings, 3100000);
  s.transactions.push(tx(40000));
  const over = dashboard(s, "2026-09", "2026-09-10");
  assert.equal(over.delta, -20000);
  assert.equal(over.todayAvailable, -20000);
  assert.equal(over.recovery, 690);
});
test("예산0 지출0 정확한 일치와 초과에서 NaN/Infinity 없음", () => {
  const s = emptyState();
  let b = dashboard(s, "2026-09", "2026-09-10");
  for (const k of [
    "budget",
    "delta",
    "todayAvailable",
    "forecast",
    "projectedSavings",
  ])
    assert(Number.isFinite(b[k]));
  assert.equal(b.pace, null);
  s.transactions = [tx(1)];
  b = dashboard(s, "2026-09", "2026-09-10");
  assert.equal(b.delta, -1);
  assert.equal(b.status, "현재 불가능");
  const s2 = setup();
  s2.transactions = [tx(50000)];
  assert.equal(dashboard(s2, "2026-09", "2026-09-10").delta, 0);
});
test("환불과 음수 보정은 한 번만 차감", () => {
  const s = setup();
  s.transactions = [
    tx(100000),
    tx(20000, "2026-09-10", {
      direction: "refund",
      sourceType: "reconciliation",
    }),
  ];
  assert.equal(dashboard(s, "2026-09", "2026-09-10").actual, 80000);
});
test("간편결제+카드 부가정보는 한 건, 이체·카드대금 제외", () => {
  const s = setup();
  s.transactions = [
    tx(39900, "2026-09-10", {
      merchantRaw: "쿠팡",
      paymentChannel: "쿠팡페이",
      paymentMethod: "신한카드",
    }),
    tx(39900, "2026-09-10", { direction: "transfer", scope: "excluded" }),
  ];
  assert.equal(dashboard(s, "2026-09", "2026-09-10").actual, 39900);
});
test("일회성 지출은 운영월 예상에서 확대하지 않음", () => {
  const s = setup();
  s.transactions = [tx(300000, "2026-09-10", { costKind: "oneoff" })];
  const b = dashboard(s, "2026-09", "2026-09-10");
  assert.equal(b.forecast, 300000);
});
test("미래 운영월, 마지막 날, 이미 끝난 기간", () => {
  const s = setup();
  assert.equal(dashboard(s, "2026-10", "2026-09-21").elapsed, 0);
  s.transactions = [tx(800000)];
  const b = dashboard(s, "2026-09", "2026-10-09");
  assert.equal(b.forecast, 800000);
  assert.equal(b.future, 0);
  assert.equal(b.recovery, 0);
});
test("목표합계가 수입을 넘으면 가용 변동예산을 제한", () => {
  const s = setup();
  s.settings.income = 2000000;
  s.settings.savingsTarget = 1800000;
  const b = dashboard(s, "2026-09", "2026-09-10");
  assert.equal(b.budget, 200000);
  assert.equal(b.affordability, 200000);
});
test("고정지출 원금과 미결제액 중복 계산 없음", () => {
  const s = setup();
  s.recurring = [
    { id: "r", name: "r", amount: 1000000, day: 10, start: "2026-01-01" },
  ];
  s.transactions = [
    tx(300000, "2026-09-10", { recurringId: "r", scope: "fixed" }),
  ];
  const b = dashboard(s, "2026-09", "2026-09-10");
  assert.equal(b.fixed, 1000000);
  assert.equal(b.actual, 0);
});
test("분석기간 완전성 확인 전 추천곡선 사용 금지", () => {
  const s = history();
  s.settings.baseline.confirmed = false;
  const h = baselineAnalysis(s, "2026-09");
  assert.equal(h.usable, false);
  assert.deepEqual(dailyWeights(s, period("2026-09"), h), Array(30).fill(1));
});
test("3개월 실제수입, 고정비, 소비곡선과 합계 보존", () => {
  const s = history(),
    h = baselineAnalysis(s, "2026-09");
  assert.equal(h.income, 4000000);
  assert.equal(h.fixed, 1000000);
  assert(h.patterns.weekend > h.patterns.weekday);
  const weights = dailyWeights(s, period("2026-09"), h);
  assert(weights[2] > weights[0]);
  const amounts = allocate(1000001, weights);
  assert.equal(
    amounts.reduce((a, b) => a + b, 0),
    1000001,
  );
  assert(amounts.every(Number.isSafeInteger));
});
test("추천 여유/균형/절약 목표는 관측치 기반이며 보호항목 유지", () => {
  const s = history();
  for (const m of ["06", "07", "08"])
    s.transactions.push(
      tx(m === "06" ? 120000 : 200000, `2026-${m}-15`, { category: "child" }),
    );
  const h = baselineAnalysis(s, "2026-09");
  assert.equal(h.variants[0].reduction, 0);
  assert(h.variants[2].variableBudget <= h.variants[1].variableBudget);
  for (const v of h.variants)
    assert.equal(
      v.categoryBudgets.child,
      h.categories.find((c) => c.id === "child").mean,
    );
});
test("현재 또는 미래 데이터는 역사학습 기준선으로 사용하지 않음", () => {
  const s = history();
  s.settings.baseline = {
    start: "2026-07-01",
    end: "2026-09-30",
    confirmed: true,
  };
  assert.equal(baselineAnalysis(s, "2026-09").usable, false);
});
test("하루 무지출 확인, 기록 추가·수정·삭제 후 마감 무효", () => {
  const s = setup(),
    date = today();
  closeDay(s, date, "zero");
  assert(dayStatus(s, date).closed);
  s.transactions.push(tx(1000, date));
  assert(!dayStatus(s, date).closed);
  assert.throws(() => closeDay(s, date, "zero"));
  closeDay(s, date);
  assert(dayStatus(s, date).closed);
  s.transactions[0].amount = 2000;
  assert(!dayStatus(s, date).closed);
  closeDay(s, date);
  s.transactions[0].deletedAt = "now";
  assert(!dayStatus(s, date).closed);
});
test("전날 미마감과 미래일 마감 방지", () => {
  const s = setup();
  assert(!dayStatus(s, addDays(today(), -1)).closed);
  assert.throws(() => closeDay(s, addDays(today(), 1)));
});
test("주간 보정은 거래일·정확한 카드명·환불을 기준으로 함", () => {
  const s = setup();
  s.transactions = [
    tx(557800),
    tx(1000, "2026-09-10", { paymentMethod: "다른카드" }),
    tx(99999, "2026-09-09"),
  ];
  const q = {
    payment: "가상카드",
    start: "2026-09-10",
    end: "2026-09-21",
    actual: 584200,
  };
  assert.equal(reconcile(s, q).difference, 26400);
  s.transactions.push(tx(26400, "2026-09-21"));
  assert.equal(reconcile(s, q).difference, 0);
});
test("다른 출처의 동일 소비 중복 의심, 서로 다른 소비는 보존", () => {
  const a = tx(39900, "2026-09-10", {
      merchantRaw: "쿠팡",
      merchantNormalized: "쿠팡",
      paymentMethod: "쿠팡페이",
    }),
    b = { ...a, id: "b", sourceId: "b", paymentMethod: "신한카드" };
  assert.equal(possibleDuplicates([b], [a]).length, 1);
  assert.equal(possibleDuplicates([{ ...b, amount: 39000 }], [a]).length, 0);
});
test("가져오기 고정비·카페·결제경로·귀속월 정규화", () => {
  const map = {
    date: 0,
    merchant: 1,
    amount: 2,
    payment: 3,
    channel: 4,
    operatingMonth: 5,
    costKind: 6,
  };
  let t = normalizeRow(
    ["2026-09-09", "급여", 3000000, "통장", "", "2026-09", ""],
    map,
  );
  assert.equal(t.operatingMonth, "2026-09");
  t = normalizeRow(
    ["2026-09-10", "아파트 관리비", 100000, "카드", "", "", ""],
    map,
  );
  assert.equal(t.costKind, "fixed");
  t = normalizeRow(
    ["2026-09-10", "메가커피", 2000, "신한카드", "네이버페이", "", ""],
    map,
  );
  assert.equal(t.category, "cafe");
  assert.equal(t.paymentChannel, "네이버페이");
});
test("서로 다른 기기의 거래 추가는 병합하고 동일 기록 충돌은 보류", () => {
  const base = setup(),
    l = structuredClone(base),
    r = structuredClone(base);
  l.transactions.push(tx(1000));
  r.transactions.push(tx(2000));
  const m = mergeValue(base, l, r);
  assert.equal(m.transactions.length, 2);
  const b = structuredClone(m),
    a = structuredClone(m),
    z = structuredClone(m);
  a.transactions[0].amount = 500;
  z.transactions[0].amount = 800;
  assert.throws(() => mergeValue(b, a, z));
  const result = mergeStates(b, a, z);
  assert.equal(result.conflicts.length, 1);
  const chosen = mergeStates(b, a, z, { [result.conflicts[0].path]: "remote" });
  assert.equal(chosen.state.transactions[0].amount, 800);
});
test("동시 마감·서로 다른 예산 설정 병합", () => {
  const b = setup(),
    l = structuredClone(b),
    r = structuredClone(b);
  l.settings.savingsTarget = 1000000;
  r.settings.variableBudget = 1200000;
  closeDay(l, "2026-09-10");
  closeDay(r, "2026-09-11");
  const v = mergeValue(b, l, r);
  assert.equal(v.settings.savingsTarget, 1000000);
  assert.equal(v.settings.variableBudget, 1200000);
  assert.equal(Object.keys(v.dailyCloses).length, 2);
});
test("레거시 원본을 백업하고 날짜/ID/금액/인증키 보존", async () => {
  const factory = new IDBFactory(),
    repo = new Repository("qa-v2-migration", factory),
    old = emptyState();
  delete old.settings.periodStartDay;
  delete old.dailyCloses;
  delete old.reconciliations;
  old.transactions = [tx(99000, "2026-09-09")];
  await repo.writeKey("state", old);
  await repo.writeKey("cloudMeta", { sessionToken: "dummy-test-token" });
  const read = await repo.read();
  assert.equal(read.settings.periodStartDay, 10);
  await repo.mutate((s) => {
    s.configured = true;
  });
  assert.deepEqual((await repo.read()).transactions, old.transactions);
  assert.deepEqual(await repo.readKey("pre-v2-backup"), old);
  assert.equal(
    (await repo.readKey("cloudMeta")).sessionToken,
    "dummy-test-token",
  );
  repo.close();
});
test("복원 검증은 잘못된 운영월·기준일·목표금액 거절", () => {
  const s = setup();
  s.settings.periodStartDay = 32;
  assert.throws(() => validateState(s));
  s.settings.periodStartDay = 10;
  s.transactions = [tx(1, "2026-09-10", { operatingMonth: "2026-13" })];
  assert.throws(() => validateState(s));
  s.transactions = [];
  s.settings.variableBudget = -1;
  assert.throws(() => validateState(s));
});
test("마감일 전체 계획선은 정확히 예산, 카테고리 초과/여유", () => {
  const s = setup();
  s.settings.categoryBudgets = { cafe: 100000, child: 300000 };
  s.transactions = [tx(200000)];
  const b = dashboard(s, "2026-09", "2026-09-21");
  assert.equal(b.chart.at(-1).planned, b.budget);
  assert(b.cuts.some((c) => c.id === "cafe"));
  assert(b.room.some((c) => c.id === "child"));
});

test("서버 응답 대기 중 추가한 지출을 원자적으로 보존하고 재동기화 표시", async () => {
  const repo = new Repository("inflight-qa", new IDBFactory());
  await repo.replace(setup());
  await repo.writeKey("cloudMeta", {
    sessionToken: "dummy",
    revision: 1,
    dirty: false,
  });
  const snapshot = await repo.read();
  const remote = structuredClone(snapshot);
  remote.settings.savingsTarget = 1200000;
  await repo.mutate((s) => {
    s.transactions.push(tx(12345));
  });
  assert.equal((await repo.readKey("cloudMeta")).dirty, true);
  const result = await repo.acceptRemote(snapshot, remote, { revision: 2 });
  assert.equal(result.state.transactions.length, 1);
  assert.equal(result.state.settings.savingsTarget, 1200000);
  assert.equal(result.meta.dirty, true);
  assert.equal(result.meta.sessionToken, "dummy");
  const accepted = await repo.acceptRemote(result.state, result.state, {
    revision: 3,
  });
  assert.equal(accepted.meta.dirty, false);
  assert.equal((await repo.read()).transactions[0].amount, 12345);
  repo.close();
});
test("서버 대기 중 같은 거래 충돌은 로컬 원본을 보존", async () => {
  const repo = new Repository("inflight-conflict", new IDBFactory()),
    s = setup();
  s.transactions = [tx(1000)];
  await repo.replace(s);
  await repo.writeKey("cloudMeta", {
    sessionToken: "dummy",
    revision: 1,
    dirty: false,
  });
  const snapshot = await repo.read(),
    remote = structuredClone(snapshot);
  remote.transactions[0].amount = 2000;
  await repo.mutate((s) => {
    s.transactions[0].amount = 3000;
  });
  await assert.rejects(repo.acceptRemote(snapshot, remote, { revision: 2 }));
  assert.equal((await repo.read()).transactions[0].amount, 3000);
  assert.equal((await repo.readKey("cloudMeta")).dirty, true);
  repo.close();
});
test("같은 업로드 파일 안의 서로 다른 결제수단도 중복 검토", () => {
  const t = tx(39900);
  assert.equal(
    possibleDuplicates(
      [
        t,
        { ...t, id: "other", sourceId: "other", paymentMethod: "네이버페이" },
      ],
      [],
    ).length,
    1,
  );
});

test("고정비만 기록한 초기 운영월은 변동소비 0원으로 성급히 예측하지 않음", () => {
  const s = setup();
  s.transactions = [
    tx(500000, "2026-09-10", { scope: "fixed", costKind: "fixed" }),
  ];
  const b = dashboard(s, "2026-09", "2026-09-10");
  assert.equal(b.forecast, 2000000);
  assert.equal(b.provisional, true);
});
test("추천 고정비 준비액은 실제·예정액과 중복되지 않고 누락 예상을 막음", () => {
  const s = setup();
  s.settings.fixedReserve = 1000000;
  let b = dashboard(s, "2026-09", "2026-09-10");
  assert.equal(b.fixed, 1000000);
  assert.equal(b.forecast, 2500000);
  s.transactions = [tx(400000, "2026-09-10", { costKind: "fixed" })];
  assert.equal(dashboard(s, "2026-09", "2026-09-10").fixed, 1000000);
  s.transactions[0].amount = 1200000;
  assert.equal(dashboard(s, "2026-09", "2026-09-10").fixed, 1200000);
});
test("반복비 연결은 수기 기본 변동비보다 우선해 이중 계상을 막음", () => {
  const s = setup();
  s.recurring = [
    { id: "r", name: "가상고정", amount: 500000, day: 10, start: "2026-01-01" },
  ];
  s.transactions = [
    tx(500000, "2026-09-10", { recurringId: "r", costKind: "variable" }),
  ];
  const b = dashboard(s, "2026-09", "2026-09-10");
  assert.equal(b.actual, 0);
  assert.equal(b.fixed, 500000);
});
test("31일 기준의 짧은 달은 실제 포함된 반복 예정일만 집계", () => {
  const s = setup();
  s.settings.periodStartDay = 31;
  s.recurring = [
    { id: "r", name: "가상반복", amount: 100000, day: 30, start: "2026-01-01" },
  ];
  assert.equal(monthBudget(s, "2026-03", "2026-04-29").recurring.length, 0);
  let b = monthBudget(s, "2026-02", "2026-03-30");
  assert.equal(b.recurring.length, 2);
  assert.equal(b.fixed, 200000);
  s.transactions = [
    tx(100000, "2026-02-28", { recurringId: "r", scope: "fixed" }),
    tx(100000, "2026-03-30", { recurringId: "r", scope: "fixed" }),
  ];
  b = monthBudget(s, "2026-02", "2026-03-30");
  assert.equal(b.outstanding, 0);
  assert.equal(b.fixed, 200000);
});

test("빠른입력은 마지막으로 저장한 사용자와 사람별 결제수단을 최우선 유지", () => {
  const state = emptyState();
  state.settings.members = { p1: "박태영", p2: "김은영" };
  state.settings.paymentMethods = ["기본카드"];
  const values = new Map([
    ["richkkok-owner", "p2"],
    ["richkkok-payment-p1", "태영 우리카드"],
    ["richkkok-payment-p2", "은영 우리카드"],
  ]);
  const storage = {
    getItem(key) {
      return values.get(key) || null;
    },
  };
  const app = {
    cloud: {
      meta: { member: { role: "owner", displayName: "박태영" } },
    },
  };
  const recent = [
    tx(1000, "2026-09-20", { owner: "p1", paymentMethod: "태영 최근카드" }),
    tx(2000, "2026-09-20", { owner: "p2", paymentMethod: "은영 최근카드" }),
  ];

  assert.equal(resolveEntryOwner(app, state, storage), "p2");
  assert.equal(resolveEntryPayment(state, "p1", recent, storage), "태영 우리카드");
  assert.equal(resolveEntryPayment(state, "p2", recent, storage), "은영 우리카드");
});

test("공동가계부 기기 이름으로 지출 입력 사용자를 올바르게 판별", () => {
  const state = emptyState();
  state.settings.members = { p1: "박태영", p2: "김은영" };

  assert.equal(
    resolveEntryOwner(
      { cloud: { meta: { member: { role: "owner", displayName: "박태영" } } } },
      state,
    ),
    "p1",
  );
  assert.equal(
    resolveEntryOwner(
      { cloud: { meta: { member: { role: "member", displayName: "김은영" } } } },
      state,
    ),
    "p2",
  );
  assert.equal(
    resolveEntryOwner(
      { cloud: { meta: { member: { role: "member", displayName: "태영-pc" } } } },
      state,
    ),
    "p1",
  );
  assert.equal(
    resolveEntryOwner(
      {
        cloud: {
          meta: { member: { role: "member", displayName: "은영-iPhone" } },
        },
      },
      state,
    ),
    "p2",
  );
});

