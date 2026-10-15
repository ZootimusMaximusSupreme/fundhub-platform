// Guards for the batch 10 row table: every listed row is one exact map row, every named test file is a
// plain runnable test that opens no live site, every attached row has exactly one proof case (a live check
// or a practice test), and the two rows left out stay out only while the reason in
// fin-b10-not-attachable.mjs is still true.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B10_DISPLAY_PROOF_CASES, FIN_B10_PRACTICE_CASES } from "./fin-b10-display-proofs.mjs";
import { FIN_B10_LIVE_CASES, FIN_B10_LIVE_ROWS } from "./fin-b10-display-contracts.mjs";
import { FIN_B10_NOT_ATTACHABLE } from "./fin-b10-not-attachable.mjs";
import ROWS from "./fin-b10-rows.json" with { type: "json" };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const maps = new Map();
const rowsOf = (file) => {
  if (!maps.has(file)) maps.set(file, JSON.parse(fs.readFileSync(path.join(MAP_DIR, file), "utf8")));
  return maps.get(file);
};
const oneRow = (file, surface, control) => rowsOf(file).filter((r) => r.surface === surface && r.control === control);
const keyOf = (c) => `${c.sourceFile}\0${c.surface}\0${c.control}`;

test("every listed row is one exact map row, and its test file is a plain test that never opens a live site", () => {
  let listed = 0;
  for (const [name, groups] of Object.entries(ROWS)) {
    const file = path.join(ROOT, "src/pulse/catalog/proofs", name);
    assert.ok(fs.existsSync(file), `${name} does not exist`);
    assert.ok(name.endsWith(".test.mjs") && !name.includes(".pg."), `${name} is not a plain runnable test`);
    const text = fs.readFileSync(file, "utf8");
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost)[a-z0-9.-]+\.(?:ai|net)\b[^\s"'`]*\/api\//i.test(text), `${name} must not call a live API`);
    for (const group of groups) {
      for (const control of [...group.controls, ...(group.notAttached || [])]) {
        listed += 1;
        assert.equal(oneRow(group.sourceFile, group.surface, control).length, 1, `${group.surface} / ${control}`);
      }
    }
  }
  assert.equal(listed, 40, "all 40 batch rows are exercised: 38 attached and 2 left out");
});

test("attached rows have one proof case each (5 live, 33 practice); the two left out have none", () => {
  const attached = Object.values(ROWS).flatMap((groups) => groups.flatMap((g) => g.controls.map((control) => ({ sourceFile: g.sourceFile, surface: g.surface, control }))));
  assert.equal(attached.length, 38);
  assert.equal(FIN_B10_LIVE_CASES.length, 5);
  assert.equal(FIN_B10_PRACTICE_CASES.length, 33);
  assert.equal(FIN_B10_DISPLAY_PROOF_CASES.length, 38);
  const caseKeys = FIN_B10_DISPLAY_PROOF_CASES.map(keyOf);
  assert.equal(new Set(caseKeys).size, 38);
  assert.deepEqual([...caseKeys].sort(), attached.map(keyOf).sort());
  for (const row of FIN_B10_NOT_ATTACHABLE) assert.equal(caseKeys.includes(keyOf(row)), false, row.control);
  // A live row names the lane (so it stays in the lane); a practice row never does.
  for (const c of FIN_B10_LIVE_CASES) assert.match(c.evidence, /gap-catalog-display\.mjs/);
  for (const c of FIN_B10_PRACTICE_CASES) assert.doesNotMatch(c.evidence, /gap-catalog-display\.mjs/);
  assert.equal(FIN_B10_LIVE_ROWS.length, 5);
});

test("the two left-out rows are real map rows, each with a reason that is still true", () => {
  assert.equal(FIN_B10_NOT_ATTACHABLE.length, 2);
  for (const row of FIN_B10_NOT_ATTACHABLE) {
    assert.equal(oneRow(row.sourceFile, row.surface, row.control).length, 1, row.control);
    assert.ok(row.why.length > 120, "the reason is written out");
  }
  // Still true: the page's link gate has no present.html on its ALL list of screens, so both rows stay hidden.
  const shell = fs.readFileSync(path.join(ROOT, "public/app/shell.js"), "utf8");
  const start = shell.indexOf("var ALL = [");
  const end = shell.indexOf("];", start);
  assert.ok(start > 0 && end > start, "the shell's ALL list moved");
  const all = shell.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/present\.html/.test(all), "present.html is on the ALL list now: attach the Credit Snapshot and Quick launch rows with the practice test (fin-b10-client-control-panel.test.mjs already presses them)");
  // The control panel still carries both links, pointing at the deck for this client.
  const panel = fs.readFileSync(path.join(ROOT, "public/app/client-control-panel.html"), "utf8");
  assert.match(panel, /id="ccp-link-present2" href="present\.html"/);
  assert.match(panel, /id="ccp-link-present" href="present\.html"/);
});
