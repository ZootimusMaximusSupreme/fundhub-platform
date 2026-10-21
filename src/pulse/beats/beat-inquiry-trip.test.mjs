import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-inquiry-trip.mjs";
import * as tripTruth from "./lib/inquiry-trip-truth.mjs";
import * as caseTruth from "./lib/inquiry-truth.mjs";
import * as tripLane from "../coverage/gap-trip-inquiry.mjs";
import * as caseLane from "../coverage/gap-inquiry.mjs";
import { cronIntervalMs, STALE_MULTIPLE } from "../heartbeats.mjs";
import { LOOKBACK_MS as FUNDING_LOOKBACK_MS } from "../coverage/gap-money-funding.mjs";
import { SETTLE_GRACE_MS as FACTS_SETTLE_GRACE_MS } from "../coverage/gap-pipeline-facts.mjs";
import { INTERNAL_CLIENT_EMAIL_RE as PORTAL_INTERNAL_RE } from "../coverage/gap-portal.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { SELF_TEST_NOW, laneSelfTest } from "./lib/money-hourly.mjs";
import { loadBeats } from "./index.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

/** The pass rows with some answers replaced. */
function spec(overrides) {
  return laneSelfTest({ ...beat.LANE, selfTest: { passRows: beat.LANE.selfTest.passRows, failRows: overrides } }, true);
}

test("inquiry-trip is valid, goes green on nothing stuck and red at the stuck-case step", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-inquiry-trip.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true);
  assert.match(passed.detail, /^2 inquiry checks passed$/);
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "inquiry-case-stuck");
  assert.match(failed.detail, /1 inquiry case is stuck/);
  assert.deepEqual(failed.steps.map((step) => step.name), beat.steps);
});

test("inquiry-trip: each of its two checks can go red on its own", async () => {
  const trip = await runBeat(beat, makeFakeCtx(beat, spec([[tripTruth.TRIP_SQL, [beat.SELF_TEST_ROWS.NO_GATE_ROW]]])));
  assert.equal(trip.ok, false);
  assert.equal(trip.step, "trip-inquiry");
  assert.match(trip.detail, /FH-000998 stopped at "inquiry gate ran"/);
  // A red step ends the beat: the stuck-case step never ran.
  assert.deepEqual(trip.steps.map((step) => step.name), ["read", "trip-inquiry"]);

  const stuck = await runBeat(beat, makeFakeCtx(beat, spec([[caseTruth.STUCK_SQL, [{ n: 3 }]]])));
  assert.equal(stuck.ok, false);
  assert.equal(stuck.step, "inquiry-case-stuck");
  assert.match(stuck.detail, /3 inquiry cases are stuck/);
});

test("inquiry-trip: a customer waiting on the bureau or with a fraud hold is not red", async () => {
  const waiting = {
    ...beat.SELF_TEST_ROWS.NO_GATE_ROW,
    gate_raised_at: "2026-10-09T17:08:00.000Z",
    raised_bureaus: ["experian"],
    started_at: "2026-10-09T17:08:00.000Z",
    cases_n: 1,
    case_bureaus: ["experian"],
    letters_owed_n: 1,
    letters_missing_n: 0,
    calls_fired_n: 1
  };
  const green = await runBeat(beat, makeFakeCtx(beat, spec([[tripTruth.TRIP_SQL, [waiting]]])));
  assert.equal(green.ok, true, green.detail);
  const fraud = await runBeat(beat, makeFakeCtx(beat, spec([[tripTruth.TRIP_SQL, [{ ...beat.SELF_TEST_ROWS.NO_GATE_ROW, gate_clear_at: null, fraud_alert: true }]]])));
  assert.equal(fraud.ok, true, fraud.detail);
});

test("inquiry-trip: a read that fails is never green", async () => {
  const failing = {
    ...beat.selfTest.pass(),
    read: async (sql) => {
      if (/SELECT id FROM orgs/.test(sql)) return { rows: [{ id: "00000000-0000-4000-8000-000000000001" }], rowCount: 1 };
      throw new Error("statement timeout");
    }
  };
  const result = await runBeat(beat, makeFakeCtx(beat, failing));
  // The trip read is a skip with the reason (the morning lane's rule); the stuck-case read is a FAIL (its rule).
  assert.equal(result.ok, false);
  assert.equal(result.step, "inquiry-case-stuck");
  assert.match(result.detail, /could not read inquiry cases: statement timeout/);
  const tripStep = result.steps.find((step) => step.name === "trip-inquiry");
  assert.equal(tripStep.skipped, true);
  assert.match(tripStep.why, /could not read the inquiry trips: statement timeout/);
});

test("inquiry-trip: the daily lanes and the hourly beat share one SQL and one judge", () => {
  assert.equal(tripLane.TRIP_SQL, tripTruth.TRIP_SQL);
  assert.equal(tripLane.judgeInquiry, tripTruth.judgeInquiry);
  assert.equal(tripLane.toTripRow, tripTruth.toTripRow);
  assert.equal(tripLane.tripParams, tripTruth.tripParams);
  assert.deepEqual(tripLane.CHECK_IDS, ["trip:inquiry"]);
  assert.equal(caseLane.STUCK_SQL, caseTruth.STUCK_SQL);
  assert.equal(caseLane.CALL_GRACE_MS, caseTruth.CALL_GRACE_MS);
  assert.equal(caseLane.CALL_DUE_STATUSES, caseTruth.CALL_DUE_STATUSES);
  assert.equal(caseLane.LETTER_STATUSES, caseTruth.LETTER_STATUSES);
  assert.equal(caseLane.GATE_SOURCE, caseTruth.GATE_SOURCE);
});

test("inquiry-trip: the numbers copied into lib still equal their sources", () => {
  // heartbeats.mjs owns the stale rule and the cron reader; lib/inquiry-truth.mjs holds copies.
  assert.equal(caseTruth.STALE_MULTIPLE, STALE_MULTIPLE);
  assert.equal(caseTruth.CALL_SWEEPER_INTERVAL_MS, cronIntervalMs(caseTruth.CALL_SWEEPER_CRON));
  assert.equal(caseTruth.CALL_GRACE_MS, STALE_MULTIPLE * cronIntervalMs(caseTruth.CALL_SWEEPER_CRON));
  // The trip's window, settle wait and test-address pattern come from lib files; the lanes own the originals.
  assert.equal(tripTruth.WINDOW_MS, FUNDING_LOOKBACK_MS);
  const params = tripTruth.tripParams("org", SELF_TEST_NOW);
  assert.equal(params[2], PORTAL_INTERNAL_RE);
  const gate = tripTruth.STEPS.find((step) => step.key === "gate");
  assert.equal(gate.graceMs, FACTS_SETTLE_GRACE_MS);
});

test("inquiry-trip: every surface it covers needs only checks that run hourly, and this beat runs one of them", async () => {
  const hourly = new Set((await loadBeats()).flatMap((loaded) => loaded.checkIds || []));
  for (const checkId of beat.HOURLY_CHECK_IDS) assert.ok(hourly.has(checkId), checkId);
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) assert.ok(hourly.has(checkId), `${surface} needs ${checkId}, which no hourly beat runs`);
    assert.ok(wire.checks.some((checkId) => beat.HOURLY_CHECK_IDS.includes(checkId)), `${surface}: this beat runs none of its checks`);
  }
});
