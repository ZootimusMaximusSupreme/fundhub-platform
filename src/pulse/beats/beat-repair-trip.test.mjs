import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-repair-trip.mjs";
import * as tripTruth from "./lib/repair-trip-truth.mjs";
import * as deskTruth from "./lib/repair-desk-truth.mjs";
import * as motionTruth from "./lib/repair-motion-truth.mjs";
import * as documentsTruth from "./lib/documents-truth.mjs";
import * as tripLane from "../coverage/gap-trip-repair.mjs";
import * as deskLane from "../coverage/gap-repair.mjs";
import * as documentsLane from "../coverage/gap-documents.mjs";
import * as motion from "../pipeline-motion.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { DEFAULT_ORG_SQL, SELF_TEST_NOW, SELF_TEST_ORG, laneSelfTest } from "./lib/money-hourly.mjs";
import { loadBeats } from "./index.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const HOUR = 60 * 60 * 1000;
const ago = (ms) => new Date(SELF_TEST_NOW.getTime() - ms).toISOString();

/** One customer who bought repair 3 hours ago and never got a program row: stuck at "repair program opened". */
function stuckTripRow(code) {
  return {
    client_id: `${code === "FH-000507" ? "aaaaaaaa" : "bbbbbbbb"}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`, client_code: code,
    purchase_at: ago(3 * HOUR), enrolled_at: null, program_status: null,
    verified_at: null, credit_file_at: null, authorized_at: null,
    letters_made_at: null, letters_mailed_at: null, later_round_at: null,
    answer_read_at: null, card_stage: null, card_entered_at: null, response_due_at: null
  };
}
const openCase = (code) => ({ id: `case-${code}`, round: "R1", client_code: code });

/** The pass rows with some answers replaced. */
function spec(overrides) {
  return laneSelfTest({ ...beat.LANE, selfTest: { passRows: beat.LANE.selfTest.passRows, failRows: overrides } }, true);
}

test("repair-trip is valid, goes green on nothing stuck and red at the stuck-case step", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-repair-trip.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true);
  assert.match(passed.detail, /^5 repair checks passed$/);
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "repair-case-stuck");
  assert.match(failed.detail, /1 repair case is marked stalled/);
  // A red step ends the beat: the steps run are the ones up to and including it.
  assert.deepEqual(failed.steps.map((step) => step.name), beat.steps.slice(0, beat.steps.indexOf("repair-case-stuck") + 1));
});

test("repair-trip: each of its five checks can go red on its own", async () => {
  const red = {
    "trip-repair": [[tripTruth.TRIP_SQL, [stuckTripRow("FH-000201")]]],
    "repair-case-stuck": [[deskTruth.STALLED_CASES_SQL, [{ id: "case-9" }]]],
    "repair-letter-round": [[deskTruth.OPEN_CASE_NO_LETTER_SQL, [openCase("FH-000201")]]],
    "pipeline-repair": [[motionTruth.REPAIR_STUCK_SQL, [{ n: 2 }]]],
    "documents-stuck-processing": [[documentsTruth.STUCK_DELIVERY_SQL, [{ pending: 1, failed: 0 }]]]
  };
  for (const [step, rows] of Object.entries(red)) {
    const result = await runBeat(beat, makeFakeCtx(beat, spec(rows)));
    assert.equal(result.ok, false, step);
    assert.equal(result.step, step);
  }
  const trip = await runBeat(beat, makeFakeCtx(beat, spec(red["trip-repair"])));
  assert.match(trip.detail, /FH-000201 stopped at "repair program opened"/);
});

test("repair-trip: owner hold. FH-000507 alone is never red; another late customer still is", async () => {
  // Braum alone: stuck on the trip and with a case waiting for letters. Named, not judged.
  const held = await runBeat(beat, makeFakeCtx(beat, spec([
    [tripTruth.TRIP_SQL, [stuckTripRow("FH-000507")]],
    [deskTruth.OPEN_CASE_NO_LETTER_SQL, [openCase("FH-000507")]]
  ])));
  assert.equal(held.ok, true, held.detail);
  const letter = held.steps.find((step) => step.name === "repair-letter-round");
  assert.equal(letter.skipped, true);
  assert.match(letter.why, /The only late file is FH-000507/);
  assert.equal(held.steps.find((step) => step.name === "trip-repair").skipped, undefined);
  assert.match(held.detail, /^4 repair checks passed; 1 had nothing safe to judge$/);

  // Braum plus a real late customer on the trip: red at the trip, naming the other one.
  const tripBoth = await runBeat(beat, makeFakeCtx(beat, spec([[tripTruth.TRIP_SQL, [stuckTripRow("FH-000507"), stuckTripRow("FH-000201")]]])));
  assert.equal(tripBoth.ok, false);
  assert.equal(tripBoth.step, "trip-repair");
  assert.match(tripBoth.detail, /FH-000201/);
  assert.doesNotMatch(tripBoth.detail, /FH-000507 stopped/);

  // Braum plus a real late letter round: red at the letter round.
  const letterBoth = await runBeat(beat, makeFakeCtx(beat, spec([[deskTruth.OPEN_CASE_NO_LETTER_SQL, [openCase("FH-000507"), openCase("FH-000201")]]])));
  assert.equal(letterBoth.ok, false);
  assert.equal(letterBoth.step, "repair-letter-round");
  assert.match(letterBoth.detail, /1 open case has dispute items and no letter/);
});

test("repair-trip: an unreadable count is never green", async () => {
  // No rows at all: the two counts (stuck repair files, stuck documents) cannot be read, so they skip.
  // An empty list is a real answer for the trip and the desk (nobody started, nothing stuck).
  const empty = await runBeat(beat, makeFakeCtx(beat, laneSelfTest({ ...beat.LANE, selfTest: {} })));
  assert.equal(empty.ok, true);
  const skipped = new Set(empty.steps.filter((step) => step.skipped).map((step) => step.name));
  assert.deepEqual([...skipped].sort(), ["documents-stuck-processing", "pipeline-repair"]);

  // Every read after the company read throws: nothing is green.
  const broken = {
    now: new Date(SELF_TEST_NOW.getTime()),
    read: async (sql) => {
      if (String(sql).trim() === DEFAULT_ORG_SQL) return { rows: [{ id: SELF_TEST_ORG }], rowCount: 1 };
      throw new Error("statement timeout");
    },
    env: {},
    http: {}
  };
  const result = await runBeat(beat, makeFakeCtx(beat, broken));
  for (const step of result.steps.filter((s) => s.name !== "read")) {
    assert.ok(step.skipped || step.ok === false, `${step.name} went green on a read that threw`);
  }
  assert.equal(result.ok, false, "the desk reads say FAIL on a read error, as the morning lane does");
});

test("repair-trip: the daily lanes and the hourly beat share one SQL and one judge", () => {
  assert.equal(tripLane.TRIP_SQL, tripTruth.TRIP_SQL);
  assert.equal(tripLane.judgeRepairWithHolds, tripTruth.judgeRepairWithHolds);
  assert.equal(deskLane.stuckCheck, deskTruth.stuckCheck);
  assert.equal(deskLane.letterCheck, deskTruth.letterCheck);
  assert.equal(deskLane.CLOCK_CARDS_SQL, deskTruth.CLOCK_CARDS_SQL);
  assert.equal(motion.REPAIR_STUCK_STAGES, motionTruth.REPAIR_STUCK_STAGES);
  assert.equal(documentsLane.STUCK_DELIVERY_SQL, documentsTruth.STUCK_DELIVERY_SQL);
  assert.equal(documentsLane.STUCK_READER_SQL, documentsTruth.STUCK_READER_SQL);
  for (const checkId of beat.HOURLY_CHECK_IDS) {
    const owned = [...tripLane.CHECK_IDS, ...deskLane.CHECK_IDS, "pipeline:repair", documentsLane.ID_STUCK];
    assert.ok(owned.includes(checkId), checkId);
  }
});

test("repair-trip: every surface it covers is a tripwire whose deep checks run hourly", async () => {
  const hourly = new Set((await loadBeats()).flatMap((b) => (Array.isArray(b.checkIds) ? b.checkIds : [])));
  for (const checkId of beat.HOURLY_CHECK_IDS) assert.ok(hourly.has(checkId), `${checkId} is not on the loaded list`);
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) assert.ok(hourly.has(checkId), `${surface} needs ${checkId}, which no hourly beat runs`);
  }
  // route:documents-upload also needs documents:upload-store. Its store-setting half runs hourly in the beat
  // upload-door (the byte read-back stays on the morning pulse), so the surface is upload-door's, not this beat's.
  const beats = await loadBeats();
  const uploadDoor = beats.find((b) => b.id === "upload-door");
  assert.ok(TRIPWIRES["route:documents-upload"].checks.includes("documents:upload-store"));
  assert.equal(beat.covers.includes("route:documents-upload"), false);
  assert.ok(uploadDoor && uploadDoor.covers.includes("route:documents-upload"), "upload-door covers the upload door");
  assert.ok(uploadDoor.checkIds.includes("documents:upload-store"));
  assert.equal(beats.filter((b) => Array.isArray(b.checkIds) && b.checkIds.includes("documents:upload-store")).length, 1, "one hourly beat runs it");
});
