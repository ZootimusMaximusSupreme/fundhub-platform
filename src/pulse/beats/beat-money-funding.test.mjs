import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-money-funding.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";

test("money-funding is valid and all six W1 judges can go green and red", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-money-funding.mjs" }), []);
  assert.equal(beat.checkIds.length, 6);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.step, "books-sample-rows");
  assert.deepEqual(failed.steps.map((step) => step.name), beat.steps);
});
