import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-funding-trip.mjs";
import { checkBeatSelfTest, validateBeat } from "./contract.mjs";

test("funding-trip is valid and its real judge goes green and red", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-funding-trip.mjs" }), []);
  assert.deepEqual(beat.checkIds, ["trip:funding"]);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
});
