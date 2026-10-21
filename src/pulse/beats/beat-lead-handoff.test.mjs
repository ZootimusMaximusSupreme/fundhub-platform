import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-lead-handoff.mjs";
import * as truth from "./lib/handoff-truth.mjs";
import * as lane from "../coverage/gap-handoff.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

test("lead-handoff is valid, goes green on zero misses and red at the contact step", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-lead-handoff.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true);
  assert.match(passed.detail, /^4 hand-off checks passed$/);
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "handoff-contact-no-followup");
  assert.match(failed.detail, /left an email on \/roadmap, did not pay, and got no follow-up note/);
  // A red step ends the beat: the steps run are the ones up to and including it.
  assert.deepEqual(failed.steps.map((step) => step.name), beat.steps.slice(0, beat.steps.indexOf("handoff-contact-no-followup") + 1));
});

test("lead-handoff: each of its four checks can go red on its own", async () => {
  const red = {
    "handoff-lead-first-touches-missing": truth.WELCOME_SQL,
    "handoff-contact-no-followup": truth.CONTACT_197_SQL,
    "handoff-booking-no-confirm": truth.CONFIRM_SQL,
    "handoff-reminder-missing": truth.REMIND_2H_SQL
  };
  for (const [step, sql] of Object.entries(red)) {
    const spec = laneSelfTest({ ...beat.LANE, selfTest: { passRows: beat.LANE.selfTest.passRows, failRows: [[sql, [{ n: 2, newest: null, sample: null, silent_n: 0 }]]] } }, true);
    const result = await runBeat(beat, makeFakeCtx(beat, spec));
    assert.equal(result.ok, false, step);
    assert.equal(result.step, step);
  }
});

test("lead-handoff: an unreadable count is never green", async () => {
  // No rows at all for every branch: the lane cannot read a count, so each check is skip, never PASS.
  const result = await runBeat(beat, makeFakeCtx(beat, laneSelfTest({ ...beat.LANE, selfTest: {} })));
  assert.equal(result.ok, true);
  assert.match(result.detail, /^0 hand-off checks passed; 4 had nothing safe to judge$/);
  assert.ok(result.steps.filter((step) => step.name !== "read").every((step) => step.skipped));
});

test("lead-handoff: the daily lane and the hourly beat share one SQL and one judge", () => {
  assert.equal(lane.runHandoffChecks, truth.runHandoffChecks);
  assert.equal(lane.WELCOME_SQL, truth.WELCOME_SQL);
  assert.equal(lane.CONTACT_M1_SQL, truth.CONTACT_M1_SQL);
  assert.equal(lane.REMIND_24H_SQL, truth.REMIND_24H_SQL);
  for (const checkId of beat.HOURLY_CHECK_IDS) assert.ok(truth.CHECK_IDS.includes(checkId), checkId);
});

test("lead-handoff: every surface it covers is a tripwire whose deep checks it runs", () => {
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) assert.ok(beat.HOURLY_CHECK_IDS.includes(checkId), `${surface} needs ${checkId}`);
  }
});
