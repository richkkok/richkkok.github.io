import { parseCSV, decodeCSV } from "./csv.js";
import { detectHeader, mappingValid } from "./mapper.js";
import { normalizeRow } from "./normalize.js";
import { identify, dedupe } from "./dedupe.js";
export function parseWorkbook(bytes, adapter) {
  const wb = adapter.read(bytes, {
    type: "array",
    cellDates: false,
    cellFormula: false,
    cellHTML: false,
    sheetRows: 50042,
  });
  return wb.SheetNames.map((name) => ({
    name,
    date1904: !!wb.Workbook?.WBProps?.date1904,
    rows: adapter.utils.sheet_to_json(wb.Sheets[name], {
      header: 1,
      defval: null,
      raw: true,
      blankrows: true,
    }),
  }));
}
export function parseBytes(bytes, name, adapter) {
  if (bytes.byteLength === 0) throw Error("비어 있는 파일이에요.");
  if (bytes.byteLength > 20 * 1024 * 1024)
    throw Error("파일은 20MB까지 지원해요. 기간을 나눠 내보내 주세요.");
  const ext = name.split(".").at(-1).toLowerCase();
  if (ext === "csv")
    return [{ name: "CSV", rows: parseCSV(decodeCSV(bytes)), date1904: false }];
  if (!["xls", "xlsx"].includes(ext))
    throw Error("CSV, XLS, XLSX 파일을 선택해 주세요.");
  if (!adapter)
    throw Error("엑셀 파서를 준비하지 못했어요. 앱을 새로 열어 주세요.");
  return parseWorkbook(bytes, adapter);
}
export function inspectSheets(sheets) {
  return sheets.map((s) => ({ ...s, header: detectHeader(s.rows) }));
}
export async function previewRows(
  sheet,
  header,
  mapping,
  options,
  existing = [],
) {
  if (!mappingValid(mapping))
    throw Error("날짜, 가맹점, 금액 열을 연결해 주세요.");
  const rows = [],
    errors = [];
  if (sheet.rows.length - header > 50001)
    throw Error("50,000행을 넘었어요. 파일을 나눠 주세요.");
  sheet.rows.slice(header + 1).forEach((row, index) => {
    if (!row.some((v) => v !== null && String(v).trim())) return;
    try {
      rows.push(
        normalizeRow(row, mapping, { ...options, date1904: sheet.date1904 }),
      );
    } catch (error) {
      errors.push({ row: header + index + 2, message: error.message });
    }
  });
  const identified = await identify(rows),
    result = dedupe(identified, existing);
  return {
    ...result,
    valid: identified,
    total: rows.length + errors.length,
    errors,
  };
}
