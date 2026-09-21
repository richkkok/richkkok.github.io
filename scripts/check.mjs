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
  if (!/^https?:/.test(m[1]))
    assert.ok(fs.existsSync(m[1]), "Missing " + m[1]);

const manifest = JSON.parse(fs.readFileSync("manifest.webmanifest"));
for (const i of manifest.icons) assert.ok(fs.existsSync(i.src));

for (const f of ["js", "data"].flatMap(walk)) {
  const source = fs.readFileSync(f, "utf8");
  if (f.replaceAll("\\", "/") === "js/cloud.js") {
    assert.ok(
      source.includes(
        "https://wjelumpbjklfrdjxbesj.supabase.co/functions/v1/richkkok-sync",
      ),
      "Cloud sync API must stay pinned",
    );
    assert.ok(
      source.includes(
        "wss://wjelumpbjklfrdjxbesj.supabase.co/realtime/v1/websocket",
      ),
      "Realtime endpoint must stay pinned",
    );
    assert.ok(
      !/service[_-]?role|SUPABASE_SERVICE_ROLE/i.test(source),
      "Never expose a Supabase service-role secret to the browser",
    );
    continue;
  }
  assert.ok(
    !/fetch\s*\(|XMLHttpRequest|sendBeacon|https?:\/\//.test(source),
    "Unexpected external/network behavior in " + f,
  );
}

assert.ok(html.includes("connect-src 'self'"));
assert.ok(html.includes("https://wjelumpbjklfrdjxbesj.supabase.co"));
assert.ok(html.includes("wss://wjelumpbjklfrdjxbesj.supabase.co"));
assert.ok(html.includes("viewport-fit=cover"));

const focusCss = fs.readFileSync("css/app.css", "utf8");
const responsiveCss = fs.readFileSync("css/responsive.css", "utf8");
assert.ok(!focusCss.includes("outline: 3px solid #2b86db"));
assert.ok(!focusCss.includes("var(--focus-ring)"));
assert.ok(!focusCss.includes("var(--focus-halo)"));
assert.ok(focusCss.includes("-webkit-tap-highlight-color: transparent"));
assert.ok(focusCss.includes("outline: none !important"));
assert.ok(focusCss.includes("#main:focus"));
assert.ok(focusCss.includes("#main:focus-visible"));
assert.ok(responsiveCss.includes("@media (hover: none) and (pointer: coarse)"));
assert.ok(responsiveCss.includes("-webkit-tap-highlight-color: transparent !important"));

console.log(
  `PASS syntax ${files.length} files, resources, manifest, isolated RichKkok sync only`,
);
