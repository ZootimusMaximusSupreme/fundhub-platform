import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-partner-pages.mjs";
import * as truth from "./lib/partner-pages-truth.mjs";
import * as lane from "../coverage/gap-partner-pages.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

test("partner-pages is valid, green when every published page opens, red when one is the not-live page", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-partner-pages.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true, passed.detail);
  assert.equal(passed.detail, "1 partner page checks passed");
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "partner-pages-live");
  assert.match(failed.detail, /1 published partner page is not live \(of 2 published\): 068b933c…\/apply answered 404/);
});

test("partner-pages: a 200 that is the not-live page and a page that never answers are red too", async () => {
  const [a, b] = Object.keys(beat.LANE.selfTest.passHttp);
  for (const [answer, words] of [
    [{ status: 200, body: "Nothing is live at this web address" }, /answered 200 with the not-live page/],
    [new Error("timed out after 8000ms"), /did not answer \(timed out after 8000ms\)/]
  ]) {
    const spec = laneSelfTest({ ...beat.LANE, selfTest: { ...beat.LANE.selfTest, failHttp: { [a]: answer, [b]: beat.LANE.selfTest.passHttp[b] } } }, true);
    const result = await runBeat(beat, makeFakeCtx(beat, spec));
    assert.equal(result.ok, false);
    assert.equal(result.step, "partner-pages-live");
    assert.match(result.detail, words);
  }
});

test("partner-pages: no published page is green and makes no web call; a list that cannot be read is skipped, never green", async () => {
  const none = laneSelfTest({ ...beat.LANE, selfTest: { passRows: [[truth.PUBLISHED_SQL, []]] } });
  const ctx = makeFakeCtx(beat, none);
  const green = await runBeat(beat, ctx);
  assert.equal(green.ok, true);
  assert.equal(ctxLog(ctx).http.length, 0);

  const broken = { ...none, read: async (sql) => {
    if (/FROM orgs/.test(sql)) return { rows: [{ id: "00000000-0000-4000-8000-000000000001" }] };
    throw new Error("connection terminated");
  } };
  const skipped = await runBeat(beat, makeFakeCtx(beat, broken));
  assert.equal(skipped.ok, true);
  assert.match(skipped.detail, /1 had nothing safe to judge/);
  assert.ok(skipped.steps.find((s) => s.name === "partner-pages-live").skipped);
});

test("partner-pages: reads only our own site, GET only", async () => {
  const ctx = makeFakeCtx(beat, beat.selfTest.pass());
  await runBeat(beat, ctx);
  const log = ctxLog(ctx);
  assert.equal(log.http.length, 2);
  assert.ok(log.http.every((call) => call.method === "GET" && call.host === "fundhub.ai"));
  assert.equal(log.refused.length, 0);
});

test("partner-pages: the daily lane and the hourly beat share one SQL and one judge", () => {
  assert.equal(lane.PUBLISHED_SQL, truth.PUBLISHED_SQL);
  assert.equal(lane.readPage, truth.readPage);
  assert.equal(lane.pickPages, truth.pickPages);
  assert.deepEqual([...lane.CHECK_IDS], [...beat.HOURLY_CHECK_IDS]);
});

test("partner-pages: every deep check a covered surface names runs hourly here", () => {
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) {
      assert.ok(beat.HOURLY_CHECK_IDS.includes(checkId) || beat.RUNS_ELSEWHERE[checkId], `${surface} needs ${checkId} hourly`);
    }
  }
});
