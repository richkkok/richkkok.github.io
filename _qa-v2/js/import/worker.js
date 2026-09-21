/* Local-only, classic worker. No workbook data leaves this worker/browser. */
importScripts("../../vendor/xlsx.full.min.js");
self.onmessage = (event) => {
  try {
    const wb = XLSX.read(event.data, {
      type: "array",
      cellDates: false,
      cellFormula: false,
      cellHTML: false,
      sheetRows: 50042,
    });
    const sheets = wb.SheetNames.map((name) => ({
      name,
      date1904: !!wb.Workbook?.WBProps?.date1904,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[name], {
        header: 1,
        defval: null,
        raw: true,
        blankrows: true,
      }),
    }));
    self.postMessage({ sheets });
  } catch {
    self.postMessage({
      error:
        "이 엑셀 파일을 읽을 수 없어요. 암호가 걸려 있다면 해제 후 다시 내보내 주세요.",
    });
  }
};
