import { escape as e, won, percent } from "./format.js";
import { scopeName, memberName } from "../data/defaults.js";
const paths = {
  home: "M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  wallet: "M3 6h16v14H3zM3 6V3h14v3M15 10h7v6h-7zM18 13h.01",
  chart: "M4 20V10M10 20V4M16 20v-8M22 20H1",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
  upload: "M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  chevron: "m9 5 7 7-7 7",
  close: "m6 6 12 12M18 6 6 18",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6",
  filter: "M3 5h18M6 12h12M9 19h6",
  shield: "m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Zm-4 10 3 3 5-6",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  calendar: "M3 5h18v16H3zM7 2v6M17 2v6M3 10h18",
  check: "m5 12 4 4L19 6",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  heart: "M12 21 3 12A5 5 0 0 1 12 5a5 5 0 0 1 9 7Z",
  basket: "m3 9 2 12h14l2-12ZM8 9l4-7 4 7M9 13v4M15 13v4",
  dining: "M4 2v7c0 2 6 2 6 0V2M7 2v20M18 2v20M18 2c-5 4-5 10 0 10",
  car: "m3 10 2-6h14l2 6v9H3Zm0 0h18M6 14h2M16 14h2M6 19v3M18 19v3",
  cross: "M9 3h6v6h6v6h-6v6H9v-6H3V9h6z",
  bag: "M4 7h16v14H4zM8 8V6a4 4 0 0 1 8 0v2",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2",
  phone: "M6 2h12v20H6zM10 18h4",
  download: "M12 3v13m-5-5 5 5 5-5M3 17v4h18v-4",
  repeat: "M4 8h14l-4-4M20 16H6l4 4M18 8l3 3M6 16l-3-3",
  lock: "M5 10h14v12H5zM8 10V6a4 4 0 0 1 8 0v4",
  info: "M12 11v6M12 7h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20",
  trash: "M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M9 10v7M15 10v7",
};
export const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.dots}"/></svg>`;
export const button = (label, action, kind = "primary", i = "") =>
  `<button class="btn ${kind}" type="button" data-action="${e(action)}">${i ? icon(i) : ""}${e(label)}</button>`;
export const sectionTitle = (title, subtitle = "", action = "") =>
  `<div class="section-heading"><div><h2>${e(title)}</h2>${subtitle ? `<p>${e(subtitle)}</p>` : ""}</div>${action}</div>`;
export const progress = (value, max, cls = "") =>
  `<div class="progress ${cls}" role="progressbar" aria-valuemin="0" aria-valuemax="${Math.max(0, max)}" aria-valuenow="${Math.max(0, Math.min(value, max))}" aria-label="${e(won(value) + " / " + won(max))}"><span style="width:${percent(value, max)}%"></span></div>`;
export const empty = (title, body, action = "") =>
  `<div class="empty-state"><span class="empty-icon">${icon("list")}</span><h3>${e(title)}</h3><p>${e(body)}</p>${action}</div>`;
export const field = (label, name, value = "", type = "text", extra = "") => {
  const defaults =
    type === "number"
      ? Object.entries({
          min: "0",
          max: "1000000000000",
          step: "1",
          inputmode: "numeric",
        })
          .filter(([key]) => !new RegExp(`(?:^|\\s)${key}\\s*=`).test(extra))
          .map(([key, val]) => `${key}="${val}"`)
          .join(" ")
      : "";
  return `<label class="field"><span>${e(label)}</span><input name="${e(name)}" type="${type}" value="${e(value)}" ${defaults} ${extra}></label>`;
};
export const select = (label, name, items, value = "", extra = "") =>
  `<label class="field"><span>${e(label)}</span><select name="${e(name)}" ${extra}>${items.map(([id, text]) => `<option value="${e(id)}" ${String(id) === String(value) ? "selected" : ""}>${e(text)}</option>`).join("")}</select></label>`;
export function hiddenPersonal(tx, state) {
  return state.settings.privacy && ["p1", "p2"].includes(tx.scope);
}
export function transactionRow(tx, state) {
  const hidden = hiddenPersonal(tx, state),
    c = state.categories.find((c) => c.id === tx.category),
    title = hidden
      ? `${memberName(tx.scope, state)} 개인 지출`
      : tx.merchantRaw;
  return `<button class="transaction-row ${tx.deletedAt ? "is-deleted" : ""}" data-edit="${e(tx.id)}"><span class="category-icon tone-${e(c?.id || "other")}">${icon(hidden ? "lock" : c?.icon || "dots")}</span><span class="transaction-description"><strong>${e(title)}</strong><span>${e(hidden ? "개인용돈 · 상세 숨김" : `${c?.name || "기타"} · ${memberName(tx.owner, state)} · ${tx.paymentMethod}`)}</span></span><span class="transaction-amount ${tx.direction === "income" || tx.direction === "refund" ? "positive" : ""}"><strong>${tx.direction === "income" || tx.direction === "refund" ? "+" : ""}${won(tx.amount)}</strong><span>${e(tx.direction === "transfer" ? "이체 · 합계 제외" : tx.scope === "excluded" ? "가계부 제외" : scopeName(tx.scope, state))}</span></span>${icon("chevron", "row-chevron")}</button>`;
}
export function openDialog(
  title,
  body,
  onSubmit = null,
  submitLabel = "저장하기",
) {
  const dialog = document.querySelector("#dialog");
  if (dialog.open) dialog.close();
  const focus = document.activeElement;
  dialog.innerHTML = `<form method="dialog"><header class="dialog-header"><h2 id="dialog-title">${e(title)}</h2><button class="icon-button" type="button" data-close aria-label="닫기">${icon("close")}</button></header><div class="dialog-body">${body}<p class="form-error" role="alert"></p></div>${onSubmit ? `<footer class="dialog-footer"><button type="button" class="btn secondary" data-close>취소</button><button type="submit" class="btn primary">${e(submitLabel)}</button></footer>` : ""}</form>`;
  dialog
    .querySelectorAll("[data-close]")
    .forEach((b) => (b.onclick = () => dialog.close()));
  dialog.querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    if (!onSubmit) {
      dialog.close();
      return;
    }
    const submit = dialog.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      await onSubmit(new FormData(event.currentTarget), dialog);
      if (dialog.open) dialog.close();
    } catch (error) {
      dialog.querySelector(".form-error").textContent =
        error.message || "저장하지 못했어요.";
    } finally {
      submit.disabled = false;
    }
  };
  dialog.onclose = () => {
    dialog.querySelector("form")?.reset();
    focus?.isConnected && focus.focus();
  };
  dialog.showModal();
  return dialog;
}
let toastTimer;
export function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4500);
}
