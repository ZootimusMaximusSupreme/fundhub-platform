// N/A conditions (zero-unchecked build, piece A). Every code has a test that passes
// (the condition is true, so "nothing to judge" may stand) and a test that fails for
// the right reason (the condition is false, so the row must not stay quiet).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NA_CONDITIONS, NA_CODES, isNaCode, naProblem, naSay, verifyNa
} from "./na-conditions.mjs";

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

test("the list of codes is closed: exactly these eight", () => {
  assert.deepEqual([...NA_CODES].sort(), [
    "low-traffic", "monthly-not-due", "no-demand", "no-real-lead",
    "no-running-ad", "no-trigger", "not-connected", "not-registered"
  ]);
  assert.equal(Object.isFrozen(NA_CONDITIONS), true);
  for (const code of NA_CODES) assert.equal(Object.isFrozen(NA_CONDITIONS[code]), true, code);
  assert.equal(isNaCode("no-demand"), true);
  assert.equal(isNaCode("whatever"), false);
  assert.equal(isNaCode("toString"), false, "an inherited property is not a code");
});

test("the four core codes verify here; the four lane codes say \"lane\"", () => {
  for (const code of ["no-demand", "no-trigger", "not-registered", "monthly-not-due"]) {
    assert.equal(typeof NA_CONDITIONS[code].verify, "function", code);
  }
  for (const code of ["no-running-ad", "low-traffic", "no-real-lead", "not-connected"]) {
    assert.equal(NA_CONDITIONS[code].verify, "lane", code);
  }
});

test("every reason sentence is short, plain, ends with a period, and spells Fundhub right", () => {
  const samples = {
    "no-demand": { names: ["round.started"], since: "2026-10-06T00:00:00.000Z" },
    "no-trigger": { id: "n-01-cold-nurture" },
    "not-registered": { id: "clarity-insights-sweeper" },
    "monthly-not-due": { cron: "0 12 1 * *" },
    "no-running-ad": {},
    "low-traffic": { count: 0, min: 360, what: "ad clicks", days: 2 },
    "no-real-lead": { days: 3 },
    "not-connected": { what: "YouTube" }
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

const NO_DEMAND = { code: "no-demand", args: { names: ["round.started", "round.funded"], since: "2026-10-06T00:00:00.000Z" } };

test("no-demand PASSES when the events table holds no row for the trigger names since then", async () => {
  const db = fakeDb(() => [{ n: 0 }]);
  const out = await verifyNa({ id: "wf:s-09", na: NO_DEMAND }, { db, now: NOW });
  assert.equal(out.ok, true);
  assert.match(out.reason, /no round\.started or round\.funded event since 10-05/);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].text, /FROM events/);
  assert.match(db.calls[0].text, /name = ANY/);
  assert.deepEqual(db.calls[0].params, [["round.started", "round.funded"], "2026-10-06T00:00:00.000Z"]);
});

test("no-demand takes since as a Date as well as ISO text, and asks the database in ISO text", async () => {
  const db = fakeDb(() => [{ n: 0 }]);
  const since = new Date("2026-10-06T00:00:00.000Z");
  const out = await verifyNa({ id: "wf:x", na: { code: "no-demand", args: { names: ["round.started"], since } } }, { db });
  assert.equal(out.ok, true);
  assert.equal(db.calls[0].params[1], "2026-10-06T00:00:00.000Z");
  const bad = await verifyNa({ id: "wf:x", na: { code: "no-demand", args: { names: ["round.started"], since: new Date("nope") } } }, { db });
  assert.equal(bad.ok, false);
});

test("no-demand reads the events table only, never a run-recorder table", async () => {
  const db = fakeDb(() => [{ n: 0 }]);
  await verifyNa({ id: "wf:x", na: NO_DEMAND }, { db });
  assert.doesNotMatch(db.calls[0].text, /workflow_runs|event_handoffs|job_heartbeats/);
});

test("no-demand FAILS when even one event came, so the row cannot hide", async () => {
  const db = fakeDb(() => [{ n: 1 }]);
  const out = await verifyNa({ id: "wf:s-09", na: NO_DEMAND }, { db });
  assert.equal(out.ok, false);
  assert.match(out.reason, /round\.started/);
});

test("no-demand FAILS with no names, a bad time, no database, or a read that throws", async () => {
  const db = fakeDb(() => [{ n: 0 }]);
  const bad = [
    { names: [], since: "2026-10-06T00:00:00.000Z" },
    { names: "round.started", since: "2026-10-06T00:00:00.000Z" },
    { names: ["round.started"], since: "last tuesday" },
    { names: ["round.started"] }
  ];
  for (const args of bad) {
    const out = await verifyNa({ id: "wf:x", na: { code: "no-demand", args } }, { db });
    assert.equal(out.ok, false, JSON.stringify(args));
    assert.match(out.reason, /proof for "no-demand"/);
  }
  assert.equal(db.calls.length, 0, "a row with bad args never reaches the database");
  assert.equal((await verifyNa({ id: "wf:x", na: NO_DEMAND }, {})).ok, false);
  const throwing = { query: async () => { throw new Error("connection reset"); } };
  const out = await verifyNa({ id: "wf:x", na: NO_DEMAND }, { db: throwing });
  assert.equal(out.ok, false);
  assert.match(out.reason, /read failed: connection reset/);
});

test("no-demand can read through the staff scope when there is no plain db", async () => {
  let ran = 0;
  const scope = async (run) => run({ query: async () => { ran += 1; return { rows: [{ n: 0 }] }; } });
  const out = await verifyNa({ id: "wf:x", na: NO_DEMAND }, { scope });
  assert.equal(out.ok, true);
  assert.equal(ran, 1);
});

/* ---------- no-trigger ---------- */

test("no-trigger PASSES for a function with no triggers, and for one switched off", async () => {
  const functions = [fn("n-01-cold-nurture"), fn("n-03-hot-nurture", { triggers: [{ event: "lead.hot" }], enabled: false })];
  for (const id of ["n-01-cold-nurture", "n-03-hot-nurture"]) {
    const out = await verifyNa({ id: `wf:${id}`, na: { code: "no-trigger", args: { id } } }, { functions });
    assert.equal(out.ok, true, id);
  }
});

test("no-trigger FAILS when the function has a live trigger, is missing, or the list is missing", async () => {
  const functions = [fn("s-00-welcome", { triggers: [{ event: "lead.created" }] })];
  const row = (id) => ({ id: `wf:${id}`, na: { code: "no-trigger", args: { id } } });
  assert.equal((await verifyNa(row("s-00-welcome"), { functions })).ok, false, "it has a trigger");
  assert.equal((await verifyNa(row("not-in-the-bundle"), { functions })).ok, false, "unknown function");
  assert.equal((await verifyNa(row("s-00-welcome"), {})).ok, false, "no function list");
  assert.equal((await verifyNa({ id: "x", na: { code: "no-trigger", args: {} } }, { functions })).ok, false, "no id");
});

/* ---------- not-registered ---------- */

test("not-registered PASSES when the id is not in the bundled list", async () => {
  const functions = [fn("a"), fn("b")];
  const out = await verifyNa({ id: "x", na: { code: "not-registered", args: { id: "clarity-insights-sweeper" } } }, { functions });
  assert.equal(out.ok, true);
});

test("not-registered FAILS when the id IS in the list, and when there is no list to look at", async () => {
  const functions = [fn("clarity-insights-sweeper")];
  const row = { id: "x", na: { code: "not-registered", args: { id: "clarity-insights-sweeper" } } };
  assert.equal((await verifyNa(row, { functions })).ok, false);
  assert.equal((await verifyNa(row, {})).ok, false, "no list, no claim");
  assert.equal((await verifyNa(row, { functions: "nope" })).ok, false);
});

/* ---------- monthly-not-due ---------- */

const MONTHLY = { id: "job:affiliate-payout-run", na: { code: "monthly-not-due", args: { cron: "0 12 1 * *" } } };

test("monthly-not-due PASSES when the first receipt came after the last due time", async () => {
  // At 2026-10-09 the last due time was 2026-10-01 12:00 UTC.
  const db = fakeDb(() => [{ first_at: "2026-10-05T06:00:00.000Z" }]);
  const out = await verifyNa(MONTHLY, { db, now: NOW });
  assert.equal(out.ok, true);
  assert.match(db.calls[0].text, /min\(finished_at\)/);
  assert.match(db.calls[0].text, /FROM job_heartbeats/);
});

test("monthly-not-due FAILS when receipts began before the last due time: that run should be there", async () => {
  const db = fakeDb(() => [{ first_at: "2026-09-20T06:00:00.000Z" }]);
  assert.equal((await verifyNa(MONTHLY, { db, now: NOW })).ok, false);
});

test("monthly-not-due FAILS on an empty receipts table, a non-monthly schedule, and a throwing read", async () => {
  assert.equal((await verifyNa(MONTHLY, { db: fakeDb(() => [{ first_at: null }]), now: NOW })).ok, false);
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
  assert.equal((await verifyNa(MONTHLY, { db, now: later })).ok, false, "11-01 12:00 came and went with receipts running");
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

test("each of the four lane codes stands on a lane's true and falls on its false", async () => {
  for (const code of ["no-running-ad", "low-traffic", "no-real-lead", "not-connected"]) {
    const row = { id: `gap-x:${code}`, sliceId: "gap-x", na: { code, args: { count: 0, min: 360 } } };
    const up = await verifyNa(row, { laneNaVerify: async (_slice, c) => c === code });
    const down = await verifyNa(row, { laneNaVerify: async () => false });
    assert.equal(up.ok, true, `${code} true`);
    assert.equal(down.ok, false, `${code} false`);
    assert.ok(down.reason.length > 0 && !/^\s*$/.test(down.reason), `${code} says what is not true`);
  }
});

test("a lane code FAILS when the lane has no verifier, or there is no way to ask", async () => {
  const row = { id: "gap-leads:lead:x", sliceId: "gap-leads", na: { code: "low-traffic", args: { count: 1, min: 360 } } };
  const none = await verifyNa(row, { laneNaVerify: async () => undefined });
  assert.equal(none.ok, false);
  assert.match(none.reason, /lane being able to re-check/);
  assert.equal((await verifyNa(row, {})).ok, false);
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
