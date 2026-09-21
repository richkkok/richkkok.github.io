import { today } from "./format.js";
import { CATEGORIES } from '../data/defaults.js';
export function migrate(state) {
  // Additive migration: original dates, IDs, budgets and records remain intact.
  state.settings.periodStartDay ??= 10;
  state.settings.trackingSince ??= today();
  state.settings.salaryDays ??= [10,15];
  state.settings.paymentMethods ??= [];
  state.dailyCloses ??= {};
  state.reconciliations ??= [];
  for(const c of CATEGORIES)if(!state.categories.some(old=>old.id===c.id))state.categories.push(structuredClone(c));
  state.productVersion=2;
  return state;
}
