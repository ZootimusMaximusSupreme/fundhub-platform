import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-bank-outreach.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { VERIFIED_SQL as DAILY_VERIFIED_SQL } from "../coverage/gap-bank-outreach.mjs";

test("bank outreach beat contract and PASS/FAIL self-test", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-bank-outreach.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  assert.equal((await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()))).ok, true);
  const fail = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(fail.ok, false);
  assert.equal(fail.step, "verified-result");
});

test("unprotected or missing read door goes red before product read", async () => {
  const fixture = beat.selfTest.pass();
  fixture.http["GET https://fundhub.ai/api/read/bank-outreach"] = { status: 200, body: "{}" };
  const result = await runBeat(beat, makeFakeCtx(beat, fixture));
  assert.equal(result.ok, false);
  assert.equal(result.step, "read-door");
});

test("pre-deploy bundle checks saved products while the new live door is pending", async () => {
  const fixture = beat.selfTest.pass();
  fixture.env = {};
  fixture.http["GET https://fundhub.ai/api/read/bank-outreach"] = { status: 404, body: "Not found" };
  const result = await runBeat(beat, makeFakeCtx(beat, fixture));
  assert.equal(result.ok, true);
  assert.ok(result.skipped.includes("read-door"));
  assert.ok(result.steps.some((step) => step.name === "verified-result" && step.ok));
});

test("hourly saved-result SQL has the same judge as the daily deep check", () => {
  const withoutTag = (sql) => sql.replace(/^\/\*[^*]*\*\//, "").trim();
  assert.equal(withoutTag(beat.VERIFIED_SQL), withoutTag(DAILY_VERIFIED_SQL));
});

test("a bank email after a stop or reply turns the hourly beat red at email-safety", async () => {
  const fixture = beat.selfTest.pass();
  fixture.read = [
    { match: /beat-bank-outreach:verified-result/, rows: [{ total: 2, broken: 0 }] },
    { match: /beat-bank-outreach:email-safety/, rows: [{ total: 5, unsafe: 1 }] }
  ];
  const result = await runBeat(beat, makeFakeCtx(beat, fixture));
  assert.equal(result.ok, false);
  assert.equal(result.step, "email-safety");
});
