import { incomeSchedulePanel } from "../income-ui.js";
import { incomeScheduleFor, incomeDate } from "../income-schedule.js";
import { cashHome } from "../cash-ui.js";
import { moneyOverview, reviewRows, classification, registeredPayments, PAYMENT_LABELS, cycleText } from "../money.js";
import { won, escape as e, today, keyText } from "../format.js";
import { button, icon, sectionTitle, transactionRow, hiddenPersonal, progress, select } from "../ui.js";
import { memberName } from "../../data/defaults.js";
import { period, startDay } from "../period.js";
const dateLabel = d => d ? d.replaceAll("-", ".") : "미등록";
const metric = (label, value, help, action = "", cls = "") =>
  `<${action ? 'button type="button"' : "div"} class="money-metric ${cls}" ${action ? `data-action="${e(action)}"` : ""}><span>${e(label)}</span><strong>${e(value)}</strong><small>${e(help || "")}${action ? icon("chevron") : ""}</small></${action ? "button" : "div"}>`;
const link = (label, route, i) => `<a class="money-shortcut" href="#${e(route)}">${icon(i)}<span>${e(label)}</span>${icon("chevron")}</a>`;
export function cycleStrip(s, month) {
  const p = period(month, startDay(s));
  const paydays = incomeScheduleFor(s, month)?.entries.map(r => r.day) || s.settings.salaryDays || [10, 15];
  return `<section class="cycle-strip" aria-label="급여 기준 가계부 기간"><div><span>가계부 집계 기간</span><strong>${e(cycleText(s, month))}</strong></div><div class="cycle-days"><b>시작 ${Number(p.start.slice(8))}일</b><span>→</span><b>마감 ${Number(p.end.slice(8))}일</b><small>급여일 ${[...new Set(paydays)].map(n => `${Number(n)}일`).join(" · ")}</small></div><button type="button" class="btn text" data-action="money-current">이번 기간</button></section>`;
}
export function moneyHome(s, month, extras = {}) {
  const o = moneyOverview(s, month), b = o.d;
  const plannedMode = b.plan.incomeMode !== "actual";
  const recent = [...b.b.tx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const next = o.recurring.filter(r => !r.paid).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  const over = b.remaining < 0;
  return `<div class="money-home">
    <section class="money-hero ${over ? "is-over" : ""}" aria-labelledby="money-title">
      <div class="money-hero-top"><span>${o.current ? "이번 가계부" : b.p.start > today() ? "다가오는 가계부" : "지난 가계부"} · ${e(cycleText(s, month))}</span><button type="button" class="icon-button light" data-action="money-explain" aria-label="남은 예산 계산 근거">${icon("info")}</button></div>
      ${o.stale ? '<span class="money-record-warning">거래자료 갱신 필요 · 기록 기준 계산</span>' : ""}<h2 id="money-title">${over ? "소비 예산을 초과했어요" : "마감까지 남은 소비 예산"}</h2><div class="money-big ${over ? "negative" : ""}">${won(b.remaining)}</div>
      <p>자동이체·고정비와 저축 목표를 먼저 확보한 예산 · <b>두 사람의 남은 용돈 포함</b></p>
      <div class="money-hero-bottom"><div><span>용돈을 남겨둔 공동 생활비</span><strong>${won(o.sharedRemaining)}</strong></div><div><span>${o.daily ? `${o.daily}일 동안 하루 평균` : "마감된 기간"}</span><strong>${o.daily ? won(o.perDay) : "집계 완료"}</strong></div></div>
      <small>${plannedMode ? "계획 수입 기준" : "등록된 생활수입 기준"} · 계좌 잔액이 아닌 가계부 예산이에요.</small>
    </section>
    <section class="card money-summary" aria-label="이번 기간 수입 목표 지출 요약"><div class="money-metrics">
      ${metric("실제 들어온 생활수입", won(b.b.actualIncome), o.grossIncome ? `등록된 입금 합계 ${won(o.grossIncome)}` : "입금 내역 미등록 · 실제 입금 확인 필요", "money-income")}
      ${metric("계획 수입", won(b.plan.income), "실제 입금과 별도로 설정한 금액", "month-income")}
      ${metric("지금까지 쓴 돈", won(b.b.spent), "고정비·용돈 포함 · 환불 차감", "money-spending")}
      ${metric("소비 목표", won(b.requested), "공동 생활비 + 개인용돈", "money-plan")}
      ${metric("저축 목표", won(b.savingsTarget), "실제 저축 완료액과는 달라요", "money-plan")}
      ${metric("자동이체·정기결제 예정", won(o.total), `이번 기간 ${o.recurring.length}건 · 등록 전체 ${s.recurring.length}개`, "go-recurring")}
    </div></section>
    ${cashHome(s)}
    ${incomeSchedulePanel(s, month)}
    ${o.stale ? `<div class="money-alert money-alert-warning" role="status">${icon("info")}<div><strong>거래자료가 최신인지 먼저 확인해 주세요</strong><p>마지막 지출 기록 ${dateLabel(o.latest)}${o.gapDays !== null ? ` · 기준일까지 ${o.gapDays}일 차이` : ""}. 미입력 소비가 있으면 남은 예산이 실제보다 크게 보여요. 기록이 없는 날을 무지출로 단정하지 않아요.</p></div>${button("내역 가져오기", "go-import", "secondary")}</div>` : ""}
    ${b.requested > b.affordability ? `<div class="money-alert money-alert-warning"><div><strong>소비 목표가 수입에서 확보할 수 있는 돈보다 ${won(b.requested - b.affordability)} 많아요.</strong><p>남은 예산은 고정비·저축 목표를 뺀 범위인 ${won(b.budget)} 기준으로 계산해요.</p></div>${button("목표 조정", "money-plan", "secondary")}</div>` : ""}
    <a class="money-review-callout ${o.allPending.length ? "needs-review" : "review-clear"}" href="#review">${icon(o.allPending.length ? "info" : "check")}<div><strong>${o.pending.length ? `분류 확인 ${o.pending.length}건 · ${won(o.pendingAmount)}` : "이번 기간 분류 대기 없음"}</strong><p>전체 기간 확인 대기 <b>${o.allPending.length}건</b> · 분류 전 금액도 이미 지출에 포함돼요.</p></div><span>확인하기 ${icon("chevron")}</span></a>
    <div class="money-shortcuts">${link("목표·용돈 설정", "budget", "wallet")}${link("자동이체 관리", "recurring", "repeat")}${link("분류 확인", "review", "list")}${link("소비 분석", "analytics", "chart")}</div>
    <section class="card money-allowance">${sectionTitle("우리집 생활비와 용돈", "생활비와 용돈은 위 가계부 집계 기간을 함께 사용해요.", button("금액 설정", "money-plan", "text"))}
      <div class="allowance-grid"><div class="allowance-card"><span>공동 생활비</span><h3>${won(o.sharedRemaining)} <small>남음</small></h3>${progress(o.sharedUsed, b.plan.sharedBudget)}<p>사용 ${won(o.sharedUsed)} / 설정 ${won(b.plan.sharedBudget)}</p><small>남은 개인용돈을 별도로 확보한 금액</small></div>${o.allowances.map(p => `<div class="allowance-card"><span>${e(memberName(p.id, s))} 용돈</span><h3 class="${p.remaining < 0 ? "negative" : ""}">${won(p.remaining)} <small>${p.remaining < 0 ? "초과분 포함" : "남음"}</small></h3>${progress(p.used, p.budget)}<p>사용 ${won(p.used)} / 설정 ${won(p.budget)}</p><small>개인 내역의 사용 범위가 용돈인 거래 기준</small></div>`).join("")}</div>
    </section>
    <section class="card money-recurring">${sectionTitle("자동이체·정기결제", "날짜가 지났어도 실제 거래가 없으면 납부 완료로 처리하지 않아요.", button("전체 관리", "go-recurring", "text"))}<div class="money-three">${metric("이번 기간 예정 합계", won(o.total), `${o.recurring.length}건`)}${metric("거래로 확인된 납부", won(o.paid), "연결된 실제 지출에서 환불 차감")}${metric("아직 확인되지 않은 금액", won(o.unpaid), "남은 소비 예산에서 이미 확보한 돈", "go-recurring")}</div>
      <div class="money-due-list">${next.map(r => `<button type="button" class="money-due-row" data-recurring="${e(r.id)}"><span class="due-date">${r.date.slice(5).replace("-", ".")}</span><span><strong>${e(r.name)}</strong><small>${e(PAYMENT_LABELS[r.status])}${r.dayEstimated ? " · 출금일 추정" : ""}</small></span><b>${won(r.outstanding)}</b>${icon("chevron")}</button>`).join("") || '<p class="empty-inline">이 기간에 확인 대기 중인 정기결제가 없어요.</p>'}</div>
    </section>
    <section class="card smart-home-panel money-guide">${sectionTitle("이번 기간 계산 기준", "예정과 실제를 구분해서 확인해요.")}<p>급여 예정일 ${o.salaryDates.map(dateLabel).join(" · ")}. 급여일이 지나도 입금 거래를 등록하거나 가져와야 실제 생활수입에 반영돼요.</p><p>계획 수입 ${won(b.plan.income)} − 고정비 준비 ${won(b.fixed)} − 저축 목표 ${won(b.savingsTarget)}. 소비 목표와 비교해 더 작은 금액을 소비 예산으로 사용해요.</p>${button("계산 상세", "money-explain", "text")}</section>
    ${extras.categoryPanel ? extras.categoryPanel(b) : ""}
    <section class="card money-recent">${sectionTitle("최근 기록", "", button("전체 보기", "go-transactions", "text"))}${recent.map(t => transactionRow(t, s)).join("") || '<p class="empty-inline">이 기간에 등록된 거래가 없어요.</p>'}</section>
    <details class="detail-disclosure"><summary><span><strong>소비곡선·하루 마감</strong><small>기존 상세 분석과 기록 관리</small></span>${icon("chevron")}</summary><div class="detail-grid"><section class="card">${sectionTitle("소비곡선", "기록 누락이 있으면 실제 소비 흐름과 다를 수 있어요.")}${extras.paceChart ? extras.paceChart(b) : ""}</section>${o.current && extras.closePanel ? extras.closePanel(s) : ""}</div></details>
  </div>`;
}
export function recurringView(s, month, f = {}) {
  const o = moneyOverview(s, month), all = f.mode === "all";
  const rows = registeredPayments(s, month).filter(r => (all || r.cycle.length) &&
    (!f.status || r.status === f.status) && (!f.owner || r.owner === f.owner) &&
    (!f.query || keyText([r.name, r.paymentMethod, memberName(r.owner, s)].join(" ")).includes(keyText(f.query))))
    .sort((a, b) => f.sort === "amount" ? (b.cycle[0]?.amount ?? b.amount) - (a.cycle[0]?.amount ?? a.amount) :
      String(a.cycle[0]?.date || a.next?.date || "9999").localeCompare(String(b.cycle[0]?.date || b.next?.date || "9999")));
  return `<div class="money-page"><div class="page-intro"><div><h1>자동이체·정기결제 관리</h1><p>예정·납부·확인 대기를 한곳에서. 은행의 자동이체를 실행하거나 해지하는 기능은 아니에요.</p></div>${button("정기결제 추가", "add-recurring", "primary", "plus")}</div>
    <section class="card"><div class="money-three">${metric("이번 기간 예정", won(o.total), `${o.recurring.length}건`)}${metric("납부 확인", won(o.paid), "연결된 실제 거래 기준")}${metric("미확인·남은 금액", won(o.unpaid), "기록이 없어 연체라고 단정할 수 없어요")}</div></section>
    <div class="money-filters"><label class="search-field">${icon("search")}<input name="recurring-search" type="search" value="${e(f.query || "")}" aria-label="자동이체 검색" placeholder="이름·결제수단 검색"></label>${select("보기", "recurring-mode", [["cycle", "이번 기간 예정"], ["all", `등록 전체 ${s.recurring.length}개`]], f.mode || "cycle")}${select("납부 상태", "recurring-status", [["", "전체 상태"], ...Object.entries(PAYMENT_LABELS), ["outside", "이번 기간 예정 없음"], ["ended", "종료"]], f.status)}${select("담당", "recurring-owner", [["", "전체"], ...["p1", "p2", "joint"].map(p => [p, memberName(p, s)])], f.owner)}${select("정렬", "recurring-sort", [["date", "날짜순"], ["amount", "금액 큰 순"]], f.sort || "date")}</div>
    <div class="money-list-heading"><strong>${rows.length}개 표시</strong><span>${all ? "종료·앞으로 시작할 항목까지 포함" : e(cycleText(s, month))}</span></div><div class="recurring-cards">${rows.map(r => {
      const x = r.cycle[0], status = PAYMENT_LABELS[r.status] || (r.status === "ended" ? "종료" : "이번 기간 예정 없음");
      return `<article class="card recurring-item"><header><div class="recurring-day">${x ? `${Number(x.date.slice(5,7))}.${Number(x.date.slice(8))}` : "—"}<small>${r.dayEstimated || (r.autoDetected && !r.dateConfirmed) ? "예정일 추정" : `매월 ${r.day}일`}</small></div><div><h2>${e(r.name)}</h2><p>${e(s.categories.find(c => c.id === r.category)?.name || "기타")} · ${e(memberName(r.owner, s))}</p></div><span class="payment-status status-${e(r.status)}">${e(status)}</span></header><div class="recurring-amounts"><div><span>${x ? "이 기간 예정" : "설정 기본 금액"}</span><strong>${won(x?.amount ?? r.amount)}</strong></div><div><span>실제 기록</span><strong>${won(x?.actual || 0)}</strong></div><div><span>남은 확인액</span><strong>${x ? won(x.outstanding) : "—"}</strong></div></div><p class="small">결제수단: ${e(r.paymentMethod || "미지정 · 확인 필요")}<br>적용 ${dateLabel(r.start)} ~ ${r.end ? dateLabel(r.end) : "계속"}${!x && r.next ? `<br>다음 적용 예정 ${dateLabel(r.next.date)} · ${won(r.next.amount)}` : ""}</p>
      ${r.policyBreakdown?.length ? `<details class="payment-detail"><summary>포함된 보험 ${r.policyBreakdown.length}건 보기</summary>${r.policyBreakdown.map(p => `<div><span>${e(p.insured)} · ${e(p.product)}</span><b>${won(p.amount)}</b></div>`).join("")}</details>` : ""}
      ${(r.changes || []).length ? `<details class="payment-detail"><summary>금액 변경 이력 ${(r.changes || []).length}건</summary>${r.changes.map(c => `<div><span>${dateLabel(c.effective)}부터</span><b>${won(c.amount)}</b></div>`).join("")}</details>` : ""}
      <footer><button type="button" class="btn secondary" data-recurring="${e(r.id)}">금액·출금일 수정</button>${x ? `<button type="button" class="btn text" data-action="money-linked" data-id="${e(r.id)}">연결 거래 보기</button>` : ""}${x && !x.paid ? `<button type="button" class="btn primary" data-action="money-payment" data-id="${e(r.id)}" data-date="${e(x.date)}">실제 납부 입력</button>` : ""}</footer></article>`;
    }).join("") || '<section class="card"><p>조건에 맞는 항목이 없어요. 등록 전체 또는 다른 상태를 선택해 주세요.</p></section>'}</div></div>`;
}
export function reviewView(s, month, f = {}) {
  const cycle = reviewRows(s, month), allRows = reviewRows(s, month, true);
  const rows = (f.mode === "all" ? allRows : cycle).filter(t => (!f.owner || t.owner === f.owner) &&
    (!f.query || keyText(hiddenPersonal(t, s) ? "개인 지출 " + t.amount : [t.merchantRaw, t.note, t.amount].join(" ")).includes(keyText(f.query))));
  return `<div class="money-page"><div class="page-intro"><div><h1>소비 분류 확인</h1><p>확실한 사용처는 자동 분류하고, 용도를 모르는 거래만 여기 남겨요.</p></div>${button("자동분류 다시 적용", "money-classify", "secondary")}</div><div class="money-review-callout needs-review"><div><strong>이번 기간 ${cycle.length}건 · 전체 기간 ${allRows.length}건</strong><p>분류 전에도 금액은 지출에 포함돼요. 확인 후에는 다른 금액으로 중복 입력하지 않아요.</p></div></div><div class="money-filters"><label class="search-field">${icon("search")}<input name="review-search" type="search" aria-label="분류 대기 검색" placeholder="사용처·금액·메모 검색" value="${e(f.query || "")}"></label>${select("조회 범위", "review-mode", [["cycle", "이번 기간"], ["all", "전체 기간"]], f.mode || "cycle")}${select("사용자", "review-owner", [["", "전체"], ...["p1", "p2", "joint"].map(p => [p, memberName(p, s)])], f.owner)}</div><div class="review-cards">${rows.slice(0, f.limit || 100).map(t => {
      const hidden = hiddenPersonal(t, s);
      return `<article class="card review-item"><div><span class="payment-status status-check">${hidden ? "개인 내역 숨김" : "분류 확인 필요"}</span><h2>${e(hidden ? memberName(t.scope, s) + " 개인 지출" : t.merchantRaw)}</h2><p>${dateLabel(t.date)} · ${e(memberName(t.owner, s))}${hidden ? "" : ` · ${e(t.paymentMethod || "결제수단 미지정")}`}</p><small>${hidden ? "개인 내역 표시를 허용한 후 확인할 수 있어요." : e(classification(t, s).reason)}</small>${!hidden && t.note ? `<p>${e(t.note)}</p>` : ""}</div><div class="review-item-side"><strong>${t.direction === "refund" ? "환불 " : ""}${won(t.amount)}</strong><button type="button" class="btn primary" data-action="money-review" data-id="${e(t.id)}">${hidden ? "개인 내역 설정" : "용도 확인·분류"}</button></div></article>`;
    }).join("") || '<section class="card review-empty"><h2>확인 대기 내역이 없어요</h2><p>전체 기간을 선택하면 이전에 남은 미분류 거래도 확인할 수 있어요.</p></section>'}</div>${rows.length > (f.limit || 100) ? button("100건 더 보기", "money-review-more", "secondary") : ""}</div>`;
}
