import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-roadmap-delivery.mjs";
import * as tripTruth from "./lib/roadmap-trip-truth.mjs";
import * as uwTruth from "./lib/underwrite-truth.mjs";
import * as softPull from "./beat-soft-pull.mjs";
import * as consentBeat from "./beat-consent-capture.mjs";
import * as tripLane from "../coverage/gap-trip-roadmap.mjs";
import * as uwLane from "../coverage/gap-underwrite.mjs";
import { INTERNAL_CLIENT_EMAIL_RE, SIGN_IN_GRACE } from "../coverage/gap-portal.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { SELF_TEST_NOW, laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const OTHER_BEATS = { "soft-pull": softPull, "consent-capture": consentBeat };
const HOUR = 60 * 60 * 1000;
const iso = (msAgo) => new Date(SELF_TEST_NOW.getTime() - msAgo).toISOString();
const failWith = (sql, rows) => laneSelfTest({ ...beat.LANE, selfTest: { passRows: beat.LANE.selfTest.passRows, failRows: [[sql, rows]] } }, true);

test("roadmap-delivery is valid, green when nothing is owed, red when a finished pull has no pack", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-roadmap-delivery.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true, passed.detail);
  assert.equal(passed.detail, "4 roadmap delivery checks passed");
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "uw-paid-roadmap-no-pack");
  assert.match(failed.detail, /1 paid roadmap client has a finished pull and no UnderwriteIQ pack/);
});

test("roadmap-delivery: a missing pack email template is red at the last step, after every other step ran", async () => {
  const result = await runBeat(beat, makeFakeCtx(beat, failWith(uwTruth.PACK_TEMPLATE_SQL, [])));
  assert.equal(result.ok, false);
  assert.equal(result.step, "uw-pack-email-not-queued");
  assert.match(result.detail, /EMAIL-U02-ANALYZER-FUNDING-DELIVERY has no row, so no pack-ready email can be queued/);
  for (const step of ["trip-roadmap", "uw-paid-roadmap-no-pack", "uw-pack-files-incomplete"]) {
    assert.equal(result.steps.find((s) => s.name === step).ok, true, step);
  }
});

test("roadmap-delivery: a pack missing a promised file is red at the pack-files step", async () => {
  const pack = { client_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", subtypes: ["credit_analysis_report"], first_at: iso(3 * HOUR), last_at: iso(3 * HOUR), empty_n: 0, short_n: 0, slo: false, tier: "REPAIR_ONLY" };
  const result = await runBeat(beat, makeFakeCtx(beat, failWith(uwTruth.PACK_FILES_SQL, [pack])));
  assert.equal(result.ok, false);
  assert.equal(result.step, "uw-pack-files-incomplete");
  assert.match(result.detail, /is missing the Credit Optimization Roadmap/);
});

test("roadmap-delivery: a buyer past 2 hours with no form and no reminder is stuck on the trip", async () => {
  const buyer = { client_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", client_code: "FH-000999", email: "buyer@gmail.com", paid_at: iso(5 * HOUR) };
  const result = await runBeat(beat, makeFakeCtx(beat, failWith(tripTruth.TRIP_SQL, [buyer])));
  assert.equal(result.ok, false);
  assert.equal(result.step, "trip-roadmap");
  assert.match(result.detail, /FH-000999 stopped at "filled the pull form": the pull form has been empty for over 2 hours/);
});

test("roadmap-delivery: a trip read that fails is a skip, never green on that step", async () => {
  const spec = beat.selfTest.pass();
  const read = spec.read;
  spec.read = async (sql, params) => {
    if (String(sql).includes("gap:trip-roadmap")) throw new Error("statement timeout");
    return read(sql, params);
  };
  const result = await runBeat(beat, makeFakeCtx(beat, spec));
  assert.equal(result.ok, true);
  assert.match(result.steps.find((s) => s.name === "trip-roadmap").why, /could not read the roadmap trips: statement timeout/);
});

test("roadmap-delivery: five reads, no web call", async () => {
  const ctx = makeFakeCtx(beat, beat.selfTest.pass());
  await runBeat(beat, ctx);
  const log = ctxLog(ctx);
  assert.equal(log.http.length, 0);
  assert.equal(log.reads.filter((r) => !/FROM orgs/.test(r.sql)).length, 5);
});

test("roadmap-delivery: the copied portal rules equal gap-portal.mjs", () => {
  assert.equal(tripTruth.INTERNAL_CLIENT_EMAIL_RE, INTERNAL_CLIENT_EMAIL_RE);
  assert.equal(tripTruth.SIGN_IN_GRACE, SIGN_IN_GRACE);
});

test("roadmap-delivery: the daily lanes and the hourly beat share one SQL and one judge", () => {
  assert.equal(tripLane.TRIP_SQL, tripTruth.TRIP_SQL);
  assert.equal(tripLane.judgeRoadmap, tripTruth.judgeRoadmap);
  assert.equal(tripLane.toTripRow, tripTruth.toTripRow);
  assert.equal(uwLane.PAID_ROADMAP_SQL, uwTruth.PAID_ROADMAP_SQL);
  assert.equal(uwLane.PACK_FILES_SQL, uwTruth.PACK_FILES_SQL);
  assert.equal(uwLane.PACK_EMAIL_SQL, uwTruth.PACK_EMAIL_SQL);
  assert.equal(uwLane.judgePackFiles, uwTruth.judgePackFiles);
  assert.equal(uwLane.judgePackEmail, uwTruth.judgePackEmail);
  assert.equal(uwLane.judgePackTemplate, uwTruth.judgePackTemplate);
  for (const checkId of beat.HOURLY_CHECK_IDS.slice(1)) assert.ok(uwLane.CHECK_IDS.includes(checkId), checkId);
  assert.deepEqual([...tripLane.CHECK_IDS], ["trip:roadmap"]);
});

test("roadmap-delivery: every deep check a covered surface names runs hourly, here or at a named step of another beat", () => {
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) {
      if (beat.HOURLY_CHECK_IDS.includes(checkId)) continue;
      const elsewhere = beat.RUNS_ELSEWHERE[checkId];
      assert.ok(elsewhere, `${surface} needs ${checkId} hourly`);
      const [otherId, step] = elsewhere;
      assert.equal(OTHER_BEATS[otherId].id, otherId);
      assert.ok(OTHER_BEATS[otherId].steps.includes(step), `${otherId} has no step ${step}`);
      assert.ok(OTHER_BEATS[otherId].HOURLY_CHECK_IDS.includes(checkId), `${otherId} does not run ${checkId}`);
    }
  }
});
