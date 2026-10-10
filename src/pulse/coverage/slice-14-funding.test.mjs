import test from "node:test";
import assert from "node:assert/strict";

import {
  CHECKS,
  COVERAGE_NOTES,
  FUNDING_WORKFLOW_IDS,
  SLICE_ID,
  eventSchedule,
  gaps
} from "./slice-14-funding.mjs";
import { functions } from "../../workflows/index.mjs";

const EXPECTED_SCHEDULES = {
  "f-01-funding-intake": "round.started",
  "f-02-portal-id-missing": "round.started",
  "f-03-round-submitted": "round.submitted",
  "f-04-round-approvals": "round.approved",
  "f-05-inquiry-cleanup-gate": "round.approved",
  "f-06-funding-conditions-missing-docs": "mail.response + docs.received",
  "f-07-funding-locked": "round.funded",
  "f-08-post-funding-monitoring": "round.funded",
  "f-09-funding-declined-no-path": "mail.response",
  "f-10-client-funding-inbox-provisioner": "round.started",
  "f-11-bank-email-event-router": "mail.response"
};

test("slice 14-funding: eleven funding workflows from index.mjs", () => {
  assert.equal(SLICE_ID, "14-funding");
  assert.deepEqual(CHECKS.map((row) => row.id), FUNDING_WORKFLOW_IDS);
  assert.equal(CHECKS.length, 11);
  for (const id of FUNDING_WORKFLOW_IDS) {
    assert.ok(functions.some((fn) => fn.id() === id), `${id} must be registered in index.mjs`);
  }
});

test("slice 14-funding: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
    assert.ok(row.schedule.length > 0);
    assert.equal(typeof row.redAfter, "string");
    assert.match(row.redAfter, /^3x .+/);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.equal(typeof row.alreadyInRegistry, "boolean");
    assert.equal(typeof row.proof, "string");
    assert.ok(row.proof.length > 0);
    assert.doesNotMatch(row.schedule, /^\*\/|\* \* \* \* \*$/);
  }
});

test("slice 14-funding: schedules are event triggers, not crons", () => {
  const byId = new Map(functions.map((fn) => [fn.id(), fn]));
  for (const id of FUNDING_WORKFLOW_IDS) {
    const fn = byId.get(id);
    assert.ok(fn, id);
    assert.equal(eventSchedule(fn), EXPECTED_SCHEDULES[id]);
    assert.equal(CHECKS.find((row) => row.id === id).schedule, EXPECTED_SCHEDULES[id]);
  }
});

test("slice 14-funding: gaps lists workflows missing registry and coverage note", () => {
  const open = gaps();
  const expected = CHECKS.filter((row) => !row.alreadyInRegistry);
  assert.deepEqual(open, expected);
  assert.deepEqual(
    open.map((row) => row.id).sort(),
    FUNDING_WORKFLOW_IDS.filter((id) => !COVERAGE_NOTES[id]).sort()
  );
  for (const row of open) {
    assert.equal(row.alreadyInRegistry, false);
    assert.match(row.proof, /Add pulse registry row|COVERAGE_NOTES/);
  }
});
