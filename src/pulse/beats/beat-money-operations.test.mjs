import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-money-operations.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { STAFF_PAYOUT_INTEGRITY_SQL, HEALTHY_STAFF_PAYOUT_COUNTS } from "./lib/money-staff-payout-truth.mjs";
import { COMPANY_CASH_INTEGRITY_SQL, HEALTHY_COMPANY_CASH_COUNTS } from "./lib/money-company-cash-truth.mjs";

test("money-operations is valid and all eleven operations judges can go green and red", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-money-operations.mjs" }), []);
  assert.equal(beat.checkIds.length, 11);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.step, "ads-meta-load-jobs");
  assert.deepEqual(failed.steps.map((step) => step.name), beat.steps);
});

test("the hourly beat flags a bad posted company cash payment without a provider call", async () => {
  const scenario = beat.selfTest.pass(), originalRead = scenario.read;
  scenario.read = (sql, params) => sql === COMPANY_CASH_INTEGRITY_SQL
    ? { rows: [{ ...HEALTHY_COMPANY_CASH_COUNTS, linked_items_n: 1, accounts_n: 1,
      selected_n: 1, bad_paid_n: 1 }] }
    : originalRead(sql, params);
  const result = await runBeat(beat, makeFakeCtx(beat, scenario));
  assert.equal(result.ok, false);
  assert.equal(result.step, "company-cash-integrity");
  assert.ok(beat.covers.includes("route:owner/company-bank"));
  assert.ok(beat.covers.includes("route:owner/company-cash"));
  assert.ok(beat.covers.includes("desk:company-cash.html"));
});


test("the hourly money beat keeps corrupt saved staff payout destinations red without provider writes", async () => {
  const scenario = beat.selfTest.pass(), originalRead = scenario.read;
  scenario.read = (sql, params) => sql === STAFF_PAYOUT_INTEGRITY_SQL
    ? { rows: [{ ...HEALTHY_STAFF_PAYOUT_COUNTS, active_n: 1, wrong_owner_n: 1 }] }
    : originalRead(sql, params);
  const result = await runBeat(beat, makeFakeCtx(beat, scenario));
  assert.equal(result.ok, false);
  assert.equal(result.step, "staff-payout-destination-integrity");
  assert.ok(beat.covers.includes("route:staff/payout-account"));
  assert.ok(beat.covers.includes("route:read/staff-payout-account"));
});
