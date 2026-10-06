// THE TOPBAR STARTS WITH THE LOGO, AND IT SURVIVES A REAL WINDOW.
// docs/rules/UI-STANDARDS.md §12.8, walkthrough-4 defects 11 and 26 (2026-09-06).
//
// Defect 11: seven screens typed the word "Fundhub" where the standard puts the
// --logo wordmark. shell.js swaps --logo for a white-label partner's own mark,
// so a typed word showed OUR name on the partner's staff screens.
// Defect 26: Pipeline and Specialist lacked the three declarations that let
// the screen name shrink and truncate while the right cluster holds its size.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APP = path.join(ROOT, "public/app");
const read = (f) => fs.readFileSync(path.join(APP, f), "utf8");
const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const SEVEN = ["pipeline.html", "closer-dashboard.html", "calendar.html", "messaging.html",
  "lenders.html", "galaxy.html", "partner-galaxy.html"];

test("no screen types the company name where the logo goes", () => {
  const typed = fs.readdirSync(APP).filter((f) => f.endsWith(".html"))
    .filter((f) => /<div class="name">\s*fundhub\s*<\/div>/i.test(strip(read(f))));
  assert.deepEqual(typed, [], "these topbars type the name instead of drawing --logo");
});

test("the seven screens draw the --logo wordmark in the brand block, sized", () => {
  for (const f of SEVEN) {
    const src = strip(read(f));
    assert.match(src, /<div class="brand">\s*<div class="logo( inv)?" role="img" aria-label="Fundhub"><\/div>/, `${f}: brand block has no logo`);
    assert.match(src, /\.brand \.logo\{height:15px;aspect-ratio:2698\/543;flex-shrink:0/, `${f}: logo has no size`);
  }
});

test("Pipeline and Specialist carry the three §12.8 overflow declarations", () => {
  for (const f of ["pipeline.html", "inquiry-remover.html"]) {
    const src = strip(read(f));
    assert.match(src, /\.brand\{[^}]*min-width:0;flex:0 1 auto;/, `${f}: .brand cannot shrink`);
    assert.match(src, /\.brand \.sub\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis;/, `${f}: screen name cannot truncate`);
    assert.match(src, /\.topbar-right\{[^}]*flex:0 0 auto;/, `${f}: right cluster can shrink`);
  }
});
