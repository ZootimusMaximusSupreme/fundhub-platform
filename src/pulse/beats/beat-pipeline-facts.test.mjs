import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-pipeline-facts.mjs";
import * as factsTruth from "./lib/pipeline-facts-truth.mjs";
import * as factsLane from "../coverage/gap-pipeline-facts.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { DEFAULT_ORG_SQL, SELF_TEST_NOW, SELF_TEST_ORG, laneSelfTest } from "./lib/money-hourly.mjs";
import { loadBeats } from "./index.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const redSpec = (step) => laneSelfTest({
  ...beat.LANE,
  selfTest: { passRows: beat.LANE.selfTest.passRows, failRows: [beat.RED_ROWS[step]] }
}, true);

test("pipeline-facts is valid, goes green when every card follows its facts and red at the stage step", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-pipeline-facts.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true, passed.detail);
  assert.match(passed.detail, /^2 board fact checks passed$/);
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "pipeline-stage-vs-fact");
  assert.match(failed.detail, /1 paying client is not on Closed Won or Downsell/);
  assert.deepEqual(failed.steps.map((step) => step.name), beat.steps.slice(0, beat.steps.indexOf("pipeline-stage-vs-fact") + 1));
});

test("pipeline-facts: each of its two checks can go red on its own", async () => {
  assert.deepEqual(Object.keys(beat.RED_ROWS).sort(), beat.LANE.checks.map((check) => check.step).sort());
  for (const step of Object.keys(beat.RED_ROWS)) {
    const result = await runBeat(beat, makeFakeCtx(beat, redSpec(step)));
    assert.equal(result.ok, false, step);
    assert.equal(result.step, step);
  }
  const twoRecords = await runBeat(beat, makeFakeCtx(beat, redSpec("pipeline-two-records")));
  assert.match(twoRecords.detail, /1 Funding card sits past Apply Now with no round row/);
});

test("pipeline-facts: an unreadable database is never green", async () => {
  const spec = {
    now: new Date(SELF_TEST_NOW.getTime()),
    read: async (sql) => {
      if (String(sql).trim() === DEFAULT_ORG_SQL) return { rows: [{ id: SELF_TEST_ORG }], rowCount: 1 };
      throw new Error("connection reset");
    }
  };
  const result = await runBeat(beat, makeFakeCtx(beat, spec));
  assert.equal(result.ok, true);
  assert.match(result.detail, /^0 board fact checks passed; 2 had nothing safe to judge$/);
  assert.ok(result.steps.filter((step) => step.name !== "read").every((step) => step.skipped));
});

test("pipeline-facts: the daily lane and the hourly beat share one SQL and one judge", () => {
  assert.equal(factsLane.runFactsChecks, factsTruth.runFactsChecks);
  for (const name of ["SALES_PAID_SQL", "SALES_BOOKED_SQL", "FUNDING_FUNDED_SQL", "INQUIRY_CLEARED_SQL", "PARTNER_STATUS_SQL",
    "AR_CARD_SQL", "MOVE_RECEIPT_SQL", "ROUND_NO_CARD_SQL", "CARD_NO_ROUND_SQL", "REPAIR_CASE_CARD_SQL", "FLOOR_VS_BOARD_SQL",
    "PAID_GRACE_MS", "SETTLE_GRACE_MS", "judgeFloor", "judgeMoves", "monthWindow"]) {
    assert.equal(factsLane[name], factsTruth[name], name);
  }
  assert.deepEqual([...factsLane.CHECK_IDS], [...factsTruth.CHECK_IDS]);
  for (const checkId of beat.HOURLY_CHECK_IDS) assert.ok(factsTruth.CHECK_IDS.includes(checkId), checkId);
});

test("pipeline-facts: every surface it covers is a tripwire it guards, and every check that surface needs runs hourly", async () => {
  const hourly = new Set((await loadBeats()).flatMap((loaded) => [...(loaded.checkIds || [])]));
  for (const checkId of beat.HOURLY_CHECK_IDS) assert.ok(hourly.has(checkId), checkId);
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    assert.ok(wire.checks.some((checkId) => beat.HOURLY_CHECK_IDS.includes(checkId)), `${surface}: this beat runs none of its checks`);
    for (const checkId of wire.checks) assert.ok(hourly.has(checkId), `${surface} needs ${checkId}, which no hourly beat runs`);
  }
  // desk:sales-floor.html needs sales-manager:totals, which no beat here runs: it is not on covers.
  assert.ok(!beat.covers.includes("desk:sales-floor.html"));
  assert.ok(TRIPWIRES["desk:sales-floor.html"].checks.includes("sales-manager:totals"));
});
