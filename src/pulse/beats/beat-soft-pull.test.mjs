import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-soft-pull.mjs";
import * as truth from "./lib/soft-pull-truth.mjs";
import * as keyTruth from "./lib/credit-pull-key-truth.mjs";
import * as consentBeat from "./beat-consent-capture.mjs";
import * as lane from "../coverage/gap-soft-pull.mjs";
import * as keysLane from "../coverage/gap-keys.mjs";
import * as crs from "../../finance/crs-identities.mjs";
import { classifyVisitor } from "../../slo/visitor.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { SELF_TEST_NOW, laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const OTHER_BEATS = { "consent-capture": consentBeat };
const SITE = "https://fundhub.ai";
const HOUR = 60 * 60 * 1000;
const iso = (msAgo) => new Date(SELF_TEST_NOW.getTime() - msAgo).toISOString();
const withRows = (rows, over = {}) => ({
  ...laneSelfTest({ ...beat.LANE, selfTest: { ...beat.LANE.selfTest, failRows: rows } }, true),
  ...over
});

test("soft-pull is valid, green on a healthy ledger and a live setup, red when a pull failed and nobody retried", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-soft-pull.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true, passed.detail);
  assert.equal(passed.detail, "6 soft pull checks passed");
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "softpull-request-failed-or-stuck");
  assert.match(failed.detail, /1 failed in the last 3 days \(reason: vendor timeout\)/);
});

test("soft-pull: a paid buyer past 2 hours with no form and no reminder is red at the paid-form step", async () => {
  const client = "cccccccc-dddd-4eee-8fff-000000000001";
  const rows = [[truth.PAID_FORM_ORDERS_SQL, [{ order_id: "o1", client_id: client, email: "buyer@gmail.com", paid_at: iso(3 * HOUR) }]]];
  const result = await runBeat(beat, makeFakeCtx(beat, withRows(rows)));
  assert.equal(result.ok, false);
  assert.equal(result.step, "softpull-paid-form-not-filled-2h");
  assert.match(result.detail, /1 paid roadmap buyer has not filled the pull form for over 2 hours/);
});

test("soft-pull: a client who approved and paid with no pull 15 minutes later is red at the approve-click step", async () => {
  const client = "cccccccc-dddd-4eee-8fff-000000000002";
  const rows = [
    [truth.PAID_DIAGNOSTICS_SQL, [{ order_id: "o2", client_id: client, paid_at: iso(HOUR) }]],
    [truth.LIVE_CONSENT_SQL, [{ client_id: client, granted_at: iso(2 * HOUR) }]],
    [truth.PULL_TIMES_SQL, []]
  ];
  const result = await runBeat(beat, makeFakeCtx(beat, withRows(rows)));
  assert.equal(result.ok, false);
  assert.equal(result.step, "softpull-approve-click-no-pull");
  assert.match(result.detail, /approved the pull and paid, and no pull was started/);
});

test("soft-pull: a broken approve screen or read door is red at its own step", async () => {
  const page = `GET ${SITE}${truth.APPROVE_PAGE_PATH}`;
  const read = `GET ${SITE}${truth.APPROVE_READ_PATH}`;
  for (const [key, answer, step, words] of [
    [page, { status: 404, body: "Not found" }, "soft-pull-approve-page", /approve screen answered 404/],
    [page, { status: 200, body: "<html>some other page</html>" }, "soft-pull-approve-page", /without its read route/],
    [read, { status: 500, body: "boom" }, "soft-pull-approve-read", /read API answered 500/],
    [read, { status: 200, body: "{}" }, "soft-pull-approve-read", /not the approval read shape/]
  ]) {
    const spec = laneSelfTest({ ...beat.LANE, selfTest: { ...beat.LANE.selfTest, failHttp: { ...beat.LANE.selfTest.passHttp, [key]: answer } } }, true);
    const result = await runBeat(beat, makeFakeCtx(beat, spec));
    assert.equal(result.ok, false, words.source);
    assert.equal(result.step, step);
    assert.match(result.detail, words);
  }
});

test("soft-pull: the credit key is red on the live server when the host is the vendor's test host, and a skip on a laptop", async () => {
  const red = await runBeat(beat, makeFakeCtx(beat, { ...beat.selfTest.pass(), env: { ...beat.LANE.selfTest.passEnv, CRS_API_HOST: "api-sandbox.stitchcredit.com" } }));
  assert.equal(red.ok, false);
  assert.equal(red.step, "keys-credit-pull-live-allowed");
  assert.match(red.detail, /vendor's test host/);
  const laptop = await runBeat(beat, makeFakeCtx(beat, { ...beat.selfTest.pass(), env: {} }));
  assert.equal(laptop.ok, true);
  assert.ok(laptop.steps.find((s) => s.name === "keys-credit-pull-live-allowed").skipped);
});

test("soft-pull: GETs only our own site, never the signed handler, and reads only the ledger tables", async () => {
  const ctx = makeFakeCtx(beat, beat.selfTest.pass());
  await runBeat(beat, ctx);
  const log = ctxLog(ctx);
  assert.equal(log.refused.length, 0);
  assert.deepEqual(log.http.map((c) => `${c.method} ${c.host}`), ["GET fundhub.ai", "GET fundhub.ai"]);
  assert.ok(!log.reads.some((r) => /gap:soft-pull-client/.test(r.sql)), "the signed approve read stays in the morning lane");
});

test("soft-pull: the copies equal the code they were taken from", () => {
  for (const email of ["buyer@gmail.com", "chris@fundhub.ai", "x@example.com", "e2e.buyer@gmail.com", "sim+1@gmail.com", "", "test@acme.com"]) {
    for (const userAgent of [undefined, "Mozilla/5.0", "HeadlessChrome/1"]) {
      assert.deepEqual(truth.classifyVisitor({ email, userAgent }), classifyVisitor({ email, userAgent }), `${email} ${userAgent}`);
    }
  }
  assert.deepEqual(truth.classifyVisitor({ webdriver: true }), classifyVisitor({ webdriver: true }));
  assert.equal(keyTruth.CRS_SANDBOX_HOST, crs.CRS_SANDBOX_HOST);
  assert.equal(keyTruth.CRS_PRODUCTION_HOST, crs.CRS_PRODUCTION_HOST);
  assert.equal(keyTruth.CRS_ALLOW_LIVE, crs.CRS_ALLOW_LIVE);
  for (const host of ["", "mware.crscreditapi.com", "https://MWARE.crscreditapi.com:443/api", "user@api-sandbox.stitchcredit.com", "example.com", null]) {
    assert.equal(keyTruth.normalizeHost(host), crs.normalizeHost(host), String(host));
    assert.equal(keyTruth.isSandboxHost(host), crs.isSandboxHost(host), String(host));
    assert.equal(keyTruth.isProductionHost(host), crs.isProductionHost(host), String(host));
  }
  for (const on of [undefined, "", "1", "true", "YES", " on ", "0", "false", "maybe"]) {
    const env = on === undefined ? {} : { CRS_ALLOW_LIVE: on };
    assert.equal(keyTruth.livePullAllowed(env), crs.livePullAllowed(env), String(on));
  }
});

test("soft-pull: the daily lanes and the hourly beat share one SQL and one judge", () => {
  assert.equal(lane.LEDGER_SQL, truth.LEDGER_SQL);
  assert.equal(lane.PAID_FORM_ORDERS_SQL, truth.PAID_FORM_ORDERS_SQL);
  assert.equal(lane.PAID_DIAGNOSTICS_SQL, truth.PAID_DIAGNOSTICS_SQL);
  assert.equal(lane.judgeLedger, truth.judgeLedger);
  assert.equal(lane.judgePaidForm, truth.judgePaidForm);
  assert.equal(lane.judgeNoPull, truth.judgeNoPull);
  assert.equal(lane.approveReadShape, truth.approveReadShape);
  assert.equal(keysLane.creditPullLiveAllowed, keyTruth.creditPullLiveAllowed);
  assert.equal(keysLane.keyState, keyTruth.keyState);
  for (const checkId of beat.HOURLY_CHECK_IDS.filter((c) => c !== "keys:credit-pull-live-allowed")) {
    assert.ok(lane.ALL_CHECK_IDS.includes(checkId), checkId);
  }
  assert.ok(keysLane.CHECK_IDS.includes("keys:credit-pull-live-allowed"));
});

test("soft-pull: every deep check a covered surface names runs hourly, here or at a named step of another beat", () => {
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) {
      if (beat.HOURLY_CHECK_IDS.includes(checkId)) continue;
      const elsewhere = beat.RUNS_ELSEWHERE[checkId];
      assert.ok(elsewhere, `${surface} needs ${checkId} hourly`);
      const [otherId, step] = elsewhere;
      assert.equal(OTHER_BEATS[otherId].id, otherId);
      assert.ok(OTHER_BEATS[otherId].steps.includes(step), `${otherId} has no step ${step}`);
      assert.ok(OTHER_BEATS[otherId].HOURLY_CHECK_IDS.includes(checkId), `${otherId} does not run ${checkId}`);
    }
  }
});
