import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-pipeline-lost.mjs";
import * as boardsTruth from "./lib/pipeline-boards-truth.mjs";
import * as boardsLane from "../coverage/gap-pipeline-boards.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { DEFAULT_ORG_SQL, SELF_TEST_NOW, SELF_TEST_ORG, laneSelfTest } from "./lib/money-hourly.mjs";
import { loadBeats } from "./index.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const redSpec = (step) => laneSelfTest({
  ...beat.LANE,
  selfTest: { passRows: beat.LANE.selfTest.passRows, failRows: [beat.RED_ROWS[step]] }
}, true);

test("pipeline-lost is valid, goes green with nobody lost and red at the nobody-lost step", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-pipeline-lost.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true, passed.detail);
  // dead-stage has no card on a dead stage, so it is "nothing to judge" (a skipped step), never red.
  assert.match(passed.detail, /^1 board checks passed; 1 had nothing safe to judge$/);
  assert.ok(passed.steps.find((step) => step.name === "pipeline-dead-stage").skipped);
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "pipeline-nobody-lost");
  assert.match(failed.detail, /1 paying client has no card on the board that owns what they bought/);
  // A red step ends the beat: the steps run are the ones up to and including it.
  assert.deepEqual(failed.steps.map((step) => step.name), beat.steps.slice(0, beat.steps.indexOf("pipeline-nobody-lost") + 1));
});

test("pipeline-lost: each of its two checks can go red on its own", async () => {
  assert.deepEqual(Object.keys(beat.RED_ROWS).sort(), beat.LANE.checks.map((check) => check.step).sort());
  for (const step of Object.keys(beat.RED_ROWS)) {
    const result = await runBeat(beat, makeFakeCtx(beat, redSpec(step)));
    assert.equal(result.ok, false, step);
    assert.equal(result.step, step);
  }
});

test("pipeline-lost: an unreadable database is never green", async () => {
  const spec = {
    now: new Date(SELF_TEST_NOW.getTime()),
    read: async (sql) => {
      if (String(sql).trim() === DEFAULT_ORG_SQL) return { rows: [{ id: SELF_TEST_ORG }], rowCount: 1 };
      throw new Error("connection reset");
    }
  };
  const result = await runBeat(beat, makeFakeCtx(beat, spec));
  assert.equal(result.ok, true);
  assert.match(result.detail, /^0 board checks passed; 2 had nothing safe to judge$/);
  assert.ok(result.steps.filter((step) => step.name !== "read").every((step) => step.skipped));
});

test("pipeline-lost: the daily lane and the hourly beat share one judge", () => {
  for (const checkId of beat.HOURLY_CHECK_IDS) {
    assert.ok(boardsLane.CHECK_IDS.includes(checkId), checkId);
    assert.ok(boardsTruth.BOARDS_TRUTH_IDS.includes(checkId), checkId);
  }
});

test("pipeline-lost: every surface it covers is a tripwire it guards, and every check that surface needs runs hourly", async () => {
  const hourly = new Set((await loadBeats()).flatMap((loaded) => [...(loaded.checkIds || [])]));
  for (const checkId of beat.HOURLY_CHECK_IDS) assert.ok(hourly.has(checkId), checkId);
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    assert.ok(wire.checks.some((checkId) => beat.HOURLY_CHECK_IDS.includes(checkId)), `${surface}: this beat runs none of its checks`);
    for (const checkId of wire.checks) assert.ok(hourly.has(checkId), `${surface} needs ${checkId}, which no hourly beat runs`);
  }
});
