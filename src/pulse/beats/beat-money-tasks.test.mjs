import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-money-tasks.mjs";
import * as truth from "./lib/money-helper-truth.mjs";
import * as lane from "../coverage/gap-money-helper.mjs";
import { TEST_CLIENT_EMAIL_RE as CONSENT_TEST_CLIENT_EMAIL_RE } from "../coverage/gap-consent.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { ctxLog, makeFakeCtx } from "./ctx.mjs";
import { assertReadOnlySql } from "./readbox.mjs";
import { SELF_TEST_NOW, SELF_TEST_ORG, laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const withRow = (row) => laneSelfTest({ ...beat.LANE, selfTest: { passRows: [[truth.STUCK_SQL, [row]]] } });

test("money-tasks is valid, green when nothing is stuck, red at helper-rows-stuck on queued Do tasks", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-money-tasks.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passCtx = makeFakeCtx(beat, beat.selfTest.pass());
  const passed = await runBeat(beat, passCtx);
  assert.equal(passed.ok, true, passed.detail);
  assert.equal(passed.detail, "1 money helper checks passed");
  assert.deepEqual(ctxLog(passCtx).refused, []);
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "helper-rows-stuck");
  assert.match(failed.detail, /2 Do task rows are still queued after 10 minutes/);
});

test("money-tasks: each of the six stuck states goes red at helper-rows-stuck by itself", async () => {
  const cases = [
    ["tasks_queued", /1 Do task row is still queued/],
    ["tasks_claimed", /1 Do task row was claimed and never finished/],
    ["proposals_late", /1 money proposal is still waiting on the client/],
    ["turns_open", /1 helper chat message has no answer/],
    ["turns_failed", /1 helper chat message failed in the last day/],
    ["ready_no_task", /1 client pressed "ready to get funded" and has no CSM prep-call task/]
  ];
  for (const [key, re] of cases) {
    const result = await runBeat(beat, makeFakeCtx(beat, withRow({ ...beat.ZERO_ROW, [key]: 1 })));
    assert.equal(result.ok, false, key);
    assert.equal(result.step, "helper-rows-stuck", key);
    assert.match(result.detail, re, key);
  }
});

test("money-tasks: the read box takes the SQL whole, and the beat hands it the lane's own parameters", async () => {
  assert.equal(assertReadOnlySql(truth.STUCK_SQL), truth.STUCK_SQL);
  const ctx = makeFakeCtx(beat, beat.selfTest.pass());
  await runBeat(beat, ctx);
  const reads = ctxLog(ctx).reads.filter((entry) => entry.sql === truth.STUCK_SQL);
  assert.equal(reads.length, 1);
  // Same nine parameters the morning lane sends: the default company, demo off, the test-client pattern.
  assert.deepEqual(reads[0].params, truth.stuckParams({ orgId: SELF_TEST_ORG, demoOn: false, now: SELF_TEST_NOW }));
  assert.equal(reads[0].params[1], false);
  assert.equal(reads[0].params[2], CONSENT_TEST_CLIENT_EMAIL_RE);
});

test("money-tasks: a read that fails or comes back empty is nothing to judge, never green", async () => {
  const boom = laneSelfTest(beat.LANE);
  boom.read = async (sql, params) => {
    if (String(sql).includes("gap:helper-rows-stuck")) throw new Error("canceling statement due to statement timeout");
    return laneSelfTest(beat.LANE).read(sql, params);
  };
  for (const spec of [boom, laneSelfTest({ ...beat.LANE, selfTest: { passRows: [[truth.STUCK_SQL, []]] } })]) {
    const result = await runBeat(beat, makeFakeCtx(beat, spec));
    assert.equal(result.ok, true, result.detail);
    assert.match(result.detail, /^0 money helper checks passed; 1 had nothing safe to judge$/);
    assert.ok(result.steps.find((step) => step.name === "helper-rows-stuck").skipped);
  }
});

test("money-tasks: the daily lane and the hourly beat share one SQL, one judge and one test-client pattern", async () => {
  assert.equal(lane.runMoneyHelperChecks, truth.runMoneyHelperChecks);
  assert.equal(lane.STUCK_SQL, truth.STUCK_SQL);
  assert.equal(lane.judge, truth.judge);
  assert.equal(lane.stuckParams, truth.stuckParams);
  assert.equal(lane.CHECK_IDS, truth.CHECK_IDS);
  assert.deepEqual([...beat.HOURLY_CHECK_IDS], [...truth.CHECK_IDS]);
  // The lib's copy of gap-consent.mjs's pattern (a beat cannot import that file) must not drift.
  assert.equal(truth.TEST_CLIENT_EMAIL_RE, CONSENT_TEST_CLIENT_EMAIL_RE);
  // The lane's gapChecks runs the lib's reader with the same parameters.
  const seen = [];
  const db = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [beat.ZERO_ROW] }; } };
  const rows = await lane.gapChecks({ db, now: SELF_TEST_NOW, orgId: SELF_TEST_ORG });
  assert.equal(rows[0].status, "PASS");
  assert.equal(seen[0].sql, truth.STUCK_SQL);
  assert.deepEqual(seen[0].params, truth.stuckParams({ orgId: SELF_TEST_ORG, demoOn: false, now: SELF_TEST_NOW }));
});

test("money-tasks: every surface it covers has every named deep check run here", () => {
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) assert.ok(beat.HOURLY_CHECK_IDS.includes(checkId), `${surface} needs ${checkId}`);
  }
  // finance-os:helper opens the real api/money/helper.mjs handler on the morning pulse and is not hourly,
  // so the two surfaces that name it stay off `covers` (the loop above would fail if they were added).
  for (const surface of ["desk:money-helper.html", "route:money/helper"]) {
    assert.ok(TRIPWIRES[surface].checks.includes("finance-os:helper"), surface);
    assert.ok(!beat.covers.includes(surface), surface);
  }
});
