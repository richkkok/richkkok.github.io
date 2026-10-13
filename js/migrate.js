import { today } from "./format.js";
import { CATEGORIES } from "../data/defaults.js";

// "delivery" was a redundant built-in category. "dining" is the existing
// 외식·배달 category ID, not a new category to be created during conversion.
const LEGACY_DELIVERY = "delivery";
const DINING = "dining";
export const PRODUCT_VERSION = 3;

function mergeCategoryBudgets(budgets) {
  if (!budgets || !Object.hasOwn(budgets, LEGACY_DELIVERY)) return;
  const total = Number(budgets[DINING] || 0) + Number(budgets[LEGACY_DELIVERY] || 0);
  if (!Number.isSafeInteger(total) || total > 1e12)
    throw Error("외식·배달 예산 통합 금액을 확인해 주세요.");
  budgets[DINING] = total;
  delete budgets[LEGACY_DELIVERY];
}

export function migrate(state) {
  // Idempotent migration: never change a transaction's amount, time, ID,
  // merchant, deletion state, manual confirmation, or recurring link.
  state.settings.periodStartDay ??= 10;
  state.settings.trackingSince ??= today();
  state.settings.salaryDays ??= [10, 15];
  state.settings.paymentMethods ??= [];
  state.dailyCloses ??= {};
  state.reconciliations ??= [];
  state.cashAccounts ??= [];
  state.cashChecks ??= [];
  state.cashLinks ??= [];
  for (const c of CATEGORIES)
    if (!state.categories.some((old) => old.id === c.id))
      state.categories.push(structuredClone(c));
  const housing = state.categories.find((c) => c.id === "housing");
  if (housing?.name === "주거·관리") housing.name = "주거비";

  const dining = state.categories.find((c) => c.id === DINING);
  if (dining?.name === "외식") dining.name = "외식·배달";
  // A previously stored custom dining label is intentionally preserved.
  state.categories = state.categories.filter((c) => c.id !== LEGACY_DELIVERY);
  for (const entries of [state.transactions, state.rules, state.recurring])
    for (const item of entries || [])
      if (item.category === LEGACY_DELIVERY) item.category = DINING;
  mergeCategoryBudgets(state.settings.categoryBudgets);
  for (const override of Object.values(state.settings.monthOverrides || {}))
    mergeCategoryBudgets(override.categoryBudgets);

  state.productVersion = PRODUCT_VERSION;
  return state;
}
