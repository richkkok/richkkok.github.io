import { cashNow, cashTime, cashRows, cashRoots, cashHidden, cashConnection, validCashTime } from "./cash.js";
import { escape as e, won, uid, amountInput, normalizeText, keyText } from "./format.js";
import { period, periodKey, startDay, addDays } from "./period.js";
import { memberName } from "../data/defaults.js";
import { select, field, openDialog, toast } from "./ui.js";
import { matchRecurring } from "./recurring.js";
import { cashAction } from "./cash-ui.js";
import { paymentKind, savePaymentProfile } from "./payment-channels.js";
import { paymentNameSummary, paymentRenameBasis, renamePaymentMethod } from "./payment-rename.js";
import { cardIdentityCode, autoMergeCardCode, mergeCardInto, methodNames, instrumentUsage, hideInstrument, restoreInstrument } from "./instrument-cleanup.js";

// An account is a real-cash ledger. A card/payment method is a spending list,
// never another bank balance. No financial record is created by these views.
export function instrumentChoices(s, { includeHidden = false } = {}) {
  const hiddenAccounts = new Set(s.settings.hiddenCashAccounts || []);
  const hiddenMethods = new Set(s.settings.hiddenPaymentMethods || []);
  const accounts = [...(s.cashAccounts || [])]
    .filter(a => includeHidden || !hiddenAccounts.has(a.id))
    .sort((a, b) => Number(!!a.archived) - Number(!!b.archived));
  const methods = methodNames(s).map(name => ({
    key: "m:" + encodeURIComponent(name), type: "method", name,
    hidden: hiddenMethods.has(keyText(name)),
  })).filter(x => includeHidden || !x.hidden);
  return [
    ...accounts.map(a => ({ key: "a:" + a.id, type: "account", name: a.name,
      accountId: a.id, account: a, hidden: hiddenAccounts.has(a.id) })),
    ...methods.sort((a, b) => a.name.localeCompare(b.name, "ko")),
  ];
}

export function instrumentWindow(s, f = {}, asOf = cashNow().slice(0, 10)) {
  const mode = f.instrumentPeriod || "cycle";
  if (mode === "all") return { from: "", to: asOf };
  if (mode === "30" || mode === "90") return { from: addDays(asOf, 1 - Number(mode)), to: asOf };
  if (mode === "custom") {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(f.instrumentFrom || "") ? f.instrumentFrom : "";
    const to = /^\d{4}-\d{2}-\d{2}$/.test(f.instrumentTo || "") ? f.instrumentTo : asOf;
    return { from, to: to > asOf ? asOf : to };
  }
  const cycle = period(periodKey(asOf, startDay(s)), startDay(s));
  return { from: cycle.start, to: asOf < cycle.end ? asOf : cycle.end };
}
export function instrumentRows(s, choice, f = {}, asOf = cashNow().slice(0, 10)) {
  const window = instrumentWindow(s, f, asOf);
  if (!choice) return { rows: [], incoming: 0, outgoing: 0, pending: 0, ...window };
  const all = cashRows(s), result = [];
  const query = keyText(f.instrumentQuery || "");
  const owner = f.instrumentOwner || "";
  const direction = f.instrumentDirection || "";
  for (const r of all) {
    const t = r.t;
    if (owner && t.owner !== owner) continue;
    let leg = null, needsLink = false, stamp = String(t.datetime || t.date + "T12:00:00");
    if (choice.type === "account") {
      leg = r.legs.find(l => l.accountId === choice.accountId) || null;
      const isReview = r.status === "review" && (r.affected || []).includes(choice.accountId);
      const bankMethod = choice.account.paymentMethod || choice.name;
      const isCandidate = r.status === "unlinked" && keyText(bankMethod) === keyText(t.paymentMethod)
        && (choice.account.owner === t.owner || choice.account.owner === "joint");
      if (!leg && !isReview && !isCandidate) continue;
      needsLink = !leg;
      if (leg) stamp = leg.at;
    } else if (keyText(t.paymentMethod) !== keyText(choice.name)) continue;
    const movement = leg ? leg.direction :
      t.direction === "income" || t.direction === "refund" ? "in" : t.direction === "transfer" ? "transfer" : "out";
    const date = stamp.slice(0, 10);
    if (window.from && date < window.from) continue;
    if (window.to && date > window.to) continue;
    if (direction && movement !== direction) continue;
    const hidden = cashHidden(t, s);
    if (query && !keyText(hidden ? "개인 내역 " + date + " " + t.amount :
      [date, t.merchantRaw, t.amount, t.paymentMethod, t.note].join(" ")).includes(query)) continue;
    result.push({ t, leg, needsLink, stamp, movement, hidden, status: r.status });
  }
  result.sort((a, b) => b.stamp.localeCompare(a.stamp) || String(b.t.id).localeCompare(String(a.t.id)));
  let incoming = 0, outgoing = 0, pending = 0;
  for (const r of result) {
    if (r.needsLink) { pending++; continue; }
    if (r.movement === "in") incoming += r.t.amount;
    if (r.movement === "out") outgoing += r.t.amount;
  }
  return { rows: result, incoming, outgoing, pending, ...window };
}

// History is independent of cash balances: include deleted, imported and split records.
export function instrumentHistoryRows(s, choice, f = {}, asOf = cashNow().slice(0, 10)) {
  if (!choice) return { rows: [], active: 0, trash: 0 };
  const mode = f.instrumentPeriod || "all";
  const window = mode === "all" ? { from: "", to: "" } : instrumentWindow(s, f, asOf);
  const owner = String(f.instrumentOwner || "");
  const direction = String(f.instrumentDirection || "");
  const query = keyText(f.instrumentQuery || "");
  const links = new Map((s.cashLinks || []).map(link => [link.id, link]));
  const rows = [], method = keyText(choice.name);
  const accountMethods = choice.type === "account"
    ? new Set([choice.name, choice.account?.paymentMethod].filter(Boolean).map(keyText)) : null;
  for (const t of s.transactions || []) {
    if (owner && t.owner !== owner) continue;
    let leg = null, connection = null;
    if (choice.type === "account") {
      const explicit = links.get(t.parentId || t.id);
      leg = explicit?.legs?.find(item => item.accountId === choice.accountId) || null;
      // Trust automatic matching only for active root records, while deleted
      // records remain discoverable through their historical name or link.
      connection = !t.deletedAt && !t.parentId ? cashConnection(t, s, links) : null;
      leg ||= connection?.legs?.find(item => item.accountId === choice.accountId) || null;
      const matchesName = accountMethods.has(keyText(t.paymentMethod));
      if (!leg && !matchesName && !connection?.affected?.includes(choice.accountId)) continue;
    } else if (keyText(t.paymentMethod) !== method) continue;
    const movement = leg?.direction || (t.direction === "income" || t.direction === "refund"
      ? "in" : t.direction === "transfer" ? "transfer" : "out");
    const stamp = String(leg?.at || t.datetime || t.date + "T12:00:00");
    const date = stamp.slice(0, 10);
    if (window.from && date < window.from) continue;
    if (window.to && date > window.to) continue;
    if (direction && movement !== direction) continue;
    const hidden = cashHidden(t, s);
    if (query && !keyText(hidden ? "개인 내역 " + date + " " + t.amount
      : [date, t.merchantRaw, t.amount, t.paymentMethod, t.note].join(" ")).includes(query)) continue;
    rows.push({ t, stamp, movement, hidden, deleted: !!t.deletedAt,
      needsLink: choice.type === "account" && !leg && !t.deletedAt && !t.parentId,
      connectionReview: choice.type === "account" && connection?.status === "review",
      canLink: choice.type === "account" && !t.deletedAt && !t.parentId && !choice.account?.archived });
  }
  rows.sort((a, b) => b.stamp.localeCompare(a.stamp) || String(b.t.id).localeCompare(String(a.t.id)));
  return { rows, active: rows.filter(r => !r.deleted).length,
    trash: rows.filter(r => r.deleted).length };
}
const choiceButton = (label, action, key, extra = "") =>
  '<button type="button" class="btn ' + extra + '" data-action="' + e(action) + '" data-key="' + e(key) + '">' + e(label) + '</button>';
export function instrumentLedgerView(s, f = {}) {
  const choices = instrumentChoices(s);
  const cards = choices.filter(x => x.type === "method");
  const selected = choices.find(x => x.key === f.instrument) || cards[0] ||
    choices.find(x => x.type === "account" && !x.account?.archived) || choices[0];
  const viewing = { instrumentPeriod: "all", ...f };
  const data = instrumentRows(s, selected, viewing);
  const history = instrumentHistoryRows(s, selected, viewing);
  const isAccount = selected?.type === "account";
  const paymentCounts = selected && !isAccount ? paymentNameSummary(s, selected.name) : null;
  const selectedProfile = selected && !isAccount ? s.settings.paymentProfiles?.[keyText(selected.name)] : null;
  const ownerNumbers = paymentCounts ? [["p1", paymentCounts.owners.p1],
    ["p2", paymentCounts.owners.p2], ["joint", paymentCounts.owners.joint]]
    .filter(([, count]) => count > 0) : [];
  const ambiguousCode = selected && !isAccount && /^[A-Za-z]{1,5}[- ]?\d{2,}$/.test(selected.name);
  const ownerHint = (ambiguousCode || ownerNumbers.length > 1) && ownerNumbers.length
    ? ownerNumbers.map(([owner, count]) => memberName(owner, s) + " " + count + "건").join(" · ")
    : "";
  const options = [
    ...choices.filter(x => x.type === "account").map(x => [x.key, "계좌 · " + x.name + (x.account?.archived ? " (사용 종료)" : "")]),
    ...cards.map(x => [x.key, "카드·결제수단 · " + x.name]),
  ];
  const featured = [];
  for (const item of [selected, ...cards, ...choices.filter(x => x.type === "account")]) {
    if (item && !featured.some(x => x.key === item.key)) featured.push(item);
    if (featured.length === 5) break;
  }
  const quickChoices = featured.map(x =>
    '<button type="button" class="instrument-choice' + (selected?.key === x.key ? ' is-active' : '') +
      '" data-action="instrument-select" data-key="' + e(x.key) +
      '" aria-pressed="' + (selected?.key === x.key) + '">' +
      '<small>' + (x.type === "account" ? "계좌" : "카드·결제수단") + '</small>' +
      '<strong>' + e(x.name) + '</strong></button>'
  ).join("");
  const range = viewing.instrumentPeriod === "all" ? "전체 기간" :
    data.from ? data.from.replaceAll("-", ".") + " ~ " + data.to.replaceAll("-", ".") :
      "전체 ~ " + data.to.replaceAll("-", ".");
  // Totals retain their existing cash-safe rules; historical rows never
  // become a second balance or count deleted/split-child records as cash.
  const totals = isAccount
    ? '<div class="instrument-totals"><div><small>계좌 입금</small><strong>+' + won(data.incoming) +
      '</strong></div><div><small>계좌 출금</small><strong>−' + won(data.outgoing) +
      '</strong></div><div><small>확인할 연결</small><strong>' + data.pending + '건</strong></div></div>'
    : '<div class="instrument-totals"><div><small>사용액</small><strong>' + won(data.outgoing) +
      '</strong></div><div><small>환불·취소</small><strong>' + won(data.incoming) +
      '</strong></div><div><small>순사용</small><strong>' + won(data.outgoing - data.incoming) +
      '</strong></div></div>';
  const list = history.rows.map(r => {
    const label = r.movement === "in" ? (isAccount ? "입금" : "환불") :
      r.movement === "out" ? (isAccount ? "출금" : "사용") : "이체·결제대금";
    const status = r.deleted ? " · 휴지통 (복원 가능)" :
      r.connectionReview ? " · 연결 재확인" : r.needsLink ? " · 계좌 연결 필요" : "";
    const merchant = r.hidden ? "개인 내역 숨김" : r.t.merchantRaw;
    const secondary = r.stamp.slice(0, 16).replace("T", " ") + " · " +
      memberName(r.t.owner, s) + " · " + label + status +
      (r.t.parentId ? " · 분할 내역" : "");
    const signed = r.movement === "in" ? "+" : r.movement === "out" ? "−" : "";
    const actionText = r.deleted ? "눌러서 복원" : "눌러서 수정·변경·삭제";
    return '<div class="instrument-row' + (r.needsLink ? ' needs-link' : '') +
      (r.deleted ? ' is-deleted' : '') + '">' +
      '<button type="button" class="instrument-row-main" data-edit="' + e(r.t.id) +
      '" data-instrument-edit="1" aria-label="' + e(merchant + ' ' + won(r.t.amount) + ' · ' + actionText) + '">' +
      '<span class="instrument-row-copy"><strong>' + e(merchant) +
      '</strong><small>' + e(secondary) + '</small></span>' +
      '<span class="instrument-row-side"><strong class="' + (r.movement === "in" ? "positive" : "") + '">' +
      signed + won(r.t.amount) + '</strong><small>' + actionText + '</small></span></button>' +
      (r.canLink ? '<button type="button" class="btn text instrument-row-link" data-action="cash-link" data-id="' +
        e(r.t.id) + '">' + (r.needsLink ? "계좌 연결" : "연결 수정") + '</button>' : '') +
      '</div>';
  }).join("");
  const editAction = isAccount ? "cash-account" : "instrument-profile";
  const editTarget = isAccount ? ' data-id="' + e(selected.accountId) + '"' :
    ' data-method="' + e(selected?.name || "") + '"';
  return '<section class="card instrument-panel" id="instrument-panel" aria-label="카드와 계좌 선택">' +
    '<div class="instrument-picker">' +
      '<div class="instrument-picker-heading"><div><h2>카드·계좌 선택</h2>' +
      '<p>카드·계좌를 선택하면 과거 거래 전체와 휴지통 내역을 볼 수 있어.</p></div>' +
      '<div class="instrument-picker-actions">' +
        choiceButton("새 카드", "instrument-method", "", "secondary") +
        '<button type="button" class="btn text" data-action="cash-account">새 계좌</button></div></div>' +
      (selected ?
        '<div class="instrument-choice-list" aria-label="자주 찾는 카드와 계좌">' + quickChoices + '</div>' +
        '<div class="instrument-picker-all">' +
          select("전체 카드·계좌 목록에서 선택", "instrument-target", options, selected.key,
            'aria-label="카드·계좌 선택"') +
        '</div>' +
        '<div class="instrument-selected">' +
          '<div class="instrument-selected-name"><small>현재 선택 · ' +
          (isAccount ? (selected.account?.archived ? '사용 종료 계좌' : '은행계좌') : '카드·결제수단') + '</small><strong>' +
          e(selected.name) + '</strong>' +
          (ownerHint ? '<small class="instrument-selected-meta">등록된 사용자별 거래: ' +
            e(ownerHint) + '</small>' : '') +
           (selectedProfile?.identifier ? '<small class="instrument-selected-meta">식별코드: ' +
             e(selectedProfile.identifier) + '</small>' : '') + '</div>' +
          '<div class="instrument-selected-actions">' +
            '<button class="btn primary" type="button" data-action="' + editAction + '"' +
              editTarget + '>이름 바꾸기</button>' +
             choiceButton("목록에서 삭제", "instrument-remove", selected.key, "secondary instrument-remove-action") +
             (!isAccount ? choiceButton("카드 합치기", "instrument-merge", selected.key, "secondary") : "") +
            (selected.account?.archived ? "" : choiceButton(isAccount ? "입출금 입력" : "카드 사용 입력", "instrument-add", selected.key, "secondary")) +
            (isAccount && !selected.account?.archived ? '<button class="btn secondary" type="button" data-action="cash-check" data-id="' +
              e(selected.accountId) + '">잔액 확인</button>' : '') +
          '</div>' +
        '</div>' :
        '<div class="instrument-picker-empty"><p>등록된 카드나 계좌가 없어. 먼저 카드 또는 계좌를 추가해 줘.</p>' +
        '<button class="btn primary" type="button" data-action="instrument-method">카드 추가하기</button>' +
        '<button class="btn secondary" type="button" data-action="cash-account">계좌 추가하기</button></div>') +
    '</div>' +
    (selected ?
      '<div class="instrument-ledger-heading"><h3>선택한 카드·계좌의 전체 거래내역</h3><small>' +
        e(range) + ' · 전체 ' + history.rows.length + '건 (정상 ' + history.active + '건 · 휴지통 ' + history.trash + '건)</small></div>' +
      totals +
      '<details class="instrument-advanced"><summary>기간·사용자·검색 설정</summary><div class="instrument-advanced-inner">' +
        '<div class="instrument-controls">' +
          select("조회기간", "instrument-period",
            [["all", "전체 기간"], ["cycle", "이번 운영월"], ["30", "최근 30일"], ["90", "최근 90일"],
             ["custom", "기간 직접 지정"]],
            f.instrumentPeriod || "all") +
          select("사용자", "instrument-owner",
            [["", "전체 사용자"], ["p1", memberName("p1", s)], ["p2", memberName("p2", s)],
             ["joint", "공동"]], f.instrumentOwner || "") +
          select("거래 방향", "instrument-direction",
            [["", "모두"], ["out", isAccount ? "출금" : "사용"], ["in", isAccount ? "입금" : "환불"], ["transfer", "이체·카드대금"]],
            f.instrumentDirection || "") +
        '</div>' +
        (f.instrumentPeriod === "custom" ?
          '<div class="instrument-custom-dates">' +
          field("시작일", "instrument-from", f.instrumentFrom || "", "date") +
          field("종료일", "instrument-to", f.instrumentTo || cashNow().slice(0, 10), "date") + '</div>' : '') +
        '<div class="instrument-search-and-add">' +
          field("거래내역 검색", "instrument-query", f.instrumentQuery || "", "search",
            'placeholder="사용처 또는 금액"') + '</div>' +
      '</div></details>' +
      '<div class="instrument-list">' +
        (list || '<p class="empty-inline">이 카드·계좌에 해당하는 거래가 없어. 필터를 확인하거나 새 거래를 입력해 줘.</p>') +
      '</div>' +
      
      '<p class="instrument-hint">거래를 누르면 수정·카드/계좌 변경·휴지통 이동을 할 수 있어. 합계는 휴지통을 제외한 오늘까지의 거래 기준이야. 이름을 바꾸면 과거 거래 이름도 함께 갱신돼.</p>' :
      '') +
    '</section>';
}
export function saveCardTransaction(s, data, options = {}) {
  const now = options.now || cashNow(), at = cashTime(data.at), amount = amountInput(data.amount);
  const name = String(data.paymentMethod || "").trim(), merchant = String(data.merchant || "").trim();
  const owner = String(data.owner), scope = String(data.scope), direction = String(data.direction);
  const category = String(data.category), note = String(data.note || "");
  if (!validCashTime(at) || at > now || !amount || amount > 1e12 || !merchant || merchant.length > 300 ||
      !name || name.length > 100 || !["expense", "refund"].includes(direction) ||
      !["p1", "p2", "joint"].includes(owner) ||
      !["shared", "fixed", "p1", "p2", "excluded"].includes(scope) ||
      note.length > 1000 || !s.categories.some(c => c.id === category && !c.archived))
    throw Error("거래시각·내용·금액·분류를 확인해 주세요.");
  if (cashRoots(s).some(t => t.date === at.slice(0, 10) && t.amount === amount &&
    t.direction === direction && t.owner === owner &&
    keyText(t.paymentMethod) === keyText(name) && keyText(t.merchantRaw) === keyText(merchant)) &&
    !options.allowDuplicate)
    throw Error("같은 날 같은 카드·사용처·금액의 거래가 있어요. 별도 결제가 맞다면 확인란을 선택해 주세요.");
  const id = uid(), createdAt = new Date().toISOString();
  const t = matchRecurring({
    id, sourceId: id, date: at.slice(0, 10), datetime: at, owner, amount, direction,
    merchantRaw: merchant, merchantNormalized: normalizeText(merchant),
    category, categoryConfirmed: true, scope, excluded: scope === "excluded",
    costKind: scope === "fixed" ? "fixed" : "variable", paymentMethod: name,
    paymentChannel: "", note, sourceType: "manual", performanceStatus: "unknown",
    deletedAt: null, createdAt, updatedAt: createdAt, enteredBy: options.enteredBy || owner,
  }, s.recurring);
  s.transactions.push(t);
  return t;
}
function openPaymentProfileEditor(app, existingName = '') {
  const s = app.state;
  const existing = existingName ? instrumentChoices(s).find(
    x => x.type === 'method' && keyText(x.name) === keyText(existingName)) : null;
  if (existingName && !existing) throw Error('해당 결제수단을 찾지 못했어. 다시 조회해 줘.');
  const name = existing?.name || '';
  const original = s.settings.paymentProfiles?.[keyText(name)];
  const kind = original?.kind || (name ? paymentKind(s, name) : 'credit');
  const counts = existing ? paymentNameSummary(s, name) : null;
  const basis = existing ? paymentRenameBasis(s, name) : null;
  const ownerPreview = counts ? [
    [memberName('p1',s), counts.owners.p1],
    [memberName('p2',s), counts.owners.p2],
    ['공동', counts.owners.joint],
  ].filter(([,n]) => n > 0).map(([person,n]) => e(person) + ' ' + n + '건').join(' · ') : '';
  const dialog = openDialog(existing ? '결제방식 · 카드 청구주기 설정' : '카드·결제수단 등록',
    '<div class="form-grid">' +
      field('결제수단 이름', 'methodName', name, 'text', 'required maxlength="100" placeholder="예: 태영 신한카드, 은영 우리카드"') +
      select('결제방식', 'methodKind', [
        ['credit', '신용카드 · 나중에 일괄 결제'],
        ['immediate', '현금·계좌·체크카드 · 바로 지출'],
      ], kind === 'unknown' ? 'credit' : kind) +
    '</div><details class="instrument-identity"><summary>중복 카드 자동 통합 · 식별코드 설정</summary>' +
      '<p class="cash-small">전체 카드번호·끝 4자리만 입력하지 마. M107 같은 카드사 식별코드를 입력하고 사용자를 고르면 동일 코드·사용자 카드의 과거 거래를 자동으로 합쳐.</p>' +
      '<div class="form-grid">' +
        field('카드 식별코드 (선택)', 'identifier', original?.identifier || '', 'text', 'maxlength="40" placeholder="예: M107"') +
        select('카드 사용자', 'identityOwner', [['', '선택하지 않음'], ...['p1','p2','joint'].map(id => [id, memberName(id,s)])], original?.owner || '') +
      '</div></details><div data-billing-fields class="form-grid">' +
      field('카드사 이용 마감일 (매월 1~31일)', 'closingDay', original?.closingDay ?? '', 'number', 'min="1" max="31" placeholder="카드사에서 확인"') +
      field('결제 예정일 (매월 1~31일)', 'paymentDay', original?.paymentDay ?? '', 'number', 'min="1" max="31" placeholder="카드사에서 확인"') +
      select('마감월 기준 결제 예정월', 'lagMonths',
        [['0', '마감한 당월'], ['1', '다음 달'], ['2', '다다음 달']], String(original?.lagMonths ?? 1)) +
    '</div>' +
    (existing ? '<div class="instrument-rename-preview"><strong>현재 이름: ' + e(name) + '</strong><p>전체 저장된 거래 ' + counts.transactions + '건' +
      (ownerPreview ? ' · ' + ownerPreview : '') + ' · 고정지출 ' + counts.recurring + '건</p>' +
      '<p>이름을 바꾸면 삭제 보관함을 포함한 과거 거래와 카드 청구설정·연결 정보까지 함께 바꿔. 거래 금액·날짜·소유자는 그대로 유지해.</p>' +
      '<label class="check-field"><input type="checkbox" name="bulkRenameConfirmed">기존 이름의 전체 내역을 새 이름으로 바꾸는 데 동의해</label></div>' : '') +
    '<p class="cash-small">신용카드 이용·결제기간은 카드사 청구서에서 확인해 입력해 줘. 모르면 날짜를 비워 두어도 결제방식 구분은 저장돼. 표시된 결제일은 공휴일 조정·할부·할인 등이 반영되지 않은 예상일이야.</p>',
    async f => {
      const newName = String(f.get('methodName') || '').trim();
      const newKind = String(f.get('methodKind'));
      const identifier = cardIdentityCode(f.get('identifier'));
      const identityOwner = String(f.get('identityOwner') || '');
      if (identifier && !identityOwner)
        throw Error('카드 식별코드를 등록하려면 해당 카드 사용자도 선택해 줘.');
      const first = String(f.get('closingDay') || '').trim();
      const second = String(f.get('paymentDay') || '').trim();
      if (newKind === 'credit' && !!first !== !!second)
        throw Error('카드 이용 마감일과 결제일은 둘 다 입력하거나 둘 다 비워 줘.');
      const closing = newKind === 'credit' && first ? Number(first) : null;
      const payment = newKind === 'credit' && second ? Number(second) : null;
      const lag = newKind === 'credit' ? Number(f.get('lagMonths')) : 1;
      const renamed = !!existing && newName !== name;
      if (renamed && !f.get('bulkRenameConfirmed'))
        throw Error('기존 거래까지 이름을 일괄 변경하려면 확인란을 체크해 줘.');
      let result, merged;
      await app.update(st => {
        if (existing && paymentRenameBasis(st,name) !== basis)
          throw Error('다른 기기에서 카드나 거래기록이 변경됐어. 다시 열어서 확인해 줘.');
        if (renamed) result = renamePaymentMethod(st,name,newName,basis);
        const currentProfile = st.settings.paymentProfiles?.[keyText(newName)];
        savePaymentProfile(st,newName,newKind,closing,payment,lag,
          existing ? currentProfile : undefined, { identifier, owner: identityOwner });
        merged = autoMergeCardCode(st,newName);
      });
      if (!existing || renamed || merged?.merged) {
        app.cashFilters.instrument = 'm:' + encodeURIComponent(newName);
        app.cashFilters.instrumentLimit = 40;
        app.render();
      }
      toast(merged?.merged
        ? '같은 식별코드 카드 ' + merged.merged + '개를 자동으로 합쳤어. 거래 ' + merged.transactions + '건은 보존했어.'
        : renamed ? '카드·결제수단 이름을 변경했고, 저장된 거래 ' + result.transactions + '건 및 연결 정보를 함께 갱신했어.'
        : '결제방식과 카드 청구주기 설정을 저장했어. 기존 거래는 유지했어.');
    }, '설정 저장');
  const selector = dialog.querySelector('[name="methodKind"]');
  const fields = dialog.querySelector('[data-billing-fields]');
  const toggle = () => { fields.hidden = selector.value !== 'credit'; };
  selector.addEventListener('change', toggle);
  toggle();
}
export async function instrumentLedgerAction(app, action, target) {
  if (!action.startsWith("instrument-")) return false;
  const s = app.state;
  if (action === "instrument-select") {
    const selected = instrumentChoices(s).find(x => x.key === target?.dataset.key);
    if (!selected) throw Error("카드·계좌 목록이 변경됐어. 다시 선택해 줘.");
    app.cashFilters.instrument = selected.key;
    app.cashFilters.instrumentPeriod = "all";
    app.cashFilters.instrumentOwner = "";
    app.cashFilters.instrumentDirection = "";
    app.cashFilters.instrumentQuery = "";
    app.cashFilters.instrumentLimit = 40;
    app.render();
  } else if (action === "instrument-review") {
    const chosen = instrumentChoices(s).find(x => x.key === target?.dataset.key);
    if (!chosen) throw Error("해당 카드·계좌가 변경됐어. 다시 선택해 줘.");
    Object.assign(app.cashFilters, { instrument: chosen.key, instrumentPeriod: "all",
      instrumentOwner: "", instrumentDirection: "", instrumentQuery: "", instrumentLimit: 40 });
    document.querySelector("#dialog")?.close();
    app.navigate("cash");
    app.render();
  } else if (action === "instrument-remove") {
    const chosen = instrumentChoices(s, {includeHidden:true}).find(x => x.key === target?.dataset.key);
    if (!chosen) throw Error("카드·계좌 선택이 변경됐어. 다시 선택해 줘.");
    const usage = instrumentUsage(s, chosen);
    const bank = chosen.type === "account";
    const canDelete = bank
      ? !usage.transactions && !usage.links && !usage.checks &&
        !usage.recurring && !usage.reconciliations && !usage.rules &&
        !usage.initialBalance && !usage.reserved
      : !usage.transactions && !usage.recurring && !usage.reconciliations &&
        !usage.rules && keyText(s.settings.cardName) !== keyText(chosen.name) &&
        !Object.values(s.settings.monthOverrides || {}).some(o => keyText(o.cardName) === keyText(chosen.name)) &&
        !Object.values(s.settings.paymentAliases || {}).some(v => keyText(v) === keyText(chosen.name));
    const explanation = canDelete
      ? '이 항목에 연결된 거래·잔액 기록이 없어 등록만 삭제해. 다른 카드와 거래내역은 건드리지 않아.'
      : bank ? '거래·기준잔액·확인이력이 있으므로 계좌를 사용 종료하고 목록에서 숨겨. 기존 금융기록은 삭제하지 않아. 다시 사용할 때는 복원 후 계좌 설정에서 사용 종료를 해제해야 해.'
      : '과거 거래와 청구설정이 남아 있어 카드만 목록에서 숨겨. 거래·고정지출·카드대금 계산과 기존 데이터는 그대로 유지하고, 설정에서 복원할 수 있어.';
    openDialog("카드·계좌 목록 정리", '<p><strong>' + e(chosen.name) + '</strong></p>' +
      '<p class="cash-small">등록된 거래 ' + usage.transactions + '건' +
      (bank ? ' · 잔액 확인 ' + usage.checks + '건 · 연결 ' + usage.links + '건' :
        ' · 고정지출 ' + usage.recurring + '건') + '</p>' +
      '<p>' + e(explanation) + '</p>' +
      '<label class="check-field"><input type="checkbox" name="confirmed" required>기록 보존 조건과 목록 정리 방식을 확인했어</label>',
      async form => {
        if (!form.get("confirmed")) throw Error("목록 정리 조건을 확인해 줘.");
        let operation;
        await app.update(st => {
          const latest = instrumentChoices(st,{includeHidden:true}).find(x => x.key === chosen.key);
          if (!latest || JSON.stringify(instrumentUsage(st,latest)) !== JSON.stringify(usage))
            throw Error("다른 기기에서 카드·계좌 또는 거래내역이 변경됐어. 다시 확인해 줘.");
          operation = hideInstrument(st,latest);
        });
        app.cashFilters.instrument = "";
        app.render();
        toast(operation === "deleted" ? "사용하지 않는 카드·계좌 등록을 삭제했어."
          : "목록에서 제거했어. 기존 금융기록은 보존했고 설정에서 다시 표시할 수 있어.");
      }, "목록에서 삭제");
  } else if (action === "instrument-restore") {
    const chosen = instrumentChoices(s,{includeHidden:true}).find(x => x.key === target?.dataset.key);
    if (!chosen || !chosen.hidden) throw Error("복원할 카드·계좌가 변경됐어.");
    await app.update(st => restoreInstrument(st,chosen));
    toast(chosen.type === "account" ? "계좌 목록에 복원했어. 사용을 재개하려면 계좌 설정에서 '사용 종료'를 해제해 줘."
      : "카드를 목록에 복원했어.");
  } else if (action === "instrument-merge") {
    const chosen = instrumentChoices(s).find(x => x.key === target?.dataset.key && x.type === "method");
    if (!chosen) throw Error("합칠 카드를 먼저 선택해 줘.");
    const targets = instrumentChoices(s).filter(x =>
      x.type === "method" && keyText(x.name) !== keyText(chosen.name));
    if (!targets.length) {
      toast("합칠 다른 카드가 없어. 같은 이름·코드는 이미 하나로 보여주고 있어.");
      return true;
    }
    const sourceBasis = paymentRenameBasis(s, chosen.name);
    const destinationBases = new Map(targets.map(x => [x.key, paymentRenameBasis(s, x.name)]));
    openDialog("같은 카드끼리 합치기",
      '<p>출발 카드 <strong>' + e(chosen.name) + '</strong>의 모든 거래·고정지출·규칙을 선택한 대상 카드로 연결해. 거래 금액·날짜·ID·휴지통 상태는 바꾸지 않아.</p>' +
      select("유지할 카드", "destination", targets.map(x => [x.key,x.name]), targets[0].key) +
      '<p class="cash-small">서로 다른 사용자의 카드나 서로 다른 식별코드·청구기간이 충돌하면 통합하지 않아. 전체 카드번호와 끝 4자리만으로는 자동 합치지 않아.</p>' +
      '<label class="check-field"><input type="checkbox" name="confirmed" required>두 목록이 실제로 같은 카드임을 확인했어</label>',
      async form => {
        if (!form.get("confirmed")) throw Error("같은 카드인지 확인해야 합칠 수 있어.");
        const to = targets.find(x => x.key === form.get("destination"));
        if (!to) throw Error("유지할 카드를 선택해 줘.");
        let changed;
        await app.update(st => {
          changed = mergeCardInto(st,chosen.name,to.name,{
            source:sourceBasis,destination:destinationBases.get(to.key),
          });
        });
        app.cashFilters.instrument = to.key;
        app.render();
        toast("카드를 합쳤어. 과거 거래 " + changed.transactions + "건의 결제수단 이름을 통합하고 거래는 모두 보존했어.");
      },"동일 카드 통합");
  } else if (action === "instrument-dedupe") {
    let merged = 0, transactions = 0;
    await app.update(st => {
      for (const profile of [...Object.values(st.settings.paymentProfiles || {})]) {
        if (!st.settings.paymentProfiles[keyText(profile.name)]) continue;
        const result = autoMergeCardCode(st,profile.name);
        merged += result.merged;
        transactions += result.transactions;
      }
    });
    toast(merged ? "같은 식별코드·사용자 카드 " + merged + "개를 합쳤어. 거래 " + transactions + "건 보존."
      : "안전하게 합칠 수 있는 중복 카드가 없어. 코드나 사용자가 다른 카드는 그대로 유지했어.");
  } else if (action === "instrument-more") {
    app.cashFilters.instrumentLimit = (app.cashFilters.instrumentLimit || 40) + 40;
    app.render();
  } else if (action === "instrument-method" || action === "instrument-profile") {
    openPaymentProfileEditor(app, action === 'instrument-profile' ? String(target?.dataset.method || '') : '');
  } else if (action === "instrument-add") {
    const chosen = instrumentChoices(s).find(x => x.key === target.dataset.key);
    if (!chosen) throw Error("계좌·카드가 변경됐어요. 다시 선택해 주세요.");
    if (chosen.type === "account") {
      await cashAction(app, "cash-entry", {dataset: {id: chosen.accountId}});
      return true;
    }
    const at = cashNow();
    const owners = ["p1", "p2", "joint"].map(id => [id, memberName(id, s)]);
    openDialog(chosen.name + " · 누락 카드 거래", '<p>카드사 내역을 확인한 실제 승인·취소만 입력해 주세요. 같은 거래가 이미 있으면 수정하고, 카드대금 계좌 출금과 중복 등록하지 마세요.</p><div class="form-grid">' +
      select("거래 유형", "direction", [["expense", "카드 사용"], ["refund", "결제 취소·환불"]], "expense") +
      select("사용자", "owner", owners, "p1") +
      field("사용처", "merchant", "", "text", 'required maxlength="300"') +
      field("금액", "amount", "", "number", 'required min="1"') +
      field("거래시각 (한국시간)", "at", at, "datetime-local", 'required step="1"') +
      select("분류", "category", s.categories.filter(c => !c.archived).map(c => [c.id, c.name]), "other") +
      select("사용 범위", "scope", [["shared", "공동생활비"], ["fixed", "고정비"], ["p1", memberName("p1", s) + " 개인"], ["p2", memberName("p2", s) + " 개인"], ["excluded", "가계부 제외"]], "shared") +
      field("메모 (선택)", "note", "", "text", 'maxlength="1000"') + '</div>' +
      '<label class="check-field"><input name="checked" type="checkbox" required>카드사 실제 거래를 확인했고 기존 기록에서 검색했어요</label>' +
      '<label class="check-field"><input name="allowDuplicate" type="checkbox">같은 날짜·사용처·금액이 있어도 별도의 결제가 맞아요</label>', async f => {
        if (!f.get("checked")) throw Error("실제 거래 여부를 확인해 주세요.");
        await app.update(st => {
          if (!instrumentChoices(st).some(x => x.key === chosen.key))
            throw Error("결제수단 설정이 바뀌었어요. 다시 열어 주세요.");
          saveCardTransaction(st, {
            paymentMethod: chosen.name, direction: f.get("direction"), owner: f.get("owner"),
            merchant: f.get("merchant"), amount: f.get("amount"), at: f.get("at"),
            category: f.get("category"), scope: f.get("scope"), note: f.get("note"),
          }, {allowDuplicate: !!f.get("allowDuplicate"), enteredBy: app.cloud?.meta?.member?.id});
        });
        toast("카드 거래를 기록했어요. 같은 화면의 내역과 소비 통계에 반영했어요.");
      });
  } else return false;
  return true;
}
