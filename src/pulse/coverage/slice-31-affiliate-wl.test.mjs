import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { INNGEST_JOBS, STALE_MULTIPLE, cronIntervalMs } from "../heartbeats.mjs";
import { SWEEP_CRON as AF01_CRON } from "../../workflows/af-01-affiliate-drip.mjs";
import { PAYOUT_CRON } from "../../workflows/affiliate-payout-run.mjs";
import { REVIEW_CRON as PARTNER_FLOOR_CRON } from "../../workflows/partner-production-floor.mjs";
import {
  AFFILIATE_JOURNEY_DOORS,
  AFFILIATE_PAYOUT_LAST_RUN_SQL,
  AF02_ID,
  CHECKS,
  INNGEST_CRON_IDS,
  MONTHLY_RED_AFTER_MS,
  PARTNER_FLOOR_LAST_RUN_SQL,
  PARTNER_WL_JOURNEY_DOORS,
  PAYOUT_ID,
  SLICE_ID,
  evaluateChecks,
  gaps,
  isRed
} from "./slice-31-affiliate-wl.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

const WORKFLOW_FILES = {
  "af-01-affiliate-drip": "src/workflows/af-01-affiliate-drip.mjs",
  "af-02-referral-ownership-capture": "src/workflows/af-02-referral-ownership-capture.mjs",
  "affiliate-payout-run": "src/workflows/affiliate-payout-run.mjs",
  "partner-production-floor": "src/workflows/partner-production-floor.mjs"
};

test("slice 31-affiliate-wl: slice id and E2E inventory", () => {
  assert.equal(SLICE_ID, "31-affiliate-wl");
  assert.ok(CHECKS.length >= AFFILIATE_JOURNEY_DOORS.length + PARTNER_WL_JOURNEY_DOORS.length);
  assert.ok(CHECKS.some((r) => r.id === AF02_ID));
  for (const id of INNGEST_CRON_IDS) {
    assert.ok(CHECKS.some((r) => r.id === id), `missing cron row ${id}`);
  }
});

test("slice 31-affiliate-wl: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
    assert.equal(typeof row.redAfter, "string");
    assert.match(row.redAfter, /^3x \S+/);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.equal(typeof row.alreadyInRegistry, "boolean");
    assert.equal(typeof row.proof, "string");
    assert.ok(row.proof.length > 0);
  }
});

test("slice 31-affiliate-wl: workflow files exist and crons match modules", () => {
  assert.equal(AF01_CRON, "*/15 * * * *");
  assert.equal(PAYOUT_CRON, "0 3 1 * *");
  assert.equal(PARTNER_FLOOR_CRON, "0 14 1 * *");
  for (const [id, file] of Object.entries(WORKFLOW_FILES)) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${id} workflow file missing`);
  }
  const heartbeatIds = new Set(INNGEST_JOBS.map(([j]) => j));
  for (const id of INNGEST_CRON_IDS) {
    assert.ok(heartbeatIds.has(id), `${id} must be on INNGEST_JOBS`);
  }
});

test("slice 31-affiliate-wl: affiliate and white-label doors are on the ping list", () => {
  for (const id of AFFILIATE_JOURNEY_DOORS) {
    const row = CHECKS.find((c) => c.id === id);
    assert.ok(row, `missing door ${id}`);
    assert.equal(row.alreadyInRegistry, true, `${id} not in PULSE_REGISTRY`);
    assert.equal(row.proof, "PASS");
  }
  for (const id of PARTNER_WL_JOURNEY_DOORS) {
    const row = CHECKS.find((c) => c.id === id);
    assert.ok(row, `missing door ${id}`);
    assert.equal(row.alreadyInRegistry, true, `${id} not in PULSE_REGISTRY`);
    assert.equal(row.proof, "PASS");
  }
  const capture = CHECKS.find((c) => c.id === AF02_ID);
  assert.ok(capture);
  assert.equal(capture.alreadyInRegistry, true);
  assert.match(capture.proof, /^PASS/);
});

test("slice 31-affiliate-wl: inngest crons are on the heartbeat list", () => {
  for (const id of INNGEST_CRON_IDS) {
    const row = CHECKS.find((c) => c.id === id);
    assert.ok(row);
    assert.equal(row.alreadyInRegistry, true);
    assert.match(row.proof, /^PASS/);
  }
});

test("slice 31-affiliate-wl: payout SQL stamps are read-only", () => {
  for (const sql of [AFFILIATE_PAYOUT_LAST_RUN_SQL, PARTNER_FLOOR_LAST_RUN_SQL]) {
    assert.match(sql.trim(), /^SELECT\b/i);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|SET)\b/i);
  }
});

test("slice 31-affiliate-wl: gaps lists rows not on the pulse list", () => {
  const missing = gaps();
  const expected = CHECKS.filter((row) => !row.alreadyInRegistry);
  assert.deepEqual(missing, expected);
});

test("slice 31-affiliate-wl: isRed — missing pulse, stale heartbeat, stale monthly stamp", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const af01 = CHECKS.find((r) => r.id === "af-01-affiliate-drip");
  const payout = CHECKS.find((r) => r.id === PAYOUT_ID);
  assert.ok(af01 && payout);

  assert.equal(isRed({ ...af01, alreadyInRegistry: false }, { now }), true);

  const interval = cronIntervalMs(AF01_CRON);
  assert.ok(interval);
  const freshHb = new Date(now.getTime() - interval);
  assert.equal(isRed(af01, { lastHeartbeatAt: freshHb, now }), false);
  const staleHb = new Date(now.getTime() - STALE_MULTIPLE * interval - 1);
  assert.equal(isRed(af01, { lastHeartbeatAt: staleHb, now }), true);

  const recentPayout = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  assert.equal(isRed(payout, { lastRunAt: recentPayout, now }), false);
  const stalePayout = new Date(now.getTime() - MONTHLY_RED_AFTER_MS - 1);
  assert.equal(isRed(payout, { lastRunAt: stalePayout, now }), true);
});

test("slice 31-affiliate-wl: evaluateChecks marks stale affiliate payout stamp", async () => {
  const stale = new Date(Date.now() - MONTHLY_RED_AFTER_MS - 60_000);
  const scope = async (fn) =>
    fn({
      query: async (sql) => {
        if (sql === AFFILIATE_PAYOUT_LAST_RUN_SQL) {
          return { rows: [{ last_run: stale.toISOString() }] };
        }
        if (sql === PARTNER_FLOOR_LAST_RUN_SQL) {
          return { rows: [{ last_run: new Date().toISOString() }] };
        }
        throw new Error(`unexpected sql: ${sql}`);
      }
    });
  const rows = await evaluateChecks({ scope, now: new Date() });
  const payout = rows.find((c) => c.id === PAYOUT_ID);
  assert.ok(payout);
  assert.notEqual(payout.proof, "PASS");
});
