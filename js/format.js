export const won = (n) =>
  `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}원`;
export function shortWon(n) {
  n = Number(n) || 0;
  return Math.abs(n) >= 10000
    ? `${(n / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만원`
    : won(n);
}
export const escape = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const normalizeText = (s) =>
  String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
export const keyText = (s) => normalizeText(s).replace(/[\s()㈜·._-]/g, "");
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const currentMonth = () => today().slice(0, 7);
export function shiftMonth(month, n) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export const daysInMonth = (month) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};
export const monthTitle = (month) => `${Number(month.slice(5))}월 우리집`;
export const percent = (n, total) =>
  total > 0 ? Math.max(0, Math.min(100, (n / total) * 100)) : n > 0 ? 100 : 0;
export const uid = () => crypto.randomUUID();
export const amountInput = (v) => {
  const n = Number(String(v).replace(/,/g, ""));
  if (!Number.isSafeInteger(n) || n < 0 || n > 1e12)
    throw Error("금액은 0 이상의 정수로 입력해 주세요.");
  return n;
};
