import { keyText } from "./format.js";
import { methodNames } from "./instrument-cleanup.js";
import { resolvePaymentAlias } from "./payment-rename.js";
import { select } from "./ui.js";

// Use the same saved sources as the payment directory. Account aliases remain
// transaction values so existing bank matching and recurring links keep working.
export function paymentChoices(state) {
  const hidden = new Set(state.settings.hiddenPaymentMethods || []);
  const hiddenAccounts = new Set(state.settings.hiddenCashAccounts || []);
  const seen = new Set(), choices = [];
  const add = (value, label = value, aliases = []) => {
    value = resolvePaymentAlias(state, value).trim();
    const key = keyText(value);
    if (!key || key === keyText("미지정") || hidden.has(key) || seen.has(key)) return;
    seen.add(key);
    choices.push({ value, label, aliases: [value, ...aliases].map(keyText) });
  };
  for (const name of methodNames(state)) {
    if (!hidden.has(keyText(name))) add(name, resolvePaymentAlias(state, name));
  }
  for (const account of state.cashAccounts || []) {
    if (account.archived || hiddenAccounts.has(account.id) ||
        [account.name, account.paymentMethod].some(name => hidden.has(keyText(name || "")))) continue;
    add(account.paymentMethod || account.name, account.name, [account.name, account.paymentMethod || ""]);
  }
  return choices;
}

export function findPaymentChoice(state, input, choices = paymentChoices(state)) {
  const key = keyText(resolvePaymentAlias(state, String(input || "").trim()));
  return key ? choices.find(choice => choice.aliases.includes(key)) : undefined;
}

export function requirePaymentChoice(state, input, existing = "") {
  const value = String(input || "").trim();
  // An unchanged historical method can be retained when editing other fields,
  // even after it has been hidden or its account has been closed.
  if (existing && value === existing) return existing;
  const choice = findPaymentChoice(state, value);
  if (!choice) throw Error("등록된 결제수단을 선택해 주세요. 없으면 결제수단 메뉴에서 먼저 등록해 주세요.");
  return choice.value;
}

export function paymentSelect(state, label, value = "", existing = "") {
  const choices = paymentChoices(state);
  const items = choices.map(choice => [choice.value, choice.label]);
  if (existing && !items.some(([id]) => id === existing)) items.unshift([existing, existing + " (기존 내역)"]);
  const selected = existing && value === existing ? existing : findPaymentChoice(state, value, choices)?.value || "";
  return select(label, "paymentMethod", [["", items.length ? "결제수단 선택" : "등록된 결제수단 없음"], ...items], selected, "required") +
    (!items.length ? '<p class="small muted">결제수단 메뉴에서 카드·계좌를 먼저 등록해 주세요.</p>' : "");
}
