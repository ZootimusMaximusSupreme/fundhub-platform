import assert from "node:assert/strict";
import { test } from "node:test";
import * as beat from "./beat-meet-presence.mjs";
import { runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";

test("Meet hourly door really runs, passes protected401 and fails missing or exposed200", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-meet-presence.mjs" }), []);
  const good = makeFakeCtx(beat, beat.selfTest.pass());
  assert.equal((await runBeat(beat, good)).ok, true);
  assert.equal(ctxLog(good).http.length, 1, "the live-only door was actually requested");
  assert.equal((await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()))).ok, false);
  const exposed = beat.selfTest.pass();
  exposed.http["GET https://fundhub.ai/api/read/meet-presence"] = { status: 200, body: JSON.stringify({ ok: true, presence: {} }) };
  assert.equal((await runBeat(beat, makeFakeCtx(beat, exposed))).ok, false);
});
