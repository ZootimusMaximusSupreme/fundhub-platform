// THE CLOSER DECK'S TEXT STAYS AT 11PX OR MORE.
// docs/rules/UI-STANDARDS.md §11 (phone): "Text stays at least 11px", and §11
// names Present in scope. present.html roots on <div id="app">, which the brand
// file's size override does not reach (a deliberate carve-out), so its own
// sizes really paint. Walkthrough-4 defect 25 (2026-09-06): nine sizes sat
// below the floor, including the legal small print (.fine, 9.5px) under a
// 64px headline and the .sent-at line a closer reads to know a text went out.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HTML = fs.readFileSync(path.join(ROOT, "public/app/present.html"), "utf8");
const CSS = (HTML.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");

test("no font-size in present.html is below 11px, clamp floors included", () => {
  const low = [];
  for (const m of CSS.matchAll(/font-size\s*:\s*([^;}]*)/gi)) {
    const v = m[1].trim();
    const clamp = /^clamp\(\s*([\d.]+)px/.exec(v);
    const px = clamp ? Number(clamp[1]) : (/^([\d.]+)px/.exec(v) ? Number(/^([\d.]+)px/.exec(v)[1]) : null);
    if (px != null && px < 11) low.push(v);
  }
  assert.deepEqual(low, [], "these deck sizes are under the 11px floor");
});

test("the disclaimer and the sent-at line are at the floor, not under it", () => {
  assert.match(CSS, /\.fine\{[^}]*font-size:11px/);
  assert.match(CSS, /\.sent-at\{[^}]*font-size:11px/);
});
