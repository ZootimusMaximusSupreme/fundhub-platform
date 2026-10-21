import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-consent-capture.mjs";
import * as truth from "./lib/consent-truth.mjs";
import * as lane from "../coverage/gap-consent.mjs";
import { CONSENT_VALID_SQL } from "../../consent/index.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const withRow = (sql, row) => laneSelfTest({ ...beat.LANE, selfTest: { passRows: beat.LANE.selfTest.passRows, failRows: [[sql, [row]]] } }, true);

test("consent-capture is valid, green on zero misses, red when a signed paper has no consent row", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-consent-capture.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true, passed.detail);
  assert.equal(passed.detail, "3 consent checks passed");
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "consent-store");
  assert.match(failed.detail, /1 signed soft-pull paper has no consent row/);
});

test("consent-capture: a paid client with no consent and a roadmap order with no consent row each go red at their own step", async () => {
  const cases = [
    ["consent-required", truth.REQUIRED_SQL, /2 clients paid for a credit report over 24 hours ago/],
    ["consent-slo-store", truth.SLO_STORE_SQL, /1 roadmap order saved an identity and no consent row/]
  ];
  for (const [step, sql, words] of cases) {
    const result = await runBeat(beat, makeFakeCtx(beat, withRow(sql, { n: step === "consent-required" ? 2 : 1 })));
    assert.equal(result.ok, false, step);
    assert.equal(result.step, step);
    assert.match(result.detail, words);
  }
});

test("consent-capture: a read that gives no count is red, never green", async () => {
  const result = await runBeat(beat, makeFakeCtx(beat, withRow(truth.STORE_SQL, { n: null })));
  assert.equal(result.ok, false);
  assert.equal(result.step, "consent-store");
  assert.match(result.detail, /did not return a count/);
});

test("consent-capture: three reads, no web call, and the repair-client count is not read hourly", async () => {
  const ctx = makeFakeCtx(beat, beat.selfTest.pass());
  await runBeat(beat, ctx);
  const log = ctxLog(ctx);
  assert.equal(log.http.length, 0);
  const sqls = log.reads.map((r) => r.sql.replace(/\s+/g, " ").trim());
  assert.ok(!sqls.some((s) => s.includes("repair_programs")), "consent:dispute-required stays daily");
  assert.equal(sqls.filter((s) => s.includes("count(*)::int AS n")).length, 3);
});

test("consent-capture: the copied validity rule equals the one the pull gate uses", () => {
  assert.equal(truth.CONSENT_VALID_SQL, CONSENT_VALID_SQL);
});

test("consent-capture: the daily lane and the hourly beat share one SQL and one judge", () => {
  assert.equal(lane.REQUIRED_SQL, truth.REQUIRED_SQL);
  assert.equal(lane.STORE_SQL, truth.STORE_SQL);
  assert.equal(lane.SLO_STORE_SQL, truth.SLO_STORE_SQL);
  assert.equal(lane.DISPUTE_SQL, truth.DISPUTE_SQL);
  assert.equal(lane.TEST_CLIENT_EMAIL_RE, truth.TEST_CLIENT_EMAIL_RE);
  for (const checkId of beat.HOURLY_CHECK_IDS) assert.ok(lane.CHECK_IDS.includes(checkId), checkId);
});

test("consent-capture: every deep check a covered surface names runs hourly here", () => {
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) {
      assert.ok(beat.HOURLY_CHECK_IDS.includes(checkId) || beat.RUNS_ELSEWHERE[checkId], `${surface} needs ${checkId} hourly`);
    }
  }
});
