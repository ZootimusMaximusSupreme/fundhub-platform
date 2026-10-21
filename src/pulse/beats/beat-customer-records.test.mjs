import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-customer-records.mjs";
import * as truth from "./lib/records-truth.mjs";
import * as facts from "./lib/bureau-dial-facts.mjs";
import * as lane from "../coverage/gap-records.mjs";
import { bureauDialPlan, BUREAU_SCRIPTS, DIAL_NUMBER_RE, MIN_MENU_STEPS } from "../../inquiry-ops/bureau-dial-plan.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const failWith = (sql, rows, env) => ({
  ...laneSelfTest({ ...beat.LANE, selfTest: { passRows: beat.LANE.selfTest.passRows, failRows: [[sql, rows]] } }, true),
  ...(env ? { env } : {})
});

test("customer-records is valid, green when nothing is waiting, red when a revoke failed", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-customer-records.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true, passed.detail);
  assert.equal(passed.detail, "3 records checks passed");
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "privacy-erasure");
  assert.match(failed.detail, /1 request failed and no later request for the same person finished/);
});

test("customer-records: a reveal across companies is red at privacy-pii-company", async () => {
  const result = await runBeat(beat, makeFakeCtx(beat, failWith(truth.PII_COMPANY_SQL, [{ reveals: 2, by_staff: 2, across: 1, clients: 1, staff_n: 1, latest: null }])));
  assert.equal(result.ok, false);
  assert.equal(result.step, "privacy-pii-company");
  assert.match(result.detail, /made by staff from a different company/);
});

test("customer-records: a bureau with no usable number in the setting, the script or the table is red", async () => {
  // The live setting is junk, so the caller would dial nothing usable, and the table has no row.
  const env = { EXPERIAN_DISPUTE_NUMBER: "call the bureau" };
  const result = await runBeat(beat, makeFakeCtx(beat, failWith(truth.BUREAU_SQL, [], env)));
  assert.equal(result.ok, false);
  assert.equal(result.step, "bureau-config-complete");
  assert.match(result.detail, /no service number for EX/);
  // A good setting, or the script number, is green.
  const good = await runBeat(beat, makeFakeCtx(beat, { ...beat.selfTest.pass(), env: { EXPERIAN_DISPUTE_NUMBER: "+18005551212" } }));
  assert.equal(good.ok, true, good.detail);
});

test("customer-records: three reads, no web call", async () => {
  const ctx = makeFakeCtx(beat, beat.selfTest.pass());
  await runBeat(beat, ctx);
  const log = ctxLog(ctx);
  assert.equal(log.http.length, 0);
  assert.equal(log.reads.filter((r) => !/FROM orgs/.test(r.sql)).length, 3);
  assert.ok(!log.reads.some((r) => /customer_insights/.test(r.sql)), "consent:recording-and-ads stays daily");
});

test("customer-records: the dial facts equal the plan built from the real call scripts, for every kind of setting", () => {
  assert.equal(facts.DIAL_NUMBER_RE.source, DIAL_NUMBER_RE.source);
  assert.equal(facts.MIN_MENU_STEPS, MIN_MENU_STEPS);
  assert.deepEqual(facts.BUREAU_SCRIPT_FACTS.map((f) => [f.code, f.name, f.env]), BUREAU_SCRIPTS.map((s) => [s.code, s.name, s.env]));
  const names = BUREAU_SCRIPTS.map((s) => s.env);
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  try {
    for (const value of [undefined, "", "+18005551212", "  +18005551212  ", "+1800555\\n1212", "+1800555\\n1212\\n", "junk", "****1212"]) {
      for (const n of names) {
        if (value === undefined) delete process.env[n];
        else process.env[n] = value;
      }
      const env = { ...process.env };
      assert.deepEqual(facts.dialPlanFromFacts(env), bureauDialPlan({ env }), `setting ${JSON.stringify(value)}`);
    }
  } finally {
    for (const n of names) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  }
});

test("customer-records: the daily lane and the hourly beat share one SQL and one judge", () => {
  assert.equal(lane.ERASURE_SQL, truth.ERASURE_SQL);
  assert.equal(lane.PII_COMPANY_SQL, truth.PII_COMPANY_SQL);
  assert.equal(lane.BUREAU_SQL, truth.BUREAU_SQL);
  assert.equal(lane.judgeErasure, truth.judgeErasure);
  assert.equal(lane.judgePiiCompany, truth.judgePiiCompany);
  assert.equal(lane.judgeBureauConfig, truth.judgeBureauConfig);
  for (const checkId of beat.HOURLY_CHECK_IDS) assert.ok(lane.CHECK_IDS.includes(checkId), checkId);
});

test("customer-records: every deep check a covered surface names runs hourly here", () => {
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) {
      assert.ok(beat.HOURLY_CHECK_IDS.includes(checkId) || beat.RUNS_ELSEWHERE[checkId], `${surface} needs ${checkId} hourly`);
    }
  }
});
