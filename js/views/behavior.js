import { moneyHome } from "./money.js";
import { dashboard, dayStatus } from "../behavior.js";
import { periodLabel, addDays } from "../period.js";
import { won, shortWon, escape as e, today, shiftMonth } from "../format.js";
import { button, sectionTitle, icon, transactionRow, progress } from "../ui.js";
import { memberName } from "../../data/defaults.js";

export function paceChart(b) {
  const max = Math.max(1, b.budget, ...b.chart.map((x) => x.actual || 0));
  const x = (i) => 88 + (i / (b.chart.length - 1 || 1)) * 548,
    y = (v) => 190 - (Math.max(0, v) / max) * 154;
  const points = (key) =>
    b.chart
      .map((c, i) =>
        c[key] === null ? null : `${x(i).toFixed(1)},${y(c[key]).toFixed(1)}`,
      )
      .filter(Boolean)
      .join(" ");
  return `<div class="pace-chart"><svg viewBox="0 0 666 226" role="img" aria-label="운영월 누적 소비. 실선은 실제, 점선은 계획"><g class="chart-grid">${[0, 0.5, 1].map((v) => `<line x1="88" x2="636" y1="${y(max * v)}" y2="${y(max * v)}"/><text x="80" y="${y(max * v) + 4}" text-anchor="end">${Math.round((max * v) / 10000)}만</text>`).join("")}</g><polyline class="plan-line" points="${points("planned")}"/><polyline class="actual-line ${b.delta < 0 ? "over" : ""}" points="${points("actual")}"/><text x="88" y="216">${b.p.start.slice(5).replace("-", ".")}</text><text x="636" y="216" text-anchor="end">${b.p.end.slice(5).replace("-", ".")}</text></svg><div class="chart-legend"><span><i class="actual-key"></i>실제</span><span><i class="plan-key"></i>계획</span></div></div>`;
}

const SHARE_COLORS = [
  "#0b67b2",
  "#12a18a",
  "#e49a2f",
  "#8268c9",
  "#d86672",
];

function categorySharePanel(b) {
  const rows = b.categories
    .filter((c) => c.used > 0)
    .sort((a, b) => b.used - a.used);
  const total = rows.reduce((sum, c) => sum + c.used, 0);
  if (!total)
    return `<section class="card category-share-panel full-width">${sectionTitle("어디에 쓰고 있나", "이번 운영월 변동소비")}<div class="category-share-empty"><div class="category-donut empty" role="img" aria-label="변동소비 기록 없음"><div><strong>0원</strong><span>기록 대기</span></div></div><p>지출을 입력하면 카테고리 비중을 자동으로 정리해 줄게.</p></div></section>`;

  const visible = rows.slice(0, 4).map((c) => ({
    id: c.id,
    ids: [c.id],
    name: c.name,
    used: c.used,
  }));
  const remainder = rows.slice(4);
  const other = remainder.reduce((sum, c) => sum + c.used, 0);
  if (other > 0)
    visible.push({
      id: "",
      ids: remainder.map((c) => c.id),
      name: "기타",
      used: other,
    });

  let cursor = 0;
  const items = visible.map((item, index) => {
    const percent = (item.used / total) * 100;
    const start = cursor;
    cursor += percent;
    return {
      ...item,
      color: SHARE_COLORS[index % SHARE_COLORS.length],
      percent,
      start,
      end: index === visible.length - 1 ? 100 : cursor,
    };
  });
  const stops = items
    .map(
      (item) =>
        `${item.color} ${item.start.toFixed(2)}% ${item.end.toFixed(2)}%`,
    )
    .join(", ");
  const label = items
    .map((item) => `${item.name} ${Math.round(item.percent)}%`)
    .join(", ");

  return `<section class="card category-share-panel full-width">${sectionTitle("어디에 쓰고 있나", "이번 운영월 변동소비")}<div class="category-share-body"><div class="category-donut" style="--donut:${stops}" role="img" aria-label="${e(label)}"><div><strong>${won(total)}</strong><span>변동소비</span></div></div><div class="category-share-list">${items
    .map(
      (item) =>
        `<button type="button" class="category-share-item" data-action="category-transactions" ${item.id ? `data-filter-category="${e(item.id)}"` : `data-filter-categories="${e(item.ids.join(","))}"`} data-filter-label="${e(item.name)}" aria-label="${e(item.name)} 지출 상세내역 보기"><i style="--slice:${item.color}"></i><span><strong>${e(item.name)}</strong><small>${won(item.used)}</small></span><b>${item.percent >= 10 ? Math.round(item.percent) : item.percent.toFixed(1)}%</b>${icon("chevron", "category-share-chevron")}</button>`,
    )
    .join("")}</div></div></section>`;
}

function closePanel(state, d) {
  return `<section class="card close-panel">${sectionTitle("오늘 기록", today().replaceAll("-", "."))}<div class="close-summary"><strong>${won(d.total)}</strong><span>${d.count}건</span></div>${d.closed ? `<div class="closed-state">${icon("check")}기록 완료</div>` : `<p>오늘 소비를 다 적었으면 마감해 줘.</p><div class="close-actions">${button("기록 완료", "close-day", "primary", "check")}${button("빠진 소비", "quick-expense", "secondary")}${!d.count ? button("무지출", "zero-day", "text") : ""}</div>`}<button class="weekly-link" data-action="weekly-check">${icon("repeat")}주간 누락 확인 ${icon("chevron")}</button></section>`;
}

export function controlHome(state, month) {
  return moneyHome(state, month, {
    categoryPanel: categorySharePanel,
    paceChart,
    closePanel: s => closePanel(s, dayStatus(s, today())),
  });
}

function analysisBrief(state, b, h) {
  const insights = [];
  const topCut = b.cuts[0],
    topCategory = b.categories
      .filter((c) => c.used > 0)
      .sort((a, b) => b.used - a.used)[0],
    small = h.small?.[0];
  if (topCut)
    insights.push({
      title: `${topCut.name} 조절 효과가 가장 커`,
      text: `현재 속도 기준 약 ${won(topCut.reduce)} 줄이면 목표에 가까워져.`,
    });
  else if (b.pace !== null)
    insights.push({
      title: b.pace > 5 ? "소비속도가 계획보다 빠른 편" : "소비속도는 계획 범위",
      text: `현재 계획 대비 ${Math.abs(b.pace)}% ${b.pace > 0 ? "빠르게" : "여유 있게"} 쓰고 있어.`,
    });
  if (topCategory)
    insights.push({
      title: `가장 큰 소비는 ${topCategory.name}`,
      text: `이번 운영월 ${won(topCategory.used)} 사용했어.`,
    });
  if (h.patterns.weekend > h.patterns.weekday * 1.2 && h.patterns.weekend > 0)
    insights.push({
      title: "주말 소비가 평일보다 높은 편",
      text: `주말 하루 평균 ${won(h.patterns.weekend)}, 평일 ${won(h.patterns.weekday)}이야.`,
    });
  if (small)
    insights.push({
      title: "작지만 자주 나가는 소비가 있어",
      text: `${state.settings.privacy && ["p1", "p2"].includes(small.scope) ? "개인 소액소비" : small.merchant} ${small.count}회 · ${won(small.total)}`,
    });
  if (!insights.length)
    insights.push({
      title: "아직 뚜렷한 이상 패턴은 없어",
      text: "기록이 더 쌓이면 변화를 자동으로 찾아줄게.",
    });
  return `<section class="card analysis-brief full-width"><div class="smart-badge">자동 분석</div><div class="analysis-brief-list">${insights.slice(0, 3).map((item) => `<div><strong>${e(item.title)}</strong><p>${e(item.text)}</p></div>`).join("")}</div></section>`;
}

export function controlAnalysis(state, month) {
  const b = dashboard(state, month),
    h = b.history,
    prev = dashboard(state, shiftMonth(month, -1));
  const catMax = Math.max(1, ...b.categories.map((c) => c.used));
  const line = (l, v) =>
    `<div class="between data-line"><span>${e(l)}</span><strong>${won(v)}</strong></div>`;

  return `<div class="page-intro compact-page-intro"><div><h1>분석</h1><p>리치콕이 먼저 요약하고, 필요할 때만 자세히 봐.</p></div>${button("자료 가져오기", "go-import", "secondary", "upload")}</div>
    <section class="card baseline-header compact-baseline"><div><span class="eyebrow">분석 기준</span><h2>${h.selected.start.replaceAll("-", ".")} – ${h.selected.end.replaceAll("-", ".")}</h2><p>${h.usable ? "3개월 자료 확인 완료" : "3개월 자료를 확인하면 추천 정확도가 올라가."}</p></div><div class="action-buttons">${button("기간 수정", "baseline-settings", "text")}${button(h.usable ? "추천 목표" : "자료 확인", h.usable ? "recommend-goals" : "baseline-settings", "primary")}</div></section>
    <div class="analysis-layout">
      ${analysisBrief(state, b, h)}
      <div class="analysis-metrics compact-metrics">${[
        ["생활수입 평균", h.income],
        ["고정지출 평균", h.fixed],
        ["변동지출 평균", h.variable],
        ["현재월 지출", b.b.spent],
      ].map(([l, v]) => `<div><span>${l}</span><strong>${won(v)}</strong></div>`).join("")}</div>
      <section class="card full-width">${sectionTitle("카테고리별 소비", "이번 운영월 · 큰 항목부터")}<div class="category-bars">${b.categories
        .filter((c) => c.used)
        .sort((a, b) => b.used - a.used)
        .slice(0, 7)
        .map(
          (c) =>
            `<div><div class="between"><strong>${e(c.name)}</strong><span>${won(c.used)}</span></div><div class="analysis-bar"><span style="width:${(Math.max(0, c.used) / catMax) * 100}%"></span></div><small class="muted">3개월 평균 ${won(h.categories.find((a) => a.id === c.id)?.mean || 0)}${c.target !== undefined ? " · 목표 " + won(c.target) : ""}</small></div>`,
        )
        .join("") || "<p>기록된 변동지출이 없어.</p>"}</div></section>
      <details class="detail-disclosure full-width">
        <summary><span><strong>상세 패턴 보기</strong><small>소비곡선 · 요일 · 반복소비 · 결제수단</small></span>${icon("chevron")}</summary>
        <div class="analysis-detail-grid">
          <section class="card">${sectionTitle("소비곡선", b.history.usable ? "우리집 과거패턴 반영" : "임시 계획선")}${paceChart(b)}${line("이전 운영월 지출", prev.b.spent)}${line("이번 운영월 지출", b.b.spent)}</section>
          <section class="card">${sectionTitle("언제 많이 쓸까?")}${line("평일 하루 평균", h.patterns.weekday)}${line("주말 하루 평균", h.patterns.weekend)}${line("급여일 전 3일", h.patterns.before)}${line("급여일~3일 뒤", h.patterns.after)}</section>
          <section class="card">${sectionTitle("자주 새는 소액소비")}${h.small.map((x) => line(`${state.settings.privacy && ["p1", "p2"].includes(x.scope) ? "개인 소액소비" : x.merchant} · ${x.count}회`, x.total)).join("") || "<p>해당 패턴이 없어.</p>"}</section>
          <section class="card">${sectionTitle("반복결제 후보")}${h.recurring.slice(0, 6).map((x) => `<div class="between data-line"><span>${e(state.settings.privacy && ["p1", "p2"].includes(x.scope) ? "개인 반복결제" : x.merchant)}<small class="muted"> · ${x.count}회</small></span><strong>${won(x.amount)}</strong></div>`).join("") || "<p>반복결제 후보가 없어.</p>"}${button("고정비 관리", "recurring-list", "text")}</section>
          <section class="card">${sectionTitle("결제수단별 순지출")}${h.payments.map((x) => line(x.name, x.total)).join("") || "<p>자료가 없어.</p>"}</section>
          <section class="card">${sectionTitle("구성원별 소비")}${h.owners.map((o) => line(memberName(o.owner, state), o.total)).join("")}<p class="small muted">보험금·가족 간 이체·캐시백·예금이자는 생활수입에서 제외해.</p></section>
        </div>
      </details>
    </div>`;
}

export function planHeader(state, month) {
  const b = dashboard(state, month);
  return `<div class="page-intro compact-page-intro"><div><h1>상세 계획</h1><p>${periodLabel(b.p)} · 필요할 때만 조정해.</p></div>${button("목표 수정", "behavior-plan", "primary")}</div><section class="plan-top simplified-plan-top"><div><span>변동지출 목표</span><strong>${won(b.requested)}</strong></div><div><span>목표저축</span><strong>${won(b.savingsTarget)}</strong></div><div class="action-buttons">${button("추천 목표", "recommend-goals", "secondary")}${button("운영월·급여일", "period-settings", "secondary")}${button("수입 수정", "month-income", "text")}</div></section>`;
}
