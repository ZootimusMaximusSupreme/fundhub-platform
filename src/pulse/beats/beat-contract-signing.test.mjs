import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-contract-signing.mjs";
import * as truth from "./lib/contracts-truth.mjs";
import * as lane from "../coverage/gap-contracts.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const SITE = "https://fundhub.ai";
const doorSpec = (bare, forged) => laneSelfTest({
  ...beat.LANE,
  selfTest: { passRows: beat.LANE.selfTest.passRows, failHttp: { [`GET ${SITE}${truth.SIGN_PATH}`]: bare, [`GET ${SITE}${truth.FORGED_LINK}`]: forged } }
}, true);
const DOOR_404 = { status: 404, body: JSON.stringify({ ok: false, error: "not_found" }) };

test("contract-signing is valid, green when every contract can be signed and is stored, red on a signed contract with no file", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-contract-signing.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true, passed.detail);
  assert.equal(passed.detail, "3 contract checks passed");
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "contracts-signed-not-stored");
  assert.match(failed.detail, /1 signed contract has no stored signed file: 27b299b3/);
});

test("contract-signing: a sent contract nobody can sign is red at contracts-sent-unsignable", async () => {
  const spec = laneSelfTest({ ...beat.LANE, selfTest: { ...beat.LANE.selfTest, failRows: [[truth.SQL_SENT, [{ id: "c1", template_key: "X", status: "sent", why: "content_changed" }]]] } }, true);
  const result = await runBeat(beat, makeFakeCtx(beat, spec));
  assert.equal(result.ok, false);
  assert.equal(result.step, "contracts-sent-unsignable");
  assert.match(result.detail, /the words do not match the copy that was sent/);
});

test("contract-signing: the sign door is red on a router 404, a missing secret, a 200 and no answer", async () => {
  const cases = [
    [{ status: 404, body: JSON.stringify({ error: "not_found", path: "contracts/sign" }) }, DOOR_404, /router has no route/],
    [DOOR_404, { status: 503, body: JSON.stringify({ ok: false, error: "not_configured" }) }, /no signing secret/],
    [{ status: 200, body: "{}" }, DOOR_404, /answered 200 with no token/],
    [new Error("timed out after 8000ms"), DOOR_404, /The sign link did not answer: timed out after 8000ms/]
  ];
  for (const [bare, forged, words] of cases) {
    const result = await runBeat(beat, makeFakeCtx(beat, doorSpec(bare, forged)));
    assert.equal(result.ok, false);
    assert.equal(result.step, "contracts-sign-route");
    assert.match(result.detail, words);
  }
});

test("contract-signing: two reads and two GETs to our own site, nothing else", async () => {
  const ctx = makeFakeCtx(beat, beat.selfTest.pass());
  await runBeat(beat, ctx);
  const log = ctxLog(ctx);
  assert.equal(log.reads.filter((r) => !/FROM orgs/.test(r.sql)).length, 2);
  assert.equal(log.http.length, 2);
  assert.ok(log.http.every((c) => c.method === "GET" && c.host === "fundhub.ai"));
  assert.equal(log.refused.length, 0);
});

test("contract-signing: the daily lane and the hourly beat share one SQL and one judge", () => {
  assert.equal(lane.SQL_SENT, truth.SQL_SENT);
  assert.equal(lane.SQL_SIGNED, truth.SQL_SIGNED);
  assert.equal(lane.FORGED_LINK, truth.FORGED_LINK);
  assert.equal(lane.classifyBareSignGet, truth.classifyBareSignGet);
  assert.equal(lane.classifyForgedSignGet, truth.classifyForgedSignGet);
  for (const checkId of beat.HOURLY_CHECK_IDS) assert.ok(lane.CHECK_IDS.includes(checkId), checkId);
});

test("contract-signing: every deep check a covered surface names runs hourly here", () => {
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) {
      assert.ok(beat.HOURLY_CHECK_IDS.includes(checkId) || beat.RUNS_ELSEWHERE[checkId], `${surface} needs ${checkId} hourly`);
    }
  }
});
