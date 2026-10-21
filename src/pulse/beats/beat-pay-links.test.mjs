import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-pay-links.mjs";
import * as truth from "./lib/payments-truth.mjs";
import * as lane from "../coverage/gap-payments.mjs";
import * as whop from "./beat-whop-billing.mjs";
import * as vendorKeys from "./beat-vendor-keys.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const OTHER_BEATS = { "whop-billing": whop, "vendor-keys": vendorKeys };

test("pay-links is valid, green on zero misses, red when a Pay press got no link", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-pay-links.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true);
  assert.equal(passed.detail, "3 money checks passed");
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "payments-checkout-started-no-link");
  assert.match(failed.detail, /1 Pay press in the last 3 days with no checkout link made/);
});

test("pay-links: money on an open link and a missing grant each go red at their own step", async () => {
  const cases = [
    ["payments-pay-link-webhook", truth.PAY_LINK_WEBHOOK_SQL, { n: 1, rec_n: 1, money_n: 0, sim_n: 0 }],
    ["payments-paid-no-entitlement", truth.PAID_NO_ENTITLEMENT_SQL, { n: 2, sim_n: 0 }]
  ];
  for (const [step, sql, bad] of cases) {
    const spec = laneSelfTest({ ...beat.LANE, selfTest: { passRows: beat.LANE.selfTest.passRows, failRows: [[sql, [bad]]] } }, true);
    const result = await runBeat(beat, makeFakeCtx(beat, spec));
    assert.equal(result.ok, false, step);
    assert.equal(result.step, step);
  }
});

test("pay-links: a Pay-press read with no row is skipped, never green", async () => {
  const rows = beat.LANE.selfTest.passRows.filter(([sql]) => sql !== truth.CHECKOUT_STARTED_NO_LINK_SQL);
  const result = await runBeat(beat, makeFakeCtx(beat, laneSelfTest({ ...beat.LANE, selfTest: { passRows: rows } })));
  assert.equal(result.ok, true);
  assert.match(result.detail, /^2 money checks passed; 1 had nothing safe to judge$/);
  assert.ok(result.steps.find((step) => step.name === "payments-checkout-started-no-link").skipped);
});

test("pay-links: the daily lane and the hourly beat share one SQL and one judge", () => {
  assert.equal(lane.CHECKOUT_STARTED_NO_LINK_SQL, truth.CHECKOUT_STARTED_NO_LINK_SQL);
  assert.equal(lane.PAY_LINK_WEBHOOK_SQL, truth.PAY_LINK_WEBHOOK_SQL);
  assert.equal(lane.PAID_NO_ENTITLEMENT_SQL, truth.PAID_NO_ENTITLEMENT_SQL);
  assert.equal(lane.TEST_CLIENT_EMAIL_RE, truth.TEST_CLIENT_EMAIL_RE);
  for (const checkId of beat.HOURLY_CHECK_IDS) assert.ok(lane.CHECK_IDS.includes(checkId), checkId);
});

test("pay-links: every deep check a covered door names runs hourly, here or at a named step of another beat", () => {
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
    }
  }
});
