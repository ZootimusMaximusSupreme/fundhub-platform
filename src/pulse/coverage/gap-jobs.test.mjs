import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { JOBS, STALE_MULTIPLE, cronIntervalMs } from "../heartbeats.mjs";
import { DOC_CHECK_HANDLER, DOC_CHECK_RETRY_CRON, docCheckStuckBefore, gapChecks } from "./gap-jobs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

const SHAPE = ["id", "status", "detail", "suggestedFix"];

function assertShape(row) {
  assert.deepEqual(Object.keys(row), SHAPE);
  assert.equal(typeof row.id, "string");
  assert.ok(row.id.length > 0);
  assert.ok(row.status === "PASS" || row.status === "FAIL" || row.status === "skip");
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  assert.ok(row.suggestedFix == null || typeof row.suggestedFix === "string");
}

function fakeDb({ eventsRow = { n: 0, exhausted: 0, pending: 0, latest_handler: null, latest_error: null }, heartbeatRows = [], firstEver = null, failSql = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ text, params });
      assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
      assert.match(text, /^\s*SELECT/i);
      if (failSql && text.includes(failSql)) throw new Error("relation missing");
      if (text.includes("failed_events")) {
        assert.doesNotMatch(text, /payload/);
        return { rows: [eventsRow] };
      }
      if (text.includes("GROUP BY job")) return { rows: heartbeatRows };
      if (text.includes("first_ever")) return { rows: [{ first_ever: firstEver }] };
      throw new Error(`unexpected sql: ${text.slice(0, 80)}`);
    }
  };
}

test("no database skips the dead-letter read and every known job", async () => {
  const rows = await gapChecks({ jobs: JOBS });
  assert.equal(rows.length, 1 + JOBS.length);
  for (const row of rows) {
    assertShape(row);
    assert.equal(row.status, "skip");
    assert.equal(row.suggestedFix, null);
  }
  assert.equal(rows[0].id, "failed-events");
  assert.match(rows[0].detail, /no database/i);
});

test("a stuck dead-letter row fails, and the read does not retry it", async () => {
  const now = new Date("2026-10-08T15:00:00.000Z");
  const db = fakeDb({
    eventsRow: {
      n: 2,
      exhausted: 1,
      pending: 1,
      latest_handler: "money-chain",
      latest_error: "provider down"
    }
  });
  const rows = await gapChecks({ db, now, jobs: [] });
  const hit = rows.find((row) => row.id === "failed-events");
  assertShape(hit);
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /2 stuck dead-letter rows/);
  assert.match(hit.detail, /1 exhausted, 1 pending overdue/);
  assert.match(hit.detail, /money-chain/);
  assert.match(hit.detail, /provider down/);
  assert.match(hit.suggestedFix, /Do not retry/);
  assert.doesNotMatch(hit.suggestedFix, /watchdog|new cron|drain/i);

  const call = db.calls.find((item) => item.text.includes("failed_events"));
  assert.equal(call.params[0], now);
  assert.equal(call.params[2], DOC_CHECK_HANDLER);
  assert.equal(call.params[1].toISOString(), docCheckStuckBefore(now).toISOString());
  const grace = STALE_MULTIPLE * cronIntervalMs(DOC_CHECK_RETRY_CRON);
  assert.equal(now.getTime() - call.params[1].getTime(), grace);
  assert.equal(grace, 3 * 20 * 60 * 1000);
});

test("no stuck dead-letter rows passes", async () => {
  const db = fakeDb();
  const rows = await gapChecks({ db, now: new Date("2026-10-08T15:00:00.000Z"), jobs: [] });
  const hit = rows.find((row) => row.id === "failed-events");
  assert.equal(hit.status, "PASS");
  assert.equal(hit.suggestedFix, null);
  assert.match(hit.detail, /No stuck dead-letter rows/);
});

test("a dead-letter read that throws is a skip, and job checks still run", async () => {
  const now = new Date("2026-10-08T13:00:00.000Z");
  const hour = cronIntervalMs("0 * * * *");
  const fresh = new Date(now.getTime() - hour);
  const db = fakeDb({
    failSql: "failed_events",
    heartbeatRows: [
      { job: "fresh-one", last_at: fresh.toISOString(), last_outcome: "ok", last_error: null, first_ever: fresh.toISOString() }
    ]
  });
  const rows = await gapChecks({
    db,
    now,
    jobs: [{ job: "fresh-one", cron: "0 * * * *", runner: "inngest" }]
  });
  const dead = rows.find((row) => row.id === "failed-events");
  const job = rows.find((row) => row.id === "job:fresh-one");
  assert.equal(dead.status, "skip");
  assert.match(dead.detail, /relation missing/);
  assert.equal(job.status, "PASS");
});

test("a known job with no recent run fails when heartbeats says it is late", async () => {
  const now = new Date("2026-10-08T13:00:00.000Z");
  const hour = cronIntervalMs("0 * * * *");
  const late = new Date(now.getTime() - 4 * hour);
  const fresh = new Date(now.getTime() - hour);
  const db = fakeDb({
    heartbeatRows: [
      { job: "late-one", last_at: late.toISOString(), last_outcome: "ok", last_error: null, first_ever: late.toISOString() },
      { job: "fresh-one", last_at: fresh.toISOString(), last_outcome: "ok", last_error: null, first_ever: late.toISOString() }
    ]
  });
  const rows = await gapChecks({
    db,
    now,
    jobs: [
      { job: "late-one", cron: "0 * * * *", runner: "inngest" },
      { job: "fresh-one", cron: "0 * * * *", runner: "inngest" }
    ]
  });
  const lateRow = rows.find((row) => row.id === "job:late-one");
  const freshRow = rows.find((row) => row.id === "job:fresh-one");
  assert.equal(lateRow.status, "FAIL");
  assert.match(lateRow.suggestedFix, /Do not re-run/);
  assert.equal(freshRow.status, "PASS");
  assert.equal(rows.find((row) => row.id === "failed-events").status, "PASS");
  for (const row of rows) assertShape(row);
});

test("the doc-check retry cron in this file matches the sweeper", () => {
  const sweeper = fs.readFileSync(path.join(ROOT, "src/workflows/doc-check-retry-sweeper.mjs"), "utf8");
  assert.match(sweeper, new RegExp(`export const SWEEP_CRON = "${DOC_CHECK_RETRY_CRON.replace(/\*/g, "\\*")}"`));
  assert.equal(DOC_CHECK_RETRY_CRON, "*/20 * * * *");
  assert.equal(cronIntervalMs(DOC_CHECK_RETRY_CRON), 20 * 60 * 1000);
});

test("the jobs note asks for no new heartbeat row", () => {
  const md = fs.readFileSync(path.join(ROOT, "ops/workflows/heartbeat-gaps-2026-10-08/jobs.md"), "utf8");
  const add = md.split("## Add these rows")[1].split("##")[0];
  assert.match(add, /None/);
  assert.doesNotMatch(add, /clarity-insights-sweeper/);
  assert.doesNotMatch(add, /ad-video-sweeper/);
  assert.match(md, /clarity-insights-sweeper/);
  assert.match(md, /Do not add/);
});

test("this file does not write heartbeats or drain the queue", () => {
  const src = fs.readFileSync(path.join(HERE, "gap-jobs.mjs"), "utf8");
  assert.doesNotMatch(src, /recordHeartbeat|noteScheduledRun|retryDue|INSERT|UPDATE|DELETE/);
});
