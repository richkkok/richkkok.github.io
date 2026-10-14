import { focusOverview, limitValues, limitBasis, saveFocusLimit } from './focus.js';
import { moneyOverview } from './money.js';
import { incomeReconciliation } from './income-reconcile.js';
import { incomeSchedulePanel } from './income-ui.js';
import { memberName } from '../data/defaults.js';
import { won, shortWon, escape as e, amountInput } from './format.js';
import { button, icon, progress, field, openDialog, toast } from './ui.js';
const actionLink = (title, text, action, glyph = 'list') => `<button type="button" class="focus-menu-item" data-action="${e(action)}">${icon(glyph)}<span><strong>${e(title)}</strong></span>${icon('chevron')}</button>`;
const fold = (id, title, description, body) => `<details class="focus-fold detail-disclosure" data-focus-fold="${id}"><summary aria-label="${e(title + ': ' + description)}"><span><strong>${e(title)}</strong></span>${icon('chevron')}</summary><div class="focus-fold-body">${body}</div></details>`;


/* Numbers have different accounting meanings on each card. Keep the labels
   explicit; the right side is not necessarily a mathematical cap on the left. */
const amountRatio = (left, right, leftKey, rightKey, leftLabel, rightLabel) =>
  `<div class="focus-ratio" role="group" aria-label="${e(leftLabel)} ${won(left)}, ${e(rightLabel)} ${won(right)}"><strong class="focus-amount" data-focus-value="${e(leftKey)}" title="${won(left)}">${shortWon(left)}</strong><span class="focus-ratio-right"><span class="focus-ratio-divider" aria-hidden="true">/</span><span class="focus-ratio-total" data-focus-value="${e(rightKey)}" title="${won(right)}">${shortWon(right)}</span></span></div>`;

export function focusHome(s, month, extras = {}, at) {
  const f = focusOverview(s, month, at), { money: o, cash: c, projectedCash: projected } = f, b = o.d;
  const cashStatus = !c.accounts.length ? '아직 입력하지 않았어' : projected.usable < 0 ? '지출 반영 후 사용가능 현금이 부족해' : c.mismatchCount ? '잔액 차이 있음 · 확인 필요' : f.cashChanged ? '입력 이후 거래 변경 · 재확인 필요' : projected.unlinkedCount ? '고정비 출금 추정 반영 · 계좌 연결 확인 필요' : f.cashStale ? '오늘 잔액 재확인 필요' : c.pending.length ? '연결하지 않은 입출금 확인 필요' : c.baselineCount ? '첫 잔액 등록 · 아직 대조 전' : '최근 확인시각의 연결 기록상 일치';
  const dates = c.accounts.map(a => a.measuredAt);
  const cashAt = c.oldest ? `${c.oldest.replace('T', ' ').slice(5, 16).replaceAll('-', '.')} 확인${new Set(dates).size > 1 ? ' · 계좌별 시각 다름' : ''}` : '';
  const incomeCheck = incomeReconciliation(s, month);
  const fixedExtra = b.fixed > o.total;
  const unlinkedFixed = f.fixedSpent > o.paid;
  const allowance = `<div class="focus-allowances">${o.allowances.map(p => `<div><span>${e(memberName(p.id, s))} 용돈</span><strong>${won(p.remaining)} 남음</strong><small>사용 ${won(p.used)} / 설정 ${won(p.budget)}</small></div>`).join('')}</div>${button('용돈·한도 편집', 'focus-plan', 'secondary')}`;
  const bills = f.cardBills.slice(0, 20).map(card => {
    const period = card.window
      ? `${card.window.start.replaceAll('-', '.')} ~ ${card.window.end.replaceAll('-', '.')} 사용 · ${card.window.payment.replaceAll('-', '.')} 결제일 예상`
      : '카드 이용·결제주기 미설정';
    return `<div class="focus-billing-row"><div><strong>${e(card.name)}</strong><small>${e(period)}</small>${card.window ? `<span>등록된 거래 기준 ${won(card.estimatedUsage)} · 청구 확정금액 아님</span>` : ''}</div><button type="button" class="btn text" data-action="instrument-profile" data-method="${e(card.name)}">설정</button></div>`;
  }).join('');
  const unknownMethods = f.channels.unknownMethods.slice(0, 12).map(name =>
    `<button type="button" class="btn text" data-action="instrument-profile" data-method="${e(name)}">${e(name)} 분류</button>`).join('');

  return `<div class="focus-home">
    <div class="focus-board" aria-label="핵심 가계부 요약">
      <section class="focus-card focus-budget${f.remaining < 0 ? ' is-over' : ''}">
        <header><h2>종합 소비한도</h2>${button('한도 편집', 'focus-plan', 'text')}</header>
        <span class="focus-label">사용 / 이번 기간 설정한도</span>
        ${amountRatio(f.used, f.limit, 'used', 'limit', '실제 소비 사용액', '설정한 소비한도')}
        ${progress(f.used, f.limit, 'focus-progress')}
        <p class="focus-counter">${f.remaining < 0 ? '한도 초과' : '남은 소비한도'} <strong data-focus-value="remaining">${won(Math.abs(f.remaining))}</strong></p>
        <div class="focus-spend-split" aria-label="종합 소비 중 결제방식별 사용액">
          <div><span>신용카드 · 나중에 결제</span><strong data-focus-value="credit-spent">${won(f.channels.credit)}</strong></div>
          <div><span>현금 · 계좌 · 체크카드</span><strong data-focus-value="immediate-spent">${won(f.channels.immediate)}</strong></div>
          ${f.channels.unknown || f.channels.unknownMethods.length ? `<div class="focus-spend-unknown"><span>결제수단 미확인</span><strong data-focus-value="unknown-spent">${won(f.channels.unknown)}</strong></div>` : ''}
        </div>
        <p class="focus-spend-caption">위 소비액은 가계부 운영월의 사용·환불 기준 · 카드대금 출금은 중복 소비 제외</p>
        <details class="focus-billing-detail">
          <summary>카드별 청구기간 · 결제일 확인</summary>
          <div class="focus-billing-body">
            <p>카드별 청구기간은 가계부 운영월과 달라. 입력한 이용 마감일·결제일을 기준으로 추정하며 실제 청구서, 할부, 할인, 영업일 조정과는 다를 수 있어.</p>
            ${bills || '<p>등록된 신용카드가 없어. 카드 결제수단을 등록하거나 거래 결제수단을 확인해 줘.</p>'}
            ${unknownMethods ? `<div class="focus-unknown-methods"><strong>결제방법 확인 필요</strong>${unknownMethods}</div>` : ''}
            ${f.cardBills.length > 20 ? '<p>나머지 카드 내역은 계좌·카드 메뉴에서 확인해 줘.</p>' : ''}
            ${button('계좌·카드 관리', 'go-cash', 'text')}
          </div>
        </details>
        ${o.stale ? '<p class="focus-status warn">기록 갱신 필요 · 입력된 지출 기준</p>' : ''}
        ${f.limit > b.affordability ? '<button class="focus-inline-warning" type="button" data-action="money-explain">수입·저축 목표 기준으로는 한도 조정이 필요해</button>' : ''}
      </section>
      <section class="focus-card focus-cash" aria-label="사용가능 현금">
        <header><h2>사용가능 현금</h2>${button('계좌 보기', 'go-cash', 'text')}</header>
        <span class="focus-label">현재 사용가능 추정액 / 이번 운영월 실제 입금</span>
        ${c.accounts.length ? amountRatio(projected.usable, f.cashReceived, 'cash', 'cash-income', '최근 확인한 잔액과 이후 출금·입금을 반영한 사용가능 추정액', '이번 운영월 실제 생활수입 누적') : `<div class="focus-ratio"><strong class="focus-amount" data-focus-value="cash">입력 필요</strong></div><p class="focus-counter">이번 운영월 실제 입금 <strong data-focus-value="cash-income">${won(f.cashReceived)}</strong></p>`}
        <p class="focus-note">${projected.unlinkedCount ? `최근 잔액에서 이후 고정비 ${won(Math.abs(projected.unlinkedFixed))} ${projected.unlinkedFixed >= 0 ? '추정 차감' : '환급 반영'} · 계좌 확인 필요` : projected.linkedChange ? '최근 잔액에 이후 연결된 입출금 반영' : '잔액은 직접 확인'} · 수입은 귀속월 기준</p>
        ${incomeCheck.nearby.length ? `<button type="button" class="focus-income-alert" data-action="money-income"><strong>지난 운영월에 등록된 최근 입금 ${incomeCheck.nearby.length}건 · ${won(incomeCheck.nearbyAmount)}</strong><span>조회 · 귀속월 변경 ${icon('chevron')}</span></button>` : ''}
        <p class="focus-status${f.cashIssue ? ' warn' : ''}">${e(cashStatus)}</p>${cashAt ? `<small class="focus-time">${e(cashAt)}</small>` : ''}
        <div class="focus-cash-entry" aria-label="현금 기준잔액과 실제 수입 입력">
          
          <div class="focus-cash-entry-actions">
            <div class="focus-cash-entry-group">
              <span>왼쪽 · 현금잔액</span>
              ${button(c.accounts.length ? '현재 잔액 입력' : '처음 기준잔액 입력', c.accounts.length ? 'cash-check' : 'cash-account', 'primary', 'wallet')}
            </div>
            <div class="focus-cash-entry-group">
              <span>오른쪽 · 실제 입금액</span>
              ${button('입금 조회·반영', 'money-income', 'secondary', 'list')}
            </div>
          </div>
          <div class="focus-cash-entry-links">
            ${button('새 계좌 등록', 'cash-account', 'text')}
            ${button('새 입금 입력', 'money-add-income', 'text')}
          </div>
          
        </div>
      </section>
      <section class="focus-card focus-fixed">
        <header><h2>월 고정지출</h2>${button('내역 편집', 'go-recurring', 'text')}</header>
        <span class="focus-label">실제 고정비 지출 / 이번 기간 등록 예정</span>
        ${s.recurring.length ? amountRatio(f.fixedSpent, f.fixedPlanned, 'fixed-spent', 'fixed', '실제 기록된 고정지출', '등록된 고정지출 예정합계') : `<strong class="focus-amount" data-focus-value="fixed">등록 필요</strong>`}
        ${s.recurring.length ? `<p class="focus-counter">${f.fixedDifference < 0 ? '예정 초과' : '예정 대비 잔여'} <strong data-focus-value="fixed-difference">${won(Math.abs(f.fixedDifference))}</strong></p>` : ''}
        
        <p class="focus-status${o.unpaid || fixedExtra || unlinkedFixed ? ' warn' : ''}">${unlinkedFixed ? '고정비 중 예정 항목과 연결되지 않은 기록이 있어' : fixedExtra ? '미등록 고정비·별도 준비액도 확인해줘' : o.unpaid ? '실제 납부 확인이 필요한 항목이 있어' : o.recurring.length ? '등록 항목의 납부내역 연결됨' : '이번 기간에 등록된 정기지출이 없어'}</p>
        <footer>${button('고정지출 추가', 'add-recurring', 'text', 'plus')}</footer>
      </section>
    </div>
    <section class="focus-next" aria-label="절약계획 조정"><div><span class="focus-label">확인할 일</span><h2>${e(f.advice.title)}</h2></div><div class="focus-next-actions">${button(f.advice.label, f.advice.action, 'primary')}${f.advice.action !== 'focus-plan' ? button('절약계획 조정', 'focus-plan', 'text') : ''}</div></section>
    <div class="focus-quick">${button('지출 입력', 'quick-expense', 'secondary', 'plus')}${button('거래 가져오기', 'go-import', 'secondary', 'upload')}</div>
    <div class="focus-details" aria-label="필요할 때 보는 상세 정보">
      ${fold('budget', '용돈·저축·계산 기준', '소비한도에 포함된 용돈과 수입 기준 확인', `${allowance}<div class="focus-detail-actions">${button('저축·세부 예산 설정', 'money-plan', 'text')}${button('계산 근거', 'money-explain', 'text')}</div>`)}
      ${fold('income', '급여 계획·입금', '수입 예정액과 실입금 내역', incomeSchedulePanel(s, month) + button('실제 입금 전체 조회', 'money-income', 'secondary'))}
      ${fold('review', '분류·잔액 확인할 항목', o.allPending.length || c.pending.length || c.mismatchCount ? '확인할 항목이 있어 · 지출 합계에는 이미 반영' : '확인 대기와 마지막 기록일 보기', `${actionLink(`분류 확인 ${o.allPending.length}건`, '구매 용도를 모르는 거래만 직접 확인', 'go-review', 'info')}${actionLink('계좌잔액 대조', '실제 잔액과 연결된 입출금 비교', 'go-cash', 'wallet')}`)}
      ${fold('analysis', '어디에 쓰는지 분석', '카테고리별 소비와 소비곡선·하루 마감', `${extras.categoryPanel ? extras.categoryPanel(b) : ''}${button('소비 분석 열기', 'go-analytics', 'secondary')}${extras.paceChart ? extras.paceChart(b) : ''}${o.current && extras.closePanel ? extras.closePanel(s) : ''}`)}
    </div>
  </div>`;
}
export function moreView(s, month) {
  const o = moneyOverview(s, month);
  return `<div class="focus-more"><h1>더보기</h1><section class="focus-menu">${actionLink('소비한도·용돈', '이번 기간 한도와 남은 금액을 바로 조정', 'focus-plan', 'wallet')}${actionLink('실제 입금 조회', '기존 입금 운영월 확인·수정', 'money-income', 'wallet')}${actionLink('급여일별 수입', '날짜별 수입 금액과 입금일 설정', 'month-income', 'calendar')}${actionLink('상세 예산·저축 목표', '카테고리 예산·카드실적·저축 설정', 'go-budget', 'chart')}${actionLink('소비 분류 확인', o.allPending.length ? `확인 대기 ${o.allPending.length}건` : '확인 대기 없음', 'go-review', 'list')}${actionLink('소비 분석', '카테고리·소비패턴을 자세히 보기', 'go-analytics', 'chart')}${actionLink('내역 가져오기', '은행·카드 자료를 가져오고 중복 검토', 'go-import', 'upload')}${actionLink('가족·앱 설정', '공동가계부·백업·카테고리·개인정보 표시', 'go-settings', 'settings')}</section></div>`;
}
export async function focusAction(app, action) {
  if (action !== 'focus-plan') return false;
  const month = app.month, original = limitBasis(app.state, month);
  const f = focusOverview(app.state, month), p = f.money.d.plan;
  openDialog('소비한도 · 절약계획 조정', `<p class="focus-note">${e(f.money.d.p.start)} ~ ${e(f.money.d.p.end)}에만 적용해. 저장 전에는 아무것도 바뀌지 않아.</p>${field('이번 기간 전체 소비한도 (원)', 'focus-total', f.limit, 'number', 'required')}<div class="focus-presets"><button class="btn secondary" type="button" data-focus-cut="50000">5만원 줄이기</button><button class="btn secondary" type="button" data-focus-cut="100000">10만원 줄이기</button><button class="btn text" type="button" data-focus-reset>원래대로</button></div><div class="focus-plan-preview" aria-live="polite"><span>이미 쓴 돈 <b>${won(f.used)}</b></span><strong id="focus-preview-remaining"></strong><small id="focus-preview-shared"></small></div><details class="focus-editor-fold"><summary>용돈 배분도 함께 바꾸기</summary><div class="form-grid">${field(`${memberName('p1', app.state)} 용돈`, 'focus-p1', p.personalBudgets.p1, 'number', 'required')}${field(`${memberName('p2', app.state)} 용돈`, 'focus-p2', p.personalBudgets.p2, 'number', 'required')}</div></details>`, async form => {
    const values = limitValues(amountInput(form.get('focus-total')), amountInput(form.get('focus-p1')), amountInput(form.get('focus-p2')));
    await app.update(s => { saveFocusLimit(s, month, values, original); });
    toast('이 기간의 한도만 바꿨어. 거래내역과 실제 현금은 그대로야.');
  }, '새 한도 적용');
  const dialog = document.querySelector('#dialog'), total = dialog.querySelector('[name=focus-total]');
  const preview = () => {
    const fields = ['focus-total', 'focus-p1', 'focus-p2'].map(name => dialog.querySelector(`[name=${name}]`));
    const note = dialog.querySelector('#focus-preview-shared'), output = dialog.querySelector('#focus-preview-remaining');
    try {
      if (fields.some(input => !input.value.trim())) throw Error('금액을 입력해줘.');
      const v = limitValues(...fields.map(input => Number(input.value)));
      const left = v.variableBudget - f.used;
      output.textContent = `${left < 0 ? '적용 후 초과' : '적용 후 남은 한도'} ${won(Math.abs(left))}`;
      output.classList.toggle('negative', left < 0);
      note.textContent = `공동 생활비 배분 ${won(v.sharedBudget)} · 고정지출 별도`;
    } catch (error) { output.textContent = '입력 확인 필요'; note.textContent = error.message; }
  };
  dialog.querySelectorAll('input').forEach(input => input.addEventListener('input', preview));
  dialog.querySelectorAll('[data-focus-cut]').forEach(btn => btn.addEventListener('click', () => { total.value = Math.max(0, Number(total.value) - Number(btn.dataset.focusCut)); preview(); }));
  dialog.querySelector('[data-focus-reset]').addEventListener('click', () => { total.value = f.limit; dialog.querySelector('[name=focus-p1]').value = p.personalBudgets.p1; dialog.querySelector('[name=focus-p2]').value = p.personalBudgets.p2; preview(); });
  preview();
  return true;
}
