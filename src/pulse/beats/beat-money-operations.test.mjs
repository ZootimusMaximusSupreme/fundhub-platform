import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-money-operations.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";

test("money-operations is valid and all nine W2 operations judges can go green and red", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-money-operations.mjs" }), []);
  assert.equal(beat.checkIds.length, 9);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.step, "ads-meta-load-jobs");
  assert.deepEqual(failed.steps.map((step) => step.name), beat.steps);
});
