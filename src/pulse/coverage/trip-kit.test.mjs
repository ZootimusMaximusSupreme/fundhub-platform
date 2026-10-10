// The trip walker, both ways. A broken trip must go red and name the step. A trip waiting on a
// person or on the customer must NOT go red. Pure tests: no database.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BY, SHOWN, buildSharedCount, defaultOrg, judgeTrip, makeNaVerify, realClientSql, sharedCount, skipRow, span,
  walkTrip, whoIs
} from "./trip-kit.mjs";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-10T18:00:00.000Z");
const ago = (ms) => new Date(NOW.getTime() - ms);

const STEPS = Object.freeze([
  { key: "paid", label: "paid", by: BY.CLIENT },
  { key: "card", label: "the card", by: BY.SYSTEM, from: "paid", graceMs: HOUR },
  { key: "call", label: "the call", by: BY.PERSON },
  { key: "docs", label: "the documents", by: BY.CLIENT },
  { key: "letters", label: "the letters", by: BY.SYSTEM, from: "docs", graceMs: 30 * MIN, required: false },
  { key: "mailed", label: "the mailing", by: BY.PERSON },
  { key: "bill", label: "the bill", by: BY.SYSTEM, from: "mailed", graceMs: 30 * MIN }
]);

function walk(facts, extra = {}) {
  return walkTrip({ steps: STEPS, facts, now: NOW, ...extra });
}

test("walkTrip: every step reached is finished", () => {
  const facts = {};
  for (const s of STEPS) facts[s.key] = ago(5 * DAY);
  const w = walk(facts);
  assert.equal(w.state, "finished");
  assert.equal(w.doneCount, STEPS.length);
  assert.equal(w.step, null);
});

test("walkTrip: a system step past its wait is broken and names the step", () => {
  const w = walk({ paid: ago(3 * HOUR) });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "card");
  assert.match(w.why, /"paid" was 3 hours ago and "the card" is owed within 1 hour of it/);
});

test("walkTrip: a system step inside its wait is waiting, not broken", () => {
  const w = walk({ paid: ago(20 * MIN) });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "card");
  assert.equal(w.waitingOn.by, BY.SYSTEM);
});

test("walkTrip: the wait is exact (at the limit still waits, one minute past is broken)", () => {
  assert.equal(walk({ paid: ago(HOUR) }).state, "waiting");
  assert.equal(walk({ paid: ago(HOUR + MIN) }).state, "broken");
});

test("walkTrip: a customer waiting on the client or on a person is never red", () => {
  const onClient = walk({ paid: ago(30 * DAY), card: ago(30 * DAY) });
  assert.equal(onClient.state, "waiting");
  assert.equal(onClient.step.key, "call");
  assert.equal(onClient.step.by, BY.PERSON);

  const longWait = walk({ paid: ago(90 * DAY), card: ago(90 * DAY), call: ago(80 * DAY) });
  assert.equal(longWait.state, "waiting");
  assert.equal(longWait.step.key, "docs");
  assert.equal(longWait.step.by, BY.CLIENT);
});

test("walkTrip: a late hand-off behind a client step is still found (every missing system step is judged)", () => {
  // the call is not held (a person step is first missing), but the card owed after paying is 3 hours late
  const w = walk({ paid: ago(3 * HOUR) });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "card");

  // the letters are owed 30 minutes after the documents, and the call step is missing before them
  const later = walk({ paid: ago(10 * DAY), card: ago(10 * DAY), docs: ago(2 * HOUR) });
  assert.equal(later.state, "broken");
  assert.equal(later.step.key, "letters");
});

test("walkTrip: a system step whose own anchor is missing cannot be late", () => {
  const w = walk({ paid: ago(10 * DAY), card: ago(10 * DAY) });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "call");
});

test("walkTrip: a required step skipped is broken at once, however young", () => {
  const steps = STEPS.map((s) => (s.key === "docs" ? { ...s, required: true } : s));
  const w = walkTrip({ steps, facts: { paid: ago(MIN), card: ago(MIN), letters: ago(MIN) }, now: NOW });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "docs");
  assert.match(w.why, /"the letters" is there, but "the documents" never happened/);
});

test("walkTrip: a step that is not required and was skipped is only waiting", () => {
  const w = walk({ paid: ago(MIN), card: ago(MIN), mailed: ago(MIN) });
  assert.notEqual(w.state, "broken");
});

test("walkTrip: the board shows a step with no fact behind it is broken", () => {
  const w = walk({ paid: ago(5 * DAY), card: ago(5 * DAY), "mailed:claim": true });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "mailed");
  assert.match(w.why, /the board shows "the mailing" but no record backs it up/);
});

test("walkTrip: a claim that has its fact is fine", () => {
  const w = walk({ paid: ago(5 * DAY), card: ago(5 * DAY), mailed: ago(DAY), bill: ago(DAY), "mailed:claim": true });
  // The call and the documents were skipped on the way and are not required, so nothing is waited on.
  assert.equal(w.state, "finished");
});

test("walkTrip: a step this customer does not owe is skipped, even for a system hand-off", () => {
  const w = walk({ paid: ago(10 * DAY) }, { notOwed: ["card"] });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "call");
  assert.equal(w.owedCount, STEPS.length - 1);
});

test("walkTrip: an ended trip is not red", () => {
  const w = walk({ paid: ago(30 * DAY) }, { ended: { why: "the Sales card is on Lost" } });
  assert.equal(w.state, "ended");
  assert.match(w.why, /Lost/);
});

test("walkTrip: a stall the code defines turns a person step red", () => {
  const w = walk({ paid: ago(5 * DAY), card: ago(5 * DAY) }, {
    stall: { key: "call", why: "the file sat in the stage past its 3-day clock" }
  });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "call");
  assert.match(w.why, /3-day clock/);
});

test("walkTrip: a stall on a step already reached is ignored", () => {
  const w = walk({ paid: ago(5 * DAY), card: ago(5 * DAY), call: ago(DAY) }, {
    stall: { key: "call", why: "late" }
  });
  assert.notEqual(w.state, "broken");
});

test("walkTrip: a fact that is true with no time counts as reached but cannot start a clock", () => {
  const w = walk({ paid: true });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "card");
});

test("walkTrip: facts set to false or null are missing", () => {
  const w = walk({ paid: false, card: null });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "paid");
});

test("walkTrip: a stall with no key lands on the step after the furthest one reached", () => {
  const w = walk({ paid: ago(5 * DAY), card: ago(5 * DAY), call: ago(4 * DAY) }, { stall: { why: "stuck in the stage" } });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "docs");
  assert.equal(w.why, "stuck in the stage");
});

test("walkTrip: detail words are added to the reason of the step that is broken, and only that one", () => {
  const w = walk({ paid: ago(3 * HOUR) }, { detail: { card: "the board has no row for it", docs: "not this one" } });
  assert.equal(w.state, "broken");
  assert.match(w.why, /owed within 1 hour of it\. the board has no row for it$/);
});

test("walkTrip: an anchor that is not a step is named by its fromLabel", () => {
  const steps = [
    { key: "a", label: "first", by: BY.CLIENT },
    { key: "b", label: "second", by: BY.SYSTEM, from: "hidden", fromLabel: "the thing that happened", graceMs: HOUR }
  ];
  const w = walkTrip({ steps, facts: { a: ago(DAY), hidden: ago(3 * HOUR) }, now: NOW });
  assert.equal(w.state, "broken");
  assert.match(w.why, /^"the thing that happened" was 3 hours ago and "second"/);
});

/* ---- judgeTrip ---- */

function trip(facts, who = "FH-1", extra = {}) {
  return { who, facts, ...extra };
}

test("judgeTrip: nobody started is a verified nothing-to-judge with the low-traffic code", () => {
  const r = judgeTrip({ id: "trip:x", tripName: "x", steps: STEPS, rows: [], now: NOW, windowDays: 60 });
  assert.equal(r.status, "na");
  assert.equal(r.na.code, "low-traffic");
  assert.deepEqual(r.na.args, { check: "trip:x", count: 0, min: 1, what: "x trips started", days: 60 });
});

test("judgeTrip: a broken trip is FAIL, names the customer and the step, and carries the fix", () => {
  const r = judgeTrip({
    id: "trip:x", tripName: "x", steps: STEPS, now: NOW, windowDays: 60, fix: "Read the file.",
    rows: [trip({ paid: ago(3 * HOUR) }, "FH-9"), trip({ paid: ago(3 * HOUR), card: ago(2 * HOUR), call: ago(HOUR), docs: ago(MIN) }, "FH-8")]
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /^1 of 2 customers who started the x trip in the last 60 days is stuck/);
  assert.match(r.detail, /FH-9 stopped at "the card"/);
  assert.ok(!/FH-8/.test(r.detail));
  assert.equal(r.suggestedFix, "Read the file.");
});

test("judgeTrip: waiting customers are PASS, counted by step", () => {
  const r = judgeTrip({
    id: "trip:x", tripName: "x", steps: STEPS, now: NOW, windowDays: 60,
    rows: [
      trip({ paid: ago(20 * DAY), card: ago(20 * DAY) }, "A"),
      trip({ paid: ago(20 * DAY), card: ago(20 * DAY) }, "B"),
      trip({ paid: ago(20 * DAY), card: ago(20 * DAY), call: ago(10 * DAY) }, "C")
    ]
  });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /3 customers started the x trip/);
  assert.match(r.detail, /3 waiting \(2 at "the call", 1 at "the documents"\)/);
  assert.match(r.detail, /None is stuck on a step the company owes/);
});

test("judgeTrip: finished and ended are counted", () => {
  const all = {};
  for (const s of STEPS) all[s.key] = ago(10 * DAY);
  const r = judgeTrip({
    id: "trip:x", tripName: "x", steps: STEPS, now: NOW, windowDays: 60,
    rows: [trip(all, "A"), trip({ paid: ago(30 * DAY) }, "B", { ended: { why: "lost" } })]
  });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /1 finished, 0 waiting, 1 ended/);
});

test("judgeTrip: a list that fills the cap says so", () => {
  const rows = [];
  for (let i = 0; i < 3; i += 1) rows.push(trip({ paid: ago(10 * DAY), card: ago(10 * DAY) }, `C${i}`));
  const r = judgeTrip({ id: "trip:x", tripName: "x", steps: STEPS, rows, now: NOW, cap: 3 });
  assert.match(r.detail, /the first 3, oldest first/);
});

test("judgeTrip: a long list of broken trips shows a few names and the count of the rest", () => {
  const rows = [];
  for (let i = 0; i < SHOWN + 3; i += 1) rows.push(trip({ paid: ago(5 * HOUR) }, `FH-${i}`));
  const r = judgeTrip({ id: "trip:x", tripName: "x", steps: STEPS, rows, now: NOW });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /7 of 7 customers/);
  assert.match(r.detail, /and 3 more/);
});

/* ---- naVerify ---- */

test("makeNaVerify: true only while the same read still finds nobody", async () => {
  const run = async (fn) => fn({});
  const common = { id: "trip:x", runnerOf: () => run, nowOf: () => NOW, defaultOrg: async () => "org" };
  const none = makeNaVerify({ ...common, countStarted: async () => 0 })["low-traffic"];
  assert.equal(await none({ check: "trip:x" }, { orgId: "o" }), true);
  const some = makeNaVerify({ ...common, countStarted: async () => 2 })["low-traffic"];
  assert.equal(await some({ check: "trip:x" }, { orgId: "o" }), false);
  const boom = makeNaVerify({ ...common, countStarted: async () => { throw new Error("db down"); } })["low-traffic"];
  assert.equal(await boom({ check: "trip:x" }, { orgId: "o" }), false);
});

test("makeNaVerify: a proof about another check, or with no way to read, is false", async () => {
  const run = async (fn) => fn({});
  const v = makeNaVerify({ id: "trip:x", countStarted: async () => 0, runnerOf: () => run, nowOf: () => NOW, defaultOrg: async () => "org" })["low-traffic"];
  assert.equal(await v({ check: "trip:y" }, { orgId: "o" }), false);
  assert.equal(await v(null, { orgId: "o" }), false);
  const noRun = makeNaVerify({ id: "trip:x", countStarted: async () => 0, runnerOf: () => null, nowOf: () => NOW, defaultOrg: async () => "org" })["low-traffic"];
  assert.equal(await noRun({ check: "trip:x" }, { orgId: "o" }), false);
  const noOrg = makeNaVerify({ id: "trip:x", countStarted: async () => 0, runnerOf: () => run, nowOf: () => NOW, defaultOrg: async () => null })["low-traffic"];
  assert.equal(await noOrg({ check: "trip:x" }, {}), false);
});

test("defaultOrg: reads the default org, and answers null when it cannot", async () => {
  assert.equal(await defaultOrg(async (fn) => fn({ query: async () => ({ rows: [{ id: "abc" }] }) })), "abc");
  assert.equal(await defaultOrg(async () => { throw new Error("x"); }), null);
  assert.equal(await defaultOrg(async (fn) => fn({ query: async () => ({ rows: [] }) })), null);
});

/* ---- small pieces ---- */

test("span: minutes, hours, days in plain words", () => {
  assert.equal(span(30 * MIN), "30 minutes");
  assert.equal(span(MIN), "1 minute");
  assert.equal(span(HOUR), "1 hour");
  assert.equal(span(90 * MIN), "90 minutes");
  assert.equal(span(5 * HOUR), "5 hours");
  assert.equal(span(3 * DAY), "3 days");
});

test("whoIs: the client code, else the first 8 of the id", () => {
  assert.equal(whoIs({ client_code: "FH-000123" }), "FH-000123");
  assert.equal(whoIs({ client_id: "12345678-aaaa-bbbb-cccc-1234567890ab" }), "12345678");
  assert.equal(whoIs({}), "an unknown customer");
});

test("skipRow is a skip with the reason, never a PASS", () => {
  const r = skipRow("trip:x", "no database in this run");
  assert.equal(r.status, "skip");
  assert.match(r.detail, /no database/);
});

test("realClientSql leaves out demo, synthetic, test-address and archived clients", () => {
  const sql = realClientSql("c", "$3");
  assert.match(sql, /c\.is_demo/);
  assert.match(sql, /synthetic/);
  assert.match(sql, /!~\* \$3::text/);
  assert.match(sql, /crm_archived_at/);
});

/* ---- the shared light count ---- */

function twoLanes() {
  return new Map([
    ["trip:a", { sql: "/* gap:a-count */ SELECT count(*)::int AS n FROM t WHERE org = $1::uuid AND at >= $2::timestamptz", paramsFor: (o, now) => [o, now.toISOString()] }],
    ["trip:b", { sql: "/* gap:b-count */ SELECT count(*)::int AS n FROM u WHERE org = $1::uuid AND name !~* $2::text AND at >= $3::timestamptz", paramsFor: (o, now) => [o, "x+", now.toISOString()] }]
  ]);
}

test("buildSharedCount: one SELECT, a column per trip, each lane's placeholders moved past the last", () => {
  const b = buildSharedCount("org-1", NOW, twoLanes());
  assert.deepEqual(b.ids, ["trip:a", "trip:b"]);
  assert.match(b.sql, /^\/\* gap:trip-counts \*\/\s+SELECT \(SELECT count\(\*\)::int AS n FROM t WHERE org = \$1::uuid AND at >= \$2::timestamptz\) AS "trip:a"/);
  assert.match(b.sql, /org = \$3::uuid AND name !~\* \$4::text AND at >= \$5::timestamptz\) AS "trip:b"/);
  assert.deepEqual(b.params, ["org-1", NOW.toISOString(), "org-1", "x+", NOW.toISOString()]);
  assert.ok(!/gap:a-count|gap:b-count/.test(b.sql), "the lane comments are dropped");
});

test("sharedCount: five re-checks cost one read, and each lane gets its own number", async () => {
  const registry = twoLanes();
  const seen = [];
  const db = {};
  const run = async (fn) => fn({ async query(sql, params) { seen.push({ sql, params }); return { rows: [{ "trip:a": 0, "trip:b": 3 }] }; } });
  const own = async () => { throw new Error("must not be called"); };
  const a = await sharedCount({ run, key: db, id: "trip:a", orgId: "o", now: NOW, own, registry });
  const b = await sharedCount({ run, key: db, id: "trip:b", orgId: "o", now: NOW, own, registry });
  assert.equal(a, 0);
  assert.equal(b, 3);
  assert.equal(seen.length, 1);
});

test("sharedCount: a later run (another now) reads again, never a stale answer", async () => {
  const registry = twoLanes();
  let n = 0;
  const db = {};
  const run = async (fn) => fn({ async query() { n += 1; return { rows: [{ "trip:a": n, "trip:b": 0 }] }; } });
  const own = async () => -1;
  const first = await sharedCount({ run, key: db, id: "trip:a", orgId: "o", now: NOW, own, registry });
  const later = await sharedCount({ run, key: db, id: "trip:a", orgId: "o", now: new Date(NOW.getTime() + 1000), own, registry });
  assert.equal(first, 1);
  assert.equal(later, 2);
});

test("sharedCount: a failed shared read, a trip nobody registered, or no key falls back to the lane's own count", async () => {
  const registry = twoLanes();
  const run = async () => { throw new Error("relation \"u\" does not exist"); };
  const own = async () => 7;
  assert.equal(await sharedCount({ run, key: {}, id: "trip:a", orgId: "o", now: NOW, own, registry }), 7);
  assert.equal(await sharedCount({ run: async (fn) => fn({ query: async () => ({ rows: [{}] }) }), key: {}, id: "trip:z", orgId: "o", now: NOW, own, registry }), 7);
  assert.equal(await sharedCount({ run, key: null, id: "trip:a", orgId: "o", now: NOW, own, registry }), 7);
});

test("makeNaVerify hands the run context to the count so the shared read can be keyed", async () => {
  let got = null;
  const ctx = { orgId: "o", marker: true };
  const v = makeNaVerify({
    id: "trip:x", runnerOf: () => async (fn) => fn({}), nowOf: () => NOW, defaultOrg: async () => "org",
    countStarted: async (run, orgId, now, c) => { got = c; return 0; }
  })["low-traffic"];
  assert.equal(await v({ check: "trip:x" }, ctx), true);
  assert.equal(got, ctx);
});
