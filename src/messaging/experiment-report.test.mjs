// Message tests: the verdict and its maths (src/messaging/experiment-report.mjs). No database. The
// counting itself is experiment-report.pg.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  twoSidedP, twoProportionTest, judge, experimentReport, REPORT_SQL, COUNTED_STATUSES, SIGNIFICANCE
} from "./experiment-report.mjs";
import { EXPERIMENTS, MIN_PER_ARM } from "./experiments.mjs";

const arm = (reached, people, waiting = 0) => ({ reached, people, waiting });
const call = (A, B, over = {}) => judge({
  goal: "booking.created", windowDays: 7, startedAt: "2026-11-10T16:00:00.000Z", earlierPeople: 0, arms: { A, B }, ...over
});

describe("the normal curve", () => {
  test("the chance of a gap this big by luck, at the well-known points", () => {
    assert.equal(twoSidedP(0), 1);
    assert.ok(Math.abs(twoSidedP(1) - 0.3173105) < 1e-6);
    assert.ok(Math.abs(twoSidedP(1.959964) - 0.05) < 1e-6);
    assert.ok(Math.abs(twoSidedP(2.5758293) - 0.01) < 1e-6);
    assert.ok(Math.abs(twoSidedP(3) - 0.0026998) < 1e-6);
  });

  test("it does not care which side the gap is on, and it never leaves 0 to 1", () => {
    for (const z of [0.2, 1, 1.96, 2.5, 4, 9]) assert.equal(twoSidedP(-z), twoSidedP(z));
    assert.equal(twoSidedP(60), 0);
    assert.equal(twoSidedP(NaN), null);
    assert.equal(twoSidedP(Infinity), null);
  });
});

describe("the two-proportion test", () => {
  test("30 of 100 against 18 of 100 is a z of about 1.99 and a p of about 0.047", () => {
    const r = twoProportionTest(30, 100, 18, 100);
    assert.ok(Math.abs(r.z - 1.9868) < 1e-3);
    assert.ok(Math.abs(r.p - 0.04694) < 1e-4);
  });

  test("the sign says which side is ahead", () => {
    assert.ok(twoProportionTest(30, 100, 18, 100).z > 0);
    assert.ok(twoProportionTest(18, 100, 30, 100).z < 0);
  });

  test("it makes no test when it cannot: an empty side, or nobody or everybody reached", () => {
    assert.equal(twoProportionTest(0, 0, 3, 10), null);
    assert.equal(twoProportionTest(3, 10, 0, 0), null);
    assert.equal(twoProportionTest(0, 40, 0, 40), null);
    assert.equal(twoProportionTest(40, 40, 40, 40), null);
  });
});

describe("what the report says", () => {
  test("before any version B message has gone out there is nothing to compare", () => {
    const v = call(arm(0, 0), arm(0, 0), { startedAt: null });
    assert.equal(v.winner, null);
    assert.equal(v.p, null);
    assert.equal(v.text, "Version B has not gone out yet, so there is nothing to compare.");
  });

  test("and it says what happened to the people who got A before that", () => {
    assert.equal(call(arm(0, 0), arm(0, 0), { startedAt: null, earlierPeople: 12 }).text,
      "Version B has not gone out yet, so there is nothing to compare. " +
      "The 12 people who got version A so far are not counted; the count starts when B goes out.");
    assert.match(call(arm(0, 0), arm(0, 0), { startedAt: null, earlierPeople: 1 }).text, /The 1 person who got version A/);
  });

  test("the board's own example: B ahead, not enough people yet to call it", () => {
    const v = call(arm(8, 41), arm(12, 40));
    assert.equal(v.winner, null);
    assert.ok(Math.abs(v.p - 0.2738) < 1e-3, "40 and 41 people: the test is made, and a gap this size is easily luck");
    assert.equal(v.text, "B is ahead: 12 of 40 booked (30%) vs 8 of 41 (20%). Not enough people yet to call it.");
  });

  test("under 30 a side no test is made at all", () => {
    const v = call(arm(8, 21), arm(12, 22));
    assert.equal(v.winner, null);
    assert.equal(v.p, null);
    assert.equal(v.text, "B is ahead: 12 of 22 booked (55%) vs 8 of 21 (38%). Not enough people yet to call it.");
  });

  test("the goal is said in its own words", () => {
    assert.match(call(arm(3, 20), arm(5, 20), { goal: "survey.completed" }).text, /^B is ahead: 5 of 20 finished the survey \(25%\) vs 3 of 20 \(15%\)\./);
    assert.match(call(arm(3, 20), arm(5, 20), { goal: "something.else" }).text, /5 of 20 reached the goal/);
  });

  test("A can be ahead too, and the leader is always named first", () => {
    const v = call(arm(14, 40), arm(6, 40));
    assert.match(v.text, /^A wins: 14 of 40 booked \(35%\) vs 6 of 40 \(15%\)\./);
    assert.equal(v.winner, "A");
  });

  test("a clear gap with enough people names the winner, and says why it can be trusted", () => {
    const v = call(arm(10, 40), arm(25, 40));
    assert.equal(v.winner, "B");
    assert.ok(v.p < SIGNIFICANCE);
    assert.equal(v.text, "B wins: 25 of 40 booked (63%) vs 10 of 40 (25%). That gap is big enough to trust.");
  });

  test("enough people but a gap luck could explain names nobody", () => {
    const v = call(arm(20, 40), arm(23, 40));
    assert.equal(v.winner, null);
    assert.ok(v.p > SIGNIFICANCE);
    assert.equal(v.text, "B is ahead: 23 of 40 booked (58%) vs 20 of 40 (50%). Not enough people yet to call it.");
  });

  test("the 95 percent line is the line: p of 0.053 is no winner, p of 0.037 is", () => {
    const close = call(arm(20, 100), arm(32, 100));
    assert.ok(close.p > 0.05 && close.p < 0.06, String(close.p));
    assert.equal(close.winner, null);
    const clear = call(arm(20, 100), arm(33, 100));
    assert.ok(clear.p < 0.05 && clear.p > 0.03, String(clear.p));
    assert.equal(clear.winner, "B");
  });

  test("each side needs 30 people: 29 is not enough however big the gap", () => {
    assert.equal(MIN_PER_ARM, 30);
    const short = call(arm(6, 29), arm(15, 30));
    assert.equal(short.winner, null);
    assert.equal(short.p, null);
    assert.match(short.text, /Not enough people yet to call it\.$/);
    const enough = call(arm(6, 30), arm(15, 30));
    assert.equal(enough.winner, "B");
    assert.ok(enough.p < 0.05);
    const otherSide = call(arm(6, 30), arm(15, 29));
    assert.equal(otherSide.winner, null);
  });

  test("an even race is said to be even, and never has a winner", () => {
    const small = call(arm(4, 20), arm(8, 40));
    assert.equal(small.winner, null);
    assert.equal(small.text, "A and B are even so far: 4 of 20 booked (20%) vs 8 of 40 (20%). Not enough people yet to call it.");
    const big = call(arm(10, 40), arm(10, 40));
    assert.equal(big.winner, null);
    assert.equal(big.text, "A and B are even so far: 10 of 40 booked (25%) vs 10 of 40 (25%). Not enough people yet to call it.");
  });

  test("no one reaching the goal on either side is not a winner either", () => {
    const v = call(arm(0, 40), arm(0, 40));
    assert.equal(v.winner, null);
    assert.equal(v.p, null);
  });

  test("an empty side is said plainly", () => {
    const v = call(arm(0, 0), arm(3, 9));
    assert.equal(v.winner, null);
    assert.equal(v.text, "Not enough people yet to call it. Version A has 0 people and version B has 9 people so far.");
    assert.match(call(arm(1, 1), arm(0, 0)).text, /Version A has 1 person and version B has 0 people/);
  });

  test("people still inside their days are counted and named, so the numbers are not taken for final", () => {
    const v = call(arm(8, 41, 5), arm(12, 40, 4));
    assert.equal(v.text,
      "B is ahead: 12 of 40 booked (30%) vs 8 of 41 (20%). Not enough people yet to call it. " +
      "9 of these 81 people still have days left in their 7 days, so the numbers can still move.");
    assert.ok(!/days left/.test(call(arm(8, 41, 0), arm(12, 40, 0)).text));
  });

  test("it never reads like a decision was made for anyone", () => {
    for (const v of [call(arm(10, 40), arm(25, 40)), call(arm(8, 41), arm(12, 40)), call(arm(0, 0), arm(0, 0), { startedAt: null })]) {
      assert.ok(!/switch|turn off|stop sending|use B from now|replace/i.test(v.text), v.text);
    }
  });
});

describe("the one SELECT", () => {
  test("it is a single read-only statement that starts with the marker", () => {
    assert.ok(REPORT_SQL.startsWith("/* message-tests:report */"));
    assert.ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT)\b/i.test(REPORT_SQL.replace(/\/\*[\s\S]*?\*\//g, "")));
    assert.ok(!/;\s*\S/.test(REPORT_SQL), "one statement, not two");
    assert.ok(!/\bSET\b/.test(REPORT_SQL.replace(/\/\*[\s\S]*?\*\//g, "")), "no SET anywhere");
  });

  test("messages that never reached the person do not count", () => {
    assert.deepEqual([...COUNTED_STATUSES], ["queued", "sending", "sent", "delivered", "complained"]);
    for (const bad of ["failed", "blocked", "bounced"]) assert.ok(!COUNTED_STATUSES.includes(bad), bad);
  });

  test("experimentReport asks once, with the tests, the counted statuses and the clock, and fills in the empty ones", async () => {
    const asked = [];
    const db = { query: async (sql, params) => { asked.push({ sql, params }); return { rows: [] }; } };
    const now = new Date("2026-11-20T12:00:00Z");
    const tests = await experimentReport(db, { orgId: "11111111-2222-4333-8444-555555555555", now });
    assert.equal(asked.length, 1);
    assert.equal(asked[0].sql, REPORT_SQL);
    const [orgId, json, statuses, at] = asked[0].params;
    assert.equal(orgId, "11111111-2222-4333-8444-555555555555");
    assert.deepEqual(JSON.parse(json), [
      { name: "resume-proof", goal: "survey.completed", window_days: 7,
        a_keys: ["SMS-S02-RESUME-2", "EMAIL-S02-RESUME-2"], b_keys: ["SMS-S02-RESUME-2-B", "EMAIL-S02-RESUME-2-B"] },
      { name: "nobook-proof", goal: "booking.created", window_days: 7,
        a_keys: ["SMS-NOBOOK-02", "EMAIL-NOBOOK-02"], b_keys: ["SMS-NOBOOK-02-B", "EMAIL-NOBOOK-02-B"] }
    ]);
    assert.deepEqual(statuses, [...COUNTED_STATUSES]);
    assert.equal(at, "2026-11-20T12:00:00.000Z");
    assert.deepEqual(tests.map((t) => t.name), EXPERIMENTS.map((e) => e.name));
    for (const t of tests) {
      assert.deepEqual(t.arms, { A: { people: 0, reached: 0, waiting: 0 }, B: { people: 0, reached: 0, waiting: 0 } });
      assert.equal(t.started_at, null);
      assert.equal(t.earlier_people, 0);
      assert.equal(t.verdict.winner, null);
    }
  });

  test("it turns the rows into the answer, whatever order they come in", async () => {
    const started = new Date("2026-11-10T16:00:00Z");
    const db = { query: async () => ({ rows: [
      { name: "nobook-proof", arm: "earlier", people: 2, reached: 1, waiting: 0, started_at: started },
      { name: "nobook-proof", arm: "B", people: "4", reached: "3", waiting: "1", started_at: started },
      { name: "nobook-proof", arm: "A", people: 6, reached: 2, waiting: 0, started_at: started }
    ] }) };
    const [resume, nobook] = await experimentReport(db, { orgId: "o", now: new Date("2026-11-20T00:00:00Z") });
    assert.equal(resume.name, "resume-proof");
    assert.equal(resume.started_at, null);
    assert.equal(nobook.started_at, "2026-11-10T16:00:00.000Z");
    assert.equal(nobook.earlier_people, 2);
    assert.deepEqual(nobook.arms, { A: { people: 6, reached: 2, waiting: 0 }, B: { people: 4, reached: 3, waiting: 1 } });
    assert.equal(nobook.goal, "booking.created");
    assert.equal(nobook.window_days, 7);
    assert.equal(nobook.min_per_arm, 30, "the page can say how many each side needs");
    assert.equal(nobook.label, "Never-booked chase, message 2: real proof or not");
  });

  test("it refuses to run without a company or a real clock", async () => {
    const db = { query: async () => ({ rows: [] }) };
    await assert.rejects(experimentReport(db, {}), /orgId/);
    await assert.rejects(experimentReport(db, { orgId: "o", now: "not a date" }), /real date/);
  });
});
