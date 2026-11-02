import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-slideshows.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { PUBLIC_STATIC_FILES } from "../registry.mjs";

test("all 22 phone decks have an hourly beat that goes red for a missing page", async () => {
  assert.equal(beat.covers.length, 22);
  assert.deepEqual(beat.covers, PUBLIC_STATIC_FILES.filter((file) => /^slideshows\/[^/]+\.html$/.test(file)).map((file) => `page:${file}`));
  assert.deepEqual(validateBeat(beat, { file: "beat-slideshows.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  assert.equal((await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()))).ok, true);
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "slideshows-content");
});
