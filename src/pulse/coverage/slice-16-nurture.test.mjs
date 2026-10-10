import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKS, SLICE_ID, gaps } from "./slice-16-nurture.mjs";
import { CATCH_UP_CRON } from "../../workflows/next-action-catch-up.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

const EXPECTED_IDS = [
  "n-01-cold-nurture",
  "n-02-warm-nurture",
  "n-03-hot-nurture",
  "n-04-post-funding-nurture",
  "n-05-repair-complete-nurture",
  "n-06-renewal-second-wave",
  "next-action-catch-up"
];

const WORKFLOW_FILES = {
  "n-01-cold-nurture": "src/workflows/n-01-cold-nurture.mjs",
  "n-02-warm-nurture": "src/workflows/n-02-warm-nurture.mjs",
  "n-03-hot-nurture": "src/workflows/n-03-hot-nurture.mjs",
  "n-04-post-funding-nurture": "src/workflows/n-04-post-funding-nurture.mjs",
  "n-06-renewal-second-wave": "src/workflows/n-06-renewal-second-wave.mjs",
  "next-action-catch-up": "src/workflows/next-action-catch-up.mjs"
};

test("slice 16-nurture: slice id and seven nurture rows", () => {
  assert.equal(SLICE_ID, "16-nurture");
  assert.deepEqual(CHECKS.map((row) => row.id), EXPECTED_IDS);
});

test("slice 16-nurture: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.ok(CHECKS.length > 0);
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
    assert.ok(row.schedule.length > 0);
    assert.equal(typeof row.redAfter, "string");
    assert.match(row.redAfter, /^3x \S+$/);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.equal(typeof row.alreadyInRegistry, "boolean");
    assert.equal(typeof row.proof, "string");
    assert.ok(row.proof.length > 0);
    if (row.alreadyInRegistry) {
      if (row.id === "next-action-catch-up") {
        assert.match(row.proof, /^PASS — cron/);
        assert.match(row.proof, /red after 3x 5m with no run/);
      } else {
        assert.equal(row.proof, "PASS");
      }
    } else {
      assert.match(row.proof, /^Add pulse registry row for workflow /);
    }
  }
});

test("slice 16-nurture: registered workflow files exist (n-05 is unwired)", () => {
  for (const [id, file] of Object.entries(WORKFLOW_FILES)) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${id} workflow file missing`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, "src/workflows/n-05-repair-complete-nurture.mjs")));
});

test("slice 16-nurture: catch-up names cron and 3x schedule red rule", () => {
  const catchUp = CHECKS.find((r) => r.id === "next-action-catch-up");
  assert.ok(catchUp);
  assert.equal(catchUp.schedule, "5m");
  assert.equal(catchUp.redAfter, "3x 5m");
  assert.equal(catchUp.cron, CATCH_UP_CRON);
  assert.match(catchUp.proof, /red after 3x 5m with no run/);
  if (catchUp.alreadyInRegistry) {
    assert.match(catchUp.proof, /15 minutes/);
  }
});

test("slice 16-nurture: gaps lists every row not in PULSE_REGISTRY yet", () => {
  const missing = gaps();
  const expected = CHECKS.filter((row) => !row.alreadyInRegistry);
  assert.deepEqual(missing, expected);
  for (const row of missing) {
    assert.equal(row.alreadyInRegistry, false);
  }
  assert.equal(missing.length, CHECKS.length, "nurture workflows are not in GET registry until rows are added elsewhere");
});
