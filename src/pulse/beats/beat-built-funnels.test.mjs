import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-built-funnels.mjs";
import * as truth from "./lib/built-funnels-truth.mjs";
import * as lane from "../coverage/gap-built-funnels.mjs";
import { tagMeta } from "../../marketing/funnel-tracking.mjs";
import { FUNNEL_ROLES } from "../../marketing/funnel-paths.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

test("built-funnels is valid, green when every live page carries its tag, red when one lost it", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-built-funnels.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true, passed.detail);
  assert.equal(passed.detail, "1 funnel page checks passed");
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "built-funnels-live-pages-answer");
  assert.match(failed.detail, /selftest-thank_you answered 200 but does not carry the funnel tag fh-selftest/);
});

test("built-funnels: a missing page, a page with no address, and a 404 are each red", async () => {
  const rows = beat.LANE.selfTest.passRows[0][1];
  const cases = [
    [[rows[0], rows[1]], /is live but has no thank_you page on file/],
    [[rows[0], rows[1], { ...rows[2], live_url: null }], /thank_you page \(\/selftest-thank_you\) has no live address/]
  ];
  for (const [live, words] of cases) {
    const spec = laneSelfTest({ ...beat.LANE, selfTest: { passRows: [[truth.LIVE_SQL, live]], failRows: [], passHttp: beat.LANE.selfTest.passHttp } }, true);
    const result = await runBeat(beat, makeFakeCtx(beat, spec));
    assert.equal(result.ok, false);
    assert.match(result.detail, words);
  }
  const key = Object.keys(beat.LANE.selfTest.passHttp)[0];
  const spec = laneSelfTest({ ...beat.LANE, selfTest: { ...beat.LANE.selfTest, failHttp: { ...beat.LANE.selfTest.passHttp, [key]: { status: 404, body: "" } } } }, true);
  const result = await runBeat(beat, makeFakeCtx(beat, spec));
  assert.equal(result.ok, false);
  assert.match(result.detail, /answered 404/);
});

test("built-funnels: no live built funnel is 'nothing to judge' (skipped, green), and a blind read never passes", async () => {
  const none = laneSelfTest({ ...beat.LANE, selfTest: { passRows: [[truth.LIVE_SQL, []], [truth.SEEN_SQL, [{ n: 3 }]]] } });
  const ctx = makeFakeCtx(beat, none);
  const quiet = await runBeat(beat, ctx);
  assert.equal(quiet.ok, true);
  assert.match(quiet.detail, /1 had nothing safe to judge/);
  assert.equal(ctxLog(ctx).http.length, 0);

  const blind = laneSelfTest({ ...beat.LANE, selfTest: { passRows: [[truth.LIVE_SQL, []], [truth.SEEN_SQL, [{ n: 0 }]]] } });
  const skipped = await runBeat(beat, makeFakeCtx(beat, blind));
  assert.equal(skipped.ok, true);
  assert.match(skipped.steps.find((s) => s.name === "built-funnels-live-pages-answer").why, /no funnel row was visible/);
});

test("built-funnels: a page on another host is read through '*', and our own main site is never reached that way", async () => {
  const rows = beat.LANE.selfTest.passRows[0][1].map((r) => ({ ...r, live_url: r.live_url.replace("apply.fundhub.ai", "someone.myclickfunnels.com") }));
  const http = Object.fromEntries(Object.entries(beat.LANE.selfTest.passHttp).map(([k, v]) => [k.replace("apply.fundhub.ai", "someone.myclickfunnels.com"), v]));
  const spec = laneSelfTest({ ...beat.LANE, selfTest: { passRows: [[truth.LIVE_SQL, rows]], passHttp: http } });
  const ctx = makeFakeCtx(beat, spec);
  const result = await runBeat(beat, ctx);
  assert.equal(result.ok, true, result.detail);
  assert.ok(ctxLog(ctx).http.every((c) => c.method === "GET" && c.host === "someone.myclickfunnels.com"));

  const own = rows.map((r) => ({ ...r, live_url: r.live_url.replace("someone.myclickfunnels.com", "fundhub.ai") }));
  const ownCtx = makeFakeCtx(beat, laneSelfTest({ ...beat.LANE, selfTest: { passRows: [[truth.LIVE_SQL, own]], passHttp: {} } }));
  const red = await runBeat(beat, ownCtx);
  assert.equal(red.ok, false, "a page we cannot read is not passed");
  assert.match(red.detail, /could not be reached \(refused: fundhub\.ai is our own site/);
});

test("built-funnels: the copied tag line and page roles equal the code that writes them", () => {
  for (const tag of ["fh-blueprint", "x", "a\"b"]) assert.equal(truth.tagMeta(tag), tagMeta(tag));
  assert.deepEqual([...truth.FUNNEL_ROLES], [...FUNNEL_ROLES]);
});

test("built-funnels: the daily lane and the hourly beat share one SQL and one judge", () => {
  assert.equal(lane.LIVE_SQL, truth.LIVE_SQL);
  assert.equal(lane.SEEN_SQL, truth.SEEN_SQL);
  assert.equal(lane.bustedUrl, truth.bustedUrl);
  assert.deepEqual([...lane.CHECK_IDS], [...beat.HOURLY_CHECK_IDS]);
});

test("built-funnels: every deep check a covered surface names runs hourly here", () => {
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) {
      assert.ok(beat.HOURLY_CHECK_IDS.includes(checkId) || beat.RUNS_ELSEWHERE[checkId], `${surface} needs ${checkId} hourly`);
    }
  }
});
