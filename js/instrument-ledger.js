import { cashNow, cashTime, cashRows, cashRoots, cashHidden, validCashTime } from "./cash.js";
import { escape as e, won, uid, amountInput, normalizeText, keyText } from "./format.js";
import { period, periodKey, startDay, addDays } from "./period.js";
import { memberName } from "../data/defaults.js";
import { select, field, openDialog, toast } from "./ui.js";
import { matchRecurring } from "./recurring.js";
import { cashAction } from "./cash-ui.js";

// An account is a real-cash ledger. A card/payment method is a spending list,
// never another bank balance. No financial record is created by these views.
export function instrumentChoices(s) {
  const accounts = (s.cashAccounts || []).filter(a => !a.archived);
  const bankNames = new Set(accounts.flatMap(a => [a.name, a.paymentMethod]).filter(Boolean).map(keyText));
  const used = new Set();
  const methods = [];
  for (const value of [...(s.settings.paymentMethods || []), s.settings.cardName, ...cashRoots(s).map(t => t.paymentMethod)]) {
    const name = String(value || "").trim(), normalized = keyText(name);
    if (!name || name.length > 100 || normalized === keyText("미지정") || bankNames.has(normalized) || used.has(normalized)) continue;
    used.add(normalized);
    methods.push({ key: "m:" + encodeURIComponent(name), type: "method", name });
  }
  return [
    ...accounts.map(a => ({ key: "a:" + a.id, type: "account", name: a.name, accountId: a.id, account: a })),
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
const choiceButton = (label, action, key, extra = "") =>
  '<button type="button" class="btn ' + extra + '" data-action="' + e(action) + '" data-key="' + e(key) + '">' + e(label) + '</button>';
export function instrumentLedgerView(s, f = {}) {
  const choices = instrumentChoices(s);
  const selected = choices.find(x => x.key === f.instrument) || choices[0];
  const data = instrumentRows(s, selected, f);
  const options = [
    ...choices.filter(x => x.type === "account").map(x => [x.key, "계좌 · " + x.name]),
    ...choices.filter(x => x.type === "method").map(x => [x.key, "카드·결제수단 · " + x.name]),
  ];
  const isAccount = selected?.type === "account";
  const limit = f.instrumentLimit || 40;
  const range = data.from ? data.from.replaceAll("-", ".") + " ~ " + data.to.replaceAll("-", ".") : "전체 ~ " + data.to.replaceAll("-", ".");
  const totals = isAccount
    ? '<div class="instrument-totals"><div><small>연결된 입금</small><strong>+' + won(data.incoming) + '</strong></div><div><small>연결된 출금</small><strong>−' + won(data.outgoing) + '</strong></div><div><small>미연결·재확인</small><strong>' + data.pending + '건</strong></div></div>'
    : '<div class="instrument-totals"><div><small>이용·지출</small><strong>' + won(data.outgoing) + '</strong></div><div><small>취소·환불·입금</small><strong>' + won(data.incoming) + '</strong></div><div><small>순사용 기록</small><strong>' + won(data.outgoing - data.incoming) + '</strong></div></div>';
  const list = data.rows.slice(0, limit).map(r => {
    const label = r.movement === "in" ? (isAccount ? "입금" : "환불·입금") : r.movement === "out" ? (isAccount ? "출금" : "사용") : "이체·결제대금";
    const status = isAccount ? r.needsLink ? " · 연결 필요(잔액 미반영)" : r.status === "auto" ? " · 자동 연결" : " · 확인된 연결" : "";
    const merchant = r.hidden ? "개인 내역 숨김" : r.t.merchantRaw;
    const secondary = r.stamp.slice(0, 16).replace("T", " ") + " · " + label + status;
    const signed = r.movement === "in" ? "+" : r.movement === "out" ? "−" : "";
    return '<div class="instrument-row' + (r.needsLink ? ' needs-link' : '') + '">' +
      '<div class="instrument-row-copy"><strong>' + e(merchant) + '</strong><small>' + e(secondary) + '</small></div>' +
      '<div class="instrument-row-side"><strong class="' + (r.movement === "in" ? "positive" : "") + '">' + signed + won(r.t.amount) + '</strong>' +
      (r.hidden ? '' : isAccount ?
        '<button type="button" class="btn text" data-action="cash-link" data-id="' + e(r.t.id) + '">' + (r.needsLink ? "계좌 연결" : "연결 수정") + '</button>' :
        '<button type="button" class="btn text" data-edit="' + e(r.t.id) + '">수정</button>') +
      '</div></div>';
  }).join("");
  return '<section class="card instrument-panel" id="instrument-panel" aria-label="계좌 카드별 거래내역">' +
    '<div class="section-heading"><div><h2>계좌·카드별 거래내역</h2><p>결제수단을 선택해 내역을 보고, 누락분을 바로 기록해요.</p></div>' +
    choiceButton("카드·결제수단 추가", "instrument-method", "", "secondary") + '</div>' +
    (selected ? '<div class="instrument-controls">' +
      select("조회할 계좌·카드", "instrument-target", options, selected.key) +
      select("조회기간", "instrument-period", [["cycle", "이번 운영월(10일~9일)"], ["30", "최근 30일"], ["90", "최근 90일"], ["all", "전체"], ["custom", "기간 직접 지정"]], f.instrumentPeriod || "cycle") +
      select("사용자", "instrument-owner", [["", "전체 사용자"], ["p1", memberName("p1", s)], ["p2", memberName("p2", s)], ["joint", "공동"]], f.instrumentOwner || "") +
      select("방향", "instrument-direction", [["", "입금·출금 모두"], ["out", isAccount ? "출금" : "사용"], ["in", isAccount ? "입금" : "환불·입금"]], f.instrumentDirection || "") + '</div>' +
      (f.instrumentPeriod === "custom" ? '<div class="instrument-custom-dates">' +
        field("시작일", "instrument-from", f.instrumentFrom || "", "date") +
        field("종료일", "instrument-to", f.instrumentTo || cashNow().slice(0, 10), "date") + '</div>' : '') +
      '<div class="instrument-search-and-add"><label class="field"><span>내역 검색</span><input type="search" name="instrument-query" placeholder="사용처·금액 검색" value="' + e(f.instrumentQuery || "") + '"></label>' +
      choiceButton("빠진 " + (isAccount ? "입출금" : "카드 거래") + " 입력", "instrument-add", selected.key, "primary") + '</div>' +
      '<p class="cash-small">' + e(range) + ' · 검색 조건에 맞는 ' + data.rows.length + '건' + (isAccount ? " · 미연결 내역은 합계 제외" : " · 카드 청구잔액이 아닌 거래 기록") + '</p>' +
      totals +
      (isAccount ? '<p class="cash-small">실제 계좌 잔액은 위 잔액 확인 정보가 기준이에요. 아래 입출금 합계는 연결된 거래만 표시하며, 카드를 긁은 금액은 계좌 출금으로 처리하지 않아요.</p>' :
        '<p class="cash-small">카드 사용·환불만 보여 줘요. 카드대금이 계좌에서 빠져나간 내역은 계좌에서 따로 기록하고 소비에 두 번 더하지 않아요.</p>') +
      '<div class="instrument-list">' + (list || '<p class="empty-inline">선택한 조건의 거래가 없어요. 빠진 거래를 입력하거나 조회기간을 변경해 주세요.</p>') + '</div>' +
      (data.rows.length > limit ? choiceButton("내역 40건 더 보기", "instrument-more", selected.key, "secondary") : '') :
      '<p class="empty-inline">등록된 계좌나 결제수단이 없어요. 위에서 카드·결제수단을 추가하거나 계좌를 먼저 등록해 주세요.</p>') +
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
export async function instrumentLedgerAction(app, action, target) {
  if (!action.startsWith("instrument-")) return false;
  const s = app.state;
  if (action === "instrument-more") {
    app.cashFilters.instrumentLimit = (app.cashFilters.instrumentLimit || 40) + 40;
    app.render();
  } else if (action === "instrument-method") {
    openDialog("카드·결제수단 등록", '<p>카드번호를 입력할 필요 없어요. 거래에 표시할 이름만 등록해요.</p>' +
      field("카드·결제수단 이름", "name", "", "text", 'required maxlength="100" placeholder="예: 신한카드, 우리카드"'), async f => {
        const name = String(f.get("name") || "").trim(), norm = keyText(name);
        if (!name || name.length > 100 || norm === keyText("미지정")) throw Error("결제수단 이름을 확인해 주세요.");
        await app.update(st => {
          if ((st.cashAccounts || []).some(a => !a.archived && [a.name, a.paymentMethod].filter(Boolean).some(v => keyText(v) === norm)))
            throw Error("같은 이름의 계좌가 있어요. 계좌에서 내역을 관리해 주세요.");
          st.settings.paymentMethods ||= [];
          if (!st.settings.paymentMethods.some(v => keyText(v) === norm))
            st.settings.paymentMethods.push(name);
        });
        app.cashFilters.instrument = "m:" + encodeURIComponent(name);
        app.cashFilters.instrumentLimit = 40;
        app.render();
        toast("결제수단을 추가했어요. 이제 누락 거래를 입력할 수 있어요.");
      });
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
