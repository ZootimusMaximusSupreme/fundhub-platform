import test from "node:test";
import assert from "node:assert/strict";

import {
  BRIEF_TZ,
  CHECKS,
  EVENING_BRIEF_CRON,
  EVENING_BRIEF_ID,
  MORNING_BRIEF_CRON,
  MORNING_BRIEF_ID,
  SLICE_ID,
  gaps,
  wired
} from "./slice-06-briefs.mjs";

test("slice 06-briefs: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.equal(SLICE_ID, "06-briefs");
  assert.equal(CHECKS.length, 2);
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(row.schedule, "daily");
    assert.equal(typeof row.redAfter, "string");
    assert.match(row.redAfter, /^3x \S+$/);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.equal(typeof row.alreadyInRegistry, "boolean");
    assert.equal(typeof row.proof, "string");
    assert.ok(row.proof.length > 0);
    assert.equal(row.timezone, BRIEF_TZ);
    assert.match(row.cron, /^TZ=America\/Phoenix /);
  }
});

test("slice 06-briefs: Arizona crons are 6:00 a.m. and 9:00 p.m.", () => {
  assert.equal(MORNING_BRIEF_CRON, "TZ=America/Phoenix 0 6 * * *");
  assert.equal(EVENING_BRIEF_CRON, "TZ=America/Phoenix 0 21 * * *");
  const morning = CHECKS.find((r) => r.id === MORNING_BRIEF_ID);
  const evening = CHECKS.find((r) => r.id === EVENING_BRIEF_ID);
  assert.ok(morning);
  assert.ok(evening);
  assert.equal(morning.after, "daily-pulse");
  assert.equal(evening.after, null);
});

test("slice 06-briefs: morning and evening briefs are wired end-to-end", () => {
  const byId = Object.fromEntries(CHECKS.map((row) => [row.id, row]));
  assert.equal(byId[MORNING_BRIEF_ID].alreadyInRegistry, true);
  assert.equal(byId[EVENING_BRIEF_ID].alreadyInRegistry, true);
  assert.match(byId[MORNING_BRIEF_ID].proof, /PASS/);
  assert.match(byId[EVENING_BRIEF_ID].proof, /PASS/);
  assert.deepEqual(gaps().map((r) => r.id), []);
  const w = Object.fromEntries(wired().map((r) => [r.id, r.wired]));
  assert.equal(w[MORNING_BRIEF_ID], true);
  assert.equal(w[EVENING_BRIEF_ID], true);
});
