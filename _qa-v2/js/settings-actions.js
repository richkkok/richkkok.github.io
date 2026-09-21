import { openDialog, field, select, button, toast, icon } from "./ui.js";
import { amountInput, escape as e, won, today } from "./format.js";
import { encryptBackup, decryptBackup, downloadFile } from "./backup.js";
import { planFor, monthBudget } from "./budget.js";
import { scopeName, SCOPES, DIRECTIONS, memberName } from "../data/defaults.js";
import {
  recurringEditor,
  goalEditor,
  ruleEditor,
  categoryEditor,
  budgetEditor,
} from "./editors.js";
export async function settingsAction(app, action) {
  const state = app.state,
    s = state.settings;
  if (action === "cloud-conflicts") await app.cloud.resolveConflicts();
  else if (action === "cloud-start") await app.cloud.startSharing();
  else if (action === "cloud-invite") await app.cloud.createInvite();
  else if (action === "cloud-members") await app.cloud.showMembers();
  else if (action === "month-income") {
    const plan = planFor(state, app.month),
      override = s.monthOverrides?.[app.month] || {},
      base =
        override.incomeBase ??
        (override.income !== undefined
          ? Math.min(s.income, override.income)
          : s.income),
      extra =
        override.incomeExtra ??
        Math.max(0, (override.income ?? plan.income) - base);
    openDialog(
      "이번 달 수입",
      `<p class="muted">${app.month}에만 적용하는 계획 수입이에요. 상여·성과급처럼 이번 달만 달라지는 돈을 따로 넣을 수 있어요.</p><div class="form-grid">${field("정기수입 (원)", "incomeBase", base, "number", "required")}${field("추가수입 · 상여 · 보너스 (원)", "incomeExtra", extra, "number", "required")}</div><div class="notice"><strong>현재 계획 합계 ${won(base + extra)}</strong><p class="small muted">저장하면 이번 달 가용금액 계산에 바로 반영돼요.</p></div><label class="check-field"><input name="makeDefault" type="checkbox">정기수입 금액을 앞으로 기본 월수입으로 사용</label>${plan.incomeMode === "actual" ? '<p class="small muted">현재는 “실제 수입 내역 기준”이라 이 계획금액은 가용금액 계산에 사용되지 않아요. 설정에서 계산 기준을 계획 수입으로 바꾸면 적용돼요.</p>' : ""}`,
      async (f) => {
        const incomeBase = amountInput(f.get("incomeBase")),
          incomeExtra = amountInput(f.get("incomeExtra")),
          income = incomeBase + incomeExtra;
        if (!Number.isSafeInteger(income) || income > 1e12)
          throw Error("이번 달 총수입은 1조 원 이하로 입력해 주세요.");
        await app.update((st) => {
          st.settings.monthOverrides ||= {};
          st.settings.monthOverrides[app.month] = {
            ...(st.settings.monthOverrides[app.month] || {}),
            income,
            incomeBase,
            incomeExtra,
          };
          if (f.get("makeDefault")) st.settings.income = incomeBase;
        });
        toast("이번 달 수입을 저장했어요.");
      },
      "이번 달 수입 저장",
    );
  } else if (action === "household")
    openDialog(
      "수입 · 생활비 · 용돈",
      `<p class="muted">별도로 설정하지 않은 달에 적용할 기본값이에요.</p><div class="form-grid">${field("기본 월수입 (원)", "income", s.income, "number", "required")}${select(
        "가용금액 계산 기준",
        "incomeMode",
        [
          ["planned", "계획한 월수입"],
          ["actual", "실제 수입 내역만"],
        ],
        s.incomeMode,
      )}${field("공동생활비 목표 (원)", "sharedBudget", s.sharedBudget, "number", "required")}${field(`${s.members.p1} 용돈 (원)`, "p1Budget", s.personalBudgets.p1, "number", "required")}${field(`${s.members.p2} 용돈 (원)`, "p2Budget", s.personalBudgets.p2, "number", "required")}</div><p class="small muted">기본 월수입은 평소 정기수입 기준이에요. 상여·보너스처럼 월별로 달라지는 수입은 홈의 “수입”에서 이번 달만 따로 바꿀 수 있어요.</p>`,
      async (f) => {
        await app.update((st) => {
          st.settings = {
            ...st.settings,
            income: amountInput(f.get("income")),
            incomeMode: String(f.get("incomeMode")),
            sharedBudget: amountInput(f.get("sharedBudget")),
            personalBudgets: {
              p1: amountInput(f.get("p1Budget")),
              p2: amountInput(f.get("p2Budget")),
            },
          };
        });
      },
    );
  else if (action === "members")
    openDialog(
      "함께하는 사람",
      `${field("구성원 1 이름", "p1", s.members.p1, "text", 'required maxlength="20"')}${field("구성원 2 이름", "p2", s.members.p2, "text", 'required maxlength="20"')}`,
      async (f) => {
        await app.update((st) => {
          st.settings.members = {
            p1: String(f.get("p1")).trim(),
            p2: String(f.get("p2")).trim(),
          };
        });
      },
    );
  else if (action === "card-settings")
    openDialog(
      "카드 실적목표",
      `${field("카드 이름에 포함된 문구", "cardName", s.cardName, "text", 'required maxlength="80"')}${field("월 실적목표 (원)", "cardTarget", s.cardTarget, "number", "required")}<p class="muted">이 목표는 생활비에 추가하지 않아요. 거래별로 실적인정 / 제외 / 미확인을 정해 주세요. 카드사의 상품 규정은 자동 판단하지 않아요.</p>`,
      async (f) => {
        await app.update((st) => {
          st.settings.cardName = String(f.get("cardName")).trim();
          st.settings.cardTarget = amountInput(f.get("cardTarget"));
        });
      },
    );
  else if (action === "privacy" || action === "privacy-off") {
    await app.update((st) => {
      st.settings.privacy =
        action === "privacy-off" ? false : !st.settings.privacy;
    });
    document.querySelector("#dialog").close();
    toast(
      app.state.settings.privacy
        ? "개인 상세 내역을 숨겼어요."
        : "개인 상세 내역을 표시해요.",
    );
  } else if (action === "recurring-list") {
    openDialog(
      "고정비 · 반복결제",
      `<div class="dialog-list">${state.recurring.map((r) => `<button class="settings-row" data-recurring="${e(r.id)}"><span><strong>${e(r.name)}</strong><small>매월 ${r.day}일 · ${won(r.amount)}</small></span>${icon("chevron")}</button>`).join("") || "<p>등록된 반복비가 없어요.</p>"}</div>${button("반복비 추가", "add-recurring", "primary", "plus")}`,
    );
  } else if (action === "add-recurring") recurringEditor(app);
  else if (action === "add-goal") goalEditor(app);
  else if (action === "rules-list")
    openDialog(
      "자동분류 규칙",
      `<p class="muted">정확히 일치 → 문구 포함 → 기본 분류 순서로 적용해요.</p><div class="dialog-list">${state.rules.map((r) => `<button class="settings-row" data-rule="${e(r.id)}"><span><strong>${e(r.pattern)}</strong><small>${r.field === "payment" ? "결제수단" : "가맹점"} · ${r.match === "exact" ? "정확히 일치" : "문구 포함"}</small></span>${icon("chevron")}</button>`).join("") || "<p>내역 수정 후 규칙을 저장하거나 직접 추가해 보세요.</p>"}</div>${button("규칙 추가", "add-rule", "primary", "plus")}`,
    );
  else if (action === "add-rule") ruleEditor(app);
  else if (action === "categories-list")
    openDialog(
      "카테고리",
      `<div class="dialog-list">${state.categories.map((c) => `<button class="settings-row" data-category="${e(c.id)}"><span>${e(c.name)}${c.archived ? " · 숨김" : ""}</span>${icon("chevron")}</button>`).join("")}</div>${button("카테고리 추가", "add-category", "primary", "plus")}`,
    );
  else if (action === "add-category") categoryEditor(app);
  else if (action === "edit-budget") budgetEditor(app);
  else if (action === "filters") {
    const f = app.filters;
    openDialog(
      "내역 필터",
      `<div class="form-grid">${select("사용자", "owner", [["", "전체"], ...["p1", "p2", "joint"].map((p) => [p, memberName(p, state)])], f.owner)}${select("사용 범위", "scope", [["", "전체"], ...Object.keys(SCOPES).map((k) => [k, scopeName(k, state)])], f.scope)}${select("카테고리", "category", [["", "전체"], ...state.categories.map((c) => [c.id, c.name])], f.category)}${select("결제수단", "payment", [["", "전체"], ...[...new Set(state.transactions.filter((t) => !s.privacy || !["p1", "p2"].includes(t.scope)).map((t) => t.paymentMethod))].map((p) => [p, p])], f.payment)}${select("거래 유형", "direction", [["", "전체"], ...Object.entries(DIRECTIONS)], f.direction)}</div><label class="check-field"><input name="trash" type="checkbox" ${f.trash ? "checked" : ""}>휴지통 보기</label>`,
      async (data) => {
        app.filters = {
          ...app.filters,
          ...Object.fromEntries(
            ["owner", "scope", "category", "payment", "direction"].map((k) => [
              k,
              String(data.get(k)),
            ]),
          ),
          trash: !!data.get("trash"),
          limit: 100,
        };
        app.render();
      },
      "필터 적용",
    );
  } else if (action === "calculation") {
    const b = monthBudget(state, app.month);
    openDialog(
      "사용 가능 금액의 계산",
      `<p class="muted">이번 달 전체 가구 기준이에요. 개인용돈도 이 금액 안에서 사용해요.</p><div class="calculation-list">${[
        ["수입 기준", b.income],
        ["이미 사용한 순지출", -b.spent],
        ["아직 결제되지 않은 반복비", -b.outstanding],
        ["저축목표 월 배정", -b.goals],
        ["지금 사용할 수 있는 금액", b.available],
      ]
        .map(
          ([l, v]) =>
            `<div class="between"><span>${l}</span><strong>${won(v)}</strong></div>`,
        )
        .join(
          "",
        )}</div><p>실제 거래와 연결된 반복비는 중복으로 빼지 않아요. 카드 실적목표도 추가 지출로 계산하지 않아요.</p><p class="small muted">${b.plan.incomeMode === "planned" ? "계획 수입에는 아직 입금되지 않은 돈이 포함될 수 있어요." : "실제로 가져온 수입 내역만 사용하고 있어요."} 아직 가져오지 않은 거래는 반영되지 않아요.</p>`,
    );
  } else if (action === "backup") {
    openDialog(
      "암호화 백업 만들기",
      `<p>가계 기록과 설정을 비밀번호로 암호화해 저장해요. 비밀번호를 잊으면 복원할 수 없으니 따로 보관해 주세요.</p>${field("백업 비밀번호 (8자 이상)", "password", "", "password", 'required minlength="8" autocomplete="new-password"')}<p class="small muted">금융파일 원본은 포함하지 않아요. 현재 ${state.demo ? "샘플" : "실제"} 공간을 백업해요.</p>`,
      async (f) => {
        const text = await encryptBackup(app.state, String(f.get("password")));
        downloadFile(text, `RichKkok-${today()}.richkkok`);
        toast("암호화 백업을 만들었어요.");
      },
      "암호화해서 저장",
    );
  } else if (action === "restore")
    document.querySelector("#restore-file").click();
  else if (action === "delete-all") {
    if (app.mode === "real" && app.cloud?.connected)
      openDialog(
        "공동가계부 연결 중이에요",
        "<p>공동가계부 사용 중에는 이 기기만 전체삭제하지 않아요. 지워도 서버의 우리집 기록이 다시 내려오기 때문이에요.</p><p class=\"small muted\">필요한 기록을 없애려면 개별 내역을 삭제하거나, 먼저 암호화 백업을 만들어 주세요.</p>",
      );
    else
      openDialog(
        "현재 공간의 데이터 삭제",
        `<p>${state.demo ? "샘플" : "실제"} 공간의 거래·규칙·예산·설정을 모두 지워요. 다른 공간은 유지돼요. 먼저 백업했는지 확인해 주세요.</p>${field("삭제하려면 “전체삭제” 입력", "confirm", "", "text", 'required autocomplete="off"')}`,
        async (f) => {
          if (f.get("confirm") !== "전체삭제")
            throw Error("전체삭제를 정확히 입력해 주세요.");
          await app.repo.clear();
          await app.load();
          app.step = 1;
          app.navigate("home");
          toast("현재 공간을 초기화했어요.");
        },
        "전체 로컬데이터 삭제",
      );
  }
  else if (action === "privacy-info")
    openDialog(
      app.cloud?.connected ? "공동가계부 데이터 안내" : "우리집 정보는 우리 기기에",
      app.cloud?.connected
        ? '<div class="privacy-copy"><h3>금융파일 원본은 서버로 보내지 않아요</h3><p>CSV·XLS·XLSX 원본은 브라우저에서만 읽어요. 공동가계부를 켜면 리치콕에 정규화되어 저장된 거래·예산·설정 데이터만 공동 저장소와 동기화해요.</p><h3>우리집 구성원만 사용하는 세션</h3><p>초대링크는 한 번만 사용할 수 있고 7일 뒤 만료돼요. 참여한 기기에는 별도의 비밀 세션토큰이 발급되며, 브라우저가 서버 테이블을 직접 읽지 못하도록 접근권한을 차단해 두었어요.</p><h3>실시간 신호에는 가계부 내용이 없어요</h3><p>기기간 실시간 채널에는 새 버전 번호와 갱신 시각만 전달해요. 실제 가계부 내용은 세션을 검증한 뒤 별도로 가져와요.</p><h3>오프라인과 백업</h3><p>기기에도 오프라인 사본을 유지하고, 재연결하면 변경사항을 병합해요. 중요한 시점에는 암호화 백업도 함께 보관해 주세요.</p></div>'
        : '<div class="privacy-copy"><h3>기본 모드는 외부로 보내지 않아요</h3><p>금융파일은 브라우저에서만 읽고 정규화된 거래를 IndexedDB에 저장해요. 은행 아이디·비밀번호를 수집하지 않으며 광고·분석 SDK·외부 AI·추적 기능이 없어요.</p><h3>공동가계부는 선택 기능이에요</h3><p>설정에서 공동가계부를 직접 시작하기 전까지는 다른 기기나 서버와 자동 동기화하지 않아요. 다른 기기로 옮길 때는 암호화 백업을 사용할 수 있어요.</p><h3>개인 숨김의 범위</h3><p>가맹점·메모·결제수단을 화면에서 가리는 기능이에요. 기기 잠금과는 별개이므로 기기 자체 잠금도 함께 사용해 주세요.</p><h3>데이터와 업데이트</h3><p>앱 업데이트는 화면 코드만 바꾸며 가계 데이터를 지우지 않아요. 브라우저 데이터를 지우거나 기기를 바꾸기 전에는 백업해 주세요.</p></div>',
    );
  else if (action === "install") await app.pwa.install();
  else return false;
  return true;
}
export async function restoreFile(app, file) {
  if (!file) return;
  if (file.size > 40 * 1024 * 1024)
    throw Error("40MB 이하의 백업 파일을 선택해 주세요.");
  const text = await file.text();
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw Error("백업 파일을 읽을 수 없어요.");
  }
  const encrypted = envelope.format === "richkkok-encrypted";
  openDialog(
    "백업 · 초기설정 가져오기",
    `${encrypted ? field("백업 비밀번호", "password", "", "password", 'required autocomplete="current-password"') : '<div class="notice warning">암호화되지 않은 파일이에요. 개인정보가 포함될 수 있으니 안전하게 보관해 주세요.</div>'}<p>파일을 확인한 뒤 복원 내용을 한 번 더 보여드려요.</p>`,
    async (f) => {
      const result = await decryptBackup(text, String(f.get("password") || ""));
      setTimeout(() => {
        const s = result.state;
        openDialog(
          result.setup ? "우리집 초기설정 적용" : "백업 복원 확인",
          `<p>거래 ${s.transactions.length}건 · 반복비 ${s.recurring.length}개 · 규칙 ${s.rules.length}개</p><p>${result.setup ? "수입·예산·구성원·반복비 설정을 적용해요. 기존 거래는 유지해요." : "현재 공간의 모든 데이터가 이 백업으로 교체돼요. 필요한 기록은 먼저 백업해 주세요."}</p><label class="check-field"><input name="agree" type="checkbox" required>내용을 확인했고 적용할게요</label>`,
          async (f) => {
            if (!f.get("agree")) throw Error("확인 체크를 선택해 주세요.");
            if (result.setup)
              await app.update((st) => {
                st.settings = s.settings;
                st.recurring = s.recurring;
                st.configured = true;
              });
            else if (app.mode === "real" && app.cloud?.connected)
              await app.update(() => ({ ...s, demo: false }));
            else await app.repo.replace({ ...s, demo: app.mode === "demo" });
            await app.load();
            app.navigate("home");
            toast("기록과 설정을 적용했어요.");
          },
          "확인하고 적용",
        );
      }, 0);
    },
    "파일 확인",
  );
}
