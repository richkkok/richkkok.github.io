import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
const files = ["js", "data", "scripts"]
  .flatMap(walk)
  .filter((f) => /\.(js|mjs|cjs)$/.test(f));
for (const f of files) execFileSync(process.execPath, ["--check", f]);
const html = fs.readFileSync("index.html", "utf8");
for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g))
  if (!/^https?:/.test(m[1])) assert.ok(fs.existsSync(m[1]), "Missing " + m[1]);
const manifest = JSON.parse(fs.readFileSync("manifest.webmanifest"));
for (const i of manifest.icons) assert.ok(fs.existsSync(i.src));
for (const f of ["js", "data"].flatMap(walk)) {
  const text = fs.readFileSync(f, "utf8");
  assert.ok(
    !/fetch\s*\(|XMLHttpRequest|sendBeacon|https?:\/\//.test(text),
    "Unexpected external/network behavior in " + f,
  );
}
assert.ok(html.includes("connect-src 'self'"));
assert.ok(html.includes("viewport-fit=cover"));
console.log(
  `PASS syntax ${files.length} files, resources, manifest, no financial network requests`,
);
