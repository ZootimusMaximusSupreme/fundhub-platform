import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { functions } from "../../workflows/index.mjs";
import { INNGEST_JOBS, NETLIFY_JOBS } from "../heartbeats.mjs";
import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import {
  CHECKS,
  SLICE_ID,
  U05_ID,
  gaps,
  isRed,
  ownedByNamedSlice,
  scheduleLabel
} from "./slice-25-rest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

function cronsOf(fn) {
  return ((fn.opts && fn.opts.triggers) || []).map((t) => t.cron).filter(Boolean);
}

test("slice 25-rest: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.equal(SLICE_ID, "25-rest");
  assert.ok(CHECKS.length > 0);
  const ids = CHECKS.map((row) => row.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a.localeCompare(b)));
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
    assert.equal(ownedByNamedSlice(row.id), false);
  }
});

test("slice 25-rest: leftover crons from index, plus u-05", () => {
  const expected = [];
  for (const fn of functions) {
    const id = fn.opts && fn.opts.id;
    if (!id || ownedByNamedSlice(id)) continue;
    const crons = cronsOf(fn);
    if (crons.length) expected.push(id);
    else if (id === U05_ID) expected.push(id);
  }
  if (!expected.includes(U05_ID)) expected.push(U05_ID);
  expected.sort((a, b) => a.localeCompare(b));
  assert.deepEqual(CHECKS.map((row) => row.id), expected);

  for (const id of [
    "blueprint-closer-ready-sweeper",
    "blueprint-finance-os-alerts",
    "blueprint-next-funding-sequence-sweeper",
    U05_ID
  ]) {
    assert.ok(CHECKS.some((row) => row.id === id), `missing ${id}`);
  }

  const ownedCron = functions
    .filter((fn) => cronsOf(fn).length && ownedByNamedSlice(fn.opts.id))
    .map((fn) => fn.opts.id);
  for (const id of ownedCron) {
    assert.equal(CHECKS.some((row) => row.id === id), false, `${id} belongs to another slice`);
  }
});

test("slice 25-rest: workflow files exist and schedules match the cron", () => {
  const heartbeat = new Map([...INNGEST_JOBS, ...NETLIFY_JOBS]);
  for (const row of CHECKS) {
    if (row.id === U05_ID) {
      assert.equal(row.schedule, "analysis.completed");
      assert.ok(fs.existsSync(path.join(ROOT, "src/workflows/u-05-data-health-monitor.mjs")));
      continue;
    }
    const file = path.join(ROOT, "src/workflows", `${row.id}.mjs`);
    assert.ok(fs.existsSync(file), `${row.id} workflow file missing`);
    const fn = functions.find((item) => item.opts && item.opts.id === row.id);
    assert.ok(fn, `${row.id} not registered in src/workflows/index.mjs`);
    const crons = cronsOf(fn);
    assert.equal(crons.length, 1, `${row.id} should have one cron`);
    assert.equal(row.schedule, scheduleLabel(crons[0]));
    const listed = heartbeat.get(row.id);
    assert.equal(row.alreadyInRegistry, listed === crons[0]);
    if (row.alreadyInRegistry) assert.match(row.proof, /^PASS/);
    else assert.match(row.proof, /Do not auto-fix/);
  }
});

test("slice 25-rest: u-05 is the registry gap; listed crons are not", () => {
  const keys = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
  const u05 = CHECKS.find((row) => row.id === U05_ID);
  assert.ok(u05);
  assert.equal(u05.alreadyInRegistry, keys.has(U05_ID));
  assert.match(u05.proof, /pulse registry/);

  const open = gaps();
  assert.deepEqual(open, CHECKS.filter((row) => !row.alreadyInRegistry));
  assert.deepEqual(open.map((row) => row.id), keys.has(U05_ID) ? [] : [U05_ID]);
});

test("slice 25-rest: red when missing, or silent for 3x the schedule", () => {
  const now = new Date("2026-10-07T18:00:00Z");
  const closer = CHECKS.find((row) => row.id === "blueprint-closer-ready-sweeper");
  const floor = CHECKS.find((row) => row.id === "partner-production-floor");
  const u05 = CHECKS.find((row) => row.id === U05_ID);
  assert.ok(closer && floor && u05);

  assert.equal(isRed({ ...closer, alreadyInRegistry: false }, { now }), true);
  assert.equal(isRed(u05, { now }), true);
  assert.equal(isRed(closer, { now }), false);

  const hour = 60 * 60 * 1000;
  assert.equal(
    isRed(closer, { lastHeartbeatAt: new Date(now.getTime() - hour), now }),
    false
  );
  assert.equal(
    isRed(closer, { lastHeartbeatAt: new Date(now.getTime() - 4 * hour), now }),
    true
  );

  const day = 24 * hour;
  assert.equal(
    isRed(floor, { lastHeartbeatAt: new Date(now.getTime() - 10 * day), now }),
    false
  );
  assert.equal(
    isRed(floor, { lastHeartbeatAt: new Date(now.getTime() - 100 * day), now }),
    true
  );
});
