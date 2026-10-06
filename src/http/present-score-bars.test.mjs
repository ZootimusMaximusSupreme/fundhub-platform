// THE CLOSER DECK'S SCORE BARS ARE COLOURED BY THE SCORE, NOT BY THE ROW.
//
// Walkthrough-4 defect 1 (2026-09-06). scoreBars() in public/app/present.js
// painted Experian coral, TransUnion sage and Equifax blue by position, so a
// client with a 790 Experian saw the "failed" colour on the slide a closer
// shares during the sales call. fundhub-brand.css: sage = healthy, peach =
// behind, coral = blocked/failed. The engine's one line is 700 (fundable).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const JS = fs.readFileSync(path.join(ROOT, "public/app/present.js"), "utf8");

function fnSource(src, name) {
  const start = src.indexOf("function " + name + "(");
  assert.ok(start !== -1, name + "() is gone");
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(name + "() never closes");
}

function load() {
  const box = { dash: (v) => (v == null ? "—" : String(v)) };
  vm.createContext(box);
  vm.runInContext(fnSource(JS, "scoreTone"), box);
  vm.runInContext(fnSource(JS, "scoreBars"), box);
  return box;
}

const fills = (html) => [...html.matchAll(/class="fill" style="width:[^;]*;background:([^"]+)"/g)].map((m) => m[1]);

test("a strong Experian is not painted the failed colour", () => {
  const { scoreBars } = load();
  const [ex, tu, eq] = fills(scoreBars({ ex: 790, tu: 520, eq: 705 }));
  assert.equal(ex, "var(--ok)", "790 Experian");
  assert.equal(tu, "var(--warn)", "520 TransUnion");
  assert.equal(eq, "var(--ok)", "705 Equifax");
});

test("the colour follows the number when the rows swap", () => {
  const { scoreBars } = load();
  assert.deepEqual(fills(scoreBars({ ex: 520, tu: 790, eq: 600 })), ["var(--warn)", "var(--ok)", "var(--warn)"]);
});

test("700 is the line; a missing score paints no colour", () => {
  const { scoreTone } = load();
  assert.equal(scoreTone(700), "var(--ok)");
  assert.equal(scoreTone(699), "var(--warn)");
  assert.equal(scoreTone(null), "transparent");
  assert.equal(scoreTone(undefined), "transparent");
});

test("no positional colour list is left in scoreBars", () => {
  assert.ok(!/stops\s*\[\s*i\s*\]/.test(fnSource(JS, "scoreBars")), "scoreBars indexes a colour by row again");
});
