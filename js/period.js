import { today, shiftMonth, daysInMonth } from "./format.js";
const pad = (n) => String(n).padStart(2, "0");
export const validDate = (d) =>
  typeof d === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  Number.isFinite(Date.parse(d)) &&
  new Date(d).toISOString().slice(0, 10) === d;
export const addDays = (date, n) =>
  new Date(Date.parse(date + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
export const dayDiff = (a, b) =>
  Math.round(
    (Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000,
  );
export const startDay = (state) => state.settings.periodStartDay ?? 10;
export function period(month, day = 10) {
  const start = `${month}-${pad(Math.min(day, daysInMonth(month)))}`;
  const next = shiftMonth(month, 1);
  const end = addDays(`${next}-${pad(Math.min(day, daysInMonth(next)))}`, -1);
  return { month, start, end, days: dayDiff(start, end) + 1 };
}
export function periodKey(date = today(), day = 10) {
  const month = date.slice(0, 7);
  return date < period(month, day).start ? shiftMonth(month, -1) : month;
}
export const transactionPeriod = (tx, state) =>
  tx.operatingMonth || periodKey(tx.date, startDay(state));
export const inPeriod = (tx, state, month) =>
  transactionPeriod(tx, state) === month;
export const periodLabel = (p) =>
  `${Number(p.start.slice(5, 7))}.${Number(p.start.slice(8))} – ${Number(p.end.slice(5, 7))}.${Number(p.end.slice(8))}`;
export const periodDates = (p) =>
  Array.from({ length: p.days }, (_, i) => addDays(p.start, i));
