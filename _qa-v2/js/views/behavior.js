import { dashboard, dayStatus } from "../behavior.js";
import { baselineAnalysis } from "../baseline.js";
import { periodLabel, addDays } from "../period.js";
import { won, shortWon, escape as e, today, shiftMonth } from "../format.js";
import { button, sectionTitle, icon, transactionRow, progress } from "../ui.js";
import { memberName } from "../../data/defaults.js";

export function paceChart(b) {
  const max = Math.max(1, b.budget, ...b.chart.map((x) => x.actual || 0));
  const x = (i) => 56 + (i / (b.chart.length - 1 || 1)) * 584,
    y = (v) => 190 - (Math.max(0, v) / max) * 154;
  const points = (key) =>
    b.chart
      .map((c, i) =>
        c[key] === null ? null : `${x(i).toFixed(1)},${y(c[key]).toFixed(1)}`,
      )
      .filter(Boolean)
      .join(" ");
  return `<div class="pace-chart"><svg viewBox="0 0 666 226" role="img" aria-label="운영월 누적 소비. 실선은 실제, 점선은 계획"><g class="chart-grid">${[0, 0.5, 1].map((v) => `<line x1="56" x2="640" y1="${y(max * v)}" y2="${y(max * v)}"/><text x="48" y="${y(max * v) + 4}" text-anchor="end">${Math.round((max * v) / 10000)}만</text>`).join("")}</g><polyline class="plan-line" points="${points("planned")}"/><polyline class="actual-line ${b.delta < 0 ? "over" : ""}" points="${points("actual")}"/><text x="56" y="216">${b.p.start.slice(5).replace("-", ".")}</text><text x="640" y="216" text-anchor="end">${b.p.end.slice(5).replace("-", ".")}</text></svg><div class="chart-legend"><span><i class="actual-key"></i>실제 변동지출</span><span><i class="plan-key"></i>계획 누적</span></div></div>`;
}
export function controlHome(state, month) {
  const b = dashboard(state, month),
    d = dayStatus(state, today()),
    yesterday = addDays(today(), -1),
    yd = dayStatus(state, yesterday);
  const unclosed =
    !yd.closed && yesterday >= (state.settings.trackingSince || today());
  const planned = b.requested > 0 || b.savingsTarget > 0;
  const negative = b.delta < 0;
  const recent = [...b.b.tx]
    .sort((a, b) => (b.datetime || b.date).localeCompare(a.datetime || a.date))
    .slice(0, 3);
  return `<div class="control-grid">
    <section class="control-hero ${negative ? "is-over" : ""}" aria-labelledby="control-title"><div class="between"><span class="eyebrow">${periodLabel(b.p)} · 소비 페이스</span><button class="icon-button light" data-action="pace-calculation" aria-label="소비속도 계산 근거">${icon("info")}</button></div><h2 id="control-title">${planned ? `이번 운영월 ${negative ? "덜" : "더"} 써도 되는 돈`.replace("덜 써도", "덜 써야") : "우리집 소비목표를 정해 줘"}</h2><div class="control-amount">${planned ? (negative ? "−" : "+") + won(Math.abs(b.delta)) : "목표 설정"}</div><p class="hero-meaning">${!planned ? "목표를 정하면 지금 소비속도를 바로 알려줄게." : b.pace === null ? "오늘부터 계획에 맞춰 기록해 보자." : b.pace === 0 ? "현재 계획한 소비속도와 같아." : `현재 계획보다 ${Math.abs(b.pace)}% ${b.pace > 0 ? "많이" : "적게"} 쓰고 있어.`}</p><div class="hero-today"><div><span>${b.todayAvailable < 0 ? "오늘 권장액 초과" : "오늘 추가로 쓸 수 있는 돈"}</span><strong>${won(Math.abs(b.todayAvailable))}</strong></div><div class="hero-today-side"><span>오늘 변동지출</span><b>${won(b.todaySpent)}</b></div></div><div class="hero-foot"><span>계획 누적 ${shortWon(b.planned)}</span><span>실제 ${shortWon(b.actual)}</span></div>${!planned ? button("소비·저축 목표 설정", "behavior-plan", "light-button") : ""}</section>
    <section class="card saving-panel"><div class="section-heading"><div><span class="eyebrow">목표저축</span><h2>${won(b.savingsTarget)}</h2></div>${button("수정", "behavior-plan", "text")}</div><span class="saving-state ${b.status === "달성 가능" ? "on-track" : "at-risk"}">${b.status === "달성 가능" ? icon("check") : icon("info")}${planned ? b.status : "목표 설정 필요"}</span><div class="saving-projection"><span>현재 속도 기준 예상저축</span><strong>${won(b.projectedSavings)}</strong></div>${progress(Math.max(0, b.projectedSavings), b.savingsTarget)}<p class="small muted">${b.provisional ? "잠정 예상 · 초기 기록 또는 미마감일을 확인해 줘." : "입력한 거래가 모두 반영된 경우의 예상이야."}</p><div class="plan-summary"><button data-action="month-income"><span>운영월 수입</span><strong>${won(b.b.income)} ${icon("chevron")}</strong></button><button data-action="recurring-list"><span>고정·반복비</span><strong>${won(b.fixed)} ${icon("chevron")}</strong></button></div></section>
    ${b.requested > b.affordability ? `<div class="notice warning full-width"><strong>계획 합계가 수입보다 ${won(b.requested - b.affordability)} 많아.</strong><p>고정비와 목표저축을 남기기 위해 실제 변동비 한도는 ${won(b.budget)}으로 계산했어. 수입이나 목표를 조정해 줘.</p>${button("목표 조정", "behavior-plan", "secondary")}</div>` : ""}
    ${unclosed ? `<div class="unclosed-banner full-width"><div>${icon("calendar")}<span><strong>어제 소비기록이 아직 마감되지 않았어.</strong><small>${Number(yesterday.slice(5, 7))}월 ${Number(yesterday.slice(8))}일 · ${won(yd.total)} / ${yd.count}건</small></span></div><div><button class="btn secondary" data-action="quick-expense" data-date="${yesterday}">빠진 소비</button><button class="btn primary" data-action="close-day" data-date="${yesterday}">마감하기</button></div></div>` : ""}
    <section class="card actions-panel">${sectionTitle("이번 운영월, 여기서 조절해", "현재 속도로 끝까지 쓸 경우의 예상 초과액")}${
      b.cuts.length
        ? b.cuts
            .slice(0, 3)
            .map(
              (c, i) =>
                `<div class="action-row"><span class="rank">${i + 1}</span><div><strong>${e(c.name)}</strong><small>${c.used > (c.target || 0) ? `운영월 목표보다 ${won(c.used - c.target)} 초과` : `현재 ${won(c.used)} / 목표 ${won(c.target)}`}</small></div><b class="negative">−${won(c.reduce)}</b></div>`,
            )
            .join("")
        : `<div class="calm-message">${icon("check")}<div><strong>${b.categories.some((c) => c.target !== undefined) ? "설정한 항목은 조절할 초과가 없어." : "카테고리 목표를 정하면 더 구체적으로 알려줄게."}</strong><p>${b.categories.some((c) => c.target !== undefined) ? "필요한 소비는 정한 목표 안에서 이어가도 돼." : "3개월 추천을 적용하거나 계획에서 항목별 목표를 입력해 줘."}</p></div></div>`
    }${b.recovery ? `<div class="recovery"><strong>목표로 돌아오려면</strong><p>내일부터 계획보다 하루 평균 <b>${won(b.recovery)}</b> 덜 쓰면 돼.</p></div>` : b.delta < 0 ? '<div class="recovery"><strong>운영월이 끝났어. 다음 운영월 목표를 조정해 줘.</strong></div>' : ""}</section>
    <section class="card room-panel">${sectionTitle("목표 안에서 써도 괜찮아", "항목별 남은 전체 예산 · 오늘 허용액과는 달라")}${
      b.room.length
        ? b.room
            .slice(0, 3)
            .map(
              (c) =>
                `<div class="room-row"><span class="category-icon">${icon(c.icon)}</span><div><strong>${e(c.name)}</strong><small>${c.protected ? "필요한 소비 유지" : "계획 범위 안"} · ${won(c.used)} 사용</small></div><b>+${won(c.remaining)}</b></div>`,
            )
            .join("")
        : '<p class="empty-inline">설정한 카테고리 예산 안에서 여유가 생기면 표시할게.</p>'
    }<div class="between budget-remaining"><span>변동지출 전체 잔여</span><strong>${won(b.remaining)}</strong></div><p class="small muted">항목별 잔여를 합쳐 더 쓰는 뜻은 아니야. 전체 잔여와 오늘 권장액을 함께 확인해 줘.</p></section>
    <section class="card curve-panel">${sectionTitle("우리집 소비곡선", b.history.usable ? "확인한 3개월 패턴 반영" : "자료 확인 전 · 날짜별 균등 계획", button("분석", "go-analytics", "text"))}${paceChart(b)}<div class="curve-summary"><span>운영월 예상 총지출 <strong>${won(b.forecast)}</strong></span><span>${b.future}일 남음</span></div></section>
    <section class="card close-panel">${sectionTitle("하루 마감", today().replaceAll("-", "."))}<div class="close-summary"><strong>${won(d.total)}</strong><span>${d.count}건 기록</span></div>${d.closed ? `<div class="closed-state">${icon("check")}오늘 기록 완료${d.record.mode === "zero" ? " · 무지출 확인" : ""}</div><p class="small muted">기록이 바뀌면 다시 확인할 수 있게 마감이 풀려.</p>` : `<p>오늘 두 사람의 소비, 빠진 건 없을까?</p><div class="close-actions">${button("오늘 기록 완료", "close-day", "primary", "check")}${button("빠진 소비 입력", "quick-expense", "secondary")}${!d.count ? button("오늘은 무지출", "zero-day", "text") : ""}</div>`}<button class="weekly-link" data-action="weekly-check">${icon("repeat")}주 1회 · 카드 누적액으로 누락 확인 ${icon("chevron")}</button></section>
    <section class="card recent-card full-width">${sectionTitle("최근 기록", "", button("전체 기록", "go-transactions", "text"))}${recent.map((t) => transactionRow(t, state)).join("") || '<p class="empty-inline">홈의 +지출을 눌러 첫 소비를 기록해 줘.</p>'}</section></div>`;
}

export function controlAnalysis(state, month) {
  const b = dashboard(state, month),
    h = b.history,
    prev = dashboard(state, shiftMonth(month, -1));
  const catMax = Math.max(1, ...b.categories.map((c) => c.used));
  const line = (l, v) =>
    `<div class="between data-line"><span>${e(l)}</span><strong>${won(v)}</strong></div>`;
  return `<div class="page-intro"><div><h1>분석</h1><p>소비가 몰리는 때와 줄일 수 있는 항목을 찾아봐.</p></div>${button("3개월 기준 설정", "baseline-settings", "secondary")}</div><section class="card baseline-header"><div><span class="eyebrow">초기 소비패턴 분석</span><h2>${h.selected.start.replaceAll("-", ".")} – ${h.selected.end.replaceAll("-", ".")}</h2><p>${h.usable ? "전체 자료 확인 완료 · 실제 기록을 기준으로 분석했어." : "전체 3개월 자료를 확인해야 추천 목표와 소비곡선을 사용할 수 있어."}</p></div><div class="action-buttons">${button("파일 가져오기", "go-import", "secondary", "upload")}${button(h.usable ? "추천 목표 보기" : "자료 확인", "" + (h.usable ? "recommend-goals" : "baseline-settings"), "primary")}</div></section><div class="analysis-metrics">${[
    ["월평균 실제수입", h.income],
    ["평균 고정지출", h.fixed],
    ["평균 변동지출", h.variable],
    ["평균 저축 가능액", h.savings],
  ]
    .map(([l, v]) => `<div><span>${l}</span><strong>${won(v)}</strong></div>`)
    .join(
      "",
    )}</div><p class="small muted">${h.usable ? "확인한 3개월" : "선택한 기간에 입력된 자료만"} 기준. 일회성 월평균 ${won(h.oneoff)} 포함 시 현재 패턴의 예상저축은 ${won(h.savings)}이야. 저축 이체 자체를 저축 실적으로 추정하지 않아.</p>
    <div class="two-column"><section class="card">${sectionTitle("현재 운영월 소비곡선", b.history.usable ? "우리집 소비패턴 반영" : "분석자료 확인 전 임시 균등선")}${paceChart(b)}${line("이전 운영월 전체 지출", prev.b.spent)}${line("이번 운영월 현재 지출", b.b.spent)}<p class="small muted">서로 기간 길이가 달라 단순 증감률로 비교하지 않아.</p></section><section class="card">${sectionTitle("카테고리별 소비", "개인·공동 변동지출 합계")}<div class="category-bars">${
      b.categories
        .filter((c) => c.used)
        .map(
          (c) =>
            `<div><div class="between"><strong>${e(c.name)}</strong><span>${won(c.used)}</span></div><div class="analysis-bar"><span style="width:${(Math.max(0, c.used) / catMax) * 100}%"></span></div><small class="muted">3개월 월평균 ${won(h.categories.find((a) => a.id === c.id)?.mean || 0)}${c.target !== undefined ? " · 목표 " + won(c.target) : ""}</small></div>`,
        )
        .join("") || "<p>기록된 변동지출이 없어.</p>"
    }</div></section>
    <section class="card">${sectionTitle("어느 때 많이 쓸까?", "완전한 자료에서 기록이 없는 날은 무지출로 계산")}${line("평일 하루 평균", h.patterns.weekday)}${line("주말 하루 평균", h.patterns.weekend)}${line("급여일 전 3일 평균", h.patterns.before)}${line("급여일~3일 뒤 평균", h.patterns.after)}<h3 class="subheading">운영월 주차별 하루 평균</h3>${h.patterns.weeks.map((v, i) => line(`${i + 1}주차`, v)).join("")}<p class="small muted">급여일은 계획의 운영월 설정에서 바꿀 수 있어.</p></section>
    <section class="card">${sectionTitle("덜 부담스럽게 줄일 항목", "조절 가능 항목의 월평균 − 과거 최소월")}${
      h.categories
        .filter((c) => c.room > 0)
        .sort((a, b) => b.room - a.room)
        .slice(0, 5)
        .map((c) => line(c.name, c.room))
        .join("") || "<p>확인된 절감 여지가 아직 없어.</p>"
    }<h3 class="subheading">우선 유지할 항목</h3><p>${
      h.categories
        .filter((c) => c.protected && c.mean)
        .map((c) => e(c.name))
        .join(" · ") || "육아 · 의료 · 주거 · 금융 · 교통"
    }</p><p class="small muted">절감 난도는 항목 성격에 따른 분류야. 필요성과 최종 목표는 직접 판단해 줘.</p></section>
    <section class="card">${sectionTitle("자주 새는 소액 소비", "1만원 이하 결제 · 기간 중 3회 이상")}${h.small.map((x) => line(`${state.settings.privacy && ["p1", "p2"].includes(x.scope) ? "개인 소액 소비" : x.merchant} · ${x.count}회`, x.total)).join("") || "<p>이 조건에 해당하는 반복소비가 없어.</p>"}</section><section class="card">${sectionTitle("반복 결제 후보", "2개월 이상 · 비슷한 금액 · 자동 고정비 확정 아님")}${h.recurring.map((x) => `<div class="between data-line"><span>${e(state.settings.privacy && ["p1", "p2"].includes(x.scope) ? "개인 반복 결제" : x.merchant)}<small class="muted"> · ${x.count}회${x.registered ? " · 연결됨" : ""}</small></span><strong>${won(x.amount)}</strong></div>`).join("") || "<p>비슷한 금액으로 반복된 결제가 없어.</p>"}${button("고정비 확인·등록", "recurring-list", "text")}</section>
    <section class="card">${sectionTitle("결제수단별 순지출", "간편결제 경로를 별도 소비로 합산하지 않아")}${h.payments.map((x) => line(x.name, x.total)).join("") || "<p>자료가 없어.</p>"}</section><section class="card">${sectionTitle("두 사람의 소비", "기록의 사용자 기준")}${h.owners.map((o) => line(memberName(o.owner, state), o.total)).join("")}<h3 class="subheading">3개월 실제 기록</h3>${h.monthly.map((m) => line(`${m.month} · 저축 가능액`, m.saving)).join("")}</section></div>`;
}

export function planHeader(state, month) {
  const b = dashboard(state, month);
  return `<div class="page-intro"><div><h1>계획</h1><p>${periodLabel(b.p)} · 두 사람이 함께 지킬 소비·저축 목표</p></div>${button("목표 수정", "behavior-plan", "primary")}</div><section class="plan-top"><div><span>변동지출 목표</span><strong>${won(b.requested)}</strong></div><div><span>목표저축</span><strong>${won(b.savingsTarget)}</strong></div><div class="action-buttons">${button("리치콕 추천 목표", "recommend-goals", "secondary")}${button("운영월·급여일", "period-settings", "secondary")}${button("수입 수정", "month-income", "text")}</div></section>`;
}
