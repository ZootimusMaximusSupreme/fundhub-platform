import test from "node:test";
import assert from "node:assert/strict";

import { CHECKS, SLICE_ID, gaps } from "./slice-15-repair.mjs";

const EXPECTED_IDS = [
  "c-00-crs-soft-pull-request",
  "c-02-inquiry-created",
  "c-02b-inquiry-removal-requested",
  "c-03-inquiry-removed-resume-or-hold",
  "c-05-pre-funding-review",
  "c-06-crs-results-router",
  "ds-01-repair-referral",
  "ds-02-diy-letters",
  "repair-bureau-response-reader"
];

test("slice 15-repair: slice id and nine repair-lane workflows", () => {
  assert.equal(SLICE_ID, "15-repair");
  assert.deepEqual(CHECKS.map((row) => row.id), EXPECTED_IDS);
});

test("slice 15-repair: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
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
      assert.equal(row.proof, "PASS");
    } else {
      assert.match(row.proof, /^Add pulse registry row for workflow /);
    }
  }
});

test("slice 15-repair: gaps lists every workflow not in the registry yet", () => {
  const missing = gaps();
  const expected = CHECKS.filter((row) => !row.alreadyInRegistry);
  assert.deepEqual(missing, expected);
  for (const row of missing) {
    assert.equal(row.alreadyInRegistry, false);
  }
});
