import { monthBudget } from "../budget.js";
import { won, escape as e, shortWon } from "../format.js";
import { button, sectionTitle, progress, icon } from "../ui.js";
export function budgetView(state, month) {
  const b = monthBudget(state, month);
  const rows = [
    ["공동생활비", b.shared, b.plan.sharedBudget, "home"],
    ...["p1", "p2"].map((p) => [
      `${state.settings.members[p]} 용돈`,
      b.personal[p],
      b.plan.personalBudgets[p],
      "wallet",
    ]),
  ];
  return `<div class="page-intro"><div><h1>예산</h1><p>얼마나 썼는지보다, 얼마나 남았는지.</p></div>${button("이번 달 예산 편집", "edit-budget", "primary")}</div><div class="budget-overview">${rows.map(([name, used, target, i]) => `<section class="card allowance-card"><div class="between"><h2>${e(name)}</h2>${icon(i)}</div><span class="muted small">남은 돈</span><strong class="allowance-value ${target - used < 0 ? "negative" : ""}">${won(target - used)}</strong>${progress(used, target)}<div class="between small muted"><span>${shortWon(used)} 사용</span><span>${shortWon(target)} 예산</span></div></section>`).join("")}</div><div class="two-column"><section class="card">${sectionTitle("카테고리별 생활비", "공동생활비와 공동고정비만 표시해요")}${b.categories
    .filter((c) => !c.archived || c.used)
    .map(
      (c) =>
        `<div class="category-budget-row"><span class="category-icon tone-${e(c.id)}">${icon(c.icon)}</span><div><div class="between"><strong>${e(c.name)}</strong><span>${c.budget ? `${won(c.budget - c.used)} 남음` : "예산 미설정"}</span></div>${progress(c.used, c.budget)}<div class="between small muted"><span>${won(c.used)} 사용</span><span>${c.budget ? won(c.budget) : "—"}</span></div></div></div>`,
    )
    .join(
      "",
    )}</section><div class="stack"><section class="card">${sectionTitle("고정·반복비", `예정 포함 ${won(b.fixed)}`, button("추가", "add-recurring", "text", "plus"))}${b.recurring.map((r) => `<button class="settings-row" data-recurring="${e(r.id)}"><span class="schedule-day">${Number(r.date.slice(8))}<small>일</small></span><span><strong>${e(r.name)}</strong><small>${r.paid ? "결제 연결 완료" : `${won(r.outstanding)} 미결제 예정`}${r.protected ? " · 유지할 고정비" : ""}</small></span><strong>${won(r.amount)}</strong>${icon("chevron")}</button>`).join("") || '<p class="empty-inline">매달 나가는 비용을 추가해 보세요.</p>'}</section><section class="card">${sectionTitle("함께 모으는 목표", "월 배정액은 사용 가능 금액에서 먼저 빼요", button("추가", "add-goal", "text", "plus"))}${state.goals.map((g) => `<button class="goal-row" data-goal="${e(g.id)}"><div class="between"><strong>${e(g.name)}</strong>${icon("chevron")}</div><span class="goal-value">${shortWon(g.saved)} <small>/ ${shortWon(g.target)}</small></span>${progress(g.saved, g.target)}<span class="small muted">매달 ${won(g.monthly)} 배정 · 모은 금액은 직접 관리</span></button>`).join("") || '<p class="empty-inline">비상금, 여행 등 우리집 목표를 정해요.</p>'}</section></div></div>`;
}
