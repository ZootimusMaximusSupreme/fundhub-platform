// Guards for the batch 11 row table: every listed row is one exact row of the coverage map, every
// named test file is a plain runnable test that opens no live site, every row has one proof case, and
// every live check is attached to the control it judges.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FIN_B11_CHECKS, FIN_B11_DISPLAY_PROOF_CASES, FIN_B11_LANE, FIN_B11_LIVE_PROOF_CASES, FIN_B11_NOT_ATTACHABLE, FIN_B11_ROWS
} from "./fin-b11-display-contracts.mjs";
import { DISPLAY_RESULT_CONTRACTS, displaySavedResultContract } from "./display-saved-result.mjs";
import { DISPLAY_PROOF_CASES } from "./display-proof-cases.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/desks-b.json");
const mapRows = JSON.parse(fs.readFileSync(MAP, "utf8"));

test("every listed row is one exact map row, and each is a tracked, non-repeat row", () => {
  assert.equal(FIN_B11_ROWS.length, 38);
  for (const row of FIN_B11_ROWS) {
    assert.equal(row.sourceFile, "desks-b.json");
    const hits = mapRows.filter((r) => r.surface === row.surface && r.control === row.control);
    assert.equal(hits.length, 1, `${row.surface} / ${row.control}`);
    assert.ok(!hits[0].repeats_row_in, `${row.control} is a repeat of another row`);
  }
});

test("each named test file exists, is a plain runnable test, and never opens a live site", () => {
  const files = new Set(FIN_B11_DISPLAY_PROOF_CASES.flatMap((c) => c.tests));
  assert.equal(files.size, 10, [...files].join(", "));
  for (const file of files) {
    assert.ok(file.endsWith(".test.mjs") && !file.includes(".pg."), `${file} is not a plain runnable test`);
    const full = path.join(ROOT, file);
    assert.ok(fs.existsSync(full), `${file} does not exist`);
    const text = fs.readFileSync(full, "utf8");
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost|drive\.example\.test|meet\.example)[a-z0-9.-]+\.(?:ai|com|net)\b[^\s"'`]*\/api\//i.test(text), `${file} must not call a live API`);
    assert.ok(!/DATABASE_URL|process\.env\.[A-Z_]*(?:KEY|TOKEN|SECRET)/.test(text), `${file} must not read the live database or a key`);
  }
});

test("every row has one proof case: a live check is a deep case naming the lane, a practice test is an e2e case", () => {
  assert.equal(FIN_B11_DISPLAY_PROOF_CASES.length, 38);
  assert.equal(new Set(FIN_B11_DISPLAY_PROOF_CASES.map((c) => `${c.surface}\0${c.control}`)).size, 38);
  const live = FIN_B11_DISPLAY_PROOF_CASES.filter((c) => c.depth === "deep");
  assert.equal(live.length, FIN_B11_CHECKS.length);
  assert.deepEqual(FIN_B11_LIVE_PROOF_CASES, live);
  for (const c of live) {
    assert.ok(c.evidence.includes(FIN_B11_LANE), c.control);
    assert.ok(c.tests.some((t) => t.endsWith("fin-b11-live-contracts.test.mjs")), c.control);
  }
  for (const c of FIN_B11_DISPLAY_PROOF_CASES.filter((x) => x.depth === "e2e")) {
    assert.ok(!c.evidence.includes(FIN_B11_LANE), c.control);
    // The page practice test first, then any handler or extra page test that runs the control's own code.
    assert.ok(c.tests.length >= 1);
    for (const t of c.tests) assert.ok(t.endsWith(".test.mjs") && !t.endsWith("fin-b11-live-contracts.test.mjs"), c.control);
  }
});

test("each live check is registered in the display lane under its own control, and the catalog lists every row", () => {
  for (const spec of FIN_B11_CHECKS) {
    const registered = DISPLAY_RESULT_CONTRACTS.filter((c) => c.control === spec.control);
    assert.equal(registered.length, 1, spec.control);
    assert.equal(registered[0].mode, "query");
    assert.equal(registered[0].emptyAs, "quiet");
    const row = mapRows.find((r) => r.control === spec.control);
    assert.equal(displaySavedResultContract(row)?.sql, registered[0].sql);
  }
  const known = new Set(DISPLAY_PROOF_CASES.map((c) => `${c.sourceFile}\0${c.surface}\0${c.control}`));
  for (const row of FIN_B11_ROWS) assert.ok(known.has(`${row.sourceFile}\0${row.surface}\0${row.control}`), row.control);
});

test("a row this batch could not attach honestly is on the map, is not attached, and says exactly what is missing", () => {
  assert.equal(FIN_B11_NOT_ATTACHABLE.length, 2);
  for (const row of FIN_B11_NOT_ATTACHABLE) {
    const hits = mapRows.filter((r) => r.surface === row.surface && r.control === row.control);
    assert.equal(hits.length, 1, `${row.surface} / ${row.control} is one row of the map`);
    assert.ok(row.reason.length > 200, `${row.control}: the reason is exact`);
    assert.match(row.reason, /openThread\(\)/);
    assert.ok(row.tests.every((t) => fs.existsSync(path.join(ROOT, t))), row.control);
    // Not attached: no proof case, no live check, no registered contract.
    assert.equal(FIN_B11_ROWS.some((r) => r.surface === row.surface && r.control === row.control), false, row.control);
    assert.equal(DISPLAY_RESULT_CONTRACTS.some((c) => c.control === row.control), false, `${row.control} has no registered contract`);
    assert.equal(DISPLAY_PROOF_CASES.some((c) => c.surface === row.surface && c.control === row.control), false, `${row.control} has no proof case`);
  }
});
