import assert from "node:assert/strict";
import test from "node:test";
import { selfTest } from "./beat-native-push.mjs";
import * as beat from "./beat-native-push.mjs";
import { runBeat } from "./contract.mjs";
import { ctxLog, makeFakeCtx } from "./ctx.mjs";
import { BOARD_APP_OPENS_SQL } from "../coverage/gap-crm-links.mjs";

const check = (scenario) => runBeat(beat, makeFakeCtx(beat, scenario));

test("native receipt hourly proof reads the real board and independent session-scoped saved opens", async () => {
  const ctx = makeFakeCtx(beat, selfTest.pass());
  const result = await runBeat(beat, ctx);
  assert.equal(result.ok, true, result.detail);
  assert.ok(beat.covers.includes("route:native/client-activity"));
  const reads = ctxLog(ctx).reads;
  const board = reads.find((read) => /FROM cards cd/.test(read.sql));
  const receipt = reads.find((read) => read.sql.trim() === beat.NATIVE_APP_OPENS_SQL.trim());
  assert.deepEqual(board.params, ["sales", "00000000-0000-4000-8000-000000000001", 500, false]);
  assert.deepEqual(receipt.params, ["00000000-0000-4000-8000-000000000001", ["c1000000-0000-4000-8000-000000000001"]]);
  assert.equal(beat.NATIVE_APP_OPENS_SQL.trim(), BOARD_APP_OPENS_SQL.trim());
});

test("native receipt hourly proof rejects a missing, forged, stale or invalid Sales app-open claim", async () => {
  for (const change of [
    (scenario) => { scenario.read[4].rows[0].app_first_authenticated_at = null; },
    (scenario) => { scenario.read[5].rows = []; },
    (scenario) => { scenario.read[4].rows[0].app_first_authenticated_at = "2026-10-31T00:00:00Z"; },
    (scenario) => { scenario.read[5].rows[0].first_authenticated_at = "invalid"; },
    (scenario) => { scenario.read[5].rows[0].client_id = "c2000000-0000-4000-8000-000000000002"; }
  ]) {
    const scenario = selfTest.pass();
    change(scenario);
    const result = await check(scenario);
    assert.equal(result.ok, false);
    assert.equal(result.step, "native-open-receipts");
  }
});

test("native receipt hourly proof keeps failed reads red and accepts an honestly absent open", async () => {
  for (const index of [4, 5]) {
    const scenario = selfTest.pass();
    scenario.read[index].error = new Error("native receipt read refused");
    const result = await check(scenario);
    assert.equal(result.ok, false);
    assert.equal(result.step, "native-open-receipts");
  }
  const noOrg = selfTest.pass();
  noOrg.read[2].rows = [];
  assert.equal((await check(noOrg)).ok, false);
  const noOpen = selfTest.pass();
  noOpen.read[4].rows[0].app_first_authenticated_at = null;
  noOpen.read[5].rows = [];
  const result = await check(noOpen);
  assert.equal(result.ok, true, result.detail);
});

test("native push beat passes only when signing, door, owners, and recent APNs receipts are healthy", async () => {
  const pass = await check(selfTest.pass());
  assert.equal(pass.ok, true, pass.detail);
  const fail = await check(selfTest.fail());
  assert.equal(fail.ok, false);
  assert.equal(fail.step, "device-owner");
});

test("native push beat catches a recent APNs failure without claiming delivery", async () => {
  const failed = selfTest.pass();
  failed.read[1].rows[0].recent_failed = 1;
  const result = await check(failed);
  assert.equal(result.ok, false);
  assert.equal(result.step, "recent-delivery-failure");

  const noReceiptCount = selfTest.pass();
  delete noReceiptCount.read[1].rows[0].recent_failed;
  const noProof = await check(noReceiptCount);
  assert.equal(noProof.ok, false);
  assert.equal(noProof.step, "recent-delivery-failure");
});

test("push preference beat catches a missing route and malformed saved choices", async () => {
  const noDoor = selfTest.pass();
  noDoor.http["GET https://fundhub.ai/api/push/preferences"] = { status: 404, body: "Not found" };
  const routeFail = await check(noDoor);
  assert.equal(routeFail.ok, false);
  assert.equal(routeFail.step, "preference-door");

  const malformed = selfTest.pass();
  malformed.read[0].rows[0].invalid_preferences = 1;
  const shapeFail = await check(malformed);
  assert.equal(shapeFail.ok, false);
  assert.equal(shapeFail.step, "preference-shape");

  const unreadable = selfTest.pass();
  delete unreadable.read[0].rows[0].invalid_preferences;
  const readFail = await check(unreadable);
  assert.equal(readFail.ok, false);
  assert.equal(readFail.step, "preference-shape");
});

test("native push beat catches a missing route and an unusable signing key", async () => {
  const noDoor = selfTest.pass();
  noDoor.http["GET https://fundhub.ai/api/push/native-device"] = { status: 404, body: "Not found" };
  const routeFail = await check(noDoor);
  assert.equal(routeFail.ok, false);
  assert.equal(routeFail.step, "door-mounted");

  const badKey = selfTest.pass();
  badKey.env.APNS_PRIVATE_KEY_BASE64 = Buffer.from("not a key").toString("base64");
  const signingFail = await check(badKey);
  assert.equal(signingFail.ok, false);
  assert.equal(signingFail.step, "signing-ready");
});
