// The cron clock: which jobs are due in a 5-minute slot, the start signature, and one tick.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SLOT_MS, WORKER_PATH, AUTH_HEADER, STALE_SLOT_MS,
  parseCron, dueInSlot, dueJobs, slotOf, sign, verifyStart, tick
} from "./clock.mjs";
import { CLOCK_JOBS, NETLIFY_JOBS, cronIntervalMs } from "../pulse/heartbeats.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const at = (iso) => new Date(iso);
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

test("the clock ticks every 5 minutes: netlify.toml, the function and the job list agree", async () => {
  const toml = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
  const m = /\[functions\."cron-clock"\]\s*\n\s*schedule\s*=\s*"([^"]+)"/.exec(toml);
  assert.ok(m, "netlify.toml schedules cron-clock");
  const { SWEEP_CRON } = await import("../../netlify/functions/cron-clock.mjs");
  assert.equal(m[1], SWEEP_CRON);
  assert.equal(SWEEP_CRON, "*/5 * * * *");
  assert.equal(cronIntervalMs(SWEEP_CRON), SLOT_MS, "one tick per slot");
  assert.deepEqual(NETLIFY_JOBS.find(([job]) => job === "cron-clock"), ["cron-clock", "*/5 * * * *"]);
  const src = fs.readFileSync(path.join(ROOT, "netlify/functions/cron-clock.mjs"), "utf8");
  assert.ok(src.includes('noteScheduledRun(db, "cron-clock"'), "the clock writes its own receipt");
  assert.ok(!/export\s+(async\s+)?function\s+handler|export\s+const\s+handler/.test(src), "default export only (the 4 KB env trap)");
});

test("every clock job's cron parses; an unknown zone or shape is refused, never guessed", () => {
  assert.ok(CLOCK_JOBS.length >= 30, "the job list is real");
  for (const [job, cron] of CLOCK_JOBS) assert.doesNotThrow(() => parseCron(cron), job);
  assert.throws(() => parseCron("TZ=America/Denver 0 6 * * *"), /time zone/);
  assert.throws(() => parseCron("0 6 * *"), /five fields/);
  assert.throws(() => parseCron("61 * * * *"), /out of range/);
  assert.throws(() => parseCron("@hourly * * * *"), /shape/);
});

test("a job is due in the slot that holds a minute its cron names, and in no other", () => {
  // Minute 17 lands in the :15 slot.
  assert.equal(dueInSlot("17 * * * *", at("2026-10-21T04:15:00Z")), true);
  assert.equal(dueInSlot("17 * * * *", at("2026-10-21T04:10:00Z")), false);
  assert.equal(dueInSlot("17 * * * *", at("2026-10-21T04:20:00Z")), false);
  // Every 15 minutes: :00 :15 :30 :45, never :05.
  assert.equal(dueInSlot("*/15 * * * *", at("2026-10-21T04:45:00Z")), true);
  assert.equal(dueInSlot("*/15 * * * *", at("2026-10-21T04:05:00Z")), false);
  // Arizona 6:00 a.m. is 13:00 UTC all year (no daylight saving).
  assert.equal(dueInSlot("TZ=America/Phoenix 0 6 * * *", at("2026-10-21T13:00:00Z")), true);
  assert.equal(dueInSlot("TZ=America/Phoenix 0 6 * * *", at("2026-10-21T06:00:00Z")), false);
  assert.equal(dueInSlot("TZ=America/Phoenix 0 6 * * *", at("2026-07-01T13:00:00Z")), true, "summer too");
  // Monthly: 03:00 UTC on the 1st only.
  assert.equal(dueInSlot("0 3 1 * *", at("2026-11-01T03:00:00Z")), true);
  assert.equal(dueInSlot("0 3 1 * *", at("2026-11-02T03:00:00Z")), false);
  // Daily at 07:30 UTC.
  assert.equal(dueInSlot("30 7 * * *", at("2026-10-21T07:30:00Z")), true);
  assert.equal(dueInSlot("30 7 * * *", at("2026-10-21T07:25:00Z")), false);
});

test("over a day every clock job is due exactly as often as its schedule says, and none is never due", () => {
  const dayStart = Date.parse("2026-10-21T00:00:00Z");
  const counts = new Map(CLOCK_JOBS.map(([job]) => [job, 0]));
  for (let t = dayStart; t < dayStart + DAY; t += SLOT_MS) {
    for (const { job } of dueJobs(new Date(t))) counts.set(job, counts.get(job) + 1);
  }
  for (const [job, cron] of CLOCK_JOBS) {
    const interval = cronIntervalMs(cron);
    if (interval == null) continue; // monthly: checked below
    assert.equal(counts.get(job), Math.round(DAY / interval), `${job} (${cron})`);
  }
  // Monthly jobs: due exactly once across a whole month.
  const monthly = CLOCK_JOBS.filter(([, cron]) => cronIntervalMs(cron) == null);
  assert.ok(monthly.length >= 1);
  const monthStart = Date.parse("2026-11-01T00:00:00Z");
  const monthEnd = Date.parse("2026-12-01T00:00:00Z");
  for (const [job, cron] of monthly) {
    let n = 0;
    for (let t = monthStart; t < monthEnd; t += SLOT_MS) if (dueInSlot(cron, new Date(t))) n += 1;
    assert.equal(n, 1, `${job} (${cron})`);
  }
});

test("slotOf floors to the 5-minute slot, so a late tick inside the slot is the same slot", () => {
  assert.equal(slotOf(at("2026-10-21T04:17:59Z")).toISOString(), "2026-10-21T04:15:00.000Z");
  assert.equal(slotOf(at("2026-10-21T04:15:00Z")).toISOString(), "2026-10-21T04:15:00.000Z");
});

test("a start signed by the clock for a fresh slot passes; anything else is refused", () => {
  const now = at("2026-10-21T04:16:00Z");
  const slot = "2026-10-21T04:15:00.000Z";
  const secret = "test-secret-not-real";
  const signature = sign(secret, "message-dispatch-sweeper", slot);
  assert.deepEqual(verifyStart({ secret, signature, job: "message-dispatch-sweeper", slot, now }), { ok: true });
  assert.equal(verifyStart({ secret: "other", signature, job: "message-dispatch-sweeper", slot, now }).why, "bad signature");
  assert.equal(verifyStart({ secret, signature, job: "daily-pulse", slot, now }).why, "bad signature", "a signature is for one job");
  assert.equal(verifyStart({ secret, signature: "abc", job: "message-dispatch-sweeper", slot, now }).why, "bad signature");
  assert.equal(verifyStart({ secret: "", signature, job: "message-dispatch-sweeper", slot, now }).why, "CRON_WORKER_SECRET is not set");
  assert.equal(verifyStart({ secret, signature: null, job: "message-dispatch-sweeper", slot, now }).why, "missing job, slot or signature");
  const late = new Date(Date.parse(slot) + STALE_SLOT_MS + 1000);
  assert.equal(verifyStart({ secret, signature, job: "message-dispatch-sweeper", slot, now: late }).why, "slot is not fresh");
  const early = new Date(Date.parse(slot) - SLOT_MS - 1000);
  assert.equal(verifyStart({ secret, signature, job: "message-dispatch-sweeper", slot, now: early }).why, "slot is not fresh");
});

/* A fake job_heartbeats writer: records each INSERT's params. */
function receiptDb() {
  const rows = [];
  return {
    rows,
    query: async (sql, params) => {
      assert.match(sql, /INSERT INTO job_heartbeats/);
      rows.push({ job: params[0], runner: params[1], outcome: params[4], error: params[6] });
      return { rows: [] };
    }
  };
}

const JOBS3 = Object.freeze([["every-five", "*/5 * * * *"], ["hourly-17", "17 * * * *"], ["daily", "30 7 * * *"]]);
const ENV = { URL: "https://fundhub.example", CRON_WORKER_SECRET: "test-secret-not-real" };

test("tick PASS: each due job is POSTed to the worker once, signed, and nothing else", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 202 });
  };
  const db = receiptDb();
  const r = await tick({ db, env: ENV, fetchImpl, now: at("2026-10-21T04:16:30Z"), jobs: JOBS3 });
  assert.equal(r.ok, true);
  assert.equal(r.slot, "2026-10-21T04:15:00.000Z");
  assert.equal(r.due, 2);
  assert.equal(r.started, 2);
  assert.equal(r.count, 2, "the clock's receipt counts the starts");
  assert.deepEqual(calls.map((c) => JSON.parse(c.init.body).job).sort(), ["every-five", "hourly-17"]);
  for (const c of calls) {
    assert.equal(c.url, `https://fundhub.example${WORKER_PATH}`);
    assert.equal(c.init.method, "POST");
    const body = JSON.parse(c.init.body);
    assert.equal(c.init.headers[AUTH_HEADER], sign(ENV.CRON_WORKER_SECRET, body.job, body.slot));
  }
  assert.deepEqual(db.rows, [], "a clean tick writes no job receipt (the worker does)");
});

test("tick FAIL: a start the worker refused, or that never answered, gets an error receipt naming why", async () => {
  const fetchImpl = async (url, init) => {
    const { job } = JSON.parse(init.body);
    if (job === "every-five") return new Response("no", { status: 500 });
    throw new Error("connect ETIMEDOUT");
  };
  const db = receiptDb();
  const r = await tick({ db, env: ENV, fetchImpl, now: at("2026-10-21T04:15:00Z"), jobs: JOBS3 });
  assert.equal(r.ok, false);
  assert.equal(r.started, 0);
  assert.deepEqual(r.failed.map((f) => f.job).sort(), ["every-five", "hourly-17"]);
  assert.deepEqual(db.rows.map((x) => [x.job, x.runner, x.outcome]).sort(),
    [["every-five", "netlify", "error"], ["hourly-17", "netlify", "error"]]);
  assert.match(db.rows.find((x) => x.job === "every-five").error, /could not start it: the worker answered 500/);
  assert.match(db.rows.find((x) => x.job === "hourly-17").error, /ETIMEDOUT/);
});

test("tick FAIL: with no secret nothing is sent, and every due job is marked red with the reason", async () => {
  let called = 0;
  const db = receiptDb();
  const r = await tick({ db, env: { URL: ENV.URL }, fetchImpl: async () => { called += 1; }, now: at("2026-10-21T07:30:00Z"), jobs: JOBS3 });
  assert.equal(called, 0);
  assert.equal(r.ok, false);
  assert.equal(r.error, "CRON_WORKER_SECRET is not set");
  assert.deepEqual(db.rows.map((x) => x.job).sort(), ["daily", "every-five"]);
  assert.ok(db.rows.every((x) => /CRON_WORKER_SECRET is not set/.test(x.error)));
});

test("tick: a slot with nothing due sends nothing and is ok", async () => {
  let called = 0;
  const r = await tick({ db: receiptDb(), env: ENV, fetchImpl: async () => { called += 1; }, now: at("2026-10-21T04:16:00Z"), jobs: [["daily", "30 7 * * *"]] });
  assert.equal(r.ok, true);
  assert.equal(r.due, 0);
  assert.equal(called, 0);
});

test("tick never throws on a bad cron: it reports it and starts nothing", async () => {
  const r = await tick({ db: receiptDb(), env: ENV, fetchImpl: async () => new Response(null, { status: 202 }), jobs: [["bad", "TZ=Mars/Base 0 0 * * *"]] });
  assert.equal(r.ok, false);
  assert.match(r.error, /time zone/);
});
