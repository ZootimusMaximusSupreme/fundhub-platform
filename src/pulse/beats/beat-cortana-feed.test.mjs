import { test } from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-cortana-feed.mjs";
import { runBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { cortanaFeedProblems } from "./lib/cortana-feed-truth.mjs";

test("hourly Cortana feed beat has both green and red evidence", async () => {
  const pass = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(pass.ok, true, pass.detail);
  const fail = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(fail.ok, false);
  assert.equal(fail.step, "payments-in-cortana");
});

test("a send that keeps failing is red even when nothing is unsent", () => {
  assert.equal(cortanaFeedProblems({ unsent: 0, failing: 0 }).healthy, true);
  assert.equal(cortanaFeedProblems({ unsent: 0, failing: 2 }).healthy, false);
  assert.equal(cortanaFeedProblems({ unsent: 3, failing: 0 }).healthy, false);
  assert.equal(cortanaFeedProblems({}).healthy, false, "no counts is never green");
});
