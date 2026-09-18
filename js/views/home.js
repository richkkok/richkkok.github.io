import { analyze } from "../analytics.js";
import { won, shortWon, escape as e } from "../format.js";
import {
  icon,
  button,
  progress,
  sectionTitle,
  transactionRow,
  empty,
} from "../ui.js";
export function homeView(state, month) {
  const a = analyze(state, month),
    b = a.now,
    recorded = b.tx.length > 0;
  const flows = [
    ["고정·반복비", b.fixed, "fixed"],
    ["사용한 변동비", b.variable, "variable"],
    ["저축 배정", b.goals, "saving"],
    ["사용 가능", Math.max(0, b.available), "available"],
  ];
  const width = flows.reduce((n, f) => n + Math.max(0, f[1]), 0) || 1;
  const recent = b.tx
    .filter((t) => t.direction !== "income")
    .sort((a, b) => b.datetime.localeCompare(a.datetime))
    .slice(0, 4);
  return `<div class="dashboard-grid"><section class="hero-card"><div class="eyebrow">OUR MONEY, TOGETHER</div><div class="hero-head"><h2>이번 달 지금 써도 되는 돈</h2><button class="icon-button light" data-action="calculation" aria-label="사용 가능 금액 계산 보기">${icon("info")}</button></div><div class="hero-amount ${b.available < 0 ? "negative" : ""}">${won(b.available)}</div><p class="hero-caption">${b.remaining ? `${b.remaining}일 남았어요` : "마감된 달이에요"}<span>·</span>${b.plan.incomeMode === "actual" ? "실제 수입 기준" : "계획 수입 기준"}</p><div class="money-flow" aria-label="이번 달 돈 배분">${flows.map(([label, value, cls]) => `<span class="flow-${cls}" style="width:${(Math.max(0, value) / width) * 100}%" title="${e(label)} ${won(value)}"></span>`).join("")}</div><div class="flow-legend">${flows.map(([label, value, cls]) => `<div><span><i class="flow-${cls}"></i>${label}</span><strong>${shortWon(value)}</strong></div>`).join("")}</div><div class="hero-bottom">${icon("calendar")}<span>${a.compared ? `지난달 같은 기간보다 ${won(Math.abs(a.delta))} ${a.delta > 0 ? "더 사용했어요" : a.delta < 0 ? "덜 사용했어요" : "차이가 없어요"}` : "내역을 쌓으면 지난달과 비교해 드려요"}</span></div></section>
  <section class="card household-card">${sectionTitle("함께 정한 생활비", "공동생활비 목표 기준", button("예산 보기", "go-budget", "text", "arrow"))}<div class="budget-hero"><span>남은 생활비</span><strong class="${b.plan.sharedBudget - b.shared < 0 ? "negative" : ""}">${won(b.plan.sharedBudget - b.shared)}</strong></div>${progress(b.shared, b.plan.sharedBudget)}<div class="between small muted"><span>${won(b.shared)} 사용</span><span>목표 ${shortWon(b.plan.sharedBudget)}</span></div><div class="personal-budgets">${["p1", "p2"].map((p) => `<div><span class="avatar">${e(state.settings.members[p].slice(0, 1))}</span><div><strong>${e(state.settings.members[p])} 용돈</strong><small>${shortWon(b.personal[p])} / ${shortWon(b.plan.personalBudgets[p])}</small></div><span class="personal-left">${shortWon(b.plan.personalBudgets[p] - b.personal[p])}<small>남음</small></span></div>`).join("")}</div><p class="privacy-note">${icon("lock")}개인 가맹점은 ${state.settings.privacy ? "숨겨져" : "표시되어"} 있어요</p></section>
  <section class="kpi-strip">${[
    [
      "수입",
      b.income,
      b.plan.incomeMode === "actual" ? "실제 들어온 돈" : "설정한 월수입",
    ],
    ["고정·반복비", b.fixed, "미결제 예정액 포함"],
    ["생활비 사용", b.shared, "공동 변동지출"],
    [
      "예상 잔액",
      b.expectedBalance,
      recorded ? "현재 소비속도 추정" : "설정 기준",
    ],
  ]
    .map(
      ([label, value, hint]) =>
        `<div><span>${label}</span><strong class="${value < 0 ? "negative" : ""}">${shortWon(value)}</strong><small>${hint}</small></div>`,
    )
    .join("")}</section>
  <section class="card card-performance">${sectionTitle(`${b.plan.cardName || "카드"} 실적`, "실적유지용 · 소비에 중복 합산하지 않아요", icon("wallet"))}<div class="between"><strong class="mid-number">${won(b.cardEligible)}</strong><span class="muted">/ ${shortWon(b.plan.cardTarget)}</span></div>${progress(b.cardEligible, b.plan.cardTarget)}<div class="between"><span class="status-pill">${b.cardEligible >= b.plan.cardTarget ? "목표 도달" : `${won(b.plan.cardTarget - b.cardEligible)} 남음`}</span><button class="btn text" data-action="card-transactions">내역 확인 ${icon("arrow")}</button></div><p class="small muted">예상 실적인정액이에요. 미확인 ${won(b.cardUnknown)}은 포함하지 않았어요. 상품 규정은 카드사에서 확인해 주세요.</p></section>
  <section class="card insight-card">${sectionTitle("이번 달 작은 힌트", "확인할 내용만 간단하게")}<div class="insight-list">${a.insights.length ? a.insights.map((x, i) => `<div><span class="insight-index">0${i + 1}</span><div><h3>${e(x.title)}</h3><p>${e(x.text)}</p></div></div>`).join("") : `<div><span class="insight-index">${icon("check")}</span><div><h3>${recorded ? "차분하게 흐름을 쌓고 있어요" : "우리집 돈 흐름을 연결해요"}</h3><p>${recorded ? "비교할 만한 변화가 생기면 여기에 알려드릴게요." : "두 사람의 거래파일을 가져오면 함께 사용한 돈을 한눈에 볼 수 있어요."}</p></div></div>`}</div></section>
  <section class="card recent-card">${sectionTitle("최근 내역", "우리집에 기록된 돈의 움직임", button("전체 보기", "go-transactions", "text", "arrow"))}${recent.length ? recent.map((t) => transactionRow(t, state)).join("") : empty("아직 기록된 내역이 없어요", "파일 한 번으로 이번 달 가계부를 시작해 보세요.", button("내역 가져오기", "go-import", "secondary", "upload"))}</section>
  <section class="card recurring-summary">${sectionTitle("다가오는 고정·반복비", "실제 결제와 연결해 한 번만 계산해요", button("관리", "recurring-list", "text"))}${
    b.recurring
      .filter((r) => r.outstanding > 0)
      .slice(0, 4)
      .map(
        (r) =>
          `<div class="schedule-row"><span class="schedule-day">${Number(r.date.slice(8))}<small>일</small></span><div><strong>${e(r.name)}</strong><small>${e(r.paymentMethod || "결제수단 미정")}</small></div><strong>${won(r.outstanding)}</strong></div>`,
      )
      .join("") || '<p class="empty-inline">남은 예정 결제가 없어요.</p>'
  }</section></div>`;
}
