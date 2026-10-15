// Holds the one batch 15 row that is left out on purpose to the repo. If this test goes red, the
// page was fixed: attach "Scripts: 'Try again' buttons on a failed part" with a practice test that
// fails the Rules read and the Every version read and presses Try again on each.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B15_NOT_ATTACHABLE } from "./fin-b15-not-attachable.mjs";
import { FIN_B15_DISPLAY_ENTRIES } from "./fin-b15-display-specs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");

test("the left-out row is one exact map row, has a written reason, and is attached nowhere else", () => {
  assert.equal(FIN_B15_NOT_ATTACHABLE.length, 1);
  const map = JSON.parse(fs.readFileSync(path.join(MAP_DIR, "desks-c.json"), "utf8"));
  for (const row of FIN_B15_NOT_ATTACHABLE) {
    assert.equal(map.filter((r) => r.surface === row.surface && r.control === row.control).length, 1, row.control);
    assert.ok(row.why.length > 200, "the reason is written out");
    assert.equal(FIN_B15_DISPLAY_ENTRIES.some((e) => e.control === row.control), false, "left out of the practice rows");
  }
});

test("the reason is still true: a failed Rules or Every version read is started again on every repaint", () => {
  const source = fs.readFileSync(path.join(ROOT, "public/app/marketing-cc-scripts.js"), "utf8");
  const body = source.split("function onToggle(ev)")[1].split("function onPointerDown")[0];
  // The Rules fold starts its read whenever it is open, not loaded, and not already loading. A status of
  // "error" is none of those, so a failed read is started again by the next repaint.
  assert.match(body, /key === "rules" && !st\.rules\.loaded && st\.rules\.status !== "loading"\) loadRules\(\)/,
    "the Rules fold no longer restarts a failed read on every repaint: attach the row");
  // The Every version fold does the same on purpose for status === "error".
  assert.match(body, /!st\.versions\[id\] \|\| st\.versions\[id\]\.status === "error"\)/,
    "the Every version fold no longer restarts a failed read on every repaint: attach the row");
  assert.ok(!/status !== "error"/.test(body), "a failed read is now left alone until Try again: attach the row");
});
