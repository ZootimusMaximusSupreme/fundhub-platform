import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-lead-pipe.mjs";
import * as handoff from "./beat-lead-handoff.mjs";
import * as truth from "./lib/lead-truth.mjs";
import * as lane from "../coverage/gap-leads.mjs";
import { AD_ACCOUNT_TZ, adAccountDay } from "../../lib/ad-account-day.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

test("lead-pipe is valid, green when a real lead was saved, red when traffic saved nobody", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-lead-pipe.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true);
  assert.equal(passed.detail, "1 lead checks passed");
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "lead-pipe-cut-with-traffic");
  assert.match(failed.detail, /Ads sent 400 link clicks/);
  assert.match(failed.detail, /Zero real people were saved/);
});

test("lead-pipe: too few clicks is nothing to judge, never green", async () => {
  const quiet = { ad_rows: 2, ad_clicks: 40, road_leads: 0, cf_leads: 0, lead_last: null, road_views: 3, form_views: 0, cf_posts: 0, cf_last: null, other_posts: 0 };
  const spec = laneSelfTest({ ...beat.LANE, selfTest: { passRows: [[truth.FACTS_SQL, [quiet]]] } });
  const result = await runBeat(beat, makeFakeCtx(beat, spec));
  assert.equal(result.ok, true);
  assert.match(result.detail, /^0 lead checks passed; 1 had nothing safe to judge$/);
  assert.ok(result.steps.find((step) => step.name === "lead-pipe-cut-with-traffic").skipped);
});

test("lead-pipe: a read with no row is skipped, never green", async () => {
  const result = await runBeat(beat, makeFakeCtx(beat, laneSelfTest({ ...beat.LANE, selfTest: {} })));
  assert.equal(result.ok, true);
  assert.match(result.detail, /^0 lead checks passed; 1 had nothing safe to judge$/);
});

test("lead-pipe: the daily lane and the hourly beat share one SQL and one judge", () => {
  assert.equal(lane.runLeadChecks, truth.runLeadChecks);
  assert.equal(lane.FACTS_SQL, truth.FACTS_SQL);
  assert.equal(lane.pipeCheck, truth.pipeCheck);
  assert.equal(beat.HOURLY_CHECK_IDS[0], "lead:pipe-cut-with-traffic");
});

test("lead-pipe: the copied ad-account day equals src/lib/ad-account-day.mjs", () => {
  assert.equal(truth.AD_ACCOUNT_TZ, AD_ACCOUNT_TZ);
  for (const iso of ["2026-10-09T01:30:00Z", "2026-10-09T06:59:59Z", "2026-10-09T07:00:00Z", "2026-12-31T23:30:00Z", "2027-03-14T10:00:00Z"]) {
    assert.equal(truth.adAccountDay(new Date(iso)), adAccountDay(new Date(iso)), iso);
  }
  assert.match(truth.FACTS_SQL, /AT TIME ZONE 'America\/Phoenix'/);
});

test("lead-pipe: each door it covers has every named deep check run every hour", () => {
  const hourly = new Set([...beat.HOURLY_CHECK_IDS, ...handoff.HOURLY_CHECK_IDS]);
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) assert.ok(hourly.has(checkId), `${surface} needs ${checkId} hourly`);
  }
});
