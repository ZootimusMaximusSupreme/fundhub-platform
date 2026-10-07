import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { JOBS, STALE_MULTIPLE, cronIntervalMs } from "../heartbeats.mjs";
import { runDailyPulse } from "../daily-pulse.mjs";
import {
  NOT_CHECKED,
  loadSliceModules,
  runCoverageSlices,
  tally
} from "./run-slices.mjs";
import * as pulseSlice from "./slice-02-daily-pulse.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, "run-slices.mjs");
const NOW = new Date("2026-10-07T18:00:00Z");

function sliceFiles() {
  return fs.readdirSync(HERE)
    .filter((name) => /^slice-.+\.mjs$/.test(name) && !name.endsWith(".test.mjs"))
    .sort();
}

function fakeDb(matchers) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      const text = String(sql);
      calls.push(text);
      for (const [re, rows] of matchers) {
        if (re.test(text)) return { rows };
      }
      return { rows: [] };
    }
  };
}

test("runner source has one job_heartbeats read and does not text", () => {
  const src = fs.readFileSync(RUNNER, "utf8");
  assert.equal(src.split("FROM job_heartbeats").length - 1, 1);
  assert.doesNotMatch(src, /textChris|twilio|sendSms|sendWhatsApp/);
});

test("loads every slice and does not pass or fail without a database", async () => {
  const loaded = await loadSliceModules();
  assert.deepEqual(loaded.map((m) => m.file), sliceFiles());
  const rows = await runCoverageSlices({ modules: loaded, now: NOW });
  const expected = loaded.reduce((n, item) => n + item.CHECKS.length, 0);
  assert.equal(rows.length, expected);
  assert.ok(expected > 100, `expected a full catalog, got ${expected}`);
  const counts = tally(rows);
  assert.equal(counts.pass, 0);
  assert.equal(counts.red, 0);
  assert.equal(counts.notChecked, expected);
  assert.equal(counts.other, 0);

  const event = rows.find((row) => row.checkId === "dpc-02-call-outcome-enforcement");
  assert.ok(event);
  assert.equal(event.status, NOT_CHECKED);
  assert.match(event.detail, /booking\.created/);
  assert.match(event.detail, /not a cron/i);
  assert.match(event.detail, /not red/i);

  const funding = rows.find((row) => row.checkId === "f-01-funding-intake");
  assert.ok(funding);
  assert.equal(funding.status, NOT_CHECKED);
  assert.match(funding.detail, /not a cron/i);

  const door = rows.find((row) => row.checkId === "auth/login");
  assert.ok(door);
  assert.equal(door.status, NOT_CHECKED);
  assert.match(door.detail, /Slice note:/);
});

test("a cron is red only when its last success is older than 3 times the schedule", async () => {
  const job = JOBS.find((row) => row.job === "message-dispatch-sweeper");
  const limit = STALE_MULTIPLE * cronIntervalMs(job.cron);
  assert.ok(limit > 0);
  const modules = [{
    sliceId: "t",
    CHECKS: [
      { id: job.job, schedule: "5m", proof: "catalog proof, not a pass" },
      { id: "auth/login", schedule: "daily", proof: "PASS", alreadyInRegistry: true },
      {
        id: "dpc-02-call-outcome-enforcement",
        schedule: "booking.created",
        proof: "Event booking.created.",
        alreadyInRegistry: false
      }
    ],
    mod: {}
  }];

  const stale = new Date(NOW.getTime() - limit - 1000);
  const staleDb = fakeDb([
    [/job_heartbeats/i, [{ job: job.job, last_at: stale, last_outcome: "ok", last_error: null }]]
  ]);
  const staleRows = await runCoverageSlices({ db: staleDb, modules, now: NOW });
  assert.equal(staleDb.calls.filter((sql) => /job_heartbeats/i.test(sql)).length, 1);
  const staleJob = staleRows.find((row) => row.checkId === job.job);
  assert.equal(staleJob.status, "FAIL");
  assert.match(staleJob.detail, /3 times its schedule/);
  assert.match(staleJob.suggestedFix, /Chris fixes reds/);
  assert.equal(staleRows.find((row) => row.checkId === "auth/login").status, NOT_CHECKED);
  assert.equal(
    staleRows.find((row) => row.checkId === "dpc-02-call-outcome-enforcement").status,
    NOT_CHECKED
  );

  const exact = new Date(NOW.getTime() - limit);
  const exactDb = fakeDb([
    [/job_heartbeats/i, [{ job: job.job, last_at: exact, last_outcome: "ok", last_error: null }]]
  ]);
  const exactRows = await runCoverageSlices({ db: exactDb, modules, now: NOW });
  assert.equal(exactRows.find((row) => row.checkId === job.job).status, "PASS");

  const missingDb = fakeDb([[/job_heartbeats/i, []]]);
  const missingRows = await runCoverageSlices({ db: missingDb, modules, now: NOW });
  const missing = missingRows.find((row) => row.checkId === job.job);
  assert.equal(missing.status, NOT_CHECKED);
  assert.match(missing.detail, /No last-success time/);
  assert.doesNotMatch(missing.detail, /^FAIL/);
});

test("a fresh error is red, and a missing stamp is not a fake red", async () => {
  const job = "message-dispatch-sweeper";
  const modules = [{
    sliceId: "t",
    CHECKS: [{ id: job, schedule: "5m", proof: "gap note" }],
    mod: {}
  }];
  const recent = new Date(NOW.getTime() - 60 * 1000);
  const db = fakeDb([
    [/job_heartbeats/i, [{ job, last_at: recent, last_outcome: "error", last_error: "boom" }]]
  ]);
  const rows = await runCoverageSlices({ db, modules, now: NOW });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /ended in an error: boom/);
});

test("monthly payout uses the stamp query and 3 times a month", async () => {
  const modules = [{
    sliceId: "pay",
    CHECKS: [{ id: "affiliate-payout-run", schedule: "monthly", proof: "payout stamp" }],
    mod: {
      PAYOUT_ID: "affiliate-payout-run",
      AFFILIATE_PAYOUT_LAST_RUN_SQL: "SELECT max(created_at) AS last_run FROM affiliate_payouts"
    }
  }];
  const old = new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000);
  const oldDb = fakeDb([
    [/job_heartbeats/i, []],
    [/affiliate_payouts/i, [{ last_run: old }]]
  ]);
  const oldRows = await runCoverageSlices({ db: oldDb, modules, now: NOW });
  assert.equal(oldDb.calls.filter((sql) => /job_heartbeats/i.test(sql)).length, 1);
  assert.equal(oldDb.calls.filter((sql) => /affiliate_payouts/i.test(sql)).length, 1);
  assert.equal(oldRows[0].status, "FAIL");

  const recent = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
  const recentDb = fakeDb([
    [/job_heartbeats/i, []],
    [/affiliate_payouts/i, [{ last_run: recent }]]
  ]);
  const recentRows = await runCoverageSlices({ db: recentDb, modules, now: NOW });
  assert.equal(recentRows[0].status, "PASS");

  const noneDb = fakeDb([
    [/job_heartbeats/i, []],
    [/affiliate_payouts/i, [{ last_run: null }]]
  ]);
  const noneRows = await runCoverageSlices({ db: noneDb, modules, now: NOW });
  assert.equal(noneRows[0].status, NOT_CHECKED);
});

test("AG-07 is red after 3 missed mornings and not red when the row is missing", async () => {
  const modules = [{
    sliceId: pulseSlice.SLICE_ID,
    CHECKS: pulseSlice.CHECKS.filter((row) => row.id === "ag-07-cron-daily-pulse"),
    mod: pulseSlice
  }];
  const late = new Date("2026-10-03T18:00:00Z");
  const lateDb = fakeDb([
    [/agent_runs/i, [{ created_at: late, outcome: "pass", mode: "live", trigger_event: "cron.daily-pulse" }]]
  ]);
  const lateRows = await runCoverageSlices({ db: lateDb, modules, now: NOW });
  assert.equal(lateRows[0].status, "FAIL");
  assert.match(lateRows[0].detail, /missed \d+ mornings/);

  const recent = new Date("2026-10-06T18:00:00Z");
  const recentDb = fakeDb([
    [/agent_runs/i, [{ created_at: recent, outcome: "fail", mode: "live", trigger_event: "cron.daily-pulse" }]]
  ]);
  const recentRows = await runCoverageSlices({ db: recentDb, modules, now: NOW });
  assert.equal(recentRows[0].status, "PASS");

  const noneDb = fakeDb([[/agent_runs/i, []]]);
  const noneRows = await runCoverageSlices({ db: noneDb, modules, now: NOW });
  assert.equal(noneRows[0].status, NOT_CHECKED);
});

test("a stale slice cron shows up as a FAIL finding and a dry run sends nothing", async () => {
  const job = JOBS.find((row) => row.job === "ad-video-sweeper");
  const limit = STALE_MULTIPLE * cronIntervalMs(job.cron);
  const stale = new Date(NOW.getTime() - limit - 1000);
  const sends = [];
  const db = {
    async query(sql) {
      const text = String(sql);
      if (/job_heartbeats/i.test(text)) {
        return { rows: [{ job: job.job, last_at: stale, last_outcome: "ok", last_error: null }] };
      }
      return { rows: [] };
    }
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-cov-"));
  const fetchImpl = async () => ({ status: 200, text: async () => "Sign in password Generate Apps Apply door Apply shows the client email, not a Fundhub address" });
  const result = await runDailyPulse({
    dryRun: true,
    now: NOW,
    db,
    fetchImpl,
    boardDir: tmp,
    env: { PULSE_SMS_TO: "+15555550100" },
    gateRelayDirs: null,
    recordRun: false,
    sendSms: async (msg) => {
      sends.push(msg);
      return { status: "sent" };
    },
    sendWhatsApp: async (msg) => {
      sends.push(msg);
      return { status: "sent" };
    }
  });
  assert.equal(result.autoFix, false);
  assert.equal(sends.length, 0);
  assert.equal(result.sms.reason, "dry_run");
  assert.ok(result.findings.some((line) => line.includes(job.job) && /3 times its schedule/.test(line)));
  fs.rmSync(tmp, { recursive: true, force: true });
});
