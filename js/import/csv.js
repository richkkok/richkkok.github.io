export function decodeCSV(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 255 && bytes[1] === 254)
    return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 254 && bytes[1] === 255)
    return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}
export function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, "");
  if (!text.trim()) return [];
  const first = text.split(/\r?\n/).slice(0, 8).join("\n"),
    delimiters = [",", "\t", ";"];
  const delimiter = delimiters
    .map((d) => [
      d,
      (first.match(new RegExp(d === "\t" ? "\t" : d, "g")) || []).length,
    ])
    .sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || !cell) quoted = !quoted;
      else cell += c;
    } else if (c === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
    if (rows.length > 50000)
      throw Error("한 번에 50,000행까지 가져올 수 있어요. 파일을 나눠 주세요.");
  }
  if (quoted)
    throw Error("CSV의 따옴표가 닫히지 않았어요. 파일을 확인해 주세요.");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
