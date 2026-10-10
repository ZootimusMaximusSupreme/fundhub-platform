import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { CHECKS, SLICE_ID, gaps } from "./slice-29-inquiry-remover.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const EXPECTED_IDS = [
  "inquiry-remover.html",
  "read/inquiry-cases",
  "inquiry-cases",
  "inquiry",
  "c-02b-inquiry-removal-requested",
  "ai-set-01-josh-setter",
  "ai-set-04-3way-handoff",
  "ai-set-03-no-answer-cadence",
  "inquiry-call-sweeper",
  "c-02-inquiry-created",
  "c-03-inquiry-removed-resume-or-hold"
];

test("slice 29-inquiry-remover: slice id and fulfillment map", () => {
  assert.equal(SLICE_ID, "29-inquiry-remover");
  assert.deepEqual(CHECKS.map((row) => row.id), EXPECTED_IDS);
});

test("slice 29-inquiry-remover: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.ok(CHECKS.length > 0);
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
    assert.ok(row.schedule.length > 0);
    assert.equal(typeof row.redAfter, "string");
    assert.match(row.redAfter, /^3x /);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.equal(typeof row.alreadyInRegistry, "boolean");
    assert.equal(typeof row.proof, "string");
    assert.ok(row.proof.length > 0);
    if (row.alreadyInRegistry) {
      assert.equal(row.proof, "PASS");
    } else {
      assert.match(row.proof, /Do not auto-fix from this pulse\./);
    }
  }
});

test("slice 29-inquiry-remover: specialist desk and inquiry API doors are on the pulse", () => {
  for (const id of ["inquiry-remover.html", "read/inquiry-cases", "inquiry-cases", "inquiry"]) {
    const row = CHECKS.find((c) => c.id === id);
    assert.ok(row, id);
    assert.equal(row.alreadyInRegistry, true);
    assert.equal(row.proof, "PASS");
  }
});

test("slice 29-inquiry-remover: inquiry-call-sweeper cron matches heartbeats", () => {
  const sweeperSrc = fs.readFileSync(
    path.join(ROOT, "src/workflows/inquiry-call-sweeper.mjs"),
    "utf8"
  );
  assert.match(sweeperSrc, /\{ cron: "\*\/15 \* \* \* \*" \}/);
  const row = CHECKS.find((c) => c.id === "inquiry-call-sweeper");
  assert.equal(row.schedule, "15 minutes");
});

test("slice 29-inquiry-remover: gaps lists every row not in PULSE_REGISTRY yet", () => {
  const missing = gaps();
  const expected = CHECKS.filter((row) => !row.alreadyInRegistry);
  assert.deepEqual(missing, expected);
  for (const row of missing) {
    assert.equal(row.alreadyInRegistry, false);
  }
  assert.ok(missing.length > 0, "workflows should still be gaps until registry rows exist");
});
