// whop-plans beat (Finance OS unit W): every hour, the Whop plans a client sees on Payments are current.
// The same truth as the morning lane; read only; green and red both proven.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as beat from "./beat-whop-plans.mjs";
import { validateBeat, pinBeatSource, checkBeatSelfTest, runBeat } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import * as truth from "./lib/whop-plans-truth.mjs";
import * as lane from "../coverage/gap-whop-plans.mjs";

test("whop-plans beat is valid, read-only, and covers the daily Whop read", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-whop-plans.mjs" }), []);
  assert.deepEqual(pinBeatSource(readFileSync(new URL("./beat-whop-plans.mjs", import.meta.url), "utf8")), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  assert.deepEqual(beat.covers, ["job:finance-os-whop-plans-sweeper"]);
  assert.deepEqual([...beat.checkIds], ["payments:whop-plans-current"]);
});

test("green when every open Whop plan is current; one read for the company, one for the check, no web call", async () => {
  const ctx = makeFakeCtx(beat, beat.selfTest.pass());
  const result = await runBeat(beat, ctx);
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual(result.notRun, []);
  assert.equal(ctxLog(ctx).http.length, 0);
  assert.equal(ctxLog(ctx).reads.length, 2);
});

test("red at its own step when a plan was not read from Whop in 36 hours", async () => {
  const result = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(result.ok, false);
  assert.equal(result.step, "payments-whop-plans-current");
  assert.match(result.detail, /1 Whop plan is out of date .*not read from Whop in 36 hours/);
});

test("the morning lane and the beat share one SQL and one judge", () => {
  assert.equal(lane.runWhopPlanChecks, truth.runWhopPlanChecks);
  assert.equal(lane.WHOP_PLANS_STALE_SQL, truth.WHOP_PLANS_STALE_SQL);
  assert.deepEqual(lane.CHECK_IDS, truth.CHECK_IDS);
});
