import { keyText } from "../format.js";
import { detectHeader } from "./mapper.js";
import { normalizeRow, parseAmount } from "./normalize.js";
import { identify, dedupe } from "./dedupe.js";

const CARD_MAP = {
  date: 0,
  merchant: 1,
  amount: 2,
  payment: 3,
  type: 4,
  note: 5,
};
const fullDateToken = /^\d{2,4}[./-]\d{1,2}[./-]\d{1,2}$/;
const shortDateToken = /^\d{1,2}\/\d{1,2}$/;
const amountToken = /^-?[\d,]+(?:\.\d+)?$/;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
function personKey(value) {
  return clean(value)
    .replace(/(?:고객|회원|님)/g, "")
    .replace(/[^0-9A-Za-z가-힣*]/g, "")
    .toLowerCase();
}
function memberKeys(state) {
  return Object.entries(state.settings.members || {}).map(([id, name]) => ({
    id,
    name,
    key: personKey(name),
  }));
}
function matchMember(label, state) {
  const source = personKey(label).replace(/\*/g, "");
  if (!source) return null;
  const matches = memberKeys(state).filter(({ key }) => {
    if (!key || key.length < 2) return false;
    return source.includes(key) || key.includes(source);
  });
  return matches.length === 1 ? matches[0].id : null;
}
function otherOwner(primaryOwner, state) {
  const keys = Object.keys(state.settings.members || {});
  return keys.find((key) => key !== primaryOwner) || primaryOwner;
}
function ownerHintFromSubtotal(text) {
  const compact = clean(text);
  const named = compact.match(/소계\s*\(([^)]+)\)/i);
  if (named) return { kind: "name", label: named[1].trim() };
  if (/본인회원/.test(compact) && /소\s*계/.test(compact))
    return { kind: "primary", label: "본인회원" };
  const family = compact.match(/가족\s*([^\s]+).*소\s*계/);
  if (family) return { kind: "family", label: family[1].trim() };
  return null;
}
function isGrandTotal(text) {
  const compact = clean(text).replace(/\s/g, "");
  return /^합계\d*건/.test(compact) || /청구합계/.test(compact);
}
function resolveHint(hint, state, primaryOwner) {
  if (!hint || hint.kind === "primary") return primaryOwner;
  if (hint.kind === "family") {
    const matched = matchMember(hint.label, state);
    if (matched && matched !== primaryOwner) return matched;
    return otherOwner(primaryOwner, state);
  }
  if (hint.kind === "name") return matchMember(hint.label, state);
  return null;
}

export function resolveCardEntries(entries, state, primaryOwner = "p1") {
  const groups = new Map();
  for (const entry of entries) {
    const key = JSON.stringify(entry.ownerHint || { kind: "primary" });
    if (!groups.has(key)) groups.set(key, entry.ownerHint || { kind: "primary" });
  }
  const groupOwner = new Map();
  const unresolved = [];
  for (const [key, hint] of groups) {
    const owner = resolveHint(hint, state, primaryOwner);
    if (owner) groupOwner.set(key, owner);
    else unresolved.push([key, hint]);
  }
  const used = new Set(groupOwner.values());
  const available = Object.keys(state.settings.members || {}).filter(
    (id) => !used.has(id),
  );
  if (unresolved.length === 1 && available.length === 1)
    groupOwner.set(unresolved[0][0], available[0]);
  const warnings = [];
  for (const [key, hint] of unresolved) {
    if (groupOwner.has(key)) continue;
    groupOwner.set(key, primaryOwner);
    warnings.push(
      `${hint?.label || "카드 이용자"} 이름을 구성원과 자동 연결하지 못해 선택한 기준 사용자로 넣었어요.`,
    );
  }
  return {
    entries: entries.map((entry) => ({
      ...entry,
      owner: groupOwner.get(
        JSON.stringify(entry.ownerHint || { kind: "primary" }),
      ),
    })),
    warnings,
  };
}

function findCardWorkbook(sheets) {
  for (const sheet of sheets) {
    const header = detectHeader(sheet.rows);
    const row = sheet.rows[header.index] || [];
    const cardIndex = row.findIndex((value) => keyText(value) === keyText("이용카드"));
    const title = sheet.rows
      .slice(0, 5)
      .flat()
      .map(clean)
      .join(" ");
    const strongTitle = /카드이용내역/.test(title);
    if (
      header.mapping.date >= 0 &&
      header.mapping.merchant >= 0 &&
      header.mapping.amount >= 0 &&
      cardIndex >= 0 &&
      (strongTitle || row.some((value) => keyText(value) === keyText("이용금액")))
    )
      return { sheet, header, cardIndex };
  }
  return null;
}

export function parseCardWorkbook(sheets) {
  const found = findCardWorkbook(sheets);
  if (!found) return null;
  const { sheet, header, cardIndex } = found;
  const mapping = header.mapping;
  const entries = [];
  let buffer = [];
  let sectionCount = 0;
  const flush = (hint = { kind: "primary", label: "본인회원" }) => {
    if (!buffer.length) return;
    entries.push(...buffer.map((entry) => ({ ...entry, ownerHint: hint })));
    buffer = [];
    sectionCount++;
  };
  for (let index = header.index + 1; index < sheet.rows.length; index++) {
    const row = sheet.rows[index] || [];
    const whole = row.map(clean).filter(Boolean).join(" ");
    const subtotalHint = ownerHintFromSubtotal(whole);
    if (subtotalHint) {
      flush(subtotalHint);
      continue;
    }
    if (isGrandTotal(whole)) continue;
    const date = clean(row[mapping.date]);
    const merchant = clean(row[mapping.merchant]);
    const amount = row[mapping.amount];
    if (!date || !merchant || amount === null || amount === undefined || amount === "")
      continue;
    if (!fullDateToken.test(date) && !/^\d{2}\.\d{2}\.\d{2}$/.test(date))
      continue;
    let parsedAmount;
    try {
      parsedAmount = parseAmount(amount);
    } catch {
      continue;
    }
    const payment = clean(row[cardIndex]) || "카드";
    const kindIndex = (sheet.rows[header.index] || []).findIndex(
      (value) => keyText(value) === keyText("구분"),
    );
    const kind = kindIndex >= 0 ? clean(row[kindIndex]) : "";
    buffer.push({
      date,
      merchant,
      amount: parsedAmount,
      payment,
      type: parsedAmount < 0 || /취소|환불/.test(merchant) ? "환불" : "지출",
      note: kind,
      sourceRow: index + 1,
    });
  }
  flush({ kind: "primary", label: "본인회원" });
  if (!entries.length) return null;
  return {
    provider: "card-workbook",
    sourceLabel: "카드사 원본 엑셀",
    entries,
    sectionCount,
    requiresPrimaryOwner: entries.some((entry) =>
      ["primary", "family"].includes(entry.ownerHint?.kind),
    ),
  };
}

function parseStatementPeriod(lines) {
  for (const line of lines) {
    const match = line.text.match(/(20\d{2})년\s*(\d{1,2})월\s*\d{1,2}일/);
    if (match) return { year: Number(match[1]), month: Number(match[2]) };
  }
  const whole = lines.map((line) => line.text).join(" ");
  const year = whole.match(/\b(20\d{2})\b/);
  const month = whole.match(/(?:^|\s)(\d{1,2})월\s*(?:재발송\s*)?이용대금명세서/);
  return {
    year: year ? Number(year[1]) : new Date().getFullYear(),
    month: month ? Number(month[1]) : new Date().getMonth() + 1,
  };
}
function yearForMonth(statement, month) {
  return month > statement.month + 3 ? statement.year - 1 : statement.year;
}
function lineItems(line) {
  return [...(line.items || [])].sort((a, b) => a.x - b.x);
}
function dateItem(line, allowShort) {
  return lineItems(line).find((item) => {
    const text = clean(item.text);
    return fullDateToken.test(text) || (allowShort && shortDateToken.test(text));
  });
}
function amountItemAfter(line, x) {
  return lineItems(line).find(
    (item) => item.x > x + 8 && amountToken.test(clean(item.text)),
  );
}
function inlineMerchant(line, dateX, amountX) {
  return lineItems(line)
    .filter((item) => item.x > dateX + 8 && item.x < amountX - 5)
    .map((item) => clean(item.text))
    .filter(Boolean)
    .join(" ")
    .trim();
}
const continuationStop =
  /이용대금\s*명세서|카드이용내역|상세내역|이용가맹점|이용금액|당월 결제|청구금액|결제 후|포인트|file:\/\/\/|COPYRIGHT|고객서비스센터|우리카드 홈페이지|인쇄하기|소계\(|청구합계|카드의정석/i;
function continuationMerchant(line, dateX, amountX, allowShort) {
  const text = clean(line.text);
  if (!text || continuationStop.test(text) || dateItem(line, allowShort)) return "";
  if (lineItems(line).some((item) => item.x >= amountX - 5 && amountToken.test(clean(item.text))))
    return "";
  const result = lineItems(line)
    .filter((item) => item.x > dateX + 8 && item.x < amountX - 5)
    .map((item) => clean(item.text))
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!result || /^\d+$/.test(result)) return "";
  return result;
}
function transactionDate(raw, statement) {
  if (fullDateToken.test(raw)) return raw;
  const [month, day] = raw.split("/").map(Number);
  const year = yearForMonth(statement, month);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function extractLineTransaction(lines, index, { allowShort, statement, payment }) {
  const line = lines[index];
  const dItem = dateItem(line, allowShort);
  if (!dItem) return null;
  const aItem = amountItemAfter(line, dItem.x);
  if (!aItem) return null;
  let merchant = inlineMerchant(line, dItem.x, aItem.x);
  if (!merchant) {
    const above = [];
    for (let offset = 1; offset <= 2; offset++) {
      const candidate = lines[index - offset];
      if (!candidate || Math.abs(candidate.y - line.y) > 11) break;
      const value = continuationMerchant(candidate, dItem.x, aItem.x, allowShort);
      if (!value) break;
      above.unshift(value);
    }
    const below = [];
    for (let offset = 1; offset <= 2; offset++) {
      const candidate = lines[index + offset];
      if (!candidate || Math.abs(candidate.y - line.y) > 11) break;
      const value = continuationMerchant(candidate, dItem.x, aItem.x, allowShort);
      if (!value) break;
      below.push(value);
    }
    merchant = [...above, ...below].join(" ").trim();
  }
  if (!merchant) return null;
  const amount = parseAmount(clean(aItem.text));
  return {
    date: transactionDate(clean(dItem.text), statement),
    merchant,
    amount,
    payment,
    type: amount < 0 || /취소|환불/.test(merchant) ? "환불" : "지출",
    note: "",
  };
}
function flattenPages(pages) {
  return pages.flatMap((page) =>
    (page.lines || []).map((line) => ({ ...line, page: page.page })),
  );
}

export function parseWooriPdf(pages) {
  const lines = flattenPages(pages);
  const whole = lines.map((line) => line.text).join(" ");
  if (!/우리카드/.test(whole) || !/이용대금\s*명세서/.test(whole)) return null;
  const statement = parseStatementPeriod(lines);
  const entries = [];
  let buffer = [];
  let cardCode = "우리카드";
  let sections = 0;
  const flush = (hint = { kind: "primary", label: "본인회원" }) => {
    if (!buffer.length) return;
    entries.push(...buffer.map((entry) => ({ ...entry, ownerHint: hint })));
    buffer = [];
    sections++;
  };
  for (let index = 0; index < lines.length; index++) {
    const text = clean(lines[index].text);
    const card = text.match(/\(([A-Z]+\d{2,4})\)\s*카드/i);
    if (card) cardCode = card[1];
    const subtotal = text.match(/소계\s*\(([^)]+)\)/);
    if (subtotal) {
      flush({ kind: "name", label: subtotal[1].trim() });
      continue;
    }
    if (/청구합계/.test(text)) continue;
    const tx = extractLineTransaction(lines, index, {
      allowShort: true,
      statement,
      payment: `우리카드 · ${cardCode}`,
    });
    if (tx) buffer.push(tx);
  }
  flush({ kind: "primary", label: "본인회원" });
  if (!entries.length) return null;
  return {
    provider: "woori-pdf",
    sourceLabel: "우리카드 원본 PDF",
    entries,
    sectionCount: sections,
    requiresPrimaryOwner: entries.some((entry) => entry.ownerHint?.kind !== "name"),
  };
}

export function parseGenericCardPdf(pages) {
  const lines = flattenPages(pages);
  const statement = parseStatementPeriod(lines);
  const entries = [];
  let payment = "카드사 PDF";
  const whole = lines.map((line) => line.text).join(" ");
  const provider = whole.match(/([가-힣A-Za-z0-9]+카드)/)?.[1];
  if (provider) payment = provider;
  for (let index = 0; index < lines.length; index++) {
    const tx = extractLineTransaction(lines, index, {
      allowShort: false,
      statement,
      payment,
    });
    if (tx) entries.push({ ...tx, ownerHint: { kind: "primary", label: "본인회원" } });
  }
  if (entries.length < 3) return null;
  return {
    provider: "generic-pdf",
    sourceLabel: `${provider || "카드사"} 원본 PDF`,
    entries,
    sectionCount: 1,
    requiresPrimaryOwner: true,
  };
}

export function parseCardPdf(pages) {
  return parseWooriPdf(pages) || parseGenericCardPdf(pages);
}

export async function previewCardEntries(
  entries,
  state,
  {
    primaryOwner = "p1",
    sourceType = "card",
  } = {},
  existing = state.transactions || [],
) {
  const resolved = resolveCardEntries(entries, state, primaryOwner);
  const rows = [];
  const errors = [];
  for (let index = 0; index < resolved.entries.length; index++) {
    const entry = resolved.entries[index];
    try {
      rows.push(
        normalizeRow(
          [
            entry.date,
            entry.merchant,
            entry.amount,
            entry.payment,
            entry.type,
            entry.note,
          ],
          CARD_MAP,
          {
            owner: entry.owner,
            sourceType,
            rules: state.rules,
            recurring: state.recurring,
            negativeMode: "refund",
          },
        ),
      );
    } catch (error) {
      errors.push({ row: entry.sourceRow || index + 1, message: error.message });
    }
  }
  const identified = await identify(rows);
  const result = dedupe(identified, existing);
  const ownerCounts = {};
  for (const tx of identified) ownerCounts[tx.owner] = (ownerCounts[tx.owner] || 0) + 1;
  return {
    ...result,
    valid: identified,
    total: entries.length,
    errors,
    ownerCounts,
    ownerWarnings: resolved.warnings,
  };
}
