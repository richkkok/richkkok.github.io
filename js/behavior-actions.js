import { openDialog, field, select, toast } from "./ui.js";
import {
  amountInput,
  escape as e,
  today,
  uid,
  normalizeText,
  won,
  keyText,
} from "./format.js";
import { period, periodKey, startDay, addDays, validDate } from "./period.js";
import { dashboard, closeDay, dayStatus, reconcile } from "./behavior.js";
import { baselineAnalysis, defaultBaseline } from "./baseline.js";
import { classify } from "./rules.js";
import { matchRecurring, syncAutoRecurring } from "./recurring.js";
import { planFor } from "./budget.js";
import { memberName } from "../data/defaults.js";
import { exactApprovalDuplicate, fixedManualDuplicate } from "./import/duplicates.js";

export function resolveEntryOwner(
  app,
  state,
  storage = globalThis.localStorage,
) {
  try {
    const saved = storage?.getItem("richkkok-owner");
    if (["p1", "p2", "joint"].includes(saved)) return saved;
  } catch {}

  const cloudMember = app.cloud?.meta?.member;
  const profiles = ["p1", "p2"].map((id) => ({
    id,
    name: memberName(id, state),
    key: keyText(memberName(id, state)),
  }));

  if (cloudMember) {
    if (cloudMember.role === "owner") return "p1";
    const deviceKey = keyText(cloudMember.displayName || "");
    const exact = profiles.find((profile) => profile.key === deviceKey);
    if (exact) return exact.id;

    const aliases = profiles.filter((profile) => {
      const hangul = profile.key.replace(/[^가-힣]/g, "");
      const given = hangul.length >= 2 ? hangul.slice(-2) : hangul;
      return given.length >= 2 && deviceKey.includes(given);
    });
    if (aliases.length === 1) return aliases[0].id;
  }
  return "p1";
}

export function resolveEntryPayment(
  state,
  owner,
  recent,
  storage = globalThis.localStorage,
) {
  try {
    const saved = storage?.getItem(`richkkok-payment-${owner}`);
    if (saved) return saved;
  } catch {}
  return (
    recent.find((t) => t.owner === owner && t.paymentMethod)?.paymentMethod ||
    state.settings.paymentMethods?.[0] ||
    "미지정"
  );
}

export function quickEntry(app, date = today()) {
  const state = app.state,
    recent = state.transactions
      .filter(
        (t) =>
          !t.deletedAt &&
          !t.splitParent &&
          (!state.settings.privacy || !["p1", "p2"].includes(t.scope)),
      )
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const owner = resolveEntryOwner(app, state);
  let payment = resolveEntryPayment(state, owner, recent);
  const merchants = [...new Set(recent.map((t) => t.merchantRaw))].slice(0, 30);
  const cats = state.categories
    .filter((c) => !c.archived)
    .map((c) => [c.id, c.name]);
  const id = uid(),
    stamp = new Date();
  let touched = false;
  const dialog = openDialog(
    "지출 입력",
    `<div class="quick-entry-primary"><div class="form-grid quick-core-grid">${select(
      "누가 썼어?",
      "owner",
      ["p1", "p2", "joint"].map((p) => [p, memberName(p, state)]),
      owner,
    )}${field("어디서 썼어?", "merchant", "", "text", 'required maxlength="300" list="recent-merchants" placeholder="예: 스타벅스, 이마트, 병원')}<datalist id="recent-merchants">${merchants.map((m) => `<option value="${e(m)}"></option>`).join("")}</datalist><div class="quick-amount">${field("얼마 썼어?", "amount", "", "number", 'required min="1" autofocus placeholder="0"')}</div>${field("어떻게 결제했어?", "paymentMethod", payment, "text", 'required maxlength="100" list="payment-options" placeholder="예: 우리카드, 현금, 네이버페이')}<datalist id="payment-options">${[...new Set([...(state.settings.paymentMethods || []), ...recent.map((t) => t.paymentMethod)])].map((p) => `<option value="${e(p)}"></option>`).join("")}</datalist></div><div id="auto-entry-summary" class="auto-entry-summary"><span class="auto-dot"></span><span><strong>자동으로 분류할게</strong><small>사용처를 입력하면 카테고리를 추천해.</small></span></div></div><details class="advanced quick-adjust"><summary>날짜 · 분류 수정</summary><div class="form-grid">${field("거래일", "date", date, "date", "required")}${select("카테고리", "category", cats, "other")}</div><details class="advanced secondary-advanced"><summary>고급 옵션</summary><div class="form-grid">${select(
      "거래 유형",
      "direction",
      [
        ["expense", "지출"],
        ["refund", "환불"],
        ["income", "수입"],
        ["transfer", "이체·카드대금"],
      ],
      "expense",
    )}${select(
      "사용 범위",
      "scope",
      [
        ["shared", "공동생활비"],
        ["p1", memberName("p1", state) + " 개인"],
        ["p2", memberName("p2", state) + " 개인"],
        ["fixed", "공동고정비"],
      ],
      "shared",
    )}${select(
      "지출 성격",
      "costKind",
      [
        ["variable", "변동비"],
        ["fixed", "고정비"],
        ["oneoff", "일회성 지출"],
      ],
      "variable",
    )}${field("결제경로", "paymentChannel", "", "text", 'placeholder="네이버페이·쿠팡페이 등" maxlength="100"')}${field("귀속 운영월", "operatingMonth", "", "month")}${field("메모", "note", "", "text", 'maxlength="1000"')}${field("태그", "tags", "", "text", 'maxlength="200"')}</div></details></details>`,
    async (f) => {
      const actualDate = String(f.get("date"));
      if (!validDate(actualDate)) throw Error("실제 거래일을 확인해 주세요.");
      const now = new Date().toISOString(),
        direction = String(f.get("direction")),
        scope = String(f.get("scope"));
      const tx = matchRecurring(
        {
          id,
          sourceId: id,
          owner: String(f.get("owner")),
          date: actualDate,
          datetime:
            actualDate +
            "T" +
            [stamp.getHours(), stamp.getMinutes(), stamp.getSeconds()]
              .map((x) => String(x).padStart(2, "0"))
              .join(":"),
          merchantRaw: String(f.get("merchant")).trim(),
          merchantNormalized: normalizeText(f.get("merchant")),
          amount: amountInput(f.get("amount")),
          direction,
          scope: direction === "transfer" ? "excluded" : scope,
          excluded: direction === "transfer",
          category: String(f.get("category")),
          costKind: scope === "fixed" ? "fixed" : String(f.get("costKind")),
          paymentMethod: String(f.get("paymentMethod")).trim() || "미지정",
          paymentChannel: String(f.get("paymentChannel")).trim(),
          operatingMonth: String(f.get("operatingMonth")) || null,
          note: String(f.get("note")),
          tags: String(f.get("tags"))
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          sourceType: "manual",
          createdAt: now,
          updatedAt: now,
          enteredBy: app.cloud?.meta?.member?.id || String(f.get("owner")),
          performanceStatus: "unknown",
        },
        state.recurring,
      );
      if (tx.date > today())
        throw Error("아직 발생하지 않은 거래는 고정비 계획에 등록해 줘.");
      const duplicate = app.state.transactions.find(
        (t) =>
          !t.deletedAt &&
          !t.splitParent &&
          t.id !== id &&
          (exactApprovalDuplicate(t, tx) || fixedManualDuplicate(t, tx)),
      );
      if (duplicate && !f.get("allowDuplicate")) {
        if (!dialog.querySelector("[name=allowDuplicate]"))
          dialog
            .querySelector(".dialog-body")
            .insertAdjacentHTML(
              "beforeend",
              '<label class="check-field"><input type="checkbox" name="allowDuplicate">별도 결제가 맞아</label>',
            );
        throw Error("같은 소비로 보이는 기록이 있어. 별도 결제인지 확인해 줘.");
      }
      if (!tx.merchantRaw || tx.amount <= 0)
        throw Error("금액과 소비처를 입력해 주세요.");
      await app.update((s) => {
        if (s.transactions.some((t) => t.id === id)) return;
        s.transactions.push(tx);
        s.settings.trackingSince ||= actualDate;
        if (touched) {
          s.rules = s.rules.filter(
            (r) => !(r.learned && r.pattern === tx.merchantNormalized),
          );
          s.rules.unshift({
            id: "learn-" + uid(),
            pattern: tx.merchantNormalized,
            field: "merchant",
            match: "exact",
            category: tx.category,
            enabled: true,
            learned: true,
          });
        }
        syncAutoRecurring(s);
      });
      try {
        localStorage.setItem("richkkok-owner", tx.owner);
        localStorage.setItem(`richkkok-payment-${tx.owner}`, tx.paymentMethod);
      } catch {}
      toast("저장했어. 다음 입력도 마지막 사용자로 유지할게.");
    },
    "저장",
  );

  const categoryName = (id) =>
    state.categories.find((c) => c.id === id)?.name || "기타";
  let paymentTouched = false;
  const refreshAutoSummary = () => {
    const merchant = normalizeText(
      dialog.querySelector("[name=merchant]")?.value || "",
    );
    const ownerValue = dialog.querySelector("[name=owner]")?.value || owner;
    payment =
      dialog.querySelector("[name=paymentMethod]")?.value?.trim() ||
      payment ||
      "미지정";
    let category = dialog.querySelector("[name=category]")?.value || "other";
    if (!touched && merchant) {
      const prior = recent.find(
        (t) => keyText(t.merchantNormalized) === keyText(merchant),
      );
      category =
        prior?.category ||
        classify(
          { merchantNormalized: merchant, paymentMethod: payment },
          state.rules,
        ).category;
      const selectEl = dialog.querySelector("[name=category]");
      if (selectEl)
        selectEl.value = cats.some((c) => c[0] === category)
          ? category
          : "other";
    }
    const summary = dialog.querySelector("#auto-entry-summary");
    if (summary)
      summary.innerHTML = `<span class="auto-dot"></span><span><strong>${merchant ? e(categoryName(category)) + " 자동분류" : "자동으로 분류할게"}</strong><small>${merchant ? "필요하면 아래에서 분류만 바꿔줘." : "사용처를 입력하면 카테고리를 추천해."}</small></span>`;
  };
  dialog.querySelector("[name=category]").onchange = () => {
    touched = true;
    refreshAutoSummary();
  };
  dialog.querySelector("[name=merchant]").oninput = refreshAutoSummary;
  dialog.querySelector("[name=owner]").onchange = (event) => {
    if (!paymentTouched) {
      const nextOwner = event.target.value;
      const paymentInput = dialog.querySelector("[name=paymentMethod]");
      const nextPayment = resolveEntryPayment(state, nextOwner, recent);
      if (paymentInput) paymentInput.value = nextPayment;
      payment = nextPayment;
    }
    refreshAutoSummary();
  };
  dialog.querySelector("[name=paymentMethod]").oninput = () => {
    paymentTouched = true;
    refreshAutoSummary();
  };
  refreshAutoSummary();
}

export async function behaviorAction(app, action, target) {
  const s = app.state,
    b = dashboard(s, app.month);
  if (action === "quick-expense") {
    quickEntry(app, target?.dataset.date || today());
    return true;
  }
  if (action === "close-day" || action === "zero-day") {
    const date = target?.dataset.date || today(),
      d = dayStatus(s, date);
    openDialog(
      `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일 기록 마감`,
      `<div class="close-summary"><strong>${won(d.total)}</strong><span>${d.count}건의 지출</span></div><p>두 사람의 카드·간편결제·현금 소비까지 빠짐없이 기록했는지 확인해 줘.</p><label class="check-field"><input name="complete" type="checkbox" required>누락된 소비가 없는지 확인했어</label>`,
      async () => {
        await app.update((st) =>
          closeDay(
            st,
            date,
            action === "zero-day" ? "zero" : "complete",
            app.cloud?.meta?.member?.id || "joint",
          ),
        );
        toast("하루 기록을 마감했어.");
      },
      action === "zero-day" ? "무지출 확인" : "기록 완료",
    );
  } else if (action === "behavior-plan") {
    const p = planFor(s, app.month);
    openDialog(
      "소비·저축 목표",
      `<p>${app.month} 운영월 목표야. 고정비를 제외한 공동생활비와 개인용돈을 합쳐 변동비로 관리해.</p><div class="form-grid">${field("변동지출 목표 (원)", "variableBudget", p.variableBudget ?? b.requested, "number", "required")}${field("목표저축 (원)", "savingsTarget", p.savingsTarget ?? b.savingsTarget, "number", "required")}</div><details class="advanced"><summary>고정비 준비액 조정</summary>${field("고정비 최소 준비액 (원)", "fixedReserve", p.fixedReserve || 0, "number", "required")}<p>추천 적용 시 과거 평균 고정비를 준비해 둬. 실제·예정 고정비와 합산하지 않고 둘 중 큰 금액을 반영해. 고정비가 줄었다면 직접 낮출 수 있어.</p></details><p class="notice">수입 ${won(b.b.income)} − 고정비 ${won(b.fixed)} 안에서 정해 줘. 목표 합계가 수입을 넘으면 홈에 계획 부족액을 표시해.</p><label class="check-field"><input name="future" type="checkbox">다음 운영월에도 기본 목표로 사용</label>`,
      async (f) => {
        const values = {
          variableBudget: amountInput(f.get("variableBudget")),
          savingsTarget: amountInput(f.get("savingsTarget")),
          fixedReserve: amountInput(f.get("fixedReserve")),
        };
        await app.update((st) => {
          st.settings.monthOverrides ||= {};
          st.settings.monthOverrides[app.month] = {
            ...st.settings.monthOverrides[app.month],
            ...values,
          };
          if (f.get("future")) Object.assign(st.settings, values);
        });
        toast("목표를 적용했어.");
      },
    );
  } else if (action === "period-settings") {
    openDialog(
      "운영월과 급여일",
      `<div class="form-grid">${field("운영월 시작일", "day", startDay(s), "number", 'required min="1" max="31"')}${field(memberName("p1", s) + " 급여일", "salary1", s.settings.salaryDays?.[0] || 10, "number", 'required min="1" max="31"')}${field(memberName("p2", s) + " 급여일", "salary2", s.settings.salaryDays?.[1] || 15, "number", 'required min="1" max="31"')}</div><p>기본은 10일~다음 달 9일이야. 없는 날짜는 그달 마지막 날로 맞춰. 실제 거래일과 직접 지정한 귀속 운영월은 바꾸지 않아. 기준일을 바꾸면 자동 귀속 거래의 운영월과 통계가 다시 계산돼.</p>`,
      async (f) => {
        const values = ["day", "salary1", "salary2"].map((k) =>
          Number(f.get(k)),
        );
        if (values.some((x) => !Number.isInteger(x) || x < 1 || x > 31))
          throw Error("1~31일로 입력해 줘.");
        await app.update((st) => {
          st.settings.periodStartDay = values[0];
          st.settings.salaryDays = values.slice(1);
        });
        app.month = periodKey(today(), values[0]);
        app.render();
      },
    );
  } else if (action === "baseline-settings") {
    const h = s.settings.baseline || defaultBaseline(app.month);
    openDialog(
      "처음 3개월 분석",
      `<p>분석할 연속된 3개월의 카드·은행·간편결제 자료를 모두 가져온 뒤 확인해 줘. 빠진 거래가 있으면 추천 목표도 실제와 달라져.</p><div class="form-grid">${field("시작일", "start", h.start, "date", "required")}${field("종료일", "end", h.end, "date", "required")}</div><p>예: 6월 1일~8월 31일. 월급·고정비·현금 지출도 포함하고, 내부이체와 카드대금은 소비에서 제외해야 해.</p><label class="check-field"><input type="checkbox" name="confirmed" ${h.confirmed ? "checked" : ""}>두 사람의 전체 3개월 기록을 확인했고 누락·중복을 검토했어</label>`,
      async (f) => {
        const value = {
          start: String(f.get("start")),
          end: String(f.get("end")),
          confirmed: !!f.get("confirmed"),
        };
        if (
          !validDate(value.start) ||
          !validDate(value.end) ||
          value.start > value.end
        )
          throw Error("분석 날짜를 확인해 줘.");
        const test = structuredClone(s);
        test.settings.baseline = value;
        if (value.confirmed && !baselineAnalysis(test, app.month).complete)
          throw Error(
            "현재 운영월 이전의 연속 3개월 전체를 선택해 줘. 시작은 1일, 종료는 월말이어야 해.",
          );
        await app.update((st) => {
          st.settings.baseline = value;
        });
        app.navigate("analytics");
      },
    );
  } else if (action === "recommend-goals") {
    const h = baselineAnalysis(s, app.month);
    if (!h.usable) {
      toast("3개월 자료를 가져온 뒤 분석기간과 누락 여부를 확인해 줘.");
      return true;
    }
    openDialog(
      "리치콕 추천 목표",
      `<p>조절 가능 항목의 3개월 평균과 가장 적게 쓴 달을 기준으로 계산했어. 육아·의료·주거·금융·교통은 줄이지 않아. 일회성 지출 평균 ${won(h.oneoff)}은 별도 여유로 포함해. 평균 고정비 ${won(h.fixed)}도 최소 준비액으로 함께 반영해.</p>${h.recommendationIncome !== h.income ? `<div class="notice"><strong>과거 소비는 그대로, 현재 소득으로 목표 계산</strong><p class="small muted">분석기간은 정기수입 시작 전이라 월평균 실제 생활수입은 ${won(h.income)}이야. 현재 운영월 추천은 계획수입 ${won(h.recommendationIncome)}을 기준으로 계산해.</p></div>` : ""}<div class="recommend-options">${h.variants.map((v) => `<label class="recommend-option"><input type="radio" name="variant" value="${v.id}" ${v.id === "balanced" ? "checked" : ""}><span><strong>${v.name}</strong><small>변동비 ${won(v.variableBudget)} / 저축 ${won(v.savingsTarget)}</small><small>과거 평균보다 ${won(v.reduction)} 절감</small></span></label>`).join("")}</div><p class="small muted">여유형: 과거 평균 유지 · 균형형: 평균과 최소의 중간 · 절약형: 항목별 과거 최소. 각 항목의 최소 소비월은 서로 다를 수 있어, 절약형의 동시 달성은 보장하지 않아. 실수입 기록이 누락되면 먼저 보완해 줘.</p><label class="check-field"><input type="checkbox" name="future">다음 운영월 기본 목표에도 적용</label>`,
      async (f) => {
        const v = h.variants.find((v) => v.id === f.get("variant"));
        await app.update((st) => {
          const values = {
            variableBudget: v.variableBudget,
            savingsTarget: v.savingsTarget,
            categoryBudgets: v.categoryBudgets,
            income: h.recommendationIncome,
            fixedReserve: Math.max(0, h.fixed),
            recommendation: {
              variant: v.id,
              start: h.selected.start,
              end: h.selected.end,
            },
          };
          st.settings.monthOverrides ||= {};
          st.settings.monthOverrides[app.month] = {
            ...st.settings.monthOverrides[app.month],
            ...values,
          };
          if (f.get("future")) Object.assign(st.settings, values);
        });
        toast("선택한 추천 목표를 적용했어.");
      },
      "선택한 목표 적용",
    );
  } else if (action === "weekly-check") {
    const p = period(app.month, startDay(s)),
      methods = [
        ...new Set([
          ...(s.settings.paymentMethods || []),
          ...s.transactions.map((t) => t.paymentMethod),
        ]),
      ].filter(Boolean);
    const dialog = openDialog(
      "주간 누락 확인",
      `<p>카드앱에 표시된 조회기간과 똑같이 맞춰 줘. 승인금액 기준으로 비교하고, 청구금액·할부 잔액과는 비교하지 않아.</p><div class="form-grid">${select("실제 결제수단", "payment", methods.length ? methods.map((m) => [m, m]) : [["미지정", "미지정"]])}${field("카드앱 누적 사용액 (원)", "actual", "", "number", 'required min="-1000000000000"')}${field("조회 시작일", "start", p.start, "date", "required")}${field("조회 종료일", "end", today(), "date", "required")}</div><div class="notice" id="reconcile-preview">금액과 기간을 입력하면 차이를 보여줘.</div>${select(
        "차이 처리",
        "method",
        [
          ["review", "금액만 확인 · 보정하지 않음"],
          ["adjust", "차이를 미분류 보정 거래로 기록"],
        ],
        "review",
      )}<p class="small muted">양수 차이는 누락 지출, 음수 차이는 취소·날짜 차이일 수 있어. 확인되지 않은 차이를 보정하면 소비통계에 포함돼. 나중에 실제 거래를 추가하면 보정 거래를 먼저 수정·삭제해 줘.</p>`,
      async (f) => {
        const payment = String(f.get("payment")),
          start = String(f.get("start")),
          end = String(f.get("end")),
          actual = Number(f.get("actual"));
        if (
          !Number.isSafeInteger(actual) ||
          Math.abs(actual) > 1e12 ||
          !validDate(start) ||
          !validDate(end) ||
          end > today()
        )
          throw Error("금액과 날짜를 확인해 줘.");
        const check = reconcile(app.state, { payment, start, end, actual }),
          id = uid(),
          stamp = new Date().toISOString();
        await app.update((st) => {
          const fresh = reconcile(st, { payment, start, end, actual });
          st.reconciliations ||= [];
          st.reconciliations.push({
            id,
            payment,
            start,
            end,
            actual,
            recorded: fresh.recorded,
            difference: fresh.difference,
            updatedAt: stamp,
          });
          if (f.get("method") === "adjust" && fresh.difference) {
            st.transactions.push({
              id: "adjust-" + id,
              sourceId: "adjust-" + id,
              date: end,
              datetime: end + "T23:59:00",
              merchantRaw: "주간 보정 · " + payment,
              merchantNormalized: "주간 보정",
              amount: Math.abs(fresh.difference),
              direction: fresh.difference > 0 ? "expense" : "refund",
              owner: "joint",
              scope: "shared",
              category: "other",
              costKind: "variable",
              paymentMethod: payment,
              paymentChannel: "",
              sourceType: "reconciliation",
              reconciliationId: id,
              note: `${start}~${end} 누적 차이`,
              createdAt: stamp,
              updatedAt: stamp,
              performanceStatus: "unknown",
            });
          }
        });
        toast(
          check.difference === 0
            ? "기록과 누적액이 일치해."
            : "누적액 비교를 저장했어.",
        );
      },
      "확인 저장",
    );
    dialog.querySelector("form").addEventListener("input", () => {
      const f = new FormData(dialog.querySelector("form"));
      try {
        const check = reconcile(s, {
          payment: String(f.get("payment")),
          start: String(f.get("start")),
          end: String(f.get("end")),
          actual: Number(f.get("actual")),
        });
        dialog.querySelector("#reconcile-preview").textContent =
          `리치콕 ${won(check.recorded)} · 차이 ${won(check.difference)}`;
      } catch {}
    });
  } else if (action === "payment-settings") {
    openDialog(
      "결제수단",
      `${field("결제수단 목록 (쉼표 구분)", "payments", (s.settings.paymentMethods || []).join(", "), "text", 'maxlength="1000" placeholder="신한카드, 우리카드, 계좌이체, 현금"')}<p>쿠팡페이·네이버페이 같은 결제경로는 지출 입력의 별도 항목으로 남겨. 카드 사용액과 두 번 합산하지 않아.</p>`,
      async (f) => {
        await app.update((st) => {
          st.settings.paymentMethods = [
            ...new Set(
              String(f.get("payments"))
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
            ),
          ];
        });
      },
    );
  } else if (action === "pace-calculation") {
    openDialog(
      "소비속도 계산 근거",
      `<div class="calculation-list">${[
        ["변동지출 목표", b.budget],
        ["오늘까지 계획 누적", b.planned],
        ["오늘까지 실제 변동지출", b.actual],
        ["계획 대비 여유 (+) / 초과 (−)", b.delta],
        ["운영월 예상 총지출", b.forecast],
        ["예상 저축", b.projectedSavings],
      ]
        .map(
          ([l, v]) =>
            `<div class="between"><span>${l}</span><strong>${won(v)}</strong></div>`,
        )
        .join(
          "",
        )}</div><p>${b.history.usable ? "확인한 3개월의 주중·주말, 급여 전후, 운영월 주차 패턴을 완만하게 반영한 소비곡선이야." : "확인한 3개월 자료가 없어 날짜별 균등 계획을 사용 중이야."} 고정비는 실제액과 남은 예정액을 합치고, 일회성 지출은 한 번만 더해. 환불은 차감해.</p><p>계획 여유는 통장 잔액이 아니야. ${b.plan.incomeMode === "actual" ? "입력된 실제 수입만" : "아직 들어오지 않은 계획 수입도"} 기준에 포함돼. ${b.provisional ? "기록 누락 또는 초기 관측기간 때문에 예상치는 잠정이야." : ""}</p>`,
    );
  } else return false;
  return true;
}
