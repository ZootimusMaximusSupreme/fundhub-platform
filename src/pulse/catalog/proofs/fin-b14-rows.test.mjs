// Guards for the batch 14 row table: every listed row is one exact map row, every named test file is a
// plain runnable test that opens no live site, every attached row has exactly one proof case (a live check
// or a practice test), and the one row left out stays out only while the reason in
// fin-b14-not-attachable.mjs is still true.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B14_DISPLAY_PROOF_CASES, FIN_B14_PRACTICE_CASES } from "./fin-b14-display-proofs.mjs";
import { FIN_B14_LIVE_CASES, FIN_B14_LIVE_ROWS, FIN_B14_RESULT_CONTRACTS } from "./fin-b14-display-contracts.mjs";
import { FIN_B14_NOT_ATTACHABLE } from "./fin-b14-not-attachable.mjs";
import { DISPLAY_RESULT_CONTRACTS } from "./display-saved-result.mjs";
import { ROLE_SETS } from "../../../http/read-api.mjs";
import ROWS from "./fin-b14-rows.json" with { type: "json" };

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
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost|api\.anthropic\.com\/v1\/messages)[a-z0-9.-]+\.(?:ai|net|com)\b[^\s"'`]*\/api\//i.test(text), `${name} must not call a live API`);
    for (const group of groups) {
      for (const also of group.also || []) assert.ok(fs.existsSync(path.join(ROOT, also)), `${also} does not exist`);
      for (const control of [...group.controls, ...(group.notAttached || [])]) {
        listed += 1;
        assert.equal(oneRow(group.sourceFile, group.surface, control).length, 1, `${group.surface} / ${control}`);
      }
    }
  }
  assert.equal(listed, 34, "33 practice-test rows and the one row left out");
});

test("live rows are real map rows, each with one registry contract; practice rows have one proof case each", () => {
  assert.equal(FIN_B14_LIVE_ROWS.length, 6);
  for (const [sourceFile, surface, control] of FIN_B14_LIVE_ROWS) {
    assert.equal(oneRow(sourceFile, surface, control).length, 1, `${surface} / ${control}`);
    assert.equal(DISPLAY_RESULT_CONTRACTS.filter((c) => c.control === control).length, 1, "one registry contract");
  }
  assert.equal(FIN_B14_RESULT_CONTRACTS.length, 6);

  const attached = Object.values(ROWS).flatMap((groups) => groups.flatMap((g) => g.controls.map((control) => ({ sourceFile: g.sourceFile, surface: g.surface, control }))));
  assert.equal(attached.length, 33);
  assert.equal(FIN_B14_LIVE_CASES.length, 6);
  assert.equal(FIN_B14_PRACTICE_CASES.length, 33);
  assert.equal(FIN_B14_DISPLAY_PROOF_CASES.length, 39);
  const caseKeys = FIN_B14_DISPLAY_PROOF_CASES.map(keyOf);
  assert.equal(new Set(caseKeys).size, 39, "no row has two proof cases");
  assert.deepEqual([...FIN_B14_PRACTICE_CASES.map(keyOf)].sort(), attached.map(keyOf).sort());
  for (const row of FIN_B14_NOT_ATTACHABLE) assert.equal(caseKeys.includes(keyOf(row)), false, row.control);
  // A live row names the lane (so it stays in the lane); a practice row never does.
  for (const c of FIN_B14_LIVE_CASES) assert.match(c.evidence, /gap-catalog-display\.mjs/);
  for (const c of FIN_B14_PRACTICE_CASES) assert.doesNotMatch(c.evidence, /gap-catalog-display\.mjs/);
  // A practice row's tests all exist.
  for (const c of FIN_B14_PRACTICE_CASES) for (const t of c.tests) assert.ok(fs.existsSync(path.join(ROOT, t)), `${t} exists`);
});

test("the left-out row is a real map row, and its reason is still true", () => {
  assert.equal(FIN_B14_NOT_ATTACHABLE.length, 1);
  for (const row of FIN_B14_NOT_ATTACHABLE) {
    assert.equal(oneRow(row.sourceFile, row.surface, row.control).length, 1, row.control);
    assert.ok(row.why.length > 200, "the reason is written out");
  }
  // Still true: the editor and ask doors gate on owner and admin only; the run door gates on the finance set,
  // which holds the sales manager as well.
  const journeys = fs.readFileSync(path.join(ROOT, "api/journeys.mjs"), "utf8");
  const ask = fs.readFileSync(path.join(ROOT, "api/journeys/ask.mjs"), "utf8");
  const run = fs.readFileSync(path.join(ROOT, "api/journeys/run.mjs"), "utf8");
  assert.match(journeys, /requireRole\("owner", "admin"\)/);
  assert.match(ask, /requireRole\("owner", "admin"\)/);
  assert.match(run, /requireRole\(res, staff, ROLE_SETS\.FINANCE\)/);
  assert.deepEqual([...ROLE_SETS.FINANCE].sort(), ["admin", "owner", "sales_manager"],
    "the run door's set is owner and admin only now: attach the Page gate row with fin-b14-journeys-handlers.test.mjs");
});
