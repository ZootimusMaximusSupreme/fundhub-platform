import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-money-checkout.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";

test("money-checkout is valid and all four checkout judges can go green and red", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-money-checkout.mjs" }), []);
  assert.equal(beat.checkIds.length, 4);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.step, "checkout-funnel-no-sale");
  assert.deepEqual(failed.steps.map((step) => step.name), beat.steps);
});
