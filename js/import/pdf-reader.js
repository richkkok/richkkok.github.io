const PDFJS_URL =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER_URL =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
let libraryPromise;

async function pdfLibrary() {
  if (!libraryPromise)
    libraryPromise = import(PDFJS_URL)
      .then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        return lib;
      })
      .catch(() => {
        libraryPromise = null;
        throw Error(
          "PDF 원본 해석 모듈을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
        );
      });
  return libraryPromise;
}

function groupLines(items) {
  const sorted = items
    .filter((item) => item.str && item.str.trim())
    .map((item) => ({
      text: item.str.trim(),
      x: Number(item.transform?.[4] || 0),
      y: Number(item.transform?.[5] || 0),
      width: Number(item.width || 0),
    }))
    .sort((a, b) => (Math.abs(a.y - b.y) > 2.5 ? b.y - a.y : a.x - b.x));
  const lines = [];
  for (const item of sorted) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 2.5);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      line.items.sort((a, b) => a.x - b.x);
      return {
        y: line.y,
        text: line.items.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim(),
        items: line.items,
      };
    });
}

export async function readPdfPages(bytes) {
  if (!bytes?.byteLength) throw Error("비어 있는 PDF 파일이에요.");
  if (bytes.byteLength > 20 * 1024 * 1024)
    throw Error("PDF는 20MB까지 지원해요. 기간을 나눠 내려받아 주세요.");
  const pdfjs = await pdfLibrary();
  let task;
  try {
    task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
    });
    const document = await task.promise;
    if (document.numPages > 60)
      throw Error("PDF가 60페이지를 넘어요. 기간을 나눠 내려받아 주세요.");
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false });
      pages.push({ page: pageNumber, lines: groupLines(content.items) });
      page.cleanup();
    }
    await document.destroy();
    return pages;
  } catch (error) {
    try {
      await task?.destroy?.();
    } catch {}
    if (
      /password/i.test(error?.name || "") ||
      /password/i.test(error?.message || "")
    )
      throw Error(
        "암호가 걸린 PDF는 읽을 수 없어요. 암호를 해제한 원본을 선택해 주세요.",
      );
    if (error?.message?.includes("페이지")) throw error;
    throw Error(
      "이 PDF의 거래내역을 읽지 못했어요. 카드사에서 다시 내려받은 텍스트형 PDF 또는 엑셀 원본을 사용해 주세요.",
    );
  }
}
