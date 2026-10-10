import test from "node:test";
import assert from "node:assert/strict";

import { CHECKS, SLICE_ID, gaps } from "./slice-19-slo.mjs";

const EXPECTED_IDS = [
  "slo-infinite-drip",
  "slo-no-reply-197",
  "slo-genuine-followup",
  "slo-paid-form-nudge",
  "slo-pack-delivery"
];

test("slice 19-slo: slice id and five SLO workflows", () => {
  assert.equal(SLICE_ID, "19-slo");
  assert.deepEqual(CHECKS.map((row) => row.id), EXPECTED_IDS);
});

test("slice 19-slo: every id is set and redAfter is 3x schedule", () => {
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
    if (row.alreadyInRegistry) {
      assert.equal(row.proof, "PASS");
    } else {
      assert.match(row.proof, /^Add pulse registry row for workflow /);
    }
  }
});

test("slice 19-slo: gaps lists every workflow not in the registry yet", () => {
  const missing = gaps();
  const expected = CHECKS.filter((row) => !row.alreadyInRegistry);
  assert.deepEqual(missing, expected);
  for (const row of missing) {
    assert.equal(row.alreadyInRegistry, false);
  }
});
