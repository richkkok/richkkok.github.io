import { incomeAction } from "./income-ui.js";
import { moneyOverview, cycleText, syncCategories, confirmCategory, ambiguousMerchant } from "./money.js";
import { openDialog, field, select, button, hiddenPersonal, transactionRow, toast } from "./ui.js";
import { escape as e, won, today, uid, amountInput, normalizeText } from "./format.js";
import { periodKey, startDay, validDate } from "./period.js";
import { memberName } from "../data/defaults.js";
import { inPeriod, transactionPeriod } from "./period.js";
import { liveIncome } from "./income-schedule.js";
import { incomeReconciliation, incomeAssignmentOptions, reassignRecordedIncome, findDuplicateIncome } from "./income-reconcile.js";
import { budgetIncomeValue } from "./import/normalize.js";

export async function moneyAction(app, action, target) {
  if (await incomeAction(app, action, target)) return true;
  if (!action.startsWith("money-") && action !== "recurring-list") return false;
  const s = app.state, o = moneyOverview(s, app.month), b = o.d;
  if (action === "recurring-list") app.navigate("recurring");
  else if (action === "money-current") {
    app.month = periodKey(today(), startDay(s)); app.render();
  } else if (action === "money-spending") {
    app.filters = { query: "", limit: 100 }; app.navigate("transactions");
  } else if (action === "money-review-more") {
    app.reviewFilters.limit = (app.reviewFilters.limit || 100) + 100; app.render();
  } else if (action === "money-classify") {
    let count = 0;
    await app.update(st => { count = syncCategories(st); });
    toast(`${count}건 자동 분류했어요. 용도를 모르는 거래와 직접 확인한 분류는 바꾸지 않았어요.`);
  } else if (action === "money-review") {
    const t = s.transactions.find(t => t.id === target.dataset.id);
    if (!t || t.deletedAt) throw Error("이 거래가 변경됐어요. 다시 확인해 주세요.");
    if (hiddenPersonal(t, s)) {
      openDialog("개인 내역 보호", `<p>개인 내역 숨기기가 켜져 있어요. 표시를 허용한 다음 분류해 주세요.</p>${button("개인 내역 표시하기", "privacy-off", "secondary")}`);
      return true;
    }
    openDialog("소비 용도 확인", `<p><strong>${e(t.merchantRaw)} · ${won(t.amount)}</strong></p><p>${e(t.date)} · 이 거래의 금액·날짜는 그대로 유지해요.</p><div class="form-grid">${select("어디에 쓴 돈인가요?", "category", s.categories.filter(c => !c.archived).map(c => [c.id, c.name]), t.category)}${field("구매한 내용 / 메모", "note", t.note || "", "text", 'maxlength="1000" placeholder="예: 생필품, 아이 옷, 식료품"')}</div>${ambiguousMerchant(t) ? '<p class="notice">결제대행사·종합몰 이름은 다음 구매의 용도가 달라질 수 있어요. 이 거래만 확정해요.</p>' : '<label class="check-field"><input type="checkbox" name="learn" checked>같은 사용처의 미확인 거래도 이 분류로 기억하기</label>'}<p class="small muted">‘기타’를 그대로 선택해도 직접 확인한 거래로 처리돼요. 한 결제에 여러 용도가 섞였으면 거래 수정에서 분할할 수 있어요.</p><button type="button" class="btn text" data-edit="${e(t.id)}">거래 수정·분할 열기</button>`, async f => {
      await app.update(st => {
        const live = st.transactions.find(x => x.id === t.id);
        if (live?.categoryConfirmed && live.category !== t.category) throw Error("다른 기기에서 분류가 바뀌었어요. 다시 확인해 주세요.");
        confirmCategory(st, t.id, String(f.get("category")), f.get("note"), !!f.get("learn"));
      });
      toast("분류를 확인했어요. 금액은 중복으로 추가하지 않았어요.");
    }, "분류 확정");
  } else if (action === "money-linked") {
    const rows = b.b.tx.filter(t => t.recurringId === target.dataset.id);
    openDialog("연결된 실제 거래", `<p>${e(cycleText(s, app.month))}</p>${rows.map(t => transactionRow(t, s)).join("") || '<p>이 기간에 연결된 실제 납부 내역이 없어요. 거래 가져오기 또는 실제 납부 입력으로 확인해 주세요.</p>'}`);
  } else if (action === "money-payment") {
    const r = o.recurring.find(r => r.id === target.dataset.id && r.date === target.dataset.date);
    if (!r || r.paid) throw Error("납부 상태가 바뀌었어요. 목록을 다시 확인해 주세요.");
    openDialog("실제로 납부한 금액 입력", `<p><strong>${e(r.name)}</strong></p><p>아래 내용은 예정이 아니라 실제 거래로 저장돼요. 은행·카드 내역에서 출금·결제 사실을 확인한 경우에만 입력해 주세요.</p><div class="form-grid">${field("실제 납부일", "date", r.date > today() ? today() : r.date, "date", `required max="${today()}"`)}${field("실제 납부액", "amount", r.outstanding, "number", 'required min="1"')}${field("출금계좌 또는 카드", "payment", r.paymentMethod || "", "text", 'required maxlength="100"')}</div><label class="check-field"><input name="confirmed" type="checkbox" required>실제로 납부했고, 같은 거래를 이미 입력하지 않았어요.</label>`, async f => {
      const date = String(f.get("date")), amount = amountInput(f.get("amount"));
      if (!validDate(date) || date > today() || amount <= 0 || !f.get("confirmed")) throw Error("실제 납부일과 금액을 확인해 주세요.");
      const id = uid();
      await app.update(st => {
        const current = moneyOverview(st, app.month).recurring.find(x => x.id === r.id && x.date === r.date);
        if (!current || current.paid || current.actual !== r.actual) throw Error("납부 내역이 이미 변경됐어요. 중복 입력을 막기 위해 다시 확인해 주세요.");
        const stamp = new Date().toISOString();
        st.transactions.push({ id, sourceId: id, date, datetime: date + "T12:00:00", owner: r.owner || "joint", amount,
          direction: "expense", merchantRaw: r.name, merchantNormalized: normalizeText(r.merchantPattern || r.name),
          category: r.category, categoryConfirmed: true, scope: r.scope || "fixed", costKind: "fixed", recurringId: r.id,
          operatingMonth: app.month, paymentMethod: String(f.get("payment")).trim(), paymentChannel: "", note: "납부 확인 후 직접 기록",
          sourceType: "manual", performanceStatus: "unknown", excluded: false, deletedAt: null, createdAt: stamp, updatedAt: stamp });
      });
      toast("실제 납부 내역을 저장했어요. 예정액과 중복 차감하지 않아요.");
    }, "실제 납부 저장");
  } else if (action === "money-income") {
    const ledger = incomeReconciliation(s, app.month);
    const row = t => {
      const relevant = liveIncome(t, s) && budgetIncomeValue(t, s) > 0;
      const assigned = transactionPeriod(t, s);
      const here = relevant && inPeriod(t, s, app.month);
      const privateEntry = hiddenPersonal(t, s);
      const name = privateEntry ? "개인 내역 숨김" : t.merchantRaw;
      return \`<div class="income-record-row">
        <div class="income-record-detail"><strong>\${e(t.date)} · \${e(name)}</strong>
          <small>\${e(assigned)} 운영월 · \${relevant ? here ? "이번 달 반영" : "다른 달로 반영" : "생활수입 제외"}</small>
        </div>
        <strong class="income-record-amount">\${won(t.amount)}</strong>
        \${privateEntry ? "" : \`<div class="income-record-actions">
          \${relevant && !here ? button("귀속월 변경", "money-income-move", "secondary") .replace('data-action="money-income-move"', 'data-action="money-income-move" data-id="' + e(t.id) + '"') : ""}
          <button type="button" class="btn text" data-edit="\${e(t.id)}">수정</button>
        </div>\`}
      </div>\`;
    };
    const current = ledger.records.filter(t => liveIncome(t, s) && inPeriod(t, s, app.month));
    const other = ledger.records.filter(t => !(liveIncome(t, s) && inPeriod(t, s, app.month)));
    openDialog("실제 입금 내역", \`<div class="income-ledger-head"><strong>\${e(app.month)} 운영월 · \${won(ledger.amount)}</strong>
      \${button("새 입금", "money-add-income", "primary", "plus")}</div>
      \${ledger.nearby.length ? \`<div class="income-ledger-attention"><strong>이전 운영월로 등록된 최근 입금 \${ledger.nearby.length}건 · \${won(ledger.nearbyAmount)}</strong><small>선입금이라면 아래에서 귀속월을 변경해 줘.</small></div>\` : ""}
      <div class="income-ledger-list"><h3>이번 운영월 \${current.length}건</h3>\${current.map(row).join("") || '<p class="empty-inline">이 운영월에 집계된 실제 입금 없음</p>'}
      <h3>다른 운영월 · 집계 제외 \${other.length}건</h3>\${other.slice(0, 60).map(row).join("") || '<p class="empty-inline">다른 입금 내역 없음</p>'}</div>
      \${other.length > 60 ? '<p class="small muted">최근 60건 표시. 전체 거래는 기록 메뉴에서 볼 수 있어.</p>' : ""}\`);
  } else if (action === "money-income-move") {
    const tx = s.transactions.find(t => t.id === target?.dataset.id);
    if (!tx || !liveIncome(tx, s) || tx.date > today())
      throw Error("변경할 실제 입금이 없어.");
    if (hiddenPersonal(tx, s)) throw Error("개인 내역 숨기기를 먼저 해제해 줘.");
    const original = structuredClone(tx);
    const oldMonth = transactionPeriod(tx, s);
    openDialog("입금 귀속월 변경",
      \`<div class="income-move-details"><strong>\${e(tx.date)} · \${won(tx.amount)}</strong><small>현재 \${e(oldMonth)} 운영월</small></div>
        \${select("반영할 운영월", "assignedMonth", incomeAssignmentOptions(s, app.month, tx), app.month)}
        <label class="check-field"><input type="checkbox" name="confirm" required>같은 입금을 중복 등록하지 않고 운영월만 변경</label>\`,
      async form => {
        if (!form.get("confirm")) throw Error("귀속월 변경을 확인해 줘.");
        const month = String(form.get("assignedMonth"));
        let changed = false;
        await app.update(st => {
          changed = reassignRecordedIncome(st, original.id, month, original);
        });
        toast(changed ? \`\${month} 운영월에 반영했어. 기존 금액·날짜는 그대로야.\` : "이미 해당 운영월에 반영돼 있어.");
      }, "운영월 반영");
  } else if (action === "money-add-income") {
    openDialog("실제 입금 기록",
      \`<div class="income-entry-header">\${button("기존 입금 조회·귀속월 변경", "money-income", "secondary")}</div>
       <div class="form-grid">\${field("입금일", "date", today(), "date", \`required max="\${today()}"\`)}
       \${field("실제 입금액", "amount", "", "number", 'required min="1"')}
       \${field("입금 내용", "merchant", "급여", "text", 'required maxlength="100"')}
       \${select("입금 받은 사람", "owner", ["p1", "p2", "joint"].map(id => [id, memberName(id, s)]), "p1")}
       \${field("입금 계좌명", "payment", "", "text", 'required maxlength="100"')}
       \${field("귀속 운영월", "month", app.month, "month", "required")}</div>\`,
      async form => {
        const date = String(form.get("date")), month = String(form.get("month")),
          amount = amountInput(form.get("amount")),
          owner = String(form.get("owner")), merchant = String(form.get("merchant")).trim();
        if (!validDate(date) || date > today() ||
            !/^\\d{4}-(0[1-9]|1[0-2])$/.test(month) || !amount || !merchant)
          throw Error("입금일·금액·귀속월을 확인해 줘.");
        const existing = findDuplicateIncome(app.state, {date, amount, owner, merchant});
        if (existing)
          throw Error(\`기존 입금이 있어 (\${existing.date}, \${won(existing.amount)}). 위 ‘기존 입금 조회’에서 귀속월을 확인해 줘.\`);
        const id = uid(), stamp = new Date().toISOString();
        await app.update(st => {
          if (findDuplicateIncome(st, {date, amount, owner, merchant}))
            throw Error("이미 등록된 입금이야. 기존 입금을 조회해 줘.");
          st.transactions.push({
            id, sourceId: id, date, datetime: date + "T12:00:00",
            amount, direction: "income", owner, merchantRaw: merchant,
            merchantNormalized: normalizeText(merchant), category: "other",
            scope: "shared", paymentMethod: String(form.get("payment")).trim(),
            note: "", operatingMonth: month, sourceType: "manual",
            performanceStatus: "unknown", excluded: false, deletedAt: null,
            createdAt: stamp, updatedAt: stamp,
          });
        });
        toast(\`\${month} 운영월 실제 입금을 기록했어.\`);
      }, "입금 저장");
  } else if (action === "money-plan") {
    const p = b.plan;
    openDialog("생활비·용돈·저축 목표", `<p>${e(cycleText(s, app.month))} 기준이에요. 공동 생활비와 두 사람의 용돈 합계가 소비 목표가 돼요.</p><div class="form-grid">${field("공동 생활비", "shared", p.sharedBudget, "number", "required")}${field(memberName("p1", s) + " 용돈", "p1", p.personalBudgets.p1, "number", "required")}${field(memberName("p2", s) + " 용돈", "p2", p.personalBudgets.p2, "number", "required")}${field("저축 목표", "saving", b.savingsTarget, "number", "required")}${field("고정비 최소 준비액", "fixed", p.fixedReserve || 0, "number", "required")}</div><p class="small muted">고정비 준비액은 실제·예정 고정비에 더하지 않고, 둘 중 큰 금액만 확보해요. 실제 거래나 모은 저축액은 이 설정으로 바뀌지 않아요.</p><label class="check-field"><input name="future" type="checkbox">이 금액을 앞으로 기본 목표로도 사용</label>`, async f => {
      const shared = amountInput(f.get("shared")), p1 = amountInput(f.get("p1")), p2 = amountInput(f.get("p2"));
      if (shared + p1 + p2 > 1e12) throw Error("소비 목표 합계가 너무 커요.");
      const values = { sharedBudget: shared, personalBudgets: { p1, p2 }, variableBudget: shared + p1 + p2,
        savingsTarget: amountInput(f.get("saving")), fixedReserve: amountInput(f.get("fixed")) };
      await app.update(st => {
        st.settings.monthOverrides ||= {};
        st.settings.monthOverrides[app.month] = { ...st.settings.monthOverrides[app.month], ...values };
        if (f.get("future")) Object.assign(st.settings, values);
      });
      toast("생활비·용돈·저축 목표를 함께 반영했어요.");
    });
  } else if (action === "money-explain") {
    openDialog("남은 예산 계산 근거", `<p>${e(cycleText(s, app.month))}</p><div class="money-calculation"><p>계산에 사용한 수입 <b>${won(b.b.income)}</b> (${b.plan.incomeMode === "actual" ? "등록된 생활수입" : "계획 수입"})</p><p>− 고정비·자동이체 준비 <b>${won(b.fixed)}</b></p><p>− 저축 목표 <b>${won(b.savingsTarget)}</b></p><hr><p>위 가용범위와 소비 목표 ${won(b.requested)} 중 작은 금액: <b>${won(b.budget)}</b></p><p>− 변동소비·용돈·일회성 소비 <b>${won(b.actual)}</b></p><h3>남은 소비 예산 ${won(b.remaining)}</h3><p>그중 아직 남은 개인용돈 ${won(o.allowanceReserve)}은 따로 확보해요. 공동 생활비는 설정 잔액과 확보 후 잔액 중 작은 금액 ${won(o.sharedRemaining)}이에요.</p><p>자동이체 미확인액 ${won(o.unpaid)}은 고정비 준비액에 이미 포함했어요. 실제 납부하면 예정액에서 실제액으로 옮겨지므로 두 번 빼지 않아요.</p></div><p class="notice">계좌 잔액이나 실제 쓸 수 있는 현금을 보증하는 숫자는 아니에요. 미입력 거래·급여·변동 청구액을 확인해 주세요.</p>`);
  } else return false;
  return true;
}
