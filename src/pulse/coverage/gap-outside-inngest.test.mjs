import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  gapChecks,
  CHECK_IDS,
  WATCHED_JOBS,
  TICK_MS,
  DARK_AFTER_MS,
  LOOKBACK_MS,
  RUNS_SQL,
  PRIOR_SQL,
  PRETEND_PHONE,
  NO_WRITE_DIR,
  quietStretches,
  findDarkStretches,
  inngestCronsStale,
  healthDownText,
  outageStartMs,
  morningPulseDownRun,
  deadDatabase,
  outageFetch,
  phoenixTime,
  spanText,
  OutageRunTimeout
} from "./gap-outside-inngest.mjs";
import { runInstantWatch } from "../instant-watch.mjs";
import { runDailyPulse } from "../daily-pulse.mjs";
import { JOBS, cronIntervalMs } from "../heartbeats.mjs";
import { db as pgDb, close as closePg } from "../../db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NOW = new Date("2026-10-09T13:00:30.000Z"); // 6:00 a.m. Arizona
const NOW_MS = NOW.getTime();

// ---------------------------------------------------------------------------
// A fake receipts table. It answers the two reads the check makes, the way the
// real table does: rows at or after the start time, oldest first, and the newest
// time before the start for each job. It matches each read by its exact SQL text,
// so it only checks how the check USES the answers. The SQL itself is run for
// real in the Postgres block near the end of this file.
// ---------------------------------------------------------------------------

/** Receipts every 5 minutes, newest `endAgoMs` before NOW, going back `spanMs`. */
function steady({ endAgoMs = 2 * MIN, spanMs = 30 * HOUR, skip = [] } = {}) {
  const out = [];
  for (let t = NOW_MS - endAgoMs; t >= NOW_MS - spanMs; t -= TICK_MS) {
    if (skip.some(([from, to]) => t > from && t < to)) continue;
    out.push(t);
  }
  return out.sort((a, b) => a - b);
}

function fakeDb({ receipts = {}, failOn = null, calls = [] } = {}) {
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (failOn && failOn.test(sql)) throw new Error("connection refused");
      if (sql === RUNS_SQL) {
        const [jobs, fromIso] = params;
        const from = new Date(fromIso).getTime();
        const rows = [];
        for (const job of jobs) {
          for (const t of receipts[job] || []) {
            if (t >= from) rows.push({ job, finished_at: new Date(t) });
          }
        }
        rows.sort((a, b) => (a.job === b.job ? a.finished_at - b.finished_at : a.job < b.job ? -1 : 1));
        return { rows };
      }
      if (sql === PRIOR_SQL) {
        const [jobs, fromIso] = params;
        const from = new Date(fromIso).getTime();
        const rows = [];
        for (const job of jobs) {
          const before = (receipts[job] || []).filter((t) => t < from);
          if (before.length) rows.push({ job, last_at: new Date(Math.max(...before)) });
        }
        return { rows };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };
}

function bothSteady(extra = {}) {
  return {
    "message-dispatch-sweeper": steady(extra),
    "pulse-instant-watch": steady(extra)
  };
}

// ---------------------------------------------------------------------------
// The plan the code stands on
// ---------------------------------------------------------------------------

test("the ids are the two planned ones, then the morning-pulse one the checker asked for", () => {
  assert.deepEqual([...CHECK_IDS], [
    "outside:inngest-crons-stale",
    "outside:health-down-text",
    "outside:morning-pulse-down-run"
  ]);
});

test("both watched jobs are on the job list and run every 5 minutes", () => {
  for (const w of WATCHED_JOBS) {
    const hit = JOBS.find((j) => j.job === w.job);
    assert.ok(hit, `${w.job} left the job list: update this lane`);
    assert.equal(hit.runner, "inngest");
    assert.equal(cronIntervalMs(hit.cron), TICK_MS, `${w.job} no longer runs every 5 minutes`);
  }
  assert.equal(DARK_AFTER_MS, 20 * MIN);
  assert.equal(LOOKBACK_MS, 24 * HOUR);
});

test("no other gap lane or slice uses these ids", () => {
  for (const file of fs.readdirSync(HERE)) {
    if (!/^(gap|slice)-.*\.mjs$/.test(file) || file.endsWith(".test.mjs")) continue;
    if (file === "gap-outside-inngest.mjs") continue;
    const text = fs.readFileSync(path.join(HERE, file), "utf8");
    for (const id of CHECK_IDS) assert.ok(!text.includes(id), `${id} also appears in ${file}`);
  }
});

// ---------------------------------------------------------------------------
// quietStretches / findDarkStretches (pure)
// ---------------------------------------------------------------------------

test("quietStretches measures the gap between receipts and the stretch to now", () => {
  const t0 = NOW_MS - 3 * HOUR;
  const times = [t0, t0 + 5 * MIN, t0 + 50 * MIN, NOW_MS - 2 * MIN];
  const out = quietStretches(times, { windowStartMs: NOW_MS - LOOKBACK_MS, nowMs: NOW_MS });
  assert.deepEqual(out.map((s) => Math.round(s.ms / MIN)), [5, 45, Math.round((NOW_MS - 2 * MIN - (t0 + 50 * MIN)) / MIN), 2]);
  assert.equal(out.at(-1).open, true);
  assert.equal(out[0].open, false);
});

test("a gap of exactly 20 minutes is fine and 20 minutes 1 ms is dark", () => {
  const base = NOW_MS - 2 * HOUR;
  const windowStartMs = NOW_MS - LOOKBACK_MS;
  const exactly = [base, base + 20 * MIN];
  assert.equal(findDarkStretches(exactly, { windowStartMs, nowMs: base + 20 * MIN }).length, 0);
  const over = [base, base + 20 * MIN + 1];
  assert.equal(findDarkStretches(over, { windowStartMs, nowMs: base + 20 * MIN + 1 }).length, 1);
});

test("a stretch that ended before the window began is not counted", () => {
  const windowStartMs = NOW_MS - LOOKBACK_MS;
  // A 1 hour hole that closed 2 hours before the window opened, then steady ticks to now.
  const times = [windowStartMs - 3 * HOUR];
  for (let t = windowStartMs - 2 * HOUR; t <= NOW_MS - MIN; t += TICK_MS) times.push(t);
  assert.equal(quietStretches(times, { windowStartMs, nowMs: NOW_MS }).some((s) => s.ms === HOUR), false);
  assert.equal(findDarkStretches(times, { windowStartMs, nowMs: NOW_MS }).length, 0);
  // The same hole, closing 10 minutes after the window opened, is counted.
  const inside = [windowStartMs - 50 * MIN];
  for (let t = windowStartMs + 10 * MIN; t <= NOW_MS - MIN; t += TICK_MS) inside.push(t);
  const dark = findDarkStretches(inside, { windowStartMs, nowMs: NOW_MS });
  assert.equal(dark.length, 1);
  assert.equal(dark[0].ms, HOUR);
});

test("a gap that ends inside the window but starts before it still counts", () => {
  const windowStartMs = NOW_MS - LOOKBACK_MS;
  const times = [windowStartMs - 90 * MIN, windowStartMs + 10 * MIN, NOW_MS - MIN];
  const out = findDarkStretches(times, { windowStartMs, nowMs: NOW_MS });
  assert.equal(out[0].ms, 100 * MIN);
});

test("no receipts gives no stretches", () => {
  assert.deepEqual(quietStretches([], { windowStartMs: 0, nowMs: NOW_MS }), []);
});

// ---------------------------------------------------------------------------
// outside:inngest-crons-stale
// ---------------------------------------------------------------------------

test("PASS: both jobs ticked all day", async () => {
  const r = await inngestCronsStale({ db: fakeDb({ receipts: bothSteady() }), now: NOW });
  assert.equal(r.id, "outside:inngest-crons-stale");
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /message-dispatch-sweeper saved 288 runs/);
  assert.match(r.detail, /pulse-instant-watch saved 288 runs/);
  assert.equal(r.suggestedFix, null);
});

test("FAIL: an outage that already ended before 6 a.m. (the newest receipt is fresh)", async () => {
  // Dark from 3:05 to 3:50 Arizona = 10:05 to 10:50 UTC.
  const hole = [Date.parse("2026-10-09T10:05:00Z"), Date.parse("2026-10-09T10:50:00Z")];
  const receipts = {
    "message-dispatch-sweeper": steady({ skip: [hole] }),
    "pulse-instant-watch": steady({ skip: [hole] })
  };
  // The job-by-job "newest receipt" check would be green: the newest is 2 minutes old.
  assert.ok(NOW_MS - Math.max(...receipts["pulse-instant-watch"]) < 15 * MIN);
  const r = await inngestCronsStale({ db: fakeDb({ receipts }), now: NOW });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /went quiet/);
  assert.match(r.detail, /message-dispatch-sweeper saved no run from Oct 9, 3:0\d AM to Oct 9, 3:5\d AM/);
  assert.match(r.detail, /pulse-instant-watch saved no run/);
  assert.match(r.detail, /hands waiting texts and emails to the sender/);
  assert.match(r.suggestedFix, /only reports/);
});

test("FAIL: the engine stopped just now (newest receipt is 25 minutes old)", async () => {
  const r = await inngestCronsStale({ db: fakeDb({ receipts: bothSteady({ endAgoMs: 25 * MIN }) }), now: NOW });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /to now \(still quiet\)/);
  assert.match(r.detail, /2[45] min/);
});

test("PASS at the edge: newest receipt 19 minutes old is not yet dark", async () => {
  const r = await inngestCronsStale({ db: fakeDb({ receipts: bothSteady({ endAgoMs: 19 * MIN }) }), now: NOW });
  assert.equal(r.status, "PASS");
});

test("FAIL: only the 5-minute alarm went dark, and the text names only that job", async () => {
  const hole = [Date.parse("2026-10-09T08:00:00Z"), Date.parse("2026-10-09T09:00:00Z")];
  const receipts = {
    "message-dispatch-sweeper": steady(),
    "pulse-instant-watch": steady({ skip: [hole] })
  };
  const r = await inngestCronsStale({ db: fakeDb({ receipts }), now: NOW });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /pulse-instant-watch saved no run/);
  assert.doesNotMatch(r.detail, /message-dispatch-sweeper saved no run/);
  assert.match(r.detail, /texts Chris when a door breaks/);
});

test("FAIL: a job with no receipt in the 24 hours but one earlier is dark since then", async () => {
  const old = NOW_MS - 3 * 24 * HOUR;
  const db = fakeDb({
    receipts: { "message-dispatch-sweeper": steady(), "pulse-instant-watch": [old] }
  });
  const r = await inngestCronsStale({ db, now: NOW });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /pulse-instant-watch saved no run from/);
  assert.match(r.detail, /3 days|72 h|\d+ h/);
});

test("skip, never PASS: a job with no receipt at all", async () => {
  const db = fakeDb({ receipts: { "message-dispatch-sweeper": steady(), "pulse-instant-watch": [] } });
  const r = await inngestCronsStale({ db, now: NOW });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /pulse-instant-watch has no receipt at all/);
});

// The checker's repro (high): the outage began 40 hours ago and ended 3 hours ago, so
// the receipt that starts the dark stretch is OUTSIDE the 24 hour window. A fixed one
// hour extra read missed it and the row read PASS while the engine was dark for 37 hours.
test("FAIL: an outage that began before the 24 hours and ended inside them (it swallowed yesterday's 6 a.m. run)", async () => {
  const tail = (job) => {
    const out = [];
    for (let t = NOW_MS - 42 * HOUR; t <= NOW_MS - 40 * HOUR; t += TICK_MS) out.push(t);
    for (let t = NOW_MS - 3 * HOUR; t <= NOW_MS - 2 * MIN; t += TICK_MS) out.push(t);
    return out;
  };
  const receipts = { "message-dispatch-sweeper": tail(), "pulse-instant-watch": tail() };
  // Nothing inside the 25 hours before NOW sits before the first in-window receipt.
  assert.ok(receipts["pulse-instant-watch"].filter((t) => t < NOW_MS - 3 * HOUR && t >= NOW_MS - 25 * HOUR).length === 0);
  const r = await inngestCronsStale({ db: fakeDb({ receipts }), now: NOW });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /message-dispatch-sweeper saved no run from Oct 7, 2:\d\d PM to Oct 9, 3:\d\d AM, 3\d h/);
  assert.match(r.detail, /pulse-instant-watch saved no run from Oct 7, 2:\d\d PM to Oct 9, 3:\d\d AM/);
});

test("FAIL: a hole that opens before the window and closes just after it is counted from its true start", async () => {
  const windowStart = NOW_MS - LOOKBACK_MS;
  const receipts = {};
  for (const job of ["message-dispatch-sweeper", "pulse-instant-watch"]) {
    receipts[job] = [windowStart - 6 * HOUR];
    for (let t = windowStart + 30 * MIN; t <= NOW_MS - 2 * MIN; t += TICK_MS) receipts[job].push(t);
  }
  const r = await inngestCronsStale({ db: fakeDb({ receipts }), now: NOW });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /6 h 30 min/);
});

test("PASS: the receipt before the window is only 3 minutes before it, so the first stretch is short", async () => {
  const windowStart = NOW_MS - LOOKBACK_MS;
  const receipts = {};
  for (const job of ["message-dispatch-sweeper", "pulse-instant-watch"]) {
    receipts[job] = [windowStart - 3 * MIN];
    for (let t = windowStart + 2 * MIN; t <= NOW_MS - 2 * MIN; t += TICK_MS) receipts[job].push(t);
  }
  const r = await inngestCronsStale({ db: fakeDb({ receipts }), now: NOW });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /ticked through the last 24 hours/);
});

test("PASS says what it cannot see: the check runs inside the morning job", async () => {
  const r = await inngestCronsStale({ db: fakeDb({ receipts: bothSteady() }), now: NOW });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /runs inside the morning job/);
  assert.match(r.detail, /not one still going at 6 a\.m\./);
  assert.match(r.detail, /not built yet \(it waits for Chris's go\)/);
});

test("PASS, but honest: a job with no receipt before its first one in the window is not called proved for the whole day", async () => {
  const young = steady({ spanMs: 10 * HOUR });
  const r = await inngestCronsStale({
    db: fakeDb({ receipts: { "message-dispatch-sweeper": steady(), "pulse-instant-watch": young } }),
    now: NOW
  });
  assert.equal(r.status, "PASS");
  assert.doesNotMatch(r.detail, /ticked through the last 24 hours/);
  assert.match(r.detail, /No quiet stretch over the limit in the receipts on file\./);
  assert.match(r.detail, /pulse-instant-watch has no receipt before Oct 8, 8:\d\d PM, so the part of the 24 hours before that is not proved\./);
  assert.doesNotMatch(r.detail, /message-dispatch-sweeper has no receipt before/);
});

test("a job whose first receipt came 10 minutes after the window opened, with none before it, is not a late start", async () => {
  const windowStart = NOW_MS - LOOKBACK_MS;
  const times = [];
  for (let t = windowStart + 10 * MIN; t <= NOW_MS - 2 * MIN; t += TICK_MS) times.push(t);
  const r = await inngestCronsStale({
    db: fakeDb({ receipts: { "message-dispatch-sweeper": times, "pulse-instant-watch": times } }),
    now: NOW
  });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /ticked through the last 24 hours/);
  assert.doesNotMatch(r.detail, /has no receipt before/);
});

test("a dark job still beats a job with no receipt: FAIL, not skip", async () => {
  const hole = [Date.parse("2026-10-09T08:00:00Z"), Date.parse("2026-10-09T09:00:00Z")];
  const db = fakeDb({ receipts: { "message-dispatch-sweeper": steady({ skip: [hole] }), "pulse-instant-watch": [] } });
  const r = await inngestCronsStale({ db, now: NOW });
  assert.equal(r.status, "FAIL");
});

test("skip with the reason when the receipts cannot be read", async () => {
  const r = await inngestCronsStale({ db: fakeDb({ failOn: /FROM job_heartbeats/ }), now: NOW });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /could not be read: connection refused/);
});

test("skip when the second read (newest receipt before the window) fails", async () => {
  const db = fakeDb({ receipts: { "message-dispatch-sweeper": steady(), "pulse-instant-watch": steady() }, failOn: /max\(finished_at\)/ });
  const r = await inngestCronsStale({ db, now: NOW });
  assert.equal(r.status, "skip");
});

test("skip when there is no database", async () => {
  assert.equal((await inngestCronsStale({ db: null, now: NOW })).status, "skip");
  assert.equal((await inngestCronsStale({ db: {}, now: NOW })).status, "skip");
});

test("it reads receipts for exactly the two jobs, 24 hours back, then the newest one before that, and only reads", async () => {
  const calls = [];
  await inngestCronsStale({ db: fakeDb({ receipts: bothSteady(), calls }), now: NOW });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].sql, RUNS_SQL);
  assert.equal(calls[1].sql, PRIOR_SQL);
  for (const c of calls) {
    assert.deepEqual(c.params[0], ["message-dispatch-sweeper", "pulse-instant-watch"]);
    // Written out as 24 hours so a changed constant cannot hide it. Both reads use the same cut.
    assert.equal(new Date(c.params[1]).getTime(), NOW_MS - 24 * HOUR);
  }
  for (const sql of [RUNS_SQL, PRIOR_SQL]) {
    assert.match(sql, /^SELECT/);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK|SET)\b/i);
    assert.match(sql, /FROM job_heartbeats/);
    assert.match(sql, /WHERE job = ANY\(\$1::text\[\]\)/);
    assert.doesNotMatch(sql, /started_at/);
  }
  // The two reads are cut at the same point, one side each. The checker flipped these and 37 tests stayed green.
  assert.match(RUNS_SQL, /AND finished_at >= \$2::timestamptz/);
  assert.match(RUNS_SQL, /ORDER BY job, finished_at$/);
  assert.match(PRIOR_SQL, /AND finished_at < \$2::timestamptz/);
  assert.match(PRIOR_SQL, /max\(finished_at\) AS last_at/);
  assert.match(PRIOR_SQL, /GROUP BY job/);
});

test("the limit can be tightened (used to prove the red path on real history)", async () => {
  const receipts = bothSteady();
  const loose = await inngestCronsStale({ db: fakeDb({ receipts }), now: NOW });
  const tight = await inngestCronsStale({ db: fakeDb({ receipts }), now: NOW, darkAfterMs: 4 * MIN });
  assert.equal(loose.status, "PASS");
  assert.equal(tight.status, "FAIL");
});

test("a long list of stretches shows three and counts the rest", async () => {
  const holes = [];
  for (let i = 0; i < 6; i += 1) {
    const from = NOW_MS - (20 - i * 2) * HOUR;
    holes.push([from, from + 40 * MIN]);
  }
  const r = await inngestCronsStale({ db: fakeDb({ receipts: { "message-dispatch-sweeper": steady({ skip: holes }), "pulse-instant-watch": steady() } }), now: NOW });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /3 more stretch\(es\) not shown/);
});

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

test("times read in Arizona time and spans read in plain words", () => {
  assert.equal(phoenixTime(Date.parse("2026-10-09T10:05:00Z")), "Oct 9, 3:05 AM");
  assert.equal(spanText(45 * MIN), "45 min");
  assert.equal(spanText(125 * MIN), "2 h 5 min");
  assert.equal(spanText(3 * HOUR), "3 h");
});

// ---------------------------------------------------------------------------
// outside:health-down-text
// ---------------------------------------------------------------------------

// A watch that was fixed: it survives a dead database and still texts.
async function fixedWatch({ db, env, fetchImpl, baseUrl, sendImpl, now }) {
  const res = await fetchImpl(`${baseUrl}/api/health?strict=1`);
  const failures = res.status >= 300 ? [{ id: "health", detail: `strict health answered ${res.status}` }] : [];
  try {
    await db.query("SELECT id FROM orgs WHERE is_default LIMIT 1");
  } catch {
    /* the database is down: carry on without it */
  }
  if (failures.length) {
    await sendImpl({ id: `pulse-instant-${now.getTime()}`, to: env.PULSE_SMS_TO, body: `Fundhub alert (instant pulse): ${failures[0].id}: ${failures[0].detail}`, channel: "sms" });
  }
  return { ok: true, failures };
}

test("health-down-text PASS: a watch that survives a dead database and texts", async () => {
  const r = await healthDownText({ runWatch: fixedWatch, now: NOW });
  assert.equal(r.id, "outside:health-down-text");
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /texted within half an hour \(6 texts in 6 runs\)/);
  assert.match(r.detail, /health: strict health answered 503/);
});

test("health-down-text PASS text keeps the sent words in one pair of quotes", async () => {
  const quoting = async ({ sendImpl }) => {
    await sendImpl({ body: 'health: answered 503: {"ok":false}' });
    return { ok: true };
  };
  const r = await healthDownText({ runWatch: quoting, now: NOW });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /: "health: answered 503: \{'ok':false\}"\.$/);
});

test("health-down-text FAIL: a watch that crashes on the dead database", async () => {
  const crashing = async ({ db }) => {
    await db.query("SELECT id FROM orgs WHERE is_default LIMIT 1");
    return { ok: true };
  };
  const r = await healthDownText({ runWatch: crashing, now: NOW });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /does not text/);
  assert.match(r.detail, /pretend outage/);
  assert.match(r.suggestedFix, /defaultOrgId/);
});

test("health-down-text FAIL: a watch that finishes and sends nothing", async () => {
  const quiet = async () => ({ ok: true, failures: [{ id: "health" }], sms: { sent: false, reason: "no_dest" } });
  const r = await healthDownText({ runWatch: quiet, now: NOW });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /ran for a whole half hour and sent no text/);
});

test("health-down-text FAIL: a watch that hangs is told apart from one that crashes", async () => {
  const hang = () => new Promise(() => {});
  const r = await healthDownText({ runWatch: hang, now: NOW, timeoutMs: 30 });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /hangs/);
  assert.match(r.detail, /did not finish in 30 ms/);
  assert.doesNotMatch(r.detail, /read the database again/);
  assert.ok(new OutageRunTimeout(5) instanceof Error);
});

test("health-down-text hands the watch a database that is really down and doors that answer 503", async () => {
  let seen = null;
  const spy = async (args) => {
    seen = args;
    const asked = await args.fetchImpl(`${args.baseUrl}/api/health?strict=1`);
    seen.healthStatus = asked.status;
    seen.healthBody = await asked.text();
    await args.sendImpl({ body: "ok" });
    return { ok: true };
  };
  await healthDownText({ runWatch: spy, now: NOW });
  await assert.rejects(() => seen.db.query("SELECT 1"), /database is down/);
  assert.equal(seen.healthStatus, 503);
  assert.match(seen.healthBody, /"db":"down"/);
  assert.equal(seen.baseUrl, "https://fundhub.ai");
  assert.deepEqual(Object.keys(seen.env), ["PULSE_SMS_TO"]);
  assert.equal(seen.env.PULSE_SMS_TO, PRETEND_PHONE);
  assert.equal(typeof seen.sendImpl, "function");
});

test("health-down-text never touches the real web, the real database or the real sender", async () => {
  const realFetch = globalThis.fetch;
  let realFetchCalls = 0;
  globalThis.fetch = async (...a) => {
    realFetchCalls += 1;
    return realFetch(...a);
  };
  try {
    const r = await healthDownText({ now: NOW }); // the real watch, pretend everything else
    assert.ok(["PASS", "FAIL"].includes(r.status), `real watch gave ${r.status}`);
    assert.notEqual(r.status, "skip");
    assert.equal(realFetchCalls, 0);
    assert.match(r.detail, /5-minute alarm/);
    if (r.status === "FAIL") assert.ok(r.suggestedFix);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the real 5-minute watch, given the pretend outage, gives an answer a person can read", async () => {
  // This does not pin PASS or FAIL: the day the watch is fixed it flips to PASS and this still holds.
  const { fetchImpl, asked } = outageFetch();
  const sent = [];
  let outcome;
  try {
    outcome = await runInstantWatch({
      db: deadDatabase(),
      env: { PULSE_SMS_TO: PRETEND_PHONE },
      fetchImpl,
      baseUrl: "https://fundhub.ai",
      now: NOW,
      sendImpl: async (m) => { sent.push(m); return { ok: true }; }
    });
  } catch (err) {
    outcome = { threw: String(err.message) };
  }
  assert.ok(outcome.threw ? sent.length === 0 : sent.length >= 0);
  assert.ok(asked.length >= 1);
  assert.ok(asked.every((u) => u.startsWith("https://fundhub.ai") || u.startsWith("https://apply.fundhub.ai")));
});

test("deadDatabase fails every question; outageFetch answers 503 to every door and keeps the list", async () => {
  await assert.rejects(() => deadDatabase().query("SELECT 1"));
  await assert.rejects(() => deadDatabase().query("INSERT INTO agent_runs DEFAULT VALUES"));
  const { fetchImpl, asked } = outageFetch();
  const a = await fetchImpl("https://fundhub.ai/login.html");
  const b = await fetchImpl("https://apply.fundhub.ai/roadmap");
  assert.equal(a.status, 503);
  assert.equal(b.status, 503);
  assert.deepEqual(asked, ["https://fundhub.ai/login.html", "https://apply.fundhub.ai/roadmap"]);
});

// ---------------------------------------------------------------------------
// outside:morning-pulse-down-run
// ---------------------------------------------------------------------------

/**
 * A database that is down for everything except the one read a fix would catch.
 * It stands in for "the default org read is caught and carries on with no org".
 * Used to run the REAL 6 a.m. pulse past that read.
 */
function orgReadSurvives(dead) {
  return {
    async query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [] };
      return dead.query(sql, params);
    }
  };
}

// A pulse that was fixed: it survives a dead database and reports the web failure.
async function fixedPulse({ db, fetchImpl, baseUrl }) {
  const res = await fetchImpl(`${baseUrl}/api/health?strict=1`);
  try {
    await db.query("SELECT id FROM orgs WHERE is_default LIMIT 1");
  } catch {
    /* the database is down: carry on without an org */
  }
  return { checks: [{ id: "health", status: res.status < 300 ? "PASS" : "FAIL", detail: `strict health answered ${res.status}: {"ok":false}` }] };
}

test("morning-pulse PASS: a pulse that survives a dead database and reports the site down", async () => {
  const r = await morningPulseDownRun({ runPulse: fixedPulse, now: NOW });
  assert.equal(r.id, "outside:morning-pulse-down-run");
  assert.equal(r.status, "PASS");
  assert.equal(r.suggestedFix, null);
  assert.match(r.detail, /still ran to the end \(1 rows\) and reported the site down/);
  assert.match(r.detail, /strict health answered 503/);
  assert.match(r.detail, /morning brief step that follows is not run here/);
});

test("morning-pulse PASS: a registry row that says down counts as reporting the site down", async () => {
  const r = await morningPulseDownRun({
    runPulse: async () => ({ checks: [{ id: "health", status: "down", detail: "503" }] }),
    now: NOW
  });
  assert.equal(r.status, "PASS");
});

test("morning-pulse FAIL: a pulse that crashes on the dead database (the break today)", async () => {
  const crashing = async ({ db, orgId }) => {
    const resolved = orgId || (await db.query("SELECT id FROM orgs WHERE is_default LIMIT 1"));
    return { checks: [{ id: "health", status: "FAIL", detail: String(resolved) }] };
  };
  const r = await morningPulseDownRun({ runPulse: crashing, now: NOW });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /does not finish/);
  assert.match(r.detail, /pretend outage/);
  assert.match(r.detail, /morning brief step never runs/);
  assert.match(r.suggestedFix, /runDailyPulse/);
  assert.match(r.suggestedFix, /defaultOrgId/);
  assert.match(r.suggestedFix, /only reports/);
});

test("morning-pulse FAIL: a pulse that hangs is told apart from one that crashes", async () => {
  const r = await morningPulseDownRun({ runPulse: () => new Promise(() => {}), now: NOW, timeoutMs: 30 });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /hangs/);
  assert.match(r.detail, /did not finish in 30 ms/);
  assert.doesNotMatch(r.detail, /reads the default org/);
});

test("morning-pulse FAIL: a pulse that returns no rows", async () => {
  for (const out of [{ checks: [] }, {}, null, undefined, { checks: "nope" }]) {
    const r = await morningPulseDownRun({ runPulse: async () => out, now: NOW });
    assert.equal(r.status, "FAIL", JSON.stringify(out));
    assert.match(r.detail, /returned no check rows/);
  }
});

test("morning-pulse FAIL: a pulse that swallows the 503 and calls the site fine", async () => {
  const r = await morningPulseDownRun({
    runPulse: async () => ({ checks: [{ id: "health", status: "PASS", detail: "strict health answered 200" }, { id: "login", status: "FAIL", detail: "x" }] }),
    now: NOW
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /did not report the site as down/);
  assert.match(r.detail, /health row says "PASS"/);
});

test("morning-pulse FAIL: a pulse with no health row at all", async () => {
  const r = await morningPulseDownRun({ runPulse: async () => ({ checks: [{ id: "login", status: "FAIL", detail: "x" }] }), now: NOW });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /health row says nothing at all/);
});

test("morning-pulse hands the pulse a dead database, doors that answer 503, and every send path closed", async () => {
  let seen = null;
  const spy = async (args) => {
    seen = args;
    const asked = await args.fetchImpl(`${args.baseUrl}/api/health?strict=1`);
    seen.healthStatus = asked.status;
    return { checks: [{ id: "health", status: "FAIL", detail: "503" }] };
  };
  await morningPulseDownRun({ runPulse: spy, now: NOW });
  await assert.rejects(() => seen.db.query("SELECT 1"), /database is down/);
  await assert.rejects(() => seen.db.query("INSERT INTO agent_runs DEFAULT VALUES"), /database is down/);
  assert.equal(seen.healthStatus, 503);
  assert.equal(seen.baseUrl, "https://fundhub.ai");
  assert.equal(seen.orgId, null, "the pulse must find its own org, or the first read is never tried");
  assert.deepEqual(seen.env, {}, "no real setting or key goes in");
  assert.equal(seen.dryRun, true);
  assert.equal(seen.recordRun, false);
  assert.equal(seen.sendPulseText, false);
  assert.equal(seen.gateRelayDirs, null, "no folder is read");
  assert.equal(seen.staffScope, null);
  assert.ok(Array.isArray(seen.coverageRows) && seen.coverageRows.length === 0, "an empty coverage list stops the pulse from calling this lane again");
  assert.equal(seen.boardDir, NO_WRITE_DIR);
  assert.equal(typeof seen.sendSms, "function");
  assert.equal(typeof seen.sendWhatsApp, "function");
  assert.equal((await seen.sendSms({ body: "x" })).status, "sent");
});

test("the folder the morning pulse is told to write its scorecard into cannot be created", () => {
  assert.ok(NO_WRITE_DIR.startsWith("/dev/null/"));
  assert.throws(() => fs.mkdirSync(NO_WRITE_DIR, { recursive: true }));
  assert.equal(fs.existsSync(NO_WRITE_DIR), false);
});

test("the REAL morning pulse, past the one read a fix would catch, ends cleanly and leaves nothing behind", async () => {
  const realFetch = globalThis.fetch;
  let realFetchCalls = 0;
  globalThis.fetch = async (...a) => {
    realFetchCalls += 1;
    return realFetch(...a);
  };
  let captured = null;
  let asked = 0;
  let sends = 0;
  try {
    const r = await morningPulseDownRun({
      now: NOW,
      runPulse: async (args) => {
        const { fetchImpl } = args;
        captured = await runDailyPulse({
          ...args,
          db: orgReadSurvives(args.db),
          fetchImpl: async (...a) => { asked += 1; return fetchImpl(...a); },
          sendSms: async () => { sends += 1; return { ok: true }; },
          sendWhatsApp: async () => { sends += 1; return { ok: true }; }
        });
        return captured;
      }
    });
    assert.equal(r.status, "PASS", r.detail);
    assert.match(r.detail, /reported the site down: "strict health answered 503/);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(realFetchCalls, 0, "the real web was touched");
  assert.ok(asked >= 5, "the pulse asked the pretend web for its doors");
  assert.equal(sends, 0, "a pretend text path was used: dry run and no phone number");
  assert.equal(captured.dryRun, true);
  assert.equal(captured.autoFix, false);
  assert.equal(captured.sms.sent, false);
  assert.equal(captured.darwin.sent, false);
  assert.equal(captured.agentRun.recorded, false);
  assert.equal(captured.wrote.ok, false, "no scorecard file was written");
  assert.match(captured.wrote.error, /ENOTDIR|ENOENT|EEXIST|not a directory/i);
  assert.ok(captured.checks.length > 50, "the registry doors were all asked");
});

test("the real morning pulse today gives an answer a person can read, touches no real web, and is never a skip", async () => {
  const realFetch = globalThis.fetch;
  let realFetchCalls = 0;
  globalThis.fetch = async (...a) => {
    realFetchCalls += 1;
    return realFetch(...a);
  };
  try {
    const r = await morningPulseDownRun({ now: NOW });
    // This does not pin PASS or FAIL: the day the pulse is fixed it flips to PASS and this still holds.
    assert.ok(["PASS", "FAIL"].includes(r.status), `real pulse gave ${r.status}`);
    assert.equal(realFetchCalls, 0);
    assert.match(r.detail, /6 a\.m\. pulse/);
    if (r.status === "FAIL") assert.ok(r.suggestedFix);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------------------------------------------------------------------------
// gapChecks
// ---------------------------------------------------------------------------

test("gapChecks returns the three rows in the shape the pulse reads", async () => {
  const rows = await gapChecks({ db: fakeDb({ receipts: bothSteady() }), now: NOW });
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.deepEqual(Object.keys(r), ["id", "status", "detail", "suggestedFix"]);
    assert.ok(["PASS", "FAIL", "skip"].includes(r.status));
    assert.equal(typeof r.detail, "string");
    assert.ok(r.detail.length > 0);
    if (r.status === "FAIL") assert.ok(r.suggestedFix);
    else assert.equal(r.suggestedFix, null);
  }
  assert.equal(rows[0].status, "PASS");
});

test("gapChecks with no context gives skip for the receipts and still runs both outage checks", async () => {
  const rows = await gapChecks();
  assert.equal(rows[0].status, "skip");
  assert.notEqual(rows[1].status, "skip");
  assert.notEqual(rows[2].status, "skip");
});

test("gapChecks turns a throw inside a check into a skip row, not a dead lane", async () => {
  const db = { query: () => { throw new Error("boom"); } };
  const rows = await gapChecks({ db, now: NOW });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].status, "skip");
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
});

test("gapChecks needs only db and now, and reads no other part of the context", async () => {
  const read = new Set();
  const ctx = new Proxy({ db: fakeDb({ receipts: bothSteady() }), now: NOW, env: { SECRET: "x" } }, {
    get(t, p) { if (typeof p === "string") read.add(p); return t[p]; }
  });
  await gapChecks(ctx);
  assert.deepEqual([...read].sort(), ["db", "now"]);
});

test("the lane file sends nothing itself and reads no repo file", () => {
  const src = fs
    .readFileSync(path.join(HERE, "gap-outside-inngest.mjs"), "utf8")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  assert.doesNotMatch(src, /\bnode:fs\b|readFileSync|readdirSync|process\.cwd\(\)|import\.meta\.url/);
  assert.doesNotMatch(src, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/i);
  assert.doesNotMatch(src, /globalThis\.fetch|\bfetch\(/);
  assert.doesNotMatch(src, /\b(BEGIN|COMMIT|ROLLBACK)\b/);
});

test("the lane file keeps the morning pulse sealed: no real settings, no real send, no folder", () => {
  const src = fs
    .readFileSync(path.join(HERE, "gap-outside-inngest.mjs"), "utf8")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  assert.doesNotMatch(src, /process\.env/);
  assert.match(src, /coverageRows: \[\]/);
  assert.match(src, /dryRun: true/);
  assert.match(src, /recordRun: false/);
  assert.match(src, /sendPulseText: false/);
  assert.match(src, /gateRelayDirs: null/);
  assert.match(src, /boardDir: NO_WRITE_DIR/);
});

/* ------------------------------------------------------------------------
   The SQL, run for real. job_heartbeats is replaced for one query by fixture
   rows (a CTE with the table's name), so RUNS_SQL and PRIOR_SQL run on the
   Postgres engine over rows we choose. SELECT only, nothing is stored.
   Skipped without DATABASE_URL, like every *.pg.test.mjs.
   The fake db above only checks how the answer is USED. These are the tests that
   fail if the time filter, the job filter, the sort, or the group-by is changed.
   ------------------------------------------------------------------------ */
const HAVE_DB = !!process.env.DATABASE_URL;

function fixtureDb(receipts) {
  const rows = [];
  for (const [job, times] of Object.entries(receipts)) {
    for (const t of times) rows.push({ job, finished_at: new Date(t).toISOString() });
  }
  const json = JSON.stringify(rows).replace(/'/g, "''");
  const cte = `job_heartbeats AS (SELECT * FROM jsonb_to_recordset('${json}'::jsonb) AS x("job" text, "finished_at" timestamptz))`;
  return {
    calls: [],
    async query(sql, params) {
      const text = String(sql).trim();
      this.calls.push(text);
      return pgDb.query(`WITH ${cte} ${text}`, params);
    }
  };
}

describe("outside:inngest-crons-stale SQL on the Postgres engine, over fixture rows", { skip: HAVE_DB ? false : "no DATABASE_URL" }, () => {
  after(async () => { await closePg(); });
  const JOBS2 = ["message-dispatch-sweeper", "pulse-instant-watch"];
  const START = new Date(NOW_MS - LOOKBACK_MS).toISOString();

  test("RUNS_SQL: only the two jobs, only receipts at or after the start, oldest first", async () => {
    const start = NOW_MS - LOOKBACK_MS;
    const db = fixtureDb({
      "message-dispatch-sweeper": [start - 10 * MIN, start, start + 5 * MIN, start + 1 * MIN],
      "pulse-instant-watch": [start + 7 * MIN, start - 1],
      "daily-pulse": [start + 2 * MIN, start + 3 * MIN],
      "other-job": [start + 4 * MIN]
    });
    const { rows } = await db.query(RUNS_SQL, [JOBS2, START]);
    assert.deepEqual(
      rows.map((r) => [r.job, r.finished_at.getTime() - start]),
      [
        ["message-dispatch-sweeper", 0],
        ["message-dispatch-sweeper", 1 * MIN],
        ["message-dispatch-sweeper", 5 * MIN],
        ["pulse-instant-watch", 7 * MIN]
      ]
    );
  });

  test("PRIOR_SQL: one row per watched job, its newest receipt strictly before the start", async () => {
    const start = NOW_MS - LOOKBACK_MS;
    const db = fixtureDb({
      "message-dispatch-sweeper": [start - 90 * MIN, start - 5 * MIN, start - 40 * MIN, start, start + MIN],
      "pulse-instant-watch": [start - 3 * HOUR, start + 2 * MIN],
      "daily-pulse": [start - 1 * MIN],
      "other-job": [start - 2 * MIN]
    });
    const { rows } = await db.query(PRIOR_SQL, [JOBS2, START]);
    const byJob = Object.fromEntries(rows.map((r) => [r.job, r.last_at.getTime() - start]));
    assert.deepEqual(byJob, { "message-dispatch-sweeper": -5 * MIN, "pulse-instant-watch": -3 * HOUR });
    assert.equal(rows.length, 2);
  });

  test("PRIOR_SQL: a receipt exactly at the start belongs to the window, not before it", async () => {
    const start = NOW_MS - LOOKBACK_MS;
    const db = fixtureDb({ "message-dispatch-sweeper": [start], "pulse-instant-watch": [start] });
    const { rows } = await db.query(PRIOR_SQL, [JOBS2, START]);
    assert.equal(rows.length, 0);
    const runs = await db.query(RUNS_SQL, [JOBS2, START]);
    assert.equal(runs.rows.length, 2);
  });

  test("end to end on the engine: steady ticks pass; the checker's tail-only outage fails; a stretch to now fails", async () => {
    const steadyBoth = () => ({ "message-dispatch-sweeper": steady(), "pulse-instant-watch": steady() });
    const ok = await inngestCronsStale({ db: fixtureDb(steadyBoth()), now: NOW });
    assert.equal(ok.status, "PASS", ok.detail);
    assert.match(ok.detail, /message-dispatch-sweeper saved 288 runs/);

    const tail = () => {
      const out = [];
      for (let t = NOW_MS - 42 * HOUR; t <= NOW_MS - 40 * HOUR; t += TICK_MS) out.push(t);
      for (let t = NOW_MS - 3 * HOUR; t <= NOW_MS - 2 * MIN; t += TICK_MS) out.push(t);
      return out;
    };
    const tailOnly = await inngestCronsStale({
      db: fixtureDb({ "message-dispatch-sweeper": tail(), "pulse-instant-watch": tail() }),
      now: NOW
    });
    assert.equal(tailOnly.status, "FAIL", tailOnly.detail);
    assert.match(tailOnly.detail, /37 h/);

    const stopped = await inngestCronsStale({
      db: fixtureDb({ "message-dispatch-sweeper": steady({ endAgoMs: 25 * MIN }), "pulse-instant-watch": steady({ endAgoMs: 25 * MIN }) }),
      now: NOW
    });
    assert.equal(stopped.status, "FAIL");
    assert.match(stopped.detail, /to now \(still quiet\)/);

    const other = await inngestCronsStale({
      db: fixtureDb({ "message-dispatch-sweeper": steady(), "pulse-instant-watch": steady({ endAgoMs: 25 * MIN }), "daily-pulse": steady() }),
      now: NOW
    });
    assert.equal(other.status, "FAIL", "a busy unrelated job must not hide a dark watched one");
    assert.match(other.detail, /pulse-instant-watch saved no run/);
    assert.doesNotMatch(other.detail, /message-dispatch-sweeper saved no run/);
  });

  test("end to end on the engine: a job with no receipt at all is a skip", async () => {
    const r = await inngestCronsStale({ db: fixtureDb({ "message-dispatch-sweeper": steady(), "daily-pulse": steady() }), now: NOW });
    assert.equal(r.status, "skip");
    assert.match(r.detail, /pulse-instant-watch has no receipt at all/);
  });
});

test("health-down-text: the real watch with a dead database texts once in a half hour, not every run", async () => {
  const r = await healthDownText({ now: new Date("2026-10-09T13:00:00Z") });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /\(1 text in 6 runs\)/);
});

/* ---- the pretend half hour stays inside texting hours (owner law 2026-10-09) ---- */

test("outageStartMs: inside the window it is the real now; a half hour that would cross 10 p.m. or start before 6 a.m. moves to 6 a.m.", () => {
  const iso = (s) => new Date(s).getTime();
  assert.equal(outageStartMs(iso("2026-10-09T15:00:00Z")), iso("2026-10-09T15:00:00Z"), "8:00 a.m. Arizona stays");
  assert.equal(outageStartMs(iso("2026-10-10T04:20:00Z")), iso("2026-10-10T04:20:00Z"), "9:20 p.m. Arizona stays (ends 9:45)");
  assert.equal(outageStartMs(iso("2026-10-10T04:50:00Z")), iso("2026-10-10T13:00:00Z"), "9:50 p.m. crosses 10 p.m., so 6 a.m. tomorrow");
  assert.equal(outageStartMs(iso("2026-10-10T12:30:00Z")), iso("2026-10-10T13:00:00Z"), "5:30 a.m. is before the window, so 6 a.m.");
});

test("health-down-text: the real watch passes at 9:50 p.m. and 5:30 a.m. (no false red from texting hours)", async () => {
  for (const at of ["2026-10-10T04:50:00Z", "2026-10-10T12:30:00Z"]) {
    const r = await healthDownText({ now: new Date(at) });
    assert.equal(r.status, "PASS", `${at}: ${r.detail}`);
  }
});

test("health-down-text: a watch that really sends nothing is still red at night", async () => {
  const quiet = async () => ({ ok: true });
  const r = await healthDownText({ runWatch: quiet, now: new Date("2026-10-10T04:50:00Z") });
  assert.equal(r.status, "FAIL");
});
