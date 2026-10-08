import { focusOverview, limitValues, limitBasis, saveFocusLimit } from './focus.js';
import { moneyOverview } from './money.js';
import { incomeSchedulePanel } from './income-ui.js';
import { memberName } from '../data/defaults.js';
import { won, escape as e, amountInput } from './format.js';
import { button, icon, progress, field, openDialog, toast } from './ui.js';
const actionLink = (title, text, action, glyph = 'list') => `<button type="button" class="focus-menu-item" data-action="${e(action)}">${icon(glyph)}<span><strong>${e(title)}</strong><small>${e(text)}</small></span>${icon('chevron')}</button>`;
const fold = (id, title, description, body) => `<details class="focus-fold detail-disclosure" data-focus-fold="${id}"><summary><span><strong>${e(title)}</strong><small>${e(description)}</small></span>${icon('chevron')}</summary><div class="focus-fold-body">${body}</div></details>`;

export function focusHome(s, month, extras = {}) {
  const f = focusOverview(s, month), { money: o, cash: c } = f, b = o.d;
  const cashStatus = !c.accounts.length ? '아직 입력하지 않았어' : c.usable < 0 ? '따로 확보할 돈이 잔액보다 많아' : c.mismatchCount ? '잔액 차이 있음 · 확인 필요' : f.cashChanged ? '입력 이후 거래 변경 · 재확인 필요' : f.cashStale ? '오늘 잔액 재확인 필요' : c.pending.length ? '연결하지 않은 입출금 확인 필요' : c.baselineCount ? '첫 잔액 등록 · 아직 대조 전' : '최근 확인시각의 연결 기록상 일치';
  const dates = c.accounts.map(a => a.measuredAt);
  const cashAt = c.oldest ? `${c.oldest.replace('T', ' ').slice(5, 16).replaceAll('-', '.')} 확인${new Set(dates).size > 1 ? ' · 계좌별 시각 다름' : ''}` : '';
  const fixedExtra = b.fixed > o.total;
  const allowance = `<div class="focus-allowances">${o.allowances.map(p => `<div><span>${e(memberName(p.id, s))} 용돈</span><strong>${won(p.remaining)} 남음</strong><small>사용 ${won(p.used)} / 설정 ${won(p.budget)}</small></div>`).join('')}</div><p class="focus-note">용돈은 위 소비한도에 포함돼. 실제로 계좌에서 인출할 수 있는 돈과는 달라.</p>${button('용돈·한도 편집', 'focus-plan', 'secondary')}`;
  return `<div class="focus-home">
    <div class="focus-board" aria-label="핵심 가계부 요약">
      <section class="focus-card focus-budget${f.remaining < 0 ? ' is-over' : ''}">
        <header><h2>소비한도</h2>${button('한도 편집', 'focus-plan', 'text')}</header>
        <span class="focus-label">${f.remaining < 0 ? '한도 초과' : '남은 한도'}</span><strong class="focus-amount" data-focus-value="remaining">${won(Math.abs(f.remaining))}</strong>
        ${progress(f.used, f.limit, 'focus-progress')}
        <div class="focus-budget-pair"><span>사용 <b data-focus-value="used">${won(f.used)}</b></span><span>한도 <b data-focus-value="limit">${won(f.limit)}</b></span></div>
        <p class="focus-note">생활비·용돈 포함 · 고정지출 별도</p>
        ${o.stale ? '<p class="focus-status warn">기록 갱신 필요 · 입력된 지출 기준</p>' : ''}
        ${f.limit > b.affordability ? '<button class="focus-inline-warning" type="button" data-action="money-explain">수입·저축 목표 기준으로는 한도 조정이 필요해</button>' : ''}
      </section>
      <section class="focus-card focus-cash" aria-label="사용가능 현금">
        <header><h2>사용가능 현금</h2>${button(c.accounts.length ? '잔액 갱신' : '잔액 입력', c.accounts.length ? 'cash-check' : 'cash-account', 'text')}</header>
        <span class="focus-label">${c.accounts.length ? '최근 입력 잔액 기준' : '은행에서 확인한 잔액'}</span><strong class="focus-amount" data-focus-value="cash">${c.accounts.length ? won(c.usable) : '입력 필요'}</strong>
        <p class="focus-note">확인 잔액 − 따로 남겨둘 돈</p>
        <p class="focus-status${f.cashIssue ? ' warn' : ''}">${e(cashStatus)}</p>${cashAt ? `<small class="focus-time">${e(cashAt)}</small>` : ''}
        <footer>${button('계좌·확보액 편집', 'go-cash', 'text')}</footer>
      </section>
      <section class="focus-card focus-fixed">
        <header><h2>월 고정지출</h2>${button('내역 편집', 'go-recurring', 'text')}</header>
        <span class="focus-label">등록된 정기지출 · 선택 기간 기준</span><strong class="focus-amount" data-focus-value="fixed">${s.recurring.length ? won(o.total) : '등록 필요'}</strong>
        <p class="focus-note">자동이체·정기결제 합계 · 실제 납부와 별개</p>
        <p class="focus-status${o.unpaid || fixedExtra ? ' warn' : ''}">${fixedExtra ? '미등록 고정비·별도 준비액도 확인해줘' : o.unpaid ? '실제 납부 확인이 필요한 항목이 있어' : o.recurring.length ? '등록 항목의 납부내역 연결됨' : '이번 기간에 등록된 정기지출이 없어'}</p>
        <footer>${button('고정지출 추가', 'add-recurring', 'text', 'plus')}</footer>
      </section>
    </div>
    <section class="focus-next" aria-label="절약계획 조정"><div><span class="focus-label">지금 할 일</span><h2>${e(f.advice.title)}</h2><p>${e(f.advice.text)}</p></div><div class="focus-next-actions">${button(f.advice.label, f.advice.action, 'primary')}${f.advice.action !== 'focus-plan' ? button('절약계획 조정', 'focus-plan', 'text') : ''}</div></section>
    <div class="focus-quick">${button('지출 입력', 'quick-expense', 'secondary', 'plus')}${button('입금 입력', 'money-add-income', 'secondary')}${button('거래 가져오기', 'go-import', 'secondary', 'upload')}</div>
    <div class="focus-details" aria-label="필요할 때 보는 상세 정보">
      ${fold('budget', '용돈·저축·계산 기준', '소비한도에 포함된 용돈과 수입 기준 확인', `${allowance}<div class="focus-detail-actions">${button('저축·세부 예산 설정', 'money-plan', 'text')}${button('계산 근거', 'money-explain', 'text')}</div>`)}
      ${fold('income', '급여일별 수입', '수입 날짜·금액 수정과 실제 입금 확인', incomeSchedulePanel(s, month) + button('전체 실제 입금 보기', 'money-income', 'text'))}
      ${fold('review', '분류·잔액 확인할 항목', o.allPending.length || c.pending.length || c.mismatchCount ? '확인할 항목이 있어 · 지출 합계에는 이미 반영' : '확인 대기와 마지막 기록일 보기', `${actionLink(`분류 확인 ${o.allPending.length}건`, '구매 용도를 모르는 거래만 직접 확인', 'go-review', 'info')}${actionLink('계좌잔액 대조', '실제 잔액과 연결된 입출금 비교', 'go-cash', 'wallet')}<p class="focus-note">마지막 지출 기록: ${e(o.latest || '미등록')}. 분류를 바꿔도 같은 지출을 두 번 더하지 않아.</p>`)}
      ${fold('analysis', '어디에 쓰는지 분석', '카테고리별 소비와 소비곡선·하루 마감', `${extras.categoryPanel ? extras.categoryPanel(b) : ''}${button('소비 분석 열기', 'go-analytics', 'secondary')}${extras.paceChart ? extras.paceChart(b) : ''}${o.current && extras.closePanel ? extras.closePanel(s) : ''}`)}
    </div>
  </div>`;
}
export function moreView(s, month) {
  const o = moneyOverview(s, month);
  return `<div class="focus-more"><h1>더보기</h1><p class="focus-note">홈에는 핵심만, 상세 관리와 설정은 여기에서.</p><section class="focus-menu">${actionLink('소비한도·용돈', '이번 기간 한도와 남은 금액을 바로 조정', 'focus-plan', 'wallet')}${actionLink('급여일별 수입', '날짜별 수입 금액과 입금일 설정', 'month-income', 'calendar')}${actionLink('상세 예산·저축 목표', '카테고리 예산·카드실적·저축 설정', 'go-budget', 'chart')}${actionLink('소비 분류 확인', o.allPending.length ? `확인 대기 ${o.allPending.length}건` : '확인 대기 없음', 'go-review', 'list')}${actionLink('소비 분석', '카테고리·소비패턴을 자세히 보기', 'go-analytics', 'chart')}${actionLink('내역 가져오기', '은행·카드 자료를 가져오고 중복 검토', 'go-import', 'upload')}${actionLink('가족·앱 설정', '공동가계부·백업·카테고리·개인정보 표시', 'go-settings', 'settings')}</section></div>`;
}
export async function focusAction(app, action) {
  if (action !== 'focus-plan') return false;
  const month = app.month, original = limitBasis(app.state, month);
  const f = focusOverview(app.state, month), p = f.money.d.plan;
  openDialog('소비한도 · 절약계획 조정', `<p class="focus-note">${e(f.money.d.p.start)} ~ ${e(f.money.d.p.end)}에만 적용해. 저장 전에는 아무것도 바뀌지 않아.</p>${field('이번 기간 전체 소비한도 (원)', 'focus-total', f.limit, 'number', 'required')}<div class="focus-presets"><button class="btn secondary" type="button" data-focus-cut="50000">5만원 줄이기</button><button class="btn secondary" type="button" data-focus-cut="100000">10만원 줄이기</button><button class="btn text" type="button" data-focus-reset>원래대로</button></div><div class="focus-plan-preview" aria-live="polite"><span>이미 쓴 돈 <b>${won(f.used)}</b></span><strong id="focus-preview-remaining"></strong><small id="focus-preview-shared"></small></div><details class="focus-editor-fold"><summary>용돈 배분도 함께 바꾸기</summary><div class="form-grid">${field(`${memberName('p1', app.state)} 용돈`, 'focus-p1', p.personalBudgets.p1, 'number', 'required')}${field(`${memberName('p2', app.state)} 용돈`, 'focus-p2', p.personalBudgets.p2, 'number', 'required')}</div></details><p class="focus-note">남은 한도는 전체 한도에서 입력된 지출을 뺀 금액이야. 용돈을 제외한 나머지는 공동 생활비로 배분해. 수입·저축 목표·고정지출·실제 현금은 바꾸지 않아.</p>`, async form => {
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
