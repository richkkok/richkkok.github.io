import { normalizeText, keyText } from "../format.js";
import { classify } from "../rules.js";
import { matchRecurring } from "../recurring.js";
export function parseAmount(value) {
  if (value === null || value === undefined || String(value).trim() === "")
    return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw Error("금액 오류");
    return Math.round(value);
  }
  const raw = String(value).trim(),
    negative = /^\s*\(|[-−]/.test(raw),
    clean = raw.replace(/[,₩￦원\s()+−-]/g, "");
  if (!/^\d+(\.\d+)?$/.test(clean)) throw Error("금액을 읽을 수 없어요.");
  const n = Math.round(Number(clean)) * (negative ? -1 : 1);
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1e12)
    throw Error("금액 범위를 확인해 주세요.");
  return n;
}
export function parseDate(value, timeValue = "", date1904 = false) {
  let y,
    m,
    d,
    h = 0,
    min = 0,
    s = 0;
  if (typeof value === "number" && value > 0 && value < 100000) {
    const date = new Date(
      Date.UTC(1899, 11, 30) +
        Math.round((value + (date1904 ? 1462 : 0)) * 86400000),
    );
    [y, m, d, h, min, s] = [
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
    ];
  } else {
    const raw = String(value ?? "").trim();
    const match = raw.match(
      /^(\d{4})\s*(?:[년./-]\s*)?(\d{1,2})\s*(?:[월./-]\s*)?(\d{1,2})/,
    );
    if (!match) throw Error("날짜를 읽을 수 없어요.");
    [y, m, d] = match.slice(1).map(Number);
    const tm = raw
      .slice(match[0].length)
      .match(/(오전|오후)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (tm) {
      h = Number(tm[2]);
      min = Number(tm[3]);
      s = Number(tm[4] || 0);
      if (tm[1] === "오후" && h < 12) h += 12;
      if (tm[1] === "오전" && h === 12) h = 0;
    }
  }
  if (typeof timeValue === "number" && timeValue >= 0 && timeValue < 1) {
    const seconds = Math.round(timeValue * 86400);
    h = Math.floor(seconds / 3600);
    min = Math.floor((seconds % 3600) / 60);
    s = seconds % 60;
  } else if (timeValue) {
    const tm = String(timeValue).match(
      /(오전|오후)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/,
    );
    if (tm) {
      h = Number(tm[2]);
      min = Number(tm[3]);
      s = Number(tm[4] || 0);
      if (tm[1] === "오후" && h < 12) h += 12;
      if (tm[1] === "오전" && h === 12) h = 0;
    }
  }
  const check = new Date(Date.UTC(y, m - 1, d));
  if (
    y < 1990 ||
    y > 2100 ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d ||
    h > 23 ||
    min > 59 ||
    s > 59
  )
    throw Error("올바른 날짜가 아니에요.");
  const pad = (n) => String(n).padStart(2, "0"),
    date = `${y}-${pad(m)}-${pad(d)}`;
  return { date, datetime: `${date}T${pad(h)}:${pad(min)}:${pad(s)}` };
}
const settlement =
  /카드\s*(?:결제)?대금|카드대금납부|계좌\s*간\s*이체|내\s*계좌|적금\s*(?:이체|이동|납입)|예금\s*이체|credit\s*card\s*payment|internal\s*transfer/i;
export function normalizeRow(
  row,
  map,
  {
    owner = "p1",
    sourceType = "csv",
    rules = [],
    recurring = [],
    date1904 = false,
    defaultPayment = "",
    negativeMode = "refund",
  } = {},
) {
  const cell = (field) => (map[field] >= 0 ? row[map[field]] : null);
  const { date, datetime } = parseDate(cell("date"), cell("time"), date1904);
  const merchantRaw = String(cell("merchant") ?? "")
    .trim()
    .slice(0, 300);
  if (!merchantRaw) throw Error("가맹점 또는 적요가 비어 있어요.");
  const type = normalizeText(cell("type")),
    note = String(cell("note") ?? "").slice(0, 1000),
    paymentMethod = String(cell("payment") || defaultPayment || "미지정")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);
  let value,
    direction = "expense";
  if (map.deposit >= 0 || map.withdrawal >= 0) {
    const deposit = parseAmount(cell("deposit")),
      withdrawal = parseAmount(cell("withdrawal"));
    if (deposit === null && withdrawal === null)
      throw Error("금액이 비어 있어요.");
    if (deposit && withdrawal)
      throw Error("입금과 출금이 동시에 있어요. 거래를 확인해 주세요.");
    value = withdrawal || deposit || 0;
    direction =
      withdrawal || (withdrawal === 0 && !deposit) ? "expense" : "income";
  } else {
    value = parseAmount(cell("amount"));
    if (value === null) throw Error("금액이 비어 있어요.");
    direction =
      negativeMode === "signed"
        ? value < 0
          ? "expense"
          : "income"
        : value < 0
          ? "refund"
          : "expense";
  }
  if (/수입|입금|급여|income|credit/.test(type)) direction = "income";
  if (/지출|출금|expense|debit/.test(type)) direction = "expense";
  if (/환불|취소|refund|cancel/.test(type)) direction = "refund";
  if (
    settlement.test(`${merchantRaw} ${type}`) ||
    /^(이체|transfer|settlement)$/.test(type)
  )
    direction = "transfer";
  const stamp = new Date().toISOString();
  let tx = {
    id: "",
    sourceId: "",
    owner,
    date,
    datetime,
    merchantRaw,
    merchantNormalized: normalizeText(merchantRaw),
    amount: Math.abs(value),
    direction,
    category: "other",
    scope: direction === "transfer" ? "excluded" : "shared",
    paymentMethod,
    sourceType,
    paymentChannel: String(cell("channel") || ""),
    operatingMonth: /^\d{4}-(0[1-9]|1[0-2])$/.test(
      String(cell("operatingMonth") || ""),
    )
      ? String(cell("operatingMonth"))
      : null,
    note,
    recurringId: null,
    performanceStatus: "unknown",
    excluded: direction === "transfer",
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  };
  tx = classify(tx, rules);
  if (direction === "transfer") {
    tx.scope = "excluded";
    tx.excluded = true;
  }
  const kind = String(cell("costKind") || "");
  tx.costKind = /fixed|고정/i.test(kind)
    ? "fixed"
    : /oneoff|일회/i.test(kind)
      ? "oneoff"
      : /variable|변동/i.test(kind)
        ? "variable"
        : ["housing", "finance", "subscription"].includes(tx.category)
          ? "fixed"
          : "variable";
  tx.costKindInferred = !kind;
  return matchRecurring(tx, recurring);
}
export function identityText(tx) {
  return [
    tx.owner,
    tx.datetime,
    tx.amount,
    keyText(tx.merchantNormalized),
    keyText(tx.paymentMethod),
    tx.direction,
  ].join("\u001f");
}
