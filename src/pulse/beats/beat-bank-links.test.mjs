import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-bank-links.mjs";
import * as linksTruth from "./lib/bank-links-truth.mjs";
import * as banksTruth from "./lib/banks-truth.mjs";
import * as linksLane from "../coverage/gap-bank-links.mjs";
import * as banksLane from "../coverage/gap-banks.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

test("bank-links is valid, green on healthy logins, red at banks-sync-stale on a stuck one", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-bank-links.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true);
  assert.equal(passed.detail, "5 bank checks passed");
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "banks-sync-stale");
  assert.match(failed.detail, /1 live bank login has not synced in 3 days/);
  assert.match(failed.detail, /ITEM_LOGIN_REQUIRED/);
});

test("bank-links: each of its five checks can go red at its own step", async () => {
  const cases = [
    ["banks-login-broken", linksTruth.LOGIN_SQL, { banks: 2, broken: 1, in_error: 1, clients: 1, oldest: "2026-10-07T19:07:00.000Z", last_code: "ITEM_LOGIN_REQUIRED" }],
    ["banks-merchant-sync", linksTruth.MERCHANT_SQL, { live: 1, late: 1, errored: 1, quiet: 0, oldest: "2026-10-06T19:07:00.000Z", sample_error: "key expired" }],
    ["banks-linked-not-on-screen", banksTruth.HIDDEN_SQL, { n: 1 }],
    ["banks-active-link-no-accounts", banksTruth.EMPTY_SQL, { clients: 1, items: 1 }]
  ];
  for (const [step, sql, bad] of cases) {
    const spec = laneSelfTest({ ...beat.LANE, selfTest: { passRows: beat.LANE.selfTest.passRows, failRows: [[sql, [bad]]] } }, true);
    const result = await runBeat(beat, makeFakeCtx(beat, spec));
    assert.equal(result.ok, false, step);
    assert.equal(result.step, step);
  }
});

test("bank-links: no live merchant connection is nothing to judge, never green", async () => {
  const rows = beat.LANE.selfTest.passRows.map(([sql, value]) => (sql === linksTruth.MERCHANT_SQL ? [sql, [{ live: 0, late: 0, errored: 0, quiet: 0 }]] : [sql, value]));
  const result = await runBeat(beat, makeFakeCtx(beat, laneSelfTest({ ...beat.LANE, selfTest: { passRows: rows } })));
  assert.equal(result.ok, true);
  assert.match(result.detail, /^4 bank checks passed; 1 had nothing safe to judge$/);
  assert.ok(result.steps.find((step) => step.name === "banks-merchant-sync").skipped);
});

test("bank-links: the daily lanes and the hourly beat share one SQL, one judge and one schedule", () => {
  assert.equal(linksLane.runBankLinkChecks, linksTruth.runBankLinkChecks);
  assert.equal(linksLane.LOGIN_SQL, linksTruth.LOGIN_SQL);
  assert.equal(banksLane.runBanksChecks, banksTruth.runBanksChecks);
  assert.equal(banksLane.STALE_SQL, banksTruth.STALE_SQL);
  assert.deepEqual({ ...beat.SYNC_SCHEDULE }, { ...banksLane.SYNC_SCHEDULE });
  for (const checkId of beat.LINK_CHECK_IDS) assert.ok(linksTruth.CHECK_IDS.includes(checkId), checkId);
  for (const checkId of beat.SCREEN_CHECK_IDS) assert.ok(banksTruth.BANK_SCREEN_CHECK_IDS.includes(checkId), checkId);
});

test("bank-links: every surface it covers has every named deep check run here", () => {
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) assert.ok(beat.HOURLY_CHECK_IDS.includes(checkId), `${surface} needs ${checkId}`);
  }
});
