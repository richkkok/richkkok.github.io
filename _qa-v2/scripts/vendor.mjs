import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const file = new URL("../vendor/xlsx.full.min.js", import.meta.url);
const expected =
  "cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41";
let bytes;
try {
  bytes = await fs.readFile(file);
} catch {
  const r = await fetch(
    "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
  );
  if (!r.ok) throw Error(`SheetJS download ${r.status}`);
  bytes = Buffer.from(await r.arrayBuffer());
}
if (createHash("sha256").update(bytes).digest("hex") !== expected)
  throw Error("SheetJS vendor integrity mismatch");
await fs.mkdir(new URL("../vendor", import.meta.url), { recursive: true });
await fs.writeFile(file, bytes);
console.log("Verified SheetJS CE 0.20.3, local full build");
