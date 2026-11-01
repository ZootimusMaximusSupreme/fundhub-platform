import { test } from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-cortana-booking.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";

test("Cortana beat turns red for an aged booking without a vendor receipt", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-cortana-booking.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const green = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(green.ok, true);
  const red = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(red.ok, false);
  assert.equal(red.step, "delivery-receipt");
  assert.match(red.detail, /2 confirmed ClickFunnels calls/);
});
