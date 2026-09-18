import { analyze } from "../analytics.js";
import { won, shortWon, escape as e, percent } from "../format.js";
import { memberName } from "../../data/defaults.js";
import { sectionTitle, empty, button } from "../ui.js";
export function analyticsView(state, month) {
  const a = analyze(state, month),
    b = a.now;
  const cats = [
      ...b.categories.filter((c) => c.used !== 0),
      {
        id: "personal",
        name: "개인용돈 합계",
        used: b.personal.p1 + b.personal.p2,
      },
    ]
      .filter((c) => c.used)
      .sort((a, b) => b.used - a.used),
    max = Math.max(1, ...cats.map((c) => c.used)),
    trendMax = Math.max(1, ...a.trend.map((t) => Math.max(t.spent, t.income)));
  const growth = a.changes
      .filter((c) => c.id !== "finance" && c.delta > 0)
      .sort((a, b) => b.delta - a.delta)[0],
    saving = a.changes
      .filter((c) => c.delta < 0)
      .sort((a, b) => a.delta - b.delta)[0];
  return `<div class="page-intro"><div><h1>분석</h1><p>숫자에서 발견하는 우리집의 변화.</p></div><span class="status-pill">로컬 분석 · 외부 AI 없음</span></div>${!b.tx.length ? `<section class="card">${empty("아직 분석할 내역이 없어요", "파일을 가져오면 실제 거래로 계산해 드려요.", button("내역 가져오기", "go-import", "secondary"))}</section>` : ""}<div class="two-column"><section class="card">${sectionTitle("어디에 사용했나요?", `이번 달 순지출 ${won(b.spent)}`)}<div class="category-bars">${cats.map((c) => `<div><div class="between"><span>${e(c.name)}</span><strong>${won(c.used)}</strong></div><div class="analysis-bar"><span style="width:${percent(c.used, max)}%"></span></div></div>`).join("") || '<p class="empty-inline">지출이 기록되면 여기에 표시돼요.</p>'}</div><p class="small muted">개인 지출은 세부 카테고리 없이 합계로 표시해요. 환불은 차감해요.</p></section><section class="card">${sectionTitle("최근 3개월 흐름", "실제 수입과 순지출을 비교해요")}<div class="trend-chart" role="img" aria-label="최근 3개월 수입 지출 비교">${a.trend.map((t) => `<div class="trend-column"><div class="trend-values"><strong>${shortWon(t.spent)}</strong><small>지출</small></div><div class="trend-bars"><span class="income-bar" style="height:${percent(t.income, trendMax)}%" title="수입 ${won(t.income)}"></span><span class="spend-bar" style="height:${percent(t.spent, trendMax)}%" title="지출 ${won(t.spent)}"></span></div><strong>${Number(t.month.slice(5))}월</strong></div>`).join("")}</div><div class="chart-legend"><span><i class="income-bar"></i>실제 수입</span><span><i class="spend-bar"></i>순지출</span></div></section><section class="card">${sectionTitle("달라진 소비", a.compared ? "지난달 같은 기간과 비교" : "비교할 지난달 내역이 필요해요")}<div class="change-pair"><div><span>가장 늘어난 항목</span><strong>${a.compared && growth ? e(growth.name) : "—"}</strong><b>${a.compared && growth ? "+" + won(growth.delta) : "비교 자료 없음"}</b></div><div><span>가장 줄어든 항목</span><strong>${a.compared && saving ? e(saving.name) : "—"}</strong><b class="positive">${a.compared && saving ? won(saving.delta) : "비교 자료 없음"}</b></div></div><div class="forecast-box"><span>현재 속도의 월말 예상지출</span><strong>${won(b.forecast)}</strong><small>${b.elapsed}일간의 변동지출 속도 + 고정·반복비. 실제 결과와 다를 수 있어요.</small></div></section><section class="card">${sectionTitle("우리집 지출 구성", "소유자와 사용 범위는 따로 관리해요")}<div class="composition"><div><span>고정·반복비</span><strong>${won(b.fixedActual)}</strong></div><div><span>변동지출</span><strong>${won(b.variable)}</strong></div></div><h3 class="subheading">결제한 사람</h3>${a.owners.map((o) => `<div class="between data-line"><span>${e(memberName(o.owner, state))}</span><strong>${won(o.total)}</strong></div>`).join("")}<h3 class="subheading">반복비 결제 현황</h3>${b.recurring.map((r) => `<div class="between data-line"><span>${e(r.name)}</span><strong>${r.paid ? "결제 완료" : `${won(r.outstanding)} 예정`}</strong></div>`).join("") || '<p class="small muted">등록된 반복비가 없어요.</p>'}</section></div>`;
}
