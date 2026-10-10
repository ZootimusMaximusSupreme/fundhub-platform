// N/A conditions (zero-unchecked build, piece A). Every code has a test that passes
// (the condition is true, so "nothing to judge" may stand) and a test that fails for
// the right reason (the condition is false, so the row must not stay quiet).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NA_CONDITIONS, NA_CODES, NO_DEMAND_MIN_WINDOW_MS, isNaCode, naProblem, naSay, verifyNa
} from "./na-conditions.mjs";
import { JOBS } from "./heartbeats.mjs";

const NOW = new Date("2026-10-09T18:00:00Z");

/* A fake db. `answer` is a function of (text, params) -> rows. Every call is kept. */
function fakeDb(answer) {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return { rows: answer(text, params) };
    }
  };
}

const fn = (id, opts = {}) => ({ opts: { id, triggers: [], ...opts } });

test("the list of codes is closed: exactly these ten", () => {
  assert.deepEqual([...NA_CODES].sort(), [
    "low-traffic", "monthly-not-due", "no-demand", "no-real-lead",
    "no-running-ad", "no-sender", "no-trigger", "no-work-waiting", "not-connected", "not-registered"
  ]);
  assert.equal(Object.isFrozen(NA_CONDITIONS), true);
  for (const code of NA_CODES) assert.equal(Object.isFrozen(NA_CONDITIONS[code]), true, code);
  assert.equal(isNaCode("no-demand"), true);
  assert.equal(isNaCode("whatever"), false);
  assert.equal(isNaCode("toString"), false, "an inherited property is not a code");
});

test("the five core codes verify here; the five lane codes say \"lane\"", () => {
  for (const code of ["no-demand", "no-trigger", "not-registered", "monthly-not-due", "no-work-waiting"]) {
    assert.equal(typeof NA_CONDITIONS[code].verify, "function", code);
  }
  for (const code of ["no-running-ad", "low-traffic", "no-real-lead", "not-connected", "no-sender"]) {
    assert.equal(NA_CONDITIONS[code].verify, "lane", code);
  }
});

test("every reason sentence is short, plain, ends with a period, and spells Fundhub right", () => {
  const samples = {
    "no-demand": { names: ["round.started"], since: "2026-10-06T00:00:00.000Z" },
    "no-trigger": { id: "n-01-cold-nurture" },
    "not-registered": { id: "clarity-insights-sweeper" },
    "monthly-not-due": { cron: "0 12 1 * *" },
    "no-work-waiting": { what: "worker" },
    "no-running-ad": {},
    "low-traffic": { count: 0, min: 360, what: "ad clicks", days: 2 },
    "no-real-lead": { days: 3 },
    "not-connected": { what: "YouTube" },
    "no-sender": { count: 158, days: 7 }
  };
  for (const code of NA_CODES) {
    const text = NA_CONDITIONS[code].say(samples[code], NOW);
    assert.ok(text && text.endsWith("."), `${code}: ${text}`);
    for (const sentence of text.split(/(?<=\.)\s+/)) {
      assert.ok(sentence.split(/\s+/).length <= 20, `${code}: sentence too long: ${sentence}`);
    }
    assert.doesNotMatch(text, /FundHub/);
    // A code must be able to say its sentence with no args at all and not throw.
    assert.ok(typeof NA_CONDITIONS[code].say() === "string", code);
  }
  assert.equal(
    NA_CONDITIONS["no-demand"].say(samples["no-demand"]),
    "No round.started event came since 10-05. Judged the day one comes.",
    "the date is Chris's clock (Arizona), so midnight UTC on 10-06 is still 10-05"
  );
  assert.equal(
    NA_CONDITIONS["low-traffic"].say(samples["low-traffic"]),
    "Only 0 ad clicks in 2 days. Needs 360 to judge."
  );
  assert.equal(NA_CONDITIONS["monthly-not-due"].say(samples["monthly-not-due"], NOW), "Runs once a month. Its last due time came before receipts began. First judged 11-01.");
});

/* ---------- no-demand ---------- */

/* The bundled list the audit hands in. A wf: row is judged against its own function. */
const FUNCS = [
  fn("s-09", { triggers: [{ event: "round.started" }, { event: "round.funded" }] }),
  fn("s-00-welcome", { triggers: [{ event: "lead.created" }] }),
  fn("nightly", { triggers: [{ cron: "0 9 * * *" }] }),
  fn("n-01-cold-nurture")
];

const NO_DEMAND = { code: "no-demand", args: { names: ["round.started", "round.funded"], since: "2026-10-06T00:00:00.000Z" } };
const WF_ROW = { id: "wf:s-09", na: NO_DEMAND };
const eventsDb = (counts = {}) => fakeDb(() => Object.entries(counts).map(([name, n]) => ({ name, n })));

test("no-demand PASSES when the events table holds no row for the trigger names since then", async () => {
  // Other events came, but none that start this workflow.
  const db = eventsDb({ "lead.created": 5 });
  const out = await verifyNa(WF_ROW, { db, now: NOW, functions: FUNCS });
  assert.equal(out.ok, true);
  assert.equal(out.reason, "No round.started or round.funded event since 10-05.");
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].text, /FROM events/);
  assert.match(db.calls[0].text, /GROUP BY name/);
  assert.deepEqual(db.calls[0].params, ["2026-10-06T00:00:00.000Z"]);
});

test("no-demand takes since as a Date as well as ISO text, and asks the database in ISO text", async () => {
  const db = eventsDb();
  const since = new Date("2026-10-06T00:00:00.000Z");
  const row = { id: "wf:s-00-welcome", na: { code: "no-demand", args: { names: ["lead.created"], since } } };
  const out = await verifyNa(row, { db, now: NOW, functions: FUNCS });
  assert.equal(out.ok, true);
  assert.equal(db.calls[0].params[0], "2026-10-06T00:00:00.000Z");
  const bad = { id: "wf:s-00-welcome", na: { code: "no-demand", args: { names: ["lead.created"], since: new Date("nope") } } };
  assert.equal((await verifyNa(bad, { db, now: NOW, functions: FUNCS })).ok, false);
});

test("no-demand reads the events table only, never a run-recorder table", async () => {
  const db = eventsDb();
  await verifyNa(WF_ROW, { db, now: NOW, functions: FUNCS });
  assert.doesNotMatch(db.calls[0].text, /workflow_runs|event_handoffs|job_heartbeats/);
});

test("no-demand FAILS when even one event came, and says what came", async () => {
  const one = await verifyNa(WF_ROW, { db: eventsDb({ "round.started": 1 }), now: NOW, functions: FUNCS });
  assert.equal(one.ok, false);
  assert.equal(one.reason, "1 round.started event came since 10-05.");
  const two = await verifyNa(WF_ROW, { db: eventsDb({ "round.started": 2, "round.funded": 1 }), now: NOW, functions: FUNCS });
  assert.equal(two.ok, false);
  assert.equal(two.reason, "2 round.started and 1 round.funded events came since 10-05.");
  const second = await verifyNa(WF_ROW, { db: eventsDb({ "round.funded": 4 }), now: NOW, functions: FUNCS });
  assert.equal(second.ok, false, "any one of the names is enough");
  assert.equal(second.reason, "4 round.funded events came since 10-05.");
});

test("no-demand FAILS with no names, a bad time, no database, or a read that throws", async () => {
  const db = eventsDb();
  const bad = [
    { names: [], since: "2026-10-06T00:00:00.000Z" },
    { names: "round.started", since: "2026-10-06T00:00:00.000Z" },
    { names: ["round.started"], since: "last tuesday" },
    { names: ["round.started"] }
  ];
  for (const args of bad) {
    const out = await verifyNa({ id: "wf:s-09", na: { code: "no-demand", args } }, { db, now: NOW, functions: FUNCS });
    assert.equal(out.ok, false, JSON.stringify(args));
    assert.match(out.reason, /proof for "no-demand"/);
  }
  assert.equal(db.calls.length, 0, "a row with bad args never reaches the database");
  assert.equal((await verifyNa(WF_ROW, { now: NOW, functions: FUNCS })).ok, false);
  const throwing = { query: async () => { throw new Error("connection reset"); } };
  const out = await verifyNa(WF_ROW, { db: throwing, now: NOW, functions: FUNCS });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "The read failed: connection reset.");
});

test("no-demand reads through the staff scope when there is no plain db, and prefers it when both are there", async () => {
  let scoped = 0;
  const scope = async (run) => run({ query: async () => { scoped += 1; return { rows: [] }; } });
  const out = await verifyNa(WF_ROW, { scope, now: NOW, functions: FUNCS });
  assert.equal(out.ok, true);
  assert.equal(scoped, 1);
  // The producer read through the scope, so the verifier reads what the producer read.
  const db = eventsDb({ "round.started": 9 });
  const both = await verifyNa(WF_ROW, { scope, db, now: NOW, functions: FUNCS });
  assert.equal(both.ok, true, "the scope said no events; the plain db is not asked");
  assert.equal(scoped, 2);
  assert.equal(db.calls.length, 0);
});

test("no-demand FAILS when the look-back window is under a day, so the check cannot be starved", async () => {
  const db = eventsDb({ "round.started": 3 }); // events exist: the honest window would fail
  const honest = await verifyNa(WF_ROW, { db, now: NOW, functions: FUNCS });
  assert.equal(honest.ok, false, "the honest window sees the events");
  const calls = db.calls.length;
  const day = NO_DEMAND_MIN_WINDOW_MS;
  const windows = [
    new Date(NOW.getTime() + 365 * day).toISOString(), // 2027, a clock or sign bug
    "2099-01-01T00:00:00Z",
    NOW.toISOString(), // since = now
    new Date(NOW.getTime() - 60 * 1000).toISOString(), // a minute
    new Date(NOW.getTime() - day + 1).toISOString() // one millisecond short of a day
  ];
  for (const since of windows) {
    const row = { id: "wf:s-09", na: { code: "no-demand", args: { names: ["round.started", "round.funded"], since } } };
    const out = await verifyNa(row, { db: eventsDb(), now: NOW, functions: FUNCS });
    assert.equal(out.ok, false, since);
    assert.match(out.reason, /window is under a day/, since);
  }
  const empty = eventsDb();
  await verifyNa({ id: "wf:s-09", na: { code: "no-demand", args: { names: ["round.started", "round.funded"], since: NOW.toISOString() } } }, { db: empty, now: NOW, functions: FUNCS });
  assert.equal(empty.calls.length, 0, "a window that is too short is refused before any read");
  assert.equal(db.calls.length, calls);
  // A window of exactly a day is the shortest that can stand, and no clock in ctx means the real clock.
  const exact = { id: "wf:s-09", na: { code: "no-demand", args: { names: ["round.started", "round.funded"], since: new Date(NOW.getTime() - day).toISOString() } } };
  assert.equal((await verifyNa(exact, { db: eventsDb(), now: NOW, functions: FUNCS })).ok, true);
  const noClock = { id: "wf:s-09", na: { code: "no-demand", args: { names: ["round.started", "round.funded"], since: "2099-01-01T00:00:00Z" } } };
  assert.equal((await verifyNa(noClock, { db: eventsDb(), functions: FUNCS })).ok, false, "the real clock is used when ctx has none");
});

test("no-demand FAILS when the proof is about another workflow, or other events", async () => {
  const db = eventsDb();
  const ctx = { db, now: NOW, functions: FUNCS };
  const since = NO_DEMAND.args.since;
  const row = (id, names) => ({ id, na: { code: "no-demand", args: { names, since } } });
  // a misspelled event name that never fires
  const typo = await verifyNa(row("wf:s-09", ["round.startd", "round.funded"]), ctx);
  assert.equal(typo.ok, false);
  assert.equal(typo.reason, "round.startd does not start s-09.");
  // a real event name that belongs to a different workflow
  const other = await verifyNa(row("wf:s-09", ["lead.created", "round.started", "round.funded"]), ctx);
  assert.equal(other.ok, false);
  assert.equal(other.reason, "lead.created does not start s-09.");
  // only one of the workflow's two events: the other could be busy
  const partial = await verifyNa(row("wf:s-09", ["round.started"]), ctx);
  assert.equal(partial.ok, false);
  assert.equal(partial.reason, "s-09 also starts on round.funded. The row did not check it.");
  // a workflow that has no event trigger is a no-trigger row, not a no-demand row
  assert.equal((await verifyNa(row("wf:nightly", ["round.started"]), ctx)).ok, false);
  assert.equal((await verifyNa(row("wf:n-01-cold-nurture", ["round.started"]), ctx)).ok, false);
  // not in the bundle, not a wf: row, or no list to look at (an empty list is no list)
  assert.match((await verifyNa(row("wf:ghost", ["x.y"]), ctx)).reason, /ghost is not in the workflow list/);
  assert.match((await verifyNa(row("x", ["round.started", "round.funded"]), ctx)).reason, /only fits a workflow row/);
  assert.match((await verifyNa(row("job:s-09", ["round.started", "round.funded"]), ctx)).reason, /only fits a workflow row/);
  assert.match((await verifyNa(WF_ROW, { db, now: NOW })).reason, /no workflow list/);
  assert.match((await verifyNa(WF_ROW, { db, now: NOW, functions: [] })).reason, /no workflow list/);
  assert.equal(db.calls.length, 0, "a proof about the wrong row never reaches the database");
  // and the honest row still stands
  assert.equal((await verifyNa(WF_ROW, ctx)).ok, true);
});

test("no-demand answers every workflow row of one run with ONE read, and never shares a read between runs", async () => {
  const functions = Array.from({ length: 60 }, (_, i) => fn(`wf-${i}`, { triggers: [{ event: `evt.${i}` }] }));
  const since = "2026-10-06T00:00:00.000Z";
  const db = eventsDb({ "evt.7": 2 });
  const ctx = { db, now: NOW, functions };
  const rows = functions.map((f, i) => ({ id: `wf:wf-${i}`, na: { code: "no-demand", args: { names: [`evt.${i}`], since } } }));
  const outs = await Promise.all(rows.map((r) => verifyNa(r, ctx)));
  assert.equal(db.calls.length, 1, "60 rows, one read");
  assert.equal(outs.filter((o) => o.ok).length, 59);
  assert.equal(outs[7].ok, false);
  assert.equal(outs[7].reason, "2 evt.7 events came since 10-05.");
  // a different window is a different question
  const later = { id: "wf:wf-1", na: { code: "no-demand", args: { names: ["evt.1"], since: "2026-10-07T00:00:00.000Z" } } };
  await verifyNa(later, ctx);
  assert.equal(db.calls.length, 2);
  // a new run (a new ctx) reads again: yesterday's answer is never reused
  await verifyNa(rows[0], { db, now: NOW, functions });
  assert.equal(db.calls.length, 3);
  // a failed read fails every row of that run the same way
  const throwing = { query: async () => { throw new Error("boom"); } };
  const bad = await Promise.all(rows.slice(0, 3).map((r) => verifyNa(r, { db: throwing, now: NOW, functions })));
  assert.deepEqual(bad.map((o) => o.ok), [false, false, false]);
});

/* ---------- no-trigger ---------- */

test("no-trigger PASSES for a function with no triggers, and for one switched off", async () => {
  const functions = [fn("n-01-cold-nurture"), fn("n-03-hot-nurture", { triggers: [{ event: "lead.hot" }], enabled: false })];
  for (const id of ["n-01-cold-nurture", "n-03-hot-nurture"]) {
    const out = await verifyNa({ id: `wf:${id}`, na: { code: "no-trigger", args: { id } } }, { functions });
    assert.equal(out.ok, true, id);
    assert.equal(out.reason, `${id} has no trigger.`);
  }
});

test("no-trigger FAILS when the function has a live trigger, is missing, or the list is missing", async () => {
  const functions = [fn("s-00-welcome", { triggers: [{ event: "lead.created" }] })];
  const row = (id) => ({ id: `wf:${id}`, na: { code: "no-trigger", args: { id } } });
  const live = await verifyNa(row("s-00-welcome"), { functions });
  assert.equal(live.ok, false, "it has a trigger");
  assert.equal(live.reason, "s-00-welcome has 1 trigger and is switched on.");
  assert.equal((await verifyNa(row("not-in-the-bundle"), { functions })).ok, false, "unknown function");
  assert.equal((await verifyNa(row("s-00-welcome"), {})).ok, false, "no function list");
  assert.equal((await verifyNa(row("s-00-welcome"), { functions: [] })).ok, false, "an empty list");
  assert.equal((await verifyNa({ id: "x", na: { code: "no-trigger", args: {} } }, { functions })).ok, false, "no id");
});

test("no-trigger FAILS when the proof names a different workflow than the row", async () => {
  // n-01 really is dark, but this row is s-00-welcome, which is live.
  const functions = [fn("n-01-cold-nurture"), fn("s-00-welcome", { triggers: [{ event: "lead.created" }] })];
  const borrowed = { id: "wf:s-00-welcome", na: { code: "no-trigger", args: { id: "n-01-cold-nurture" } } };
  const out = await verifyNa(borrowed, { functions });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "This row is for s-00-welcome, not n-01-cold-nurture.");
  const own = { id: "wf:n-01-cold-nurture", na: { code: "no-trigger", args: { id: "n-01-cold-nurture" } } };
  assert.equal((await verifyNa(own, { functions })).ok, true);
});

/* ---------- not-registered ---------- */

test("not-registered PASSES when the id is not in the bundled list", async () => {
  const functions = [fn("a"), fn("b")];
  const out = await verifyNa({ id: "x", na: { code: "not-registered", args: { id: "clarity-insights-sweeper" } } }, { functions });
  assert.equal(out.ok, true);
  assert.equal(out.reason, "clarity-insights-sweeper is not in the workflow list.");
});

test("not-registered FAILS when the id IS in the list, and when there is no list to look at", async () => {
  const functions = [fn("clarity-insights-sweeper")];
  const row = { id: "x", na: { code: "not-registered", args: { id: "clarity-insights-sweeper" } } };
  const inList = await verifyNa(row, { functions });
  assert.equal(inList.ok, false);
  assert.equal(inList.reason, "clarity-insights-sweeper is in the workflow list.");
  assert.equal((await verifyNa(row, {})).ok, false, "no list, no claim");
  assert.equal((await verifyNa(row, { functions: "nope" })).ok, false);
});

test("not-registered treats an empty list as no list: a made-up id is not 'not switched on'", async () => {
  const madeUp = { id: "anything-made-up", na: { code: "not-registered", args: { id: "anything-made-up" } } };
  const empty = await verifyNa(madeUp, { functions: [] });
  assert.equal(empty.ok, false);
  assert.match(empty.reason, /no workflow list/);
  assert.equal((await verifyNa(madeUp, { functions: [fn("a")] })).ok, true, "with a real list the same claim stands");
});

/* ---------- monthly-not-due ---------- */

const PAYOUT = JOBS.find((j) => j.job === "affiliate-payout-run");
const FLOOR = JOBS.find((j) => j.job === "partner-production-floor");
const MONTHLY = { id: `job:${PAYOUT.job}`, na: { code: "monthly-not-due", args: { cron: PAYOUT.cron } } };

test("monthly-not-due PASSES when the first receipt came after the last due time", async () => {
  // At 2026-10-09 the last due time of "0 3 1 * *" was 2026-10-01 03:00 UTC.
  assert.equal(PAYOUT.cron, "0 3 1 * *", "this test is written for the payout schedule on the job list");
  const db = fakeDb(() => [{ first_at: "2026-10-05T06:00:00.000Z" }]);
  const out = await verifyNa(MONTHLY, { db, now: NOW });
  assert.equal(out.ok, true);
  assert.equal(out.reason, "The first job receipt came after the last due time.");
  assert.match(db.calls[0].text, /min\(finished_at\)/);
  assert.match(db.calls[0].text, /FROM job_heartbeats/);
  const floor = { id: `job:${FLOOR.job}`, na: { code: "monthly-not-due", args: { cron: FLOOR.cron } } };
  assert.equal((await verifyNa(floor, { db, now: NOW })).ok, true, "the other monthly job on the list");
});

test("monthly-not-due FAILS when receipts began before the last due time: that run should be there", async () => {
  const db = fakeDb(() => [{ first_at: "2026-09-20T06:00:00.000Z" }]);
  const out = await verifyNa(MONTHLY, { db, now: NOW });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "The first job receipt is from 09-19. The job was due 09-30, so a run should be there.");
});

test("monthly-not-due FAILS on an empty receipts table, a non-monthly schedule, and a throwing read", async () => {
  const none = await verifyNa(MONTHLY, { db: fakeDb(() => [{ first_at: null }]), now: NOW });
  assert.equal(none.ok, false);
  assert.equal(none.reason, "No job receipt is on file at all.");
  assert.equal((await verifyNa(MONTHLY, { db: fakeDb(() => []), now: NOW })).ok, false);
  const every5 = { id: "job:x", na: { code: "monthly-not-due", args: { cron: "*/5 * * * *" } } };
  const db = fakeDb(() => [{ first_at: "2026-10-05T06:00:00.000Z" }]);
  assert.equal((await verifyNa(every5, { db, now: NOW })).ok, false);
  assert.equal(db.calls.length, 0, "a schedule that is not monthly never reaches the database");
  const throwing = { query: async () => { throw new Error("boom"); } };
  assert.equal((await verifyNa(MONTHLY, { db: throwing, now: NOW })).ok, false);
});

test("monthly-not-due uses the clock it is given: after the next due time the same receipt fails", async () => {
  const db = fakeDb(() => [{ first_at: "2026-10-05T06:00:00.000Z" }]);
  const later = new Date("2026-11-02T00:00:00Z");
  assert.equal((await verifyNa(MONTHLY, { db, now: later })).ok, false, "11-01 03:00 came and went with receipts running");
});

test("monthly-not-due FAILS when the cron is not the job's own cron, so a made-up schedule cannot borrow time", async () => {
  const db = fakeDb(() => [{ first_at: "2026-10-05T06:00:00.000Z" }]);
  // The payout job is due on the 1st at 03:00. A cron of the 4th puts "last due" after the receipt.
  for (const cron of ["0 0 1 * *", "0 0 4 * *", "0 3 4 * *", "0 14 1 * *"]) {
    const row = { id: `job:${PAYOUT.job}`, na: { code: "monthly-not-due", args: { cron } } };
    const out = await verifyNa(row, { db, now: NOW });
    assert.equal(out.ok, false, cron);
    assert.match(out.reason, /not the real schedule of affiliate-payout-run/, cron);
  }
  assert.equal(db.calls.length, 0, "a proof about the wrong schedule never reaches the database");
  // a job that is not on the job list, and a row that is not a job row
  const ghost = { id: "job:not-a-job", na: { code: "monthly-not-due", args: { cron: "0 3 1 * *" } } };
  assert.match((await verifyNa(ghost, { db, now: NOW })).reason, /not-a-job is not on the job list/);
  const notJob = { id: "wf:affiliate-payout-run", na: { code: "monthly-not-due", args: { cron: "0 3 1 * *" } } };
  assert.match((await verifyNa(notJob, { db, now: NOW })).reason, /only fits a job row/);
  assert.equal((await verifyNa({ id: "x", na: MONTHLY.na }, { db, now: NOW })).ok, false);
  assert.equal(db.calls.length, 0);
});

/* ---------- lane codes ---------- */

test("a lane code is answered by the lane: true stands, false does not, and the lane gets the right arguments", async () => {
  const seen = [];
  const make = (answer) => async (sliceId, code, args) => { seen.push([sliceId, code, args]); return answer; };
  const row = { id: "gap-ads:ads-running-no-metrics", sliceId: "gap-ads", na: { code: "no-running-ad", args: { running: 0 } } };
  assert.equal((await verifyNa(row, { laneNaVerify: make(true) })).ok, true);
  assert.equal((await verifyNa(row, { laneNaVerify: make(false) })).ok, false);
  assert.deepEqual(seen[0], ["gap-ads", "no-running-ad", { running: 0 }]);
});

test("each of the five lane codes stands on a lane's true and falls on its false", async () => {
  for (const code of ["no-running-ad", "low-traffic", "no-real-lead", "not-connected", "no-sender"]) {
    const row = { id: `gap-x:${code}`, sliceId: "gap-x", na: { code, args: { count: 0, min: 360 } } };
    const up = await verifyNa(row, { laneNaVerify: async (_slice, c) => c === code });
    const down = await verifyNa(row, { laneNaVerify: async () => false });
    assert.equal(up.ok, true, `${code} true`);
    assert.equal(down.ok, false, `${code} false`);
    assert.ok(down.reason.length > 0 && !/^\s*$/.test(down.reason), `${code} says what is not true`);
    assert.equal(down.reason, "The lane looked again and found something to judge.", `${code} says what was found`);
    assert.match(up.reason, /\.$/, `${code} true reason is a sentence`);
  }
});

test("a lane code FAILS when the lane has no verifier, or there is no way to ask", async () => {
  const row = { id: "gap-leads:lead:x", sliceId: "gap-leads", na: { code: "low-traffic", args: { count: 1, min: 360 } } };
  const none = await verifyNa(row, { laneNaVerify: async () => undefined });
  assert.equal(none.ok, false);
  assert.match(none.reason, /lane has no way to check this again/);
  const noDoor = await verifyNa(row, {});
  assert.equal(noDoor.ok, false);
  assert.match(noDoor.reason, /no way to ask the lane/);
  assert.equal((await verifyNa(row, { laneNaVerify: async () => { throw new Error("lane crashed"); } })).ok, false);
  // Only `true` stands. A truthy non-boolean does not.
  assert.equal((await verifyNa(row, { laneNaVerify: async () => 1 })).ok, false);
});

test("the lane is found from the row id when the row has no sliceId, and a row with neither is refused", async () => {
  const seen = [];
  const laneNaVerify = async (sliceId) => { seen.push(sliceId); return true; };
  const noSlice = { id: "gap-social:social:video-stats-stale", na: { code: "not-connected", args: {} } };
  assert.equal((await verifyNa(noSlice, { laneNaVerify })).ok, true);
  assert.deepEqual(seen, ["gap-social"]);
  const orphan = { id: "nocolonhere", na: { code: "not-connected", args: {} } };
  assert.equal((await verifyNa(orphan, { laneNaVerify })).ok, false);
});

/* ---------- the door itself ---------- */

test("an unknown code, a missing na object, or args that are not a plain object are ok:false", async () => {
  const db = fakeDb(() => [{ n: 0 }]);
  assert.equal((await verifyNa({ id: "x", na: { code: "because-i-said-so", args: {} } }, { db })).ok, false);
  assert.equal((await verifyNa({ id: "x", na: { code: "toString", args: {} } }, { db })).ok, false);
  assert.equal((await verifyNa({ id: "x" }, { db })).ok, false);
  assert.equal((await verifyNa(null, { db })).ok, false);
  assert.equal((await verifyNa({ id: "x", na: { code: "no-demand", args: [] } }, { db })).ok, false);
  assert.equal((await verifyNa({ id: "x", na: { code: "no-demand" } }, { db })).ok, false);
  assert.equal(db.calls.length, 0);
});

test("verifyNa never throws, whatever it is handed", async () => {
  for (const row of [undefined, null, 5, "x", {}, { na: null }, { na: { code: {}, args: {} } }, { na: { code: "no-demand", args: { names: [1], since: {} } } }]) {
    const out = await verifyNa(row, undefined);
    assert.equal(out.ok, false);
    assert.equal(typeof out.reason, "string");
  }
});

test("every reason, true or not, is a short plain sentence, and the audit's line reads cleanly after it", async () => {
  const funcs = [fn("live", { triggers: [{ event: "a.b" }] }), ...FUNCS];
  const cases = [
    [{ id: "x" }, {}],
    [{ id: "x", na: { code: "nope", args: {} } }, {}],
    [{ id: "x", na: { code: "no-demand", args: "x" } }, {}],
    [{ id: "wf:s-09", na: { code: "no-demand", args: { names: [], since: "2026-10-06T00:00:00Z" } } }, {}],
    [WF_ROW, { db: eventsDb({ "round.started": 3 }), now: NOW, functions: funcs }],
    [WF_ROW, { db: eventsDb(), now: NOW }],
    [{ id: "wf:s-09", na: { code: "no-demand", args: { names: ["round.started", "round.funded"], since: NOW.toISOString() } } }, { db: eventsDb(), now: NOW, functions: funcs }],
    [{ id: "wf:live", na: { code: "no-trigger", args: { id: "live" } } }, { functions: funcs }],
    [{ id: "x", na: { code: "not-registered", args: { id: "live" } } }, { functions: funcs }],
    [MONTHLY, { db: fakeDb(() => [{ first_at: "2026-09-01T06:00:00.000Z" }]), now: NOW }],
    [{ id: "gap-x:y", na: { code: "low-traffic", args: {} } }, { laneNaVerify: async () => false }],
    [{ id: "gap-x:y", na: { code: "low-traffic", args: {} } }, {}],
    [MONTHLY, { db: { query: async () => { throw new Error("connection reset by the other side"); } }, now: NOW }]
  ];
  for (const [row, ctx] of cases) {
    const out = await verifyNa(row, ctx);
    assert.equal(out.ok, false, JSON.stringify(row));
    assert.match(out.reason, /^[A-Za-z0-9"].*\.$/, `starts with a word and ends with a period: ${out.reason}`);
    for (const sentence of out.reason.split(/(?<=\.)\s+/)) {
      assert.ok(sentence.split(/\s+/).length <= 22, `sentence too long: ${sentence}`);
    }
    assert.doesNotMatch(out.reason, /FundHub|\bundefined\b|\[object|NaN/);
  }
  // On a failed no-demand the reason says what was FOUND. The audit writes:
  //   Said nothing to judge, but "<row detail>" is not true. <reason>
  // so the reason must add a fact and must not repeat the claim.
  const found = await verifyNa(WF_ROW, { db: eventsDb({ "round.started": 3 }), now: NOW, functions: funcs });
  assert.doesNotMatch(found.reason, /^No /i);
  assert.match(found.reason, /^3 round\.started events came/);
});

test("naProblem names why an na object is not usable, and is null for a good one", () => {
  assert.equal(naProblem(NO_DEMAND), null);
  assert.equal(naProblem({ code: "no-running-ad", args: {} }), null);
  assert.match(naProblem(undefined), /no na object/);
  assert.match(naProblem({ code: "nope", args: {} }), /not on the list/);
  assert.match(naProblem({ code: "no-demand", args: "x" }), /plain object/);
  assert.match(naProblem({ code: "no-demand", args: {} }), /names/);
  const circular = {};
  circular.self = circular;
  assert.match(naProblem({ code: "no-running-ad", args: circular }), /cannot be saved/);
});

test("naSay gives the code's sentence, and a plain fallback for a code it does not know", () => {
  assert.match(naSay({ code: "no-running-ad", args: {} }), /^No ad is running/);
  assert.equal(naSay({ code: "nope", args: {} }), "Nothing to judge today.");
  assert.equal(naSay(undefined), "Nothing to judge today.");
});

/* ---- no-work-waiting: the marketing worker rows ---- */

const waitingScope = (work) => async (fn) => fn({ async query() { return { rows: [work] }; } });
const NONE = { outbox_waiting: 0, buzzes_due: 0, jobs_due: 0, stale_claims: 0 };

test("no-work-waiting: still true when nothing waits (worker and drain)", async () => {
  const scope = waitingScope(NONE);
  for (const what of ["worker", "outbox_drain"]) {
    const v = await verifyNa({ id: `03-marketing:${what}`, na: { code: "no-work-waiting", args: { what } } }, { scope });
    assert.equal(v.ok, true, what);
  }
});

test("no-work-waiting: goes false the moment work waits, and says what it saw", async () => {
  const scope = waitingScope({ ...NONE, outbox_waiting: 2 });
  const drain = await verifyNa({ id: "03-marketing:outbox_drain", na: { code: "no-work-waiting", args: { what: "outbox_drain" } } }, { scope });
  assert.equal(drain.ok, false);
  assert.match(drain.reason, /2 repo saves are waiting/);
  const worker = await verifyNa({ id: "03-marketing:worker", na: { code: "no-work-waiting", args: { what: "worker" } } }, { scope });
  assert.equal(worker.ok, false);
});

test("no-work-waiting: a proof for one beat cannot sit on another row", async () => {
  const scope = waitingScope(NONE);
  const v = await verifyNa({ id: "03-marketing:worker", na: { code: "no-work-waiting", args: { what: "outbox_drain" } } }, { scope });
  assert.equal(v.ok, false);
  const other = await verifyNa({ id: "wf:s-09", na: { code: "no-work-waiting", args: { what: "worker" } } }, { scope });
  assert.equal(other.ok, false);
  assert.equal(naProblem({ code: "no-work-waiting", args: { what: "nonsense" } }) !== null, true);
});
