import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-call-bookings.mjs";
import * as truth from "./lib/calls-truth.mjs";
import * as identity from "./lib/calls-identity.mjs";
import * as lane from "../coverage/gap-calls.mjs";
import { classifyVisitor } from "../../slo/visitor.mjs";
import { emailLooksLikeProveSim } from "../../messaging/gate.mjs";
import { isTestEmail, testEmailTag } from "../../demo/test-identity.mjs";
import { isInterviewBooking } from "../../insights/meet.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { SELF_TEST_NOW, laneSelfTest } from "./lib/money-hourly.mjs";
import { loadBeats } from "./index.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const HOUR = 60 * 60 * 1000;
const at = (ms) => new Date(SELF_TEST_NOW.getTime() + ms).toISOString();

/** One booking.created event, seen `seenAgo` before the self-test clock, for a call `startsIn` after it. */
function booking(n, { email = `pat${n}@gmail.com`, seenAgo = 5 * HOUR, startsIn = 24 * HOUR, link = null, extra = {} } = {}) {
  return {
    id: String(n),
    name: "booking.created",
    created_at: at(-seenAgo),
    payload: { bookingUid: `uid-${n}`, email, startTime: at(startsIn), ...(link ? { meetingUrl: link } : {}), ...extra }
  };
}

/** The pass rows with some answers replaced. */
function spec(overrides) {
  return laneSelfTest({ ...beat.LANE, selfTest: { passRows: beat.LANE.selfTest.passRows, failRows: overrides } }, true);
}

test("call-bookings is valid, goes green on no booked call and red at the outcome step", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-call-bookings.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true);
  assert.match(passed.detail, /^2 booked-call checks passed$/);
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "calls-booked-no-outcome");
  assert.match(failed.detail, /1 booked call ended with no outcome/);
  assert.deepEqual(failed.steps.map((step) => step.name), beat.steps);
});

test("call-bookings: a booked call ahead with no join link is red at the join-link step, before the outcome step", async () => {
  const result = await runBeat(beat, makeFakeCtx(beat, spec([[truth.JOIN_EVENTS_SQL, [booking(1)]]])));
  assert.equal(result.ok, false);
  assert.equal(result.step, "calls-booked-no-join-link");
  assert.match(result.detail, /1 booked call still ahead has no join link anywhere in our data \(next: p\*\*\*@gmail\.com/);
  assert.deepEqual(result.steps.map((step) => step.name), ["read", "calls-booked-no-join-link"]);
});

test("call-bookings: bookings first seen before join links were kept are not judged as a dead feed", async () => {
  // JOIN_FEED_SINCE (owner 2026-10-21: "Old bookings do not matter. Only new bookings."). The self-test clock is
  // 2026-10-09, so three past bookings with no link are before the cut-off: the feed is not judged, the beat is green.
  const old = [1, 2, 3].map((n) => booking(n, { seenAgo: 40 * 24 * HOUR, startsIn: -39 * 24 * HOUR }));
  const result = await runBeat(beat, makeFakeCtx(beat, spec([[truth.JOIN_EVENTS_SQL, old]])));
  assert.notEqual(result.step, "calls-booked-no-join-link");
});

test("call-bookings: the dead feed the beat runs goes red before any customer is hit (bookings after the cut-off)", async () => {
  // The same function the beat calls, with the cut-off moved before the fixture, as the lane test does.
  const old = [1, 2, 3].map((n) => booking(n, { seenAgo: 40 * 24 * HOUR, startsIn: -39 * 24 * HOUR }));
  const db = { query: async (sql) => ({ rows: sql === truth.JOIN_EVENTS_SQL ? old : [] }) };
  const row = await truth.bookedNoJoinLink({
    db, orgId: "11111111-1111-4111-8111-111111111111", now: SELF_TEST_NOW, feedSince: new Date(0)
  });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /0 of the newest 3 real bookings carried a join link/);
  const cut = await truth.bookedNoJoinLink({ db, orgId: "11111111-1111-4111-8111-111111111111", now: SELF_TEST_NOW });
  assert.notEqual(cut.status, "FAIL", "with the real cut-off these old bookings are not judged");
});

test("call-bookings: a link on the event, a tester, an interview or a fresh booking is not red", async () => {
  const cases = [
    [booking(1, { link: "https://meet.google.com/abc-defg-hij" })],
    [booking(2, { email: "chris+fhtest@gmail.com" })],
    [booking(3, { email: "someone@fundhub.ai" })],
    [booking(4, { extra: { eventTypeTitle: "Post-funding interview" } })],
    [booking(5, { seenAgo: 5 * 60 * 1000 })]
  ];
  for (const events of cases) {
    const result = await runBeat(beat, makeFakeCtx(beat, spec([[truth.JOIN_EVENTS_SQL, events]])));
    assert.equal(result.ok, true, `${JSON.stringify(events[0].payload)}: ${result.detail}`);
  }
});

test("call-bookings: a read that fails is never green", async () => {
  const failing = {
    ...beat.selfTest.pass(),
    read: async (sql) => {
      if (/SELECT id FROM orgs/.test(sql)) return { rows: [{ id: "00000000-0000-4000-8000-000000000001" }], rowCount: 1 };
      throw new Error("statement timeout");
    }
  };
  const result = await runBeat(beat, makeFakeCtx(beat, failing));
  // The join-link read is a skip with the reason (the lane's rule); the outcome read is a FAIL (its rule).
  assert.equal(result.ok, false);
  assert.equal(result.step, "calls-booked-no-outcome");
  assert.match(result.detail, /booked-call read failed: statement timeout/);
  const join = result.steps.find((step) => step.name === "calls-booked-no-join-link");
  assert.equal(join.skipped, true);
  assert.match(join.why, /booked-call events not read \(statement timeout\)/);
});

test("call-bookings: the daily lane and the hourly beat share one SQL and one judge", () => {
  assert.equal(lane.joinCalls, truth.joinCalls);
  for (const checkId of beat.HOURLY_CHECK_IDS) assert.ok(lane.CHECK_IDS.includes(checkId), checkId);
  assert.equal(truth.JOIN_ID, "calls:booked-no-join-link");
  assert.match(truth.BOOKED_NO_OUTCOME_SQL, /^\/\* gap-calls:booked-no-outcome \*\//);
  assert.match(truth.JOIN_EVENTS_SQL, /LIMIT 1500/);
});

test("call-bookings: the identity tests copied into lib give the same answers as their app sources", () => {
  const emails = [
    "", "pat@gmail.com", "PAT@Gmail.com", "someone@fundhub.ai", "a@example.com", "a@example.net", "a@example.org",
    "e2e+1@gmail.com", "x+sim-2@gmail.com", "x+colin-qa@gmail.com", "chris+fhtest@gmail.com", "chris+fhtest2@gmail.com",
    "chris+qa@gmail.com", "chris+testing@gmail.com", "sim.user@gmail.com", "test-user@gmail.com", "my.test@yahoo.com",
    "contest@gmail.com", "nope", "@gmail.com", "a+b+fhtest@x.com", " spaced@gmail.com "
  ];
  const envs = [{}, { TEST_EMAIL_TAG: "" }, { TEST_EMAIL_TAG: "qa" }, { TEST_EMAIL_TAG: " FHTEST " }];
  for (const email of emails) {
    assert.deepEqual(identity.classifyVisitor({ email }), classifyVisitor({ email }), email);
    assert.equal(identity.emailLooksLikeProveSim(email), emailLooksLikeProveSim(email), email);
    for (const env of envs) {
      assert.equal(identity.isTestEmail(email, { env }), isTestEmail(email, { env }), `${email} ${JSON.stringify(env)}`);
      assert.equal(identity.testEmailTag(env), testEmailTag(env));
    }
  }
  assert.deepEqual(identity.classifyVisitor({ userAgent: "HeadlessChrome/120" }), classifyVisitor({ userAgent: "HeadlessChrome/120" }));
  assert.deepEqual(identity.classifyVisitor({ webdriver: true }), classifyVisitor({ webdriver: true }));
  const payloads = [
    {}, { eventTypeTitle: "Strategy call" }, { eventTypeSlug: "post-funding-interview" }, { title: "Insight session" },
    { eventType: "Interview" }, { eventTypeTitle: "Funding call", title: "x" }
  ];
  for (const payload of payloads) assert.equal(identity.isInterviewBooking(payload), isInterviewBooking(payload), JSON.stringify(payload));
});

test("call-bookings: every surface it covers needs only checks that run hourly, and this beat runs one of them", async () => {
  const hourly = new Set((await loadBeats()).flatMap((loaded) => loaded.checkIds || []));
  for (const checkId of beat.HOURLY_CHECK_IDS) assert.ok(hourly.has(checkId), checkId);
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) assert.ok(hourly.has(checkId), `${surface} needs ${checkId}, which no hourly beat runs`);
    assert.ok(wire.checks.some((checkId) => beat.HOURLY_CHECK_IDS.includes(checkId)), `${surface}: this beat runs none of its checks`);
  }
});
