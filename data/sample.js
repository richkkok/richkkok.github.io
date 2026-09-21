import { periodKey, period, startDay } from "../js/period.js";
import { defaultBaseline } from "../js/baseline.js";
import { emptyState } from "./defaults.js";
import { shiftMonth, daysInMonth, currentMonth, today } from "../js/format.js";
/* Entirely fictional; stored in a separate demo database. */
export function sampleState() {
  const s = emptyState();
  s.demo = true;
  s.configured = true;
  s.settings = {
    ...s.settings,
    members: { p1: "나", p2: "파트너" },
    income: 5800000,
    variableBudget: 2500000,
    savingsTarget: 1500000,
    baseline: { ...defaultBaseline(periodKey()), confirmed: true },
    trackingSince: period(periodKey()).start,
    sharedBudget: 1900000,
    personalBudgets: { p1: 300000, p2: 300000 },
    categoryBudgets: {
      groceries: 650000,
      dining: 450000,
      child: 250000,
      transport: 200000,
      shopping: 200000,
      leisure: 150000,
      cafe: 65000,
      delivery: 100000,
      living: 80000,
    },
  };
  s.recurring = [
    {
      id: "demo-housing",
      name: "집을 위한 비용",
      amount: 1050000,
      category: "housing",
      paymentMethod: "공동계좌",
      day: 25,
      scope: "fixed",
      owner: "joint",
      start: "2020-01-01",
      end: "",
      merchantPattern: "가상주거",
      changes: [],
      protected: true,
    },
    {
      id: "demo-insurance",
      name: "건강을 위한 보험",
      amount: 380000,
      category: "finance",
      paymentMethod: "공동계좌",
      day: 5,
      scope: "fixed",
      owner: "joint",
      start: "2020-01-01",
      end: "",
      merchantPattern: "가상보험",
      changes: [],
      protected: true,
    },
    {
      id: "demo-telecom",
      name: "통신과 구독",
      amount: 130000,
      category: "subscription",
      paymentMethod: "우리카드",
      day: 12,
      scope: "fixed",
      owner: "joint",
      start: "2020-01-01",
      end: "",
      merchantPattern: "가상통신",
      changes: [],
      protected: false,
    },
  ];
  s.goals = [
    {
      id: "demo-goal",
      name: "함께 떠나는 여행",
      target: 3000000,
      saved: 1250000,
      monthly: 450000,
      start: "2020-01",
      end: "",
    },
  ];
  const categories = [
    "groceries",
    "dining",
    "transport",
    "child",
    "shopping",
    "groceries",
    "cafe",
    "leisure",
  ];
  const merchants = [
    "동네 식료품점",
    "주말의 식탁",
    "도시 교통",
    "작은 책방",
    "생활 소품",
    "싱싱한 마켓",
    "따뜻한 커피",
    "동네 영화관",
  ];
  const amounts = [56400, 42500, 18400, 32000, 76000, 68300, 9800, 28000];
  let index = 0;
  const add = (
    date,
    merchant,
    amount,
    category,
    owner,
    scope,
    paymentMethod = "공동카드",
    extras = {},
  ) => {
    const id = `demo-${index++}`;
    s.transactions.push({
      id,
      sourceId: id,
      owner,
      date,
      datetime: date + "T12:30:00",
      merchantRaw: merchant,
      merchantNormalized: merchant,
      amount,
      direction: "expense",
      category,
      scope,
      paymentMethod,
      sourceType: "sample",
      note: "가상 데이터",
      recurringId: null,
      performanceStatus: "unknown",
      excluded: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      ...extras,
    });
  };
  for (const offset of [-3, -2, -1, 0]) {
    const m = shiftMonth(currentMonth(), offset),
      end = offset === 0 ? Number(today().slice(8)) : daysInMonth(m);
    add(
      m + "-01",
      "가상 월급",
      5800000,
      "other",
      "joint",
      "shared",
      "공동계좌",
      { direction: "income" },
    );
    for (let day = 1; day <= end; day++) {
      const i = day % 8;
      add(
        `${m}-${String(day).padStart(2, "0")}`,
        merchants[i],
        amounts[i] + (offset === -1 ? -1000 : 0),
        categories[i],
        day % 2 ? "p1" : "p2",
        "shared",
        day % 4 === 0 ? "우리카드" : "공동카드",
        { performanceStatus: day % 4 === 0 ? "eligible" : "unknown" },
      );
    }
    for (const r of s.recurring)
      if (r.day <= end)
        add(
          `${m}-${String(r.day).padStart(2, "0")}`,
          r.merchantPattern,
          r.amount,
          r.category,
          "joint",
          "fixed",
          r.paymentMethod,
          {
            recurringId: r.id,
            performanceStatus:
              r.paymentMethod === "우리카드" ? "eligible" : "unknown",
          },
        );
    add(m + "-03", "가상 개인 서점", 78000, "leisure", "p1", "p1", "개인카드");
    add(m + "-04", "가상 개인 카페", 46000, "dining", "p2", "p2", "개인카드");
    if (end >= 7)
      add(
        m + "-07",
        "생활 소품 환불",
        12000,
        "shopping",
        "p2",
        "shared",
        "공동카드",
        { direction: "refund" },
      );
    if (end >= 10)
      add(
        m + "-10",
        "카드대금 납부",
        980000,
        "finance",
        "joint",
        "excluded",
        "공동계좌",
        { direction: "transfer", excluded: true },
      );
  }
  return s;
}
