import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-partner-trip.mjs";
import { checkBeatSelfTest, validateBeat } from "./contract.mjs";

test("partner-trip is valid and its real judge goes green and red", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-partner-trip.mjs" }), []);
  assert.deepEqual(beat.checkIds, ["trip:partner"]);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
});
