import assert from "node:assert/strict";
import test from "node:test";
import { selfTest } from "./beat-native-push.mjs";
import * as beat from "./beat-native-push.mjs";
import { runBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";

const check = (scenario) => runBeat(beat, makeFakeCtx(beat, scenario));

test("native push beat passes only when signing, door, owners, and recent APNs receipts are healthy", async () => {
  const pass = await check(selfTest.pass());
  assert.equal(pass.ok, true, pass.detail);
  const fail = await check(selfTest.fail());
  assert.equal(fail.ok, false);
  assert.equal(fail.step, "device-owner");
});

test("native push beat catches a recent APNs failure without claiming delivery", async () => {
  const failed = selfTest.pass();
  failed.read[0].rows[0].recent_failed = 1;
  const result = await check(failed);
  assert.equal(result.ok, false);
  assert.equal(result.step, "recent-delivery-failure");

  const noReceiptCount = selfTest.pass();
  delete noReceiptCount.read[0].rows[0].recent_failed;
  const noProof = await check(noReceiptCount);
  assert.equal(noProof.ok, false);
  assert.equal(noProof.step, "recent-delivery-failure");
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
