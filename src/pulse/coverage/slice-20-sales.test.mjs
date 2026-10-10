import test from "node:test";
import assert from "node:assert/strict";

import { CHECKS, SLICE_ID, gaps } from "./slice-20-sales.mjs";

const EXPECTED_IDS = [
  "s-00-welcome",
  "s-01-new-lead-intake",
  "s-02-incomplete-survey-nudge",
  "s-04-call-booked",
  "s-04b-booking-reminders",
  "s-04c-staff-booked-alert",
  "s-portal-invite",
  "s-nobook-chase",
  "s-05a-no-show-recovery",
  "s-06-post-call-funding-purchased",
  "s-doc-collection",
  "s-offer-bucket",
  "s-08-post-call-funding-declined"
];

test("slice 20-sales: slice id and thirteen sales workflows", () => {
  assert.equal(SLICE_ID, "20-sales");
  assert.deepEqual(CHECKS.map((row) => row.id), EXPECTED_IDS);
});

test("slice 20-sales: every id is set and redAfter is 3x schedule", () => {
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

test("slice 20-sales: gaps lists every workflow not in the registry yet", () => {
  const missing = gaps();
  const expected = CHECKS.filter((row) => !row.alreadyInRegistry);
  assert.deepEqual(missing, expected);
  assert.equal(missing.length, EXPECTED_IDS.length);
  for (const row of missing) {
    assert.equal(row.alreadyInRegistry, false);
  }
});
