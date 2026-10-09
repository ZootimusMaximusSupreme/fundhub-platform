import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { JOBS, STALE_MULTIPLE, cronIntervalMs } from "../heartbeats.mjs";
import {
  DOC_CHECK_HANDLER,
  DOC_CHECK_RETRY_CRON,
  STUCK_SQL,
  UNLISTED_SQL,
  UNLISTED_WINDOW_MS,
  TEST_ADDRESS_RE,
  docCheckStuckBefore,
  scrub,
  gapChecks
} from "./gap-jobs.mjs";
import { db as pgDb, close as closePg } from "../../db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const NOW = new Date("2026-10-08T15:00:00.000Z");

const SHAPE = ["id", "status", "detail", "suggestedFix"];

function assertShape(row) {
  assert.deepEqual(Object.keys(row), SHAPE);
  assert.equal(typeof row.id, "string");
  assert.ok(row.id.length > 0);
  assert.ok(row.status === "PASS" || row.status === "FAIL" || row.status === "skip");
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  if (row.status === "FAIL") assert.equal(typeof row.suggestedFix, "string");
  else assert.equal(row.suggestedFix, null);
}

const CLEAN = { n: 0, exhausted: 0, pending: 0, test_rows: 0, latest_handler: null, latest_error: null };

/* Answers each read by its exact SQL text, and fails the test on any other query
   or on any query that is not a select. */
function fakeDb({ stuck = CLEAN, unlisted = { recent_jobs: 5, unlisted: null }, stuckErr = null, unlistedErr = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ text, params });
      assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
      assert.match(text, /^\s*(SELECT|WITH)/i);
      if (text === STUCK_SQL) {
        assert.doesNotMatch(text, /payload\s*(,|\bFROM)/);
        if (stuckErr) throw stuckErr;
        return { rows: [stuck] };
      }
      if (text === UNLISTED_SQL) {
        if (unlistedErr) throw unlistedErr;
        return { rows: [unlisted] };
      }
      throw new Error(`unexpected sql: ${text.slice(0, 80)}`);
    }
  };
}

const byId = (rows, id) => rows.find((row) => row.id === id);

test("no database skips both reads", async () => {
  const rows = await gapChecks({ jobs: JOBS });
  assert.deepEqual(rows.map((row) => row.id), ["failed-events", "job-heartbeats-unlisted"]);
  for (const row of rows) {
    assertShape(row);
    assert.equal(row.status, "skip");
    assert.equal(row.suggestedFix, null);
  }
  assert.match(rows[0].detail, /no database/i);
});

test("a stuck dead-letter row fails, and the read does not retry it", async () => {
  const db = fakeDb({
    stuck: { n: 2, exhausted: 1, pending: 1, test_rows: 0, latest_handler: "money-chain", latest_error: "provider down" }
  });
  const rows = await gapChecks({ db, now: NOW, jobs: [] });
  const hit = byId(rows, "failed-events");
  assertShape(hit);
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /2 stuck dead-letter rows/);
  assert.match(hit.detail, /1 exhausted, 1 pending overdue/);
  assert.match(hit.detail, /money-chain/);
  assert.match(hit.detail, /provider down/);
  assert.match(hit.suggestedFix, /Do not retry/);
  assert.doesNotMatch(hit.suggestedFix, /watchdog|new cron|drain/i);

  const call = db.calls.find((item) => item.text === STUCK_SQL);
  assert.equal(call.params[0], NOW);
  assert.equal(call.params[2], DOC_CHECK_HANDLER);
  assert.equal(call.params[3], TEST_ADDRESS_RE);
  assert.equal(call.params[1].toISOString(), docCheckStuckBefore(NOW).toISOString());
  const grace = STALE_MULTIPLE * cronIntervalMs(DOC_CHECK_RETRY_CRON);
  assert.equal(NOW.getTime() - call.params[1].getTime(), grace);
  assert.equal(grace, 3 * 20 * 60 * 1000);
});

test("an error text that quotes a person never puts their email or number in the morning text", async () => {
  assert.equal(scrub("Key (email)=(pat@example.com) already exists for +1 (602) 555-0142"), "Key (email)=([email]) already exists for [number]");
  assert.equal(scrub("null value in column \"product_id\" violates not-null constraint"), "null value in column \"product_id\" violates not-null constraint");
  assert.equal(scrub(null), "");
  const db = fakeDb({
    stuck: { n: 1, exhausted: 1, pending: 0, test_rows: 0, latest_handler: "onSomething", latest_error: "bad row for pat.smith@gmail.com phone 602-555-0142" }
  });
  const hit = byId(await gapChecks({ db, now: NOW, jobs: [] }), "failed-events");
  assert.equal(hit.status, "FAIL");
  assert.doesNotMatch(hit.detail, /pat\.smith|gmail|555-0142/);
  assert.match(hit.detail, /\[email\]/);
  assert.match(hit.detail, /\[number\]/);
});

test("no stuck dead-letter rows passes", async () => {
  const rows = await gapChecks({ db: fakeDb(), now: NOW, jobs: [] });
  const hit = byId(rows, "failed-events");
  assertShape(hit);
  assert.equal(hit.status, "PASS");
  assert.equal(hit.suggestedFix, null);
  assert.match(hit.detail, /No stuck dead-letter rows/);
  assert.doesNotMatch(hit.detail, /test addresses/);
});

test("old test-walk rows are counted and left alone, a real row beside them still fails", async () => {
  const quiet = byId(await gapChecks({ db: fakeDb({ stuck: { ...CLEAN, test_rows: 24 } }), now: NOW, jobs: [] }), "failed-events");
  assert.equal(quiet.status, "PASS");
  assert.match(quiet.detail, /24 old dead-letter rows are on test addresses/);

  const one = byId(await gapChecks({ db: fakeDb({ stuck: { ...CLEAN, test_rows: 1 } }), now: NOW, jobs: [] }), "failed-events");
  assert.match(one.detail, /1 old dead-letter row is on test addresses/);

  const mixed = byId(await gapChecks({
    db: fakeDb({ stuck: { n: 1, exhausted: 0, pending: 1, test_rows: 24, latest_handler: "onDepositPaidMoney", latest_error: "real" } }),
    now: NOW,
    jobs: []
  }), "failed-events");
  assert.equal(mixed.status, "FAIL");
  assert.match(mixed.detail, /1 stuck dead-letter row \(/);
});

test("the test-address pattern matches only names that can never receive mail", () => {
  const re = new RegExp(TEST_ADDRESS_RE);
  for (const yes of [
    "audit-blk6-1787272496358@example.test",
    "live-probe-p2@example.com",
    "a@example.net",
    "b@example.org",
    "c@x.example.org",
    "d@anything.invalid",
    "e@box.localhost",
    "f@team.example"
  ]) assert.equal(re.test(yes), true, yes);
  for (const no of [
    "stanbridgejchris+sim-08@gmail.com",
    "client@notexample.com",
    "client@example.com.au",
    "client@fundhub.ai",
    "client@testing.com",
    ""
  ]) assert.equal(re.test(no), false, no);
});

test("a dead-letter read that throws is a skip, a missing table or column is a fail, and the other read still runs", async () => {
  const blip = await gapChecks({ db: fakeDb({ stuckErr: new Error("connection reset postgres://u:p@h/d") }), now: NOW, jobs: [] });
  const dead = byId(blip, "failed-events");
  assertShape(dead);
  assert.equal(dead.status, "skip");
  assert.match(dead.detail, /connection reset/);
  assert.doesNotMatch(dead.detail, /u:p@h/);
  assert.equal(byId(blip, "job-heartbeats-unlisted").status, "PASS");

  for (const code of ["42P01", "42703"]) {
    const drift = Object.assign(new Error("relation failed_events does not exist"), { code });
    const rows = await gapChecks({ db: fakeDb({ stuckErr: drift }), now: NOW, jobs: [] });
    const row = byId(rows, "failed-events");
    assertShape(row);
    assert.equal(row.status, "FAIL");
    assert.match(row.detail, /cannot be read/);
  }
});

test("a job that reports a run but is not on the heartbeat list fails and names it", async () => {
  const db = fakeDb({ unlisted: { recent_jobs: 41, unlisted: ["brand-new-cron", "other-new-cron"] } });
  const rows = await gapChecks({ db, now: NOW });
  const hit = byId(rows, "job-heartbeats-unlisted");
  assertShape(hit);
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /2 scheduled jobs report a run but are not on the heartbeat list: brand-new-cron, other-new-cron/);
  assert.match(hit.suggestedFix, /INNGEST_JOBS or NETLIFY_JOBS/);
  assert.match(hit.suggestedFix, /Do not add a second watcher/);

  const one = byId(await gapChecks({ db: fakeDb({ unlisted: { recent_jobs: 3, unlisted: ["solo"] } }), now: NOW, jobs: [] }), "job-heartbeats-unlisted");
  assert.match(one.detail, /1 scheduled job reports a run but is not on the heartbeat list: solo/);

  // The read is handed the three-day window and every name on the real list.
  const call = db.calls.find((item) => item.text === UNLISTED_SQL);
  assert.equal(call.params[0].toISOString(), new Date(NOW.getTime() - UNLISTED_WINDOW_MS).toISOString());
  assert.equal(UNLISTED_WINDOW_MS, 3 * 24 * 60 * 60 * 1000);
  assert.deepEqual(call.params[1], JOBS.map((j) => j.job));
  assert.ok(call.params[1].includes("daily-pulse"));
  assert.ok(call.params[1].includes("ad-video-sweeper"));
});

test("every job that reported is on the list passes; nothing reported skips; a read error never passes", async () => {
  const ok = byId(await gapChecks({ db: fakeDb({ unlisted: { recent_jobs: 40, unlisted: null } }), now: NOW }), "job-heartbeats-unlisted");
  assertShape(ok);
  assert.equal(ok.status, "PASS");
  assert.match(ok.detail, /all 40 jobs/);

  const quiet = byId(await gapChecks({ db: fakeDb({ unlisted: { recent_jobs: 0, unlisted: null } }), now: NOW }), "job-heartbeats-unlisted");
  assertShape(quiet);
  assert.equal(quiet.status, "skip");
  assert.match(quiet.detail, /nothing to compare/);

  const blip = byId(await gapChecks({ db: fakeDb({ unlistedErr: new Error("timeout") }), now: NOW }), "job-heartbeats-unlisted");
  assert.equal(blip.status, "skip");
  assert.match(blip.detail, /timeout/);

  const drift = byId(await gapChecks({
    db: fakeDb({ unlistedErr: Object.assign(new Error("relation job_heartbeats does not exist"), { code: "42P01" }) }),
    now: NOW
  }), "job-heartbeats-unlisted");
  assert.equal(drift.status, "FAIL");
});

test("late jobs are not repeated here: no job: rows, because the daily pulse already runs that check", async () => {
  const rows = await gapChecks({ db: fakeDb(), now: NOW });
  assert.equal(rows.some((row) => row.id.startsWith("job:")), false);
  const pulse = fs.readFileSync(path.join(ROOT, "src/pulse/daily-pulse.mjs"), "utf8");
  assert.match(pulse, /checkJobHeartbeats\(\{ db, now \}\)/);
  const src = fs.readFileSync(path.join(HERE, "gap-jobs.mjs"), "utf8");
  assert.doesNotMatch(src, /checkJobHeartbeats/);
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

test("this file does not write heartbeats, drain the queue, or control a transaction", () => {
  const src = fs.readFileSync(path.join(HERE, "gap-jobs.mjs"), "utf8");
  assert.doesNotMatch(src, /recordHeartbeat|noteScheduledRun|retryDue|INSERT|UPDATE|DELETE/);
  assert.doesNotMatch(src, /BEGIN|COMMIT|ROLLBACK|node:fs/);
  for (const sql of [STUCK_SQL, UNLISTED_SQL]) {
    assert.match(sql, /^WITH /);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
  }
});

/* ------------------------------------------------------------------------
   The SQL, run for real. failed_events and job_heartbeats are replaced for one
   query by fixture rows (a CTE with the table's name), so STUCK_SQL and
   UNLISTED_SQL run on the Postgres engine over rows we choose. SELECT only,
   nothing is stored. Skipped without DATABASE_URL, like every *.pg.test.mjs.
   The fake db above only checks how the answer is worded. These are the tests
   that fail if the status filter, the late rule, the doc-check grace, the
   test-address rule, or the job list rule is changed.
   ------------------------------------------------------------------------ */
const HAVE_DB = !!process.env.DATABASE_URL;
const COLS = {
  failed_events: [
    ["handler_name", "text"],
    ["status", "text"],
    ["next_attempt_at", "timestamptz"],
    ["last_seen_at", "timestamptz"],
    ["error_message", "text"],
    ["payload", "jsonb"]
  ],
  job_heartbeats: [["job", "text"], ["finished_at", "timestamptz"]]
};

/* STUCK_SQL starts with WITH, so the fixture rows are put in front of its own CTE. */
function fixtureDb(rows = {}) {
  const ctes = Object.entries(COLS).map(([name, cols]) => {
    const json = JSON.stringify(rows[name] || []).replace(/'/g, "''");
    return `${name} AS (SELECT * FROM jsonb_to_recordset('${json}'::jsonb) AS x(${cols.map(([c, t]) => `"${c}" ${t}`).join(", ")}))`;
  });
  return {
    async query(sql, params) {
      const text = String(sql).trim();
      const full = /^WITH\s/i.test(text)
        ? text.replace(/^WITH\s+/i, `WITH ${ctes.join(", ")}, `)
        : `WITH ${ctes.join(", ")} ${text}`;
      return pgDb.query(full, params);
    }
  };
}

describe("gap-jobs SQL on the Postgres engine, over fixture rows", { skip: HAVE_DB ? false : "no DATABASE_URL" }, () => {
  after(async () => { await closePg(); });
  const ago = (min) => new Date(NOW.getTime() - min * 60e3).toISOString();
  const ahead = (min) => ago(-min);
  const row = (o = {}) => ({
    handler_name: "onSomething",
    status: "pending",
    next_attempt_at: ago(10),
    last_seen_at: ago(60),
    error_message: "boom",
    payload: { email: "pat.smith@gmail.com" },
    ...o
  });

  async function stuck(failed_events) {
    const out = await gapChecks({ db: fixtureDb({ failed_events }), now: NOW, jobs: [] });
    return byId(out, "failed-events");
  }
  async function unlisted(job_heartbeats, jobs) {
    const out = await gapChecks({ db: fixtureDb({ job_heartbeats }), now: NOW, jobs });
    return byId(out, "job-heartbeats-unlisted");
  }

  test("an exhausted row fails; a pending row that is late, or has no retry time, fails", async () => {
    const exhausted = await stuck([row({ status: "exhausted", next_attempt_at: ahead(600) })]);
    assert.equal(exhausted.status, "FAIL");
    assert.match(exhausted.detail, /1 stuck dead-letter row \(1 exhausted, 0 pending overdue\)/);

    const late = await stuck([row()]);
    assert.equal(late.status, "FAIL");
    assert.match(late.detail, /1 stuck dead-letter row \(0 exhausted, 1 pending overdue\)/);

    const noTime = await stuck([row({ next_attempt_at: null })]);
    assert.equal(noTime.status, "FAIL");
    assert.match(noTime.detail, /0 exhausted, 1 pending overdue/);

    const both = await stuck([row({ status: "exhausted" }), row(), row({ handler_name: "other" })]);
    assert.match(both.detail, /3 stuck dead-letter rows \(1 exhausted, 2 pending overdue\)/);
  });

  test("a retry still in the future, a resolved row, an ignored row, and no rows at all pass", async () => {
    for (const rows of [
      [row({ next_attempt_at: ahead(5) })],
      [row({ status: "resolved" })],
      [row({ status: "ignored" })],
      []
    ]) {
      const hit = await stuck(rows);
      assert.equal(hit.status, "PASS");
      assert.match(hit.detail, /No stuck dead-letter rows/);
    }
  });

  test("a doc-check pending row is stuck only after 3 times the 20 minute sweeper; any other handler as soon as it is late", async () => {
    // The grace is 60 minutes. 59 minutes late is inside it, 61 is outside.
    assert.equal((await stuck([row({ handler_name: DOC_CHECK_HANDLER, next_attempt_at: ago(30) })])).status, "PASS");
    assert.equal((await stuck([row({ handler_name: DOC_CHECK_HANDLER, next_attempt_at: ago(59) })])).status, "PASS");
    const outside = await stuck([row({ handler_name: DOC_CHECK_HANDLER, next_attempt_at: ago(61) })]);
    assert.equal(outside.status, "FAIL");
    assert.match(outside.detail, /0 exhausted, 1 pending overdue/);
    // No retry time on a doc-check row is also stuck.
    assert.equal((await stuck([row({ handler_name: DOC_CHECK_HANDLER, next_attempt_at: null })])).status, "FAIL");
    // Another handler at 30 minutes late has no sweeper clock, so it is stuck now.
    assert.equal((await stuck([row({ handler_name: "onDepositPaidMoney", next_attempt_at: ago(30) })])).status, "FAIL");
    // Giving up is never given grace.
    assert.equal((await stuck([row({ handler_name: DOC_CHECK_HANDLER, status: "exhausted", next_attempt_at: ahead(30) })])).status, "FAIL");
  });

  test("rows on names that can never get mail are counted and left alone; a real row beside them still fails", async () => {
    const testRows = [
      row({ payload: { email: "audit-blk6-1787272496358@example.test" } }),
      row({ payload: { email: "Live-Probe@EXAMPLE.COM" }, status: "exhausted" }),
      row({ payload: { email: "x@box.localhost" } })
    ];
    const quiet = await stuck(testRows);
    assert.equal(quiet.status, "PASS");
    assert.match(quiet.detail, /3 old dead-letter rows are on test addresses/);

    const mixed = await stuck([...testRows, row({ handler_name: "onDepositPaidMoney" })]);
    assert.equal(mixed.status, "FAIL");
    assert.match(mixed.detail, /1 stuck dead-letter row \(0 exhausted, 1 pending overdue\)/);

    // Look-alikes and rows with no email are real customers' rows.
    for (const payload of [
      { email: "client@notexample.com" },
      { email: "client@example.com.au" },
      { email: "stanbridgejchris+sim-08@gmail.com" },
      {},
      { phone: "+16025550142" },
      null
    ]) {
      const real = await stuck([row({ payload })]);
      assert.equal(real.status, "FAIL", JSON.stringify(payload));
      assert.match(real.detail, /1 stuck dead-letter row \(/);
    }
  });

  test("the latest handler and error are the newest real row, never a test row, and an email in the error is hidden", async () => {
    const hit = await stuck([
      row({ handler_name: "oldHandler", last_seen_at: ago(500), error_message: "old problem" }),
      row({ handler_name: "newHandler", last_seen_at: ago(5), error_message: "bad row for pat.smith@gmail.com" }),
      row({ handler_name: "testHandler", last_seen_at: ago(1), error_message: "test problem", payload: { email: "z@example.test" } })
    ]);
    assert.equal(hit.status, "FAIL");
    assert.match(hit.detail, /2 stuck dead-letter rows/);
    assert.match(hit.detail, /Latest: newHandler/);
    assert.doesNotMatch(hit.detail, /oldHandler|testHandler|test problem/);
    assert.match(hit.detail, /bad row for \[email\]/);
    assert.doesNotMatch(hit.detail, /pat\.smith|gmail/);
  });

  test("a job that reported in the last 3 days and is not on the list fails and is named, newest first", async () => {
    const jobs = [{ job: "daily-pulse" }, { job: "ad-video-sweeper" }];
    const hit = await unlisted([
      { job: "daily-pulse", finished_at: ago(30) },
      { job: "new-cron-a", finished_at: ago(10) },
      { job: "new-cron-b", finished_at: ago(100) },
      { job: "new-cron-b", finished_at: ago(200) }
    ], jobs);
    assert.equal(hit.status, "FAIL");
    assert.match(hit.detail, /2 scheduled jobs report a run but are not on the heartbeat list: new-cron-a, new-cron-b\./);
    const one = await unlisted([{ job: "new-cron-a", finished_at: ago(10) }, { job: "daily-pulse", finished_at: ago(10) }], jobs);
    assert.match(one.detail, /1 scheduled job reports a run but is not on the heartbeat list: new-cron-a\./);
  });

  test("every reported job on the list passes; a run older than 3 days is not counted; no recent run skips", async () => {
    const jobs = [{ job: "daily-pulse" }, { job: "ad-video-sweeper" }];
    const ok = await unlisted([
      { job: "daily-pulse", finished_at: ago(30) },
      { job: "ad-video-sweeper", finished_at: ago(30) }
    ], jobs);
    assert.equal(ok.status, "PASS");
    assert.match(ok.detail, /all 2 jobs/);

    // An unlisted name that last ran 4 days ago is outside the window.
    const old = await unlisted([
      { job: "daily-pulse", finished_at: ago(30) },
      { job: "retired-cron", finished_at: ago(4 * 24 * 60) }
    ], jobs);
    assert.equal(old.status, "PASS");
    assert.match(old.detail, /all 1 jobs/);

    const quiet = await unlisted([{ job: "retired-cron", finished_at: ago(4 * 24 * 60) }], jobs);
    assert.equal(quiet.status, "skip");
    assert.match(quiet.detail, /nothing to compare/);
    assert.equal((await unlisted([], jobs)).status, "skip");
  });
});
