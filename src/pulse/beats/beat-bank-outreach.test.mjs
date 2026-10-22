import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-bank-outreach.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { VERIFIED_SQL as DAILY_VERIFIED_SQL } from "../coverage/gap-bank-outreach.mjs";
import { assertReadOnlySql } from "./readbox.mjs";
import { FIELD_CATALOG, LENDER_EXTRA_COLUMNS } from "../../outreach/model.mjs";

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

test("the hourly saved-result SQL compares every extra Lenders column a pushed product fills, and the read box accepts it", () => {
  const kindOf = (type) => type === "yesno" ? "yesno" : ["money", "pct", "months", "years", "score"].includes(type) ? "number" : "text";
  const keys = Object.keys(LENDER_EXTRA_COLUMNS);
  for (const key of keys) {
    const row = `('${key}', '${kindOf(FIELD_CATALOG[key].type)}', to_jsonb(l.${LENDER_EXTRA_COLUMNS[key]}))`;
    assert.equal(beat.VERIFIED_SQL.split(row).length - 1, 1, `${key} must be compared exactly once as ${row}`);
  }
  assert.match(beat.VERIFIED_SQL, /WHERE p\.facts \? ex\.key\s+AND coalesce\(ex\.actual, 'null'::jsonb\) IS DISTINCT FROM CASE ex\.kind/);
  assert.doesNotThrow(() => assertReadOnlySql(beat.VERIFIED_SQL));
});
