import { focusHome } from "../focus-ui.js";
import { incomeScheduleFor } from "../income-schedule.js";
import { moneyOverview, reviewRows, classification, registeredPayments, PAYMENT_LABELS, cycleText } from "../money.js";
import { won, escape as e, today, keyText } from "../format.js";
import { button, icon, hiddenPersonal, select } from "../ui.js";
import { memberName } from "../../data/defaults.js";
import { period, startDay } from "../period.js";
const dateLabel = d => d ? d.replaceAll("-", ".") : "미등록";
const metric = (label, value, help, action = "", cls = "") =>
  `<${action ? 'button type="button"' : "div"} class="money-metric ${cls}" ${action ? `data-action="${e(action)}"` : ""}><span>${e(label)}</span><strong>${e(value)}</strong><small>${e(help || "")}${action ? icon("chevron") : ""}</small></${action ? "button" : "div"}>`;
export function cycleStrip(s, month) {
  const p = period(month, startDay(s));
  const paydays = incomeScheduleFor(s, month)?.entries.map(r => r.day) || s.settings.salaryDays || [10, 15];
  return `<section class="cycle-strip" aria-label="급여 기준 가계부 기간"><div><span>가계부 집계 기간</span><strong>${e(cycleText(s, month))}</strong></div><div class="cycle-days"><b>시작 ${Number(p.start.slice(8))}일</b><span>→</span><b>마감 ${Number(p.end.slice(8))}일</b><small>급여일 ${[...new Set(paydays)].map(n => `${Number(n)}일`).join(" · ")}</small></div><button type="button" class="btn text" data-action="money-current">이번 기간</button></section>`;
}
export function moneyHome(s, month, extras = {}) { return focusHome(s, month, extras); }
export function recurringView(s, month, f = {}) {
  const o = moneyOverview(s, month), all = f.mode === "all";
  const rows = registeredPayments(s, month).filter(r => (all || r.cycle.length) &&
    (!f.status || r.status === f.status) && (!f.owner || r.owner === f.owner) &&
    (!f.query || keyText([r.name, r.paymentMethod, memberName(r.owner, s)].join(" ")).includes(keyText(f.query))))
    .sort((a, b) => f.sort === "amount" ? (b.cycle[0]?.amount ?? b.amount) - (a.cycle[0]?.amount ?? a.amount) :
      String(a.cycle[0]?.date || a.next?.date || "9999").localeCompare(String(b.cycle[0]?.date || b.next?.date || "9999")));
  return `<div class="money-page"><div class="page-intro"><div><h1>월 고정지출 관리</h1><p>예정·납부·확인 대기를 한곳에서. 은행의 자동이체를 실행하거나 해지하는 기능은 아니에요.</p></div>${button("정기결제 추가", "add-recurring", "primary", "plus")}</div>
    <section class="card"><div class="focus-fixed-overview"><div><span>이번 기간 고정지출</span><small>등록된 자동이체·정기결제 ${o.recurring.length}건</small></div><strong>${won(o.total)}</strong></div><details class="focus-fixed-total-detail"><summary>납부·미확인 금액 보기</summary><div class="money-three">${metric("납부 확인", won(o.paid), "연결된 실제 거래 기준")}${metric("미확인·남은 금액", won(o.unpaid), "기록이 없어 연체라고 단정할 수 없어요")}</div></details></section>
    <div class="money-filters"><label class="search-field">${icon("search")}<input name="recurring-search" type="search" value="${e(f.query || "")}" aria-label="자동이체 검색" placeholder="이름·결제수단 검색"></label>${select("보기", "recurring-mode", [["cycle", "이번 기간 예정"], ["all", `등록 전체 ${s.recurring.length}개`]], f.mode || "cycle")}${select("납부 상태", "recurring-status", [["", "전체 상태"], ...Object.entries(PAYMENT_LABELS), ["outside", "이번 기간 예정 없음"], ["ended", "종료"]], f.status)}${select("담당", "recurring-owner", [["", "전체"], ...["p1", "p2", "joint"].map(p => [p, memberName(p, s)])], f.owner)}${select("정렬", "recurring-sort", [["date", "날짜순"], ["amount", "금액 큰 순"]], f.sort || "date")}</div>
    <div class="money-list-heading"><strong>${rows.length}개 표시</strong><span>${all ? "종료·앞으로 시작할 항목까지 포함" : e(cycleText(s, month))}</span></div><div class="recurring-cards">${rows.map(r => {
      const x = r.cycle[0], status = PAYMENT_LABELS[r.status] || (r.status === "ended" ? "종료" : "이번 기간 예정 없음");
      return `<article class="card recurring-item"><header><div class="recurring-day">${x ? `${Number(x.date.slice(5,7))}.${Number(x.date.slice(8))}` : "—"}<small>${r.dayEstimated || (r.autoDetected && !r.dateConfirmed) ? "예정일 추정" : `매월 ${r.day}일`}</small></div><div><h2>${e(r.name)}</h2><p>${e(s.categories.find(c => c.id === r.category)?.name || "기타")} · ${e(memberName(r.owner, s))}</p></div><span class="payment-status status-${e(r.status)}">${e(status)}</span></header><strong class="focus-fixed-price">${won(x?.amount ?? r.amount)}</strong><details class="focus-fixed-detail"><summary>납부상태·결제수단·변경 이력</summary><div class="recurring-amounts"><div><span>${x ? "이 기간 예정" : "설정 기본 금액"}</span><strong>${won(x?.amount ?? r.amount)}</strong></div><div><span>실제 기록</span><strong>${won(x?.actual || 0)}</strong></div><div><span>남은 확인액</span><strong>${x ? won(x.outstanding) : "—"}</strong></div></div><p class="small">결제수단: ${e(r.paymentMethod || "미지정 · 확인 필요")}<br>적용 ${dateLabel(r.start)} ~ ${r.end ? dateLabel(r.end) : "계속"}${!x && r.next ? `<br>다음 적용 예정 ${dateLabel(r.next.date)} · ${won(r.next.amount)}` : ""}</p>
      ${r.policyBreakdown?.length ? `<details class="payment-detail"><summary>포함된 보험 ${r.policyBreakdown.length}건 보기</summary>${r.policyBreakdown.map(p => `<div><span>${e(p.insured)} · ${e(p.product)}</span><b>${won(p.amount)}</b></div>`).join("")}</details>` : ""}
      ${(r.changes || []).length ? `<details class="payment-detail"><summary>금액 변경 이력 ${(r.changes || []).length}건</summary>${r.changes.map(c => `<div><span>${dateLabel(c.effective)}부터</span><b>${won(c.amount)}</b></div>`).join("")}</details>` : ""}
      </details><footer><button type="button" class="btn secondary" data-recurring="${e(r.id)}">금액·출금일 수정</button>${x ? `<button type="button" class="btn text" data-action="money-linked" data-id="${e(r.id)}">연결 거래 보기</button>` : ""}${x && !x.paid ? `<button type="button" class="btn primary" data-action="money-payment" data-id="${e(r.id)}" data-date="${e(x.date)}">실제 납부 입력</button>` : ""}</footer></article>`;
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
