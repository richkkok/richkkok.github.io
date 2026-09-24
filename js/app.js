import { periodKey, startDay, periodLabel, period } from "./period.js";
import { behaviorAction, quickEntry } from "./behavior-actions.js";
import { controlHome, controlAnalysis } from "./views/behavior.js";
import { Repository } from "./db.js";
import { sampleState } from "../data/sample.js";
import {
  currentMonth,
  monthTitle,
  escape as e,
  amountInput,
} from "./format.js";
import { icon, toast, openDialog, button } from "./ui.js";
import { transactionsView } from "./views/transactions.js";
import { budgetView } from "./views/budget.js";
import { settingsView } from "./views/settings.js";
import { onboardingView } from "./views/onboarding.js";
import {
  importView,
  mountImport,
  readImport,
  previewImport,
  commitImport,
} from "./views/import.js";
import {
  editTransaction,
  splitEditor,
  recurringEditor,
  goalEditor,
  ruleEditor,
  categoryEditor,
} from "./editors.js";
import { settingsAction, restoreFile } from "./settings-actions.js";
import { setupPWA } from "./pwa.js";
import { CloudSync } from "./cloud.js";
import { syncAutoRecurring } from "./recurring.js";
import { route, navigate, watchRoute } from "./router.js";
const titles = {
  home: "홈",
  transactions: "기록",
  budget: "계획",
  analytics: "분석",
  settings: "가족·설정",
  import: "내역 가져오기",
};
const app = {
  state: null,
  mode: "real",
  month: currentMonth(),
  step: 1,
  filters: { query: "", limit: 100 },
  importSession: { owner: "p1", sheet: 0, queue: [] },
  repo: null,
  pwa: null,
  cloud: null,
  navigate,
};
try {
  app.mode = localStorage.getItem("richkkok-mode") === "demo" ? "demo" : "real";
} catch {}
app.repo = new Repository(
  app.mode === "demo" ? "richkkok-demo-v1" : "richkkok-v1",
);
app.cloud = new CloudSync(app);
app.load = async () => {
  app.state = await app.repo.read();
  if (!app.periodInitialized) {
    app.month = periodKey(undefined, startDay(app.state));
    app.periodInitialized = true;
  }
  app.render();
};
app.update = async (change) => {
  app.state =
    app.mode === "real" && app.cloud?.connected
      ? await app.cloud.mutate(change)
      : await app.repo.mutate(change);
  app.render();
  try {
    channel?.postMessage("changed");
  } catch {}
};
app.applyAutoRecurring = async () => {
  const preview = structuredClone(app.state);
  const result = syncAutoRecurring(preview);
  if (!result.changed) return result;
  await app.update((state) => {
    syncAutoRecurring(state);
  });
  return result;
};
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("richkkok-updates")
    : null;
channel &&
  (channel.onmessage = () => {
    if (document.querySelector("#dialog").open) return;
    if (app.mode === "real" && app.cloud?.connected)
      app.cloud.pullLatest().catch(showError);
    else app.load().catch(showError);
  });
app.render = () => {
  if (!app.state) return;
  const current = route();
  document.title = `${titles[current]} · RichKkok 리치콕`;
  const nav = [
    ["home", "home", "홈"],
    ["transactions", "list", "기록"],
    ["analytics", "chart", "분석"],
    ["settings", "settings", "설정"],
  ];
  document.querySelector("#navigation").innerHTML = nav
    .map(
      ([r, i, label]) =>
        `<a href="#${r}" class="nav-item ${current === r ? "active" : ""}" ${current === r ? 'aria-current="page"' : ""}>${icon(i)}<span>${label}</span></a>`,
    )
    .join("");
  document.querySelector("#month-title").textContent =
    monthTitle(app.month) + " 운영월";
  document.querySelector("#period-label").textContent = periodLabel(
    period(app.month, startDay(app.state)),
  );
  const cloudSummary = app.cloud?.summary() || {
    connected: false,
    status: "이 기기에만 저장 중",
    memberCount: 1,
  };
  document.querySelector("#storage-status").textContent = cloudSummary.status;
  const householdStatus = document.querySelector("#household-status");
  if (householdStatus) {
    householdStatus.classList.toggle("is-connected", !!cloudSummary.connected);
    householdStatus.classList.toggle("is-local", !cloudSummary.connected);
    householdStatus.dataset.action = cloudSummary.connected
      ? "cloud-members"
      : "cloud-start";
    householdStatus.setAttribute(
      "aria-label",
      cloudSummary.connected
        ? `공동가계부 사용 중. ${cloudSummary.memberCount || 1}명 참여. 구성원 보기`
        : "공동가계부 미사용. 이 기기에만 저장 중. 공동가계부 시작하기",
    );
    householdStatus.innerHTML = `<span class="household-status-dot" aria-hidden="true"></span><span class="household-status-copy"><strong>${
      cloudSummary.connected ? "공동가계부 사용 중" : "공동가계부 미사용"
    }</strong><small>${
      cloudSummary.connected
        ? `${e(cloudSummary.householdName || "우리집 가계부")} · ${cloudSummary.memberCount || 1}명`
        : "이 기기에만 저장"
    }</small></span>`;
  }
  document.querySelector("#month-picker").value = app.month;
  document.querySelector("#demo-banner").hidden = app.mode !== "demo";
  document.querySelector("#app-header").hidden = !app.state.configured;
  const main = document.querySelector("#main");
  const focused = document.activeElement,
    focusName = focused?.name,
    caret = focused?.selectionStart;
  if (!app.state.configured)
    main.innerHTML = onboardingView(app.state, app.step);
  else
    main.innerHTML = {
      home: () => controlHome(app.state, app.month),
      transactions: () => transactionsView(app.state, app.month, app.filters),
      budget: () => budgetView(app.state, app.month),
      analytics: () => controlAnalysis(app.state, app.month),
      settings: () => settingsView(app.state, app.cloud?.summary()),
      import: () => importView(app.state, app.importSession),
    }[current]();
  if (app.state.configured && current === "import") mountImport(app);
  if (focusName === "transaction-search") {
    const input = main.querySelector("[name=transaction-search]");
    input?.focus();
    if (caret !== null)
      try {
        input.setSelectionRange(caret, caret);
      } catch {}
  }
};
app.readImport = (file) => readImport(app, file);
function showError(error) {
  console.error(error);
  toast(error.message || "처리하지 못했어요. 다시 시도해 주세요.");
}
async function switchMode(mode) {
  app.repo.close();
  app.mode = mode;
  try {
    localStorage.setItem("richkkok-mode", mode);
  } catch {}
  app.repo = new Repository(
    mode === "demo" ? "richkkok-demo-v1" : "richkkok-v1",
  );
  await app.cloud?.setMode(mode);
  if (mode === "demo") {
    const existing = await app.repo.read();
    if (!existing.configured) await app.repo.replace(sampleState());
  }
  app.filters = { query: "", limit: 100 };
  app.importSession = { owner: "p1", sheet: 0, queue: [] };
  await app.load();
  navigate("home");
}
document.addEventListener("click", async (event) => {
  const target = event.target.closest("button,a");
  if (!target) return;
  try {
    if (target.matches(".skip-link")) {
      event.preventDefault();
      document.querySelector("#main").focus();
      return;
    }
    if (target.dataset.edit) return editTransaction(app, target.dataset.edit);
    if (target.dataset.split) return splitEditor(app, target.dataset.split);
    if (target.dataset.recurring)
      return recurringEditor(app, target.dataset.recurring);
    if (target.dataset.goal) return goalEditor(app, target.dataset.goal);
    if (target.dataset.rule) return ruleEditor(app, target.dataset.rule);
    if (target.dataset.category)
      return categoryEditor(app, target.dataset.category);
    if (target.dataset.deleteTransaction) {
      await app.update((s) => {
        const t = s.transactions.find(
          (t) => t.id === target.dataset.deleteTransaction,
        );
        if (t) t.deletedAt = new Date().toISOString();
      });
      document.querySelector("#dialog").close();
      toast("휴지통으로 옮겼어요. 필터에서 복원할 수 있어요.");
      return;
    }
    if (target.dataset.restoreTransaction) {
      await app.update((s) => {
        const t = s.transactions.find(
          (t) => t.id === target.dataset.restoreTransaction,
        );
        if (t) t.deletedAt = null;
      });
      document.querySelector("#dialog").close();
      toast("내역을 복원했어요.");
      return;
    }
    for (const [key, list, label] of [
      ["removeRecurring", "recurring", "반복비"],
      ["removeGoal", "goals", "목표"],
      ["removeRule", "rules", "규칙"],
    ])
      if (target.dataset[key]) {
        const id = target.dataset[key];
        openDialog(
          `${label} 삭제`,
          `<p>이 ${label} 설정을 삭제해요. 기록된 거래는 그대로 남아요.</p>`,
          async () => {
            await app.update((s) => {
              s[list] = s[list].filter((x) => x.id !== id);
            });
            toast(`${label} 설정을 삭제했어요.`);
          },
          "삭제하기",
        );
        return;
      }
    const action = target.dataset.action;
    if (!action) return;
    if (await behaviorAction(app, action, target)) return;
    if (action.startsWith("go-")) {
      document.querySelector("#dialog").close();
      navigate(action.slice(3));
    } else if (action === "sample") {
      await switchMode("demo");
    } else if (action === "exit-sample") {
      await switchMode("real");
    } else if (action === "onboarding-back") {
      app.step = Math.max(1, app.step - 1);
      app.render();
    } else if (action === "finish-onboarding") {
      await app.update((s) => {
        s.configured = true;
        s.settings.trackingSince ||= new Date().toLocaleDateString("en-CA");
      });
      navigate("home");
    } else if (action === "add-transaction") quickEntry(app);
    else if (action === "category-transactions") {
      const categories = String(target.dataset.filterCategories || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      app.filters = {
        query: "",
        limit: 100,
        category: target.dataset.filterCategory || "",
        categories,
        categoryLabel: target.dataset.filterLabel || "",
      };
      navigate("transactions");
    } else if (action === "clear-filters") {
      app.filters = { query: "", limit: 100 };
      app.render();
    } else if (action === "more-transactions") {
      app.filters.limit += 100;
      app.render();
    } else if (action === "card-transactions") {
      app.filters = {
        query: "",
        limit: 100,
        payment: app.state.settings.cardName,
      };
      navigate("transactions");
    } else if (action === "preview-import") {
      await previewImport(app);
    } else if (action === "commit-import") {
      await commitImport(app);
    } else await settingsAction(app, action);
  } catch (error) {
    const alert = document.querySelector("#import-error");
    if (route() === "import" && alert) {
      alert.textContent = error.message;
    } else toast(error.message || "처리하지 못했어요.");
  }
});
document.querySelector("#month-picker").onchange = (event) => {
  if (/^\d{4}-\d{2}$/.test(event.target.value)) {
    app.month = event.target.value;
    app.render();
  }
};
document.addEventListener("input", (event) => {
  if (event.target.name === "transaction-search") {
    app.filters.query = event.target.value;
    app.filters.limit = 100;
    app.render();
  }
});
document.addEventListener("submit", async (event) => {
  if (event.target.id !== "onboarding-form") return;
  event.preventDefault();
  const form = new FormData(event.target),
    step = app.step;
  try {
    if (step === 1)
      await app.update((s) => {
        s.settings.income = amountInput(form.get("income"));
        s.settings.members = {
          p1: String(form.get("p1")).trim(),
          p2: String(form.get("p2")).trim(),
        };
      });
    if (step === 2)
      await app.update((s) => {
        s.settings.sharedBudget = amountInput(form.get("sharedBudget"));
        s.settings.personalBudgets = {
          p1: amountInput(form.get("p1Budget")),
          p2: amountInput(form.get("p2Budget")),
        };
      });
    if (step < 3) {
      app.step++;
      app.render();
    } else {
      await app.update((s) => {
        s.configured = true;
        s.settings.trackingSince ||= new Date().toLocaleDateString("en-CA");
      });
      navigate("import");
    }
  } catch (error) {
    document.querySelector("#onboarding-form .form-error").textContent =
      error.message;
  }
});
document.querySelector("#restore-file").onchange = async (event) => {
  try {
    await restoreFile(app, event.target.files[0]);
  } catch (error) {
    toast(error.message);
  }
  event.target.value = "";
};
watchRoute(() => {
  document.querySelector("#dialog").close();
  app.render();
  window.scrollTo({ top: 0 });
  document.querySelector("#main")?.focus({ preventScroll: true });
});
app.pwa = setupPWA();
app
  .load()
  .then(async () => {
    await app.cloud.init();
    await app.applyAutoRecurring();
  })
  .catch((error) => {
    document.querySelector("#main").innerHTML =
      '<section class="card"><h1>저장소를 열지 못했어요</h1><p>브라우저의 일반 창에서 다시 열어 주세요. 기존 데이터는 삭제하지 않았어요.</p><button class="btn primary" type="button" id="retry-storage">다시 시도</button></section>';
    document.querySelector("#retry-storage").onclick = () => location.reload();
    console.error(error);
  });
