import test from "node:test";
import assert from "node:assert/strict";

import { MACHINE_CHECKS } from "../machine.mjs";
import {
  CHECKS,
  FLOOR_JOB_ID,
  FLOOR_LAST_RUN_SQL,
  RED_AFTER_MS,
  SLICE_ID,
  WHITE_LABEL_DOOR_IDS,
  evaluateChecks,
  gaps
} from "./slice-22-partners.mjs";

test("slice 22-partners: id and every row carries schedule + 3x redAfter", () => {
  assert.equal(SLICE_ID, "22-partners");
  assert.ok(CHECKS.length > 0);
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
    assert.equal(typeof row.redAfter, "string");
    assert.match(row.redAfter, /^3x \S+/);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.equal(typeof row.alreadyInRegistry, "boolean");
    assert.equal(typeof row.proof, "string");
  }
});

test("slice 22-partners: white-label doors are on the morning ping list", () => {
  for (const id of WHITE_LABEL_DOOR_IDS) {
    const row = CHECKS.find((c) => c.id === id);
    assert.ok(row, `missing CHECKS row for ${id}`);
    assert.equal(row.alreadyInRegistry, true, `${id} is not in PULSE_REGISTRY`);
    assert.equal(row.proof, "PASS");
  }
});

test("slice 22-partners: production-floor job is red when not watched", () => {
  const watched = MACHINE_CHECKS.some((row) => row.id === FLOOR_JOB_ID);
  const job = CHECKS.find((c) => c.id === FLOOR_JOB_ID);
  assert.ok(job);
  assert.equal(job.schedule, "monthly");
  assert.equal(job.redAfter, "3x monthly");
  assert.equal(job.alreadyInRegistry, watched);
  if (!watched) {
    assert.notEqual(job.proof, "PASS");
    assert.ok(gaps().some((g) => g.id === FLOOR_JOB_ID));
  }
});

test("slice 22-partners: floor last-run SQL is read-only", () => {
  assert.match(FLOOR_LAST_RUN_SQL.trim(), /^SELECT\b/i);
  assert.doesNotMatch(FLOOR_LAST_RUN_SQL, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|SET)\b/i);
});

test("slice 22-partners: evaluateChecks marks stale last run", async () => {
  const stale = new Date(Date.now() - RED_AFTER_MS - 60_000);
  const scope = async (fn) =>
    fn({
      query: async (sql) => {
        assert.equal(sql, FLOOR_LAST_RUN_SQL);
        return { rows: [{ last_run: stale.toISOString() }] };
      }
    });
  const rows = await evaluateChecks({ scope, now: new Date() });
  const job = rows.find((c) => c.id === FLOOR_JOB_ID);
  assert.ok(job);
  if (job.alreadyInRegistry) {
    assert.notEqual(job.proof, "PASS");
  }
});
