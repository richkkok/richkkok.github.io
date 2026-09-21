import {
  field,
  select,
  openDialog,
  button,
  hiddenPersonal,
  toast,
} from "./ui.js";
import {
  SCOPES,
  DIRECTIONS,
  PERFORMANCE,
  scopeName,
  memberName,
} from "../data/defaults.js";
import {
  escape as e,
  amountInput,
  uid,
  today,
  won,
  normalizeText,
} from "./format.js";
import { splitTransaction } from "./models.js";
import { classify, applyRules } from "./rules.js";
import { matchRecurring } from "./recurring.js";
import { planFor } from "./budget.js";
const categoryOptions = (s) =>
  s.categories.filter((c) => !c.archived).map((c) => [c.id, c.name]);
const scopeOptions = (s) =>
  Object.keys(SCOPES).map((k) => [k, scopeName(k, s)]);
export function editTransaction(app, id) {
  const state = app.state,
    existing = state.transactions.find((t) => t.id === id);
  if (existing && hiddenPersonal(existing, state)) {
    openDialog(
      "개인 내역은 숨겨져 있어요",
      `<p>공동 보기에서는 가맹점과 메모를 표시하지 않아요. 설정에서 개인 내역 숨기기를 해제하면 수정할 수 있어요.</p>${button("개인 내역 표시하기", "privacy-off", "secondary")}`,
    );
    return;
  }
  const tx = existing || {
    id: uid(),
    sourceId: uid(),
    owner: "p1",
    date: today(),
    datetime: today() + "T12:00:00",
    merchantRaw: "",
    amount: 0,
    direction: "expense",
    category: "other",
    scope: "shared",
    paymentMethod: "",
    note: "",
    recurringId: "",
    performanceStatus: "unknown",
  };
  if (tx.deletedAt) {
    openDialog(
      "삭제한 내역",
      `<p>${e(tx.merchantRaw)} · ${won(tx.amount)}</p><p>휴지통의 내역은 모든 계산에서 제외돼요.</p><button class="btn primary" data-restore-transaction="${e(id)}">이 내역 복원하기</button>`,
    );
    return;
  }
  const body = `<div class="form-grid">${field("가맹점 / 적요", "merchantRaw", tx.merchantRaw, "text", 'required maxlength="300"')}${field("금액 (원)", "amount", tx.amount, "number", "required")}${field("날짜와 시간", "datetime", tx.datetime.slice(0, 16), "datetime-local", "required")}${select("거래 유형", "direction", Object.entries(DIRECTIONS), tx.direction)}${select(
    "사용자",
    "owner",
    ["p1", "p2", "joint"].map((p) => [p, memberName(p, state)]),
    tx.owner,
  )}${select("사용 범위", "scope", scopeOptions(state), tx.scope)}${select("카테고리", "category", categoryOptions(state), tx.category)}${field("결제수단", "paymentMethod", tx.paymentMethod, "text", 'required maxlength="100"')}${select("카드 실적인정", "performanceStatus", Object.entries(PERFORMANCE), tx.performanceStatus)}${select("고정·반복비 연결", "recurringId", [["", "연결하지 않음"], ...state.recurring.map((r) => [r.id, r.name])], tx.recurringId)}</div>${field("귀속 운영월 (선택)", "operatingMonth", tx.operatingMonth || "", "month")}${select("지출 성격", "costKind", [["variable","변동비"],["fixed","고정비"],["oneoff","일회성 지출"]], tx.costKind || (tx.scope === "fixed" || tx.recurringId ? "fixed" : "variable"))}${field("결제경로 (선택)", "paymentChannel", tx.paymentChannel || "", "text", 'maxlength="100"')}${field("메모", "note", tx.note, "text", 'maxlength="1000"')}<label class="check-field"><input name="saveRule" type="checkbox">이 가맹점의 분류·범위·실적 상태를 앞으로도 적용</label>${existing ? `<div class="editor-secondary">${!tx.parentId ? `<button class="btn secondary" type="button" data-split="${e(tx.id)}">거래 분할</button>` : '<span class="small muted">분할된 내역이에요</span>'}<button class="btn danger-text" type="button" data-delete-transaction="${e(tx.id)}">휴지통으로 이동</button></div>` : ""}`;
  openDialog(existing ? "내역 수정" : "내역 직접 입력", body, async (form) => {
    const datetime = String(form.get("datetime"));
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(datetime))
      throw Error("날짜와 시간을 확인해 주세요.");
    const stamp = new Date().toISOString(),
      scope = String(form.get("scope")),
      direction = String(form.get("direction"));
    let next = {
      ...tx,
      merchantRaw: String(form.get("merchantRaw")).trim(),
      merchantNormalized: normalizeText(form.get("merchantRaw")),
      amount: amountInput(form.get("amount")),
      date: datetime.slice(0, 10),
      datetime: datetime + ":00",
      direction,
      operatingMonth: String(form.get("operatingMonth") || "") || null,
      costKind: scope === "fixed" ? "fixed" : String(form.get("costKind")),
      paymentChannel: String(form.get("paymentChannel") || ""),
      category: String(form.get("category")),
      scope,
      owner: String(form.get("owner")),
      paymentMethod: String(form.get("paymentMethod")).trim(),
      note: String(form.get("note")),
      recurringId: form.get("recurringId") || null,
      performanceStatus: String(form.get("performanceStatus")),
      excluded: scope === "excluded" || direction === "transfer",
      updatedAt: stamp,
      createdAt: tx.createdAt || stamp,
      sourceType: tx.sourceType || "manual",
      deletedAt: null,
    };
    if (!next.merchantRaw) throw Error("가맹점 또는 적요를 입력해 주세요.");
    if (!existing && next.category === "other")
      next = classify(next, state.rules);
    next = matchRecurring(next, state.recurring);
    await app.update((s) => {
      const index = s.transactions.findIndex((t) => t.id === next.id);
      if (index < 0) s.transactions.push(next);
      else s.transactions[index] = next;
      if (form.get("saveRule"))
        s.rules.unshift({
          id: uid(),
          match: "exact",
          field: "merchant",
          pattern: next.merchantNormalized,
          category: next.category,
          scope: next.scope,
          performanceStatus: next.performanceStatus,
          enabled: true,
        });
    });
    toast("내역을 저장했어요.");
  });
}
export function splitEditor(app, id) {
  const tx = app.state.transactions.find((t) => t.id === id);
  if (!tx) return;
  openDialog(
    "거래를 두 항목으로 나누기",
    `<p><strong>${e(tx.merchantRaw)} · ${won(tx.amount)}</strong></p><p class="muted">합계는 그대로 두고 범위와 카테고리를 나눠요.</p>${[1, 2].map((n) => `<h3>${n}번째 항목</h3><div class="form-grid">${field("금액 (원)", `amount${n}`, n === 1 ? Math.floor(tx.amount / 2) : tx.amount - Math.floor(tx.amount / 2), "number", 'required min="1"')}${select("카테고리", `category${n}`, categoryOptions(app.state), tx.category)}${select("사용 범위", `scope${n}`, scopeOptions(app.state), tx.scope)}</div>`).join("")}`,
    async (form) => {
      const parts = [1, 2].map((n) => ({
        amount: amountInput(form.get(`amount${n}`)),
        category: String(form.get(`category${n}`)),
        scope: String(form.get(`scope${n}`)),
        excluded: form.get(`scope${n}`) === "excluded",
      }));
      const split = splitTransaction(tx, parts);
      await app.update((s) => {
        s.transactions = s.transactions.filter((t) => t.id !== id);
        s.transactions.push(...split);
      });
      toast("합계를 유지한 채 두 항목으로 나눴어요.");
    },
  );
}
export function budgetEditor(app) {
  const p = planFor(app.state, app.month);
  openDialog(
    "이번 달 예산",
    `<p class="muted">${app.month}에만 적용해요. 수입은 홈의 “수입”을 눌러 상여·보너스까지 따로 관리할 수 있어요.</p><div class="form-grid">${field("공동생활비 (원)", "sharedBudget", p.sharedBudget, "number", "required")}${field(`${app.state.settings.members.p1} 용돈 (원)`, "p1Budget", p.personalBudgets.p1, "number", "required")}${field(`${app.state.settings.members.p2} 용돈 (원)`, "p2Budget", p.personalBudgets.p2, "number", "required")}</div><h3>카테고리별 목표</h3><div class="form-grid">${app.state.categories
      .filter((c) => !c.archived)
      .map((c) =>
        field(
          `${c.name} (원)`,
          `category-${c.id}`,
          p.categoryBudgets[c.id] || 0,
          "number",
        ),
      )
      .join("")}</div>`,
    async (form) => {
      const values = {
        sharedBudget: amountInput(form.get("sharedBudget")),
        personalBudgets: {
          p1: amountInput(form.get("p1Budget")),
          p2: amountInput(form.get("p2Budget")),
        },
        categoryBudgets: Object.fromEntries(
          app.state.categories
            .filter((c) => !c.archived)
            .map((c) => [c.id, amountInput(form.get(`category-${c.id}`) || 0)]),
        ),
      };
      await app.update((s) => {
        s.settings.monthOverrides ||= {};
        s.settings.monthOverrides[app.month] = {
          ...(s.settings.monthOverrides[app.month] || {}),
          ...values,
        };
      });
      toast("이번 달 예산을 저장했어요.");
    },
  );
}
export function recurringEditor(app, id) {
  const s = app.state,
    r = s.recurring.find((r) => r.id === id) || {
      id: uid(),
      name: "",
      amount: 0,
      category: "housing",
      paymentMethod: "",
      day: 1,
      owner: "joint",
      scope: "fixed",
      start: today(),
      end: "",
      merchantPattern: "",
      changes: [],
      protected: false,
    };
  const next = r.changes.filter((c) => c.effective >= today()).at(-1);
  openDialog(
    id ? "고정·반복비 수정" : "고정·반복비 추가",
    `<div class="form-grid">${field("이름", "name", r.name, "text", 'required maxlength="80"')}${field("월 금액 (원)", "amount", r.amount, "number", "required")}${field("매월 결제일", "day", r.day, "number", 'required min="1" max="31"')}${select("카테고리", "category", categoryOptions(s), r.category)}${field("결제수단", "paymentMethod", r.paymentMethod, "text", 'maxlength="100"')}${select(
      "사용자",
      "owner",
      ["joint", "p1", "p2"].map((p) => [p, memberName(p, s)]),
      r.owner,
    )}${select(
      "사용 범위",
      "scope",
      scopeOptions(s).filter(([id]) => id !== "excluded"),
      r.scope,
    )}${field("시작일", "start", r.start, "date", "required")}${field("종료일 (선택)", "end", r.end, "date")}${field("가맹점 포함 문구 (자동 연결)", "merchantPattern", r.merchantPattern, "text", 'maxlength="100"')}</div><label class="check-field"><input name="protected" type="checkbox" ${r.protected ? "checked" : ""}>유지할 고정비 · 절약 권고 대상에서 제외</label><h3>앞으로 금액이 바뀌나요?</h3><div class="form-grid">${field("변경 적용일", "effective", next?.effective || "", "date")}${field("변경 후 월 금액 (원)", "futureAmount", next?.amount ?? "", "number")}</div><p class="small muted">기존 적용 이력은 보존해요. 같은 적용일을 입력하면 해당 금액을 수정해요. 실제 거래의 가맹점 문구와 결제수단이 맞으면 자동 연결해요.</p>${id ? `<button class="btn danger-text" type="button" data-remove-recurring="${e(id)}">반복비 삭제</button>` : ""}`,
    async (f) => {
      const changes = r.changes.filter(
        (c) => c.effective !== f.get("effective"),
      );
      if (f.get("effective")) {
        if (f.get("futureAmount") === "")
          throw Error("변경 후 금액을 입력해 주세요.");
        changes.push({
          effective: String(f.get("effective")),
          amount: amountInput(f.get("futureAmount")),
        });
      }
      if (f.get("end") && f.get("end") < f.get("start"))
        throw Error("종료일은 시작일 이후여야 해요.");
      const day = Number(f.get("day"));
      if (day < 1 || day > 31) throw Error("결제일은 1~31일로 입력해 주세요.");
      const item = {
        ...r,
        name: String(f.get("name")).trim(),
        amount: amountInput(f.get("amount")),
        day,
        category: String(f.get("category")),
        paymentMethod: String(f.get("paymentMethod")).trim(),
        owner: String(f.get("owner")),
        scope: String(f.get("scope")),
        start: String(f.get("start")),
        end: String(f.get("end")),
        merchantPattern: String(f.get("merchantPattern")).trim(),
        protected: !!f.get("protected"),
        changes: changes.sort((a, b) => a.effective.localeCompare(b.effective)),
      };
      await app.update((s) => {
        s.recurring = s.recurring.filter((x) => x.id !== r.id);
        s.recurring.push(item);
        s.transactions = s.transactions.map((t) =>
          matchRecurring(t, s.recurring),
        );
      });
      toast("반복비를 저장했어요.");
    },
  );
}
export function goalEditor(app, id) {
  const g = app.state.goals.find((g) => g.id === id) || {
    id: uid(),
    name: "",
    target: 0,
    saved: 0,
    monthly: 0,
    start: app.month,
    end: "",
  };
  openDialog(
    "저축목표",
    `<div class="form-grid">${field("목표 이름", "name", g.name, "text", 'required maxlength="60"')}${field("목표 금액 (원)", "target", g.target, "number", "required")}${field("현재 모은 금액 (원)", "saved", g.saved, "number", "required")}${field("월 배정액 (원)", "monthly", g.monthly, "number", "required")}${field("배정 시작월", "start", g.start, "month", "required")}${field("배정 종료월 (선택)", "end", g.end, "month")}</div><p class="small muted">계좌 간 저축 이체는 소비에 포함하지 않아요. 월 배정액은 가용금액에서 한 번 차감해요.</p>${id ? `<button class="btn danger-text" type="button" data-remove-goal="${e(id)}">목표 삭제</button>` : ""}`,
    async (f) => {
      const item = {
        ...g,
        name: String(f.get("name")).trim(),
        target: amountInput(f.get("target")),
        saved: amountInput(f.get("saved")),
        monthly: amountInput(f.get("monthly")),
        start: String(f.get("start")),
        end: String(f.get("end")),
      };
      if (item.end && item.end < item.start)
        throw Error("종료월을 확인해 주세요.");
      await app.update((s) => {
        s.goals = s.goals.filter((x) => x.id !== g.id);
        s.goals.push(item);
      });
    },
  );
}
export function ruleEditor(app, id) {
  const r = app.state.rules.find((r) => r.id === id) || {
    id: uid(),
    field: "merchant",
    match: "exact",
    pattern: "",
    category: "",
    scope: "",
    performanceStatus: "",
    enabled: true,
  };
  openDialog(
    "자동분류 규칙",
    `<div class="form-grid">${select(
      "어떤 값을 볼까요?",
      "field",
      [
        ["merchant", "가맹점 / 적요"],
        ["payment", "카드 / 계좌"],
      ],
      r.field,
    )}${select(
      "연결 방식",
      "match",
      [
        ["exact", "정확히 일치"],
        ["keyword", "문구 포함"],
      ],
      r.match,
    )}${field("찾을 문구", "pattern", r.pattern, "text", 'required maxlength="200"')}${select("카테고리", "category", [["", "변경하지 않음"], ...categoryOptions(app.state)], r.category)}${select("사용 범위", "scope", [["", "변경하지 않음"], ...scopeOptions(app.state)], r.scope)}${select("실적 상태", "performanceStatus", [["", "변경하지 않음"], ...Object.entries(PERFORMANCE)], r.performanceStatus)}</div><label class="check-field"><input name="applyExisting" type="checkbox">기존 내역에도 지금 적용하기</label><p class="small muted">정확히 일치하는 규칙을 포함 규칙보다 먼저 적용해요. 같은 단계에서는 위에 있는 규칙이 우선해요. 이체는 지출로 바꾸지 않아요.</p>${id ? `<button class="btn danger-text" type="button" data-remove-rule="${e(id)}">규칙 삭제</button>` : ""}`,
    async (f) => {
      const rule = {
        ...r,
        field: String(f.get("field")),
        match: String(f.get("match")),
        pattern: String(f.get("pattern")).trim(),
        category: String(f.get("category")),
        scope: String(f.get("scope")),
        performanceStatus: String(f.get("performanceStatus")),
      };
      if (
        !rule.pattern ||
        (!rule.category && !rule.scope && !rule.performanceStatus)
      )
        throw Error("찾을 문구와 적용할 항목을 하나 이상 정해 주세요.");
      await app.update((s) => {
        s.rules = s.rules.filter((x) => x.id !== r.id);
        s.rules.unshift(rule);
        if (f.get("applyExisting"))
          s.transactions = applyRules(s.transactions, s.rules).map((t) =>
            t.direction === "transfer"
              ? { ...t, scope: "excluded", excluded: true }
              : { ...t, excluded: t.scope === "excluded" },
          );
      });
      toast("분류 규칙을 저장했어요.");
    },
  );
}
export function categoryEditor(app, id) {
  const c = app.state.categories.find((c) => c.id === id) || {
    id: uid(),
    name: "",
    icon: "dots",
    archived: false,
  };
  openDialog(
    "카테고리",
    `${field("카테고리 이름", "name", c.name, "text", 'required maxlength="30"')}<label class="check-field"><input name="archived" type="checkbox" ${c.archived ? "checked" : ""}>새 입력에서 숨기기 (기존 내역은 보존)</label>`,
    async (f) => {
      const name = String(f.get("name")).trim();
      if (!name) throw Error("이름을 입력해 주세요.");
      await app.update((s) => {
        s.categories = s.categories.filter((x) => x.id !== c.id);
        s.categories.push({ ...c, name, archived: !!f.get("archived") });
      });
    },
  );
}
