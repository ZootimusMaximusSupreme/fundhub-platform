import { test } from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-invoice-checkout-retirement.mjs";
import { runBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";

test("hourly fee checkout beat has both green and red evidence", async () => {
  const pass = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(pass.ok, true, pass.detail);
  const fail = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(fail.ok, false);
  assert.equal(fail.step, "links-safe");
});
