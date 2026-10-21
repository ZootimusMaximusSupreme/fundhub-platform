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
import * as keysTruth from "./lib/keys-truth.mjs";
import * as keysLane from "../coverage/gap-keys.mjs";
import { PARKED_FEATURES, parkedState } from "../parked-features.mjs";

/** The beat's pass rows and settings, with some rows and settings changed. */
function keysCtx({ rows = [], env = beat.SELF_TEST_ENV } = {}) {
  const swapped = beat.LANE.selfTest.passRows.map(([sql, value]) => {
    const hit = rows.find(([wanted]) => wanted === sql);
    return hit ? hit : [sql, value];
  });
  return makeFakeCtx(beat, laneSelfTest({ ...beat.LANE, selfTest: { passRows: swapped, passEnv: env } }));
}

test("bank-links: the launch keys step is green on today's settings, with the paused Lendflow secret not judged", async () => {
  const result = await runBeat(beat, keysCtx());
  assert.equal(result.ok, true, result.detail);
  const step = result.steps.find((s) => s.name === "keys-launch-secrets-present");
  assert.ok(step && !step.skipped);
});

test("bank-links: a missing or masked launch key is red at keys-launch-secrets-present, by name, never by value", async () => {
  for (const [name, bad] of [["PLAID_SECRET", undefined], ["PLAID_TOKEN_ENC_KEY", "****************f377"], ["MERCHANT_SECRET_ENC_KEY", ""]]) {
    const env = { ...beat.SELF_TEST_ENV };
    if (bad === undefined) delete env[name];
    else env[name] = bad;
    const result = await runBeat(beat, keysCtx({ env }));
    assert.equal(result.ok, false, name);
    assert.equal(result.step, "keys-launch-secrets-present");
    assert.match(result.detail, new RegExp(`${name} (is not set|is a row of asterisks)`));
    assert.doesNotMatch(result.detail, /selftest-value|f377/);
  }
});

test("bank-links: the Lendflow secret is judged again the day a Lendflow webhook arrives", async () => {
  const result = await runBeat(beat, keysCtx({ rows: [[keysTruth.LENDFLOW_PARK.sql, [{ captures: 1 }]]] }));
  assert.equal(result.ok, false);
  assert.equal(result.step, "keys-launch-secrets-present");
  assert.match(result.detail, /LENDFLOW_WEBHOOK_SECRET is not set/);
  // A park read that does not come back never parks: the secret is judged.
  const lost = await runBeat(beat, keysCtx({ rows: [[keysTruth.LENDFLOW_PARK.sql, []]] }));
  assert.equal(lost.ok, false);
  assert.match(lost.detail, /LENDFLOW_WEBHOOK_SECRET is not set/);
});

test("bank-links: off the live server the launch keys step is nothing to judge, never green", async () => {
  const env = { ...beat.SELF_TEST_ENV };
  delete env.LAMBDA_TASK_ROOT;
  const result = await runBeat(beat, keysCtx({ env }));
  assert.equal(result.ok, true);
  assert.match(result.detail, /^5 bank checks passed; 1 had nothing safe to judge$/);
  const step = result.steps.find((s) => s.name === "keys-launch-secrets-present");
  assert.ok(step.skipped);
  assert.match(step.why, /not the live server/);
});

test("bank-links: the launch keys judge is gap-keys.mjs's own, and the Lendflow park read equals parked-features.mjs", async () => {
  assert.equal(keysLane.launchSecretsPresent, keysTruth.launchSecretsPresent);
  assert.equal(keysLane.LAUNCH_SECRETS, keysTruth.LAUNCH_SECRETS);
  assert.equal(keysLane.lendflowParkedKeys, keysTruth.lendflowParkedKeys);
  const original = PARKED_FEATURES.lendflow;
  assert.equal(keysTruth.LENDFLOW_PARK.sql, original.sql, "parked-features.mjs changed the Lendflow read: copy it into lib/keys-truth.mjs");
  assert.deepEqual([...keysTruth.LENDFLOW_PARK.env], [...original.env]);
  for (const r of [{ captures: 0 }, { captures: 1 }, { captures: 7 }, { captures: "0" }, { captures: null }, { captures: "" }, { captures: "x" }, {}]) {
    assert.deepEqual(keysTruth.LENDFLOW_PARK.judge(r), original.judge(r), JSON.stringify(r));
  }
  const settings = [
    {},
    { LENDFLOW_API_KEY: "real" },
    { LENDFLOW_WEBHOOK_SECRET: "real", LENDFLOW_API_KEY: "real" },
    { LENDFLOW_WEBHOOK_SECRET: "****************abcd" },
    { LENDFLOW_API_KEY: "*masked" },
    { LENDFLOW_API_KEY: "   " }
  ];
  const answers = [{ rows: [{ captures: 0 }] }, { rows: [{ captures: 2 }] }, { rows: [] }, new Error("relation webhook_captures does not exist")];
  for (const env of settings) {
    for (const answer of answers) {
      const read = async () => { if (answer instanceof Error) throw answer; return answer; };
      const scope = (fn) => fn({ query: read });
      const want = await parkedState("lendflow", { scope, env });
      const got = await keysTruth.lendflowParked({ read, env });
      assert.deepEqual(got, want, `${JSON.stringify(env)} ${answer instanceof Error ? "error" : JSON.stringify(answer)}`);
    }
  }
  assert.deepEqual(await keysTruth.lendflowParked({ env: {} }), await parkedState("lendflow", { env: {} }));
});

test("bank-links is valid, green on healthy logins, red at banks-sync-stale on a stuck one", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-bank-links.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true);
  assert.equal(passed.detail, "6 bank checks passed");
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
  const result = await runBeat(beat, makeFakeCtx(beat, laneSelfTest({ ...beat.LANE, selfTest: { passRows: rows, passEnv: beat.SELF_TEST_ENV } })));
  assert.equal(result.ok, true);
  assert.match(result.detail, /^5 bank checks passed; 1 had nothing safe to judge$/);
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
