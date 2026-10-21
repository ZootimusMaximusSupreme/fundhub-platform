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
import * as door from "./lib/money-helper-door.mjs";
import * as helperRead from "./lib/money-helper-read.mjs";
import * as financeLane from "../coverage/gap-finance-os.mjs";

const withRow = (row) => laneSelfTest({ ...beat.LANE, selfTest: { passRows: [[truth.STUCK_SQL, [row]]] } });
/* The self test's helper-screen rows (the linked client and its client row), so a test that swaps the
   stuck counts keeps the helper door green. */
const HELPER_ROWS = beat.LANE.selfTest.passRows.filter(([sql]) => sql !== truth.STUCK_SQL);
/* The pass spec, with one read swapped: a function of the SQL that returns rows, or throws. */
function passWith(swap) {
  const spec = laneSelfTest(beat.LANE);
  const base = spec.read;
  spec.read = async (sql, params) => {
    const out = swap(String(sql));
    if (out === undefined) return base(sql, params);
    return { rows: out, rowCount: out.length };
  };
  return spec;
}

test("money-tasks is valid, green when nothing is stuck, red at helper-rows-stuck on queued Do tasks", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-money-tasks.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passCtx = makeFakeCtx(beat, beat.selfTest.pass());
  const passed = await runBeat(beat, passCtx);
  assert.equal(passed.ok, true, passed.detail);
  assert.equal(passed.detail, "2 money helper checks passed");
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
  for (const spec of [boom, laneSelfTest({ ...beat.LANE, selfTest: { passRows: [[truth.STUCK_SQL, []], ...HELPER_ROWS] } })]) {
    const result = await runBeat(beat, makeFakeCtx(beat, spec));
    assert.equal(result.ok, true, result.detail);
    // The helper door still passes; the stuck read alone had nothing safe to judge.
    assert.match(result.detail, /^1 money helper checks passed; 1 had nothing safe to judge$/);
    assert.ok(result.steps.find((step) => step.name === "helper-rows-stuck").skipped);
  }
});

test("money-tasks: the daily lane and the hourly beat share one SQL, one judge and one test-client pattern", async () => {
  assert.equal(lane.runMoneyHelperChecks, truth.runMoneyHelperChecks);
  assert.equal(lane.STUCK_SQL, truth.STUCK_SQL);
  assert.equal(lane.judge, truth.judge);
  assert.equal(lane.stuckParams, truth.stuckParams);
  assert.equal(lane.CHECK_IDS, truth.CHECK_IDS);
  assert.deepEqual([...beat.HOURLY_CHECK_IDS], [...truth.CHECK_IDS, "finance-os:helper"]);
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
  // The helper screen and its door name finance-os:helper too. It runs here every hour now (the page's own
  // payload read, lib/money-helper-read.mjs), so both surfaces are covered, and the loop above proves it.
  for (const surface of ["desk:money-helper.html", "route:money/helper", "route:money/tasks"]) {
    assert.ok(beat.covers.includes(surface), surface);
  }
  for (const surface of ["desk:money-helper.html", "route:money/helper"]) {
    assert.deepEqual([...TRIPWIRES[surface].checks].sort(), ["finance-os:helper", "helper:rows-stuck"], surface);
  }
});

/* ---------------- finance-os:helper, the helper screen's read ---------------- */

test("money-tasks: finance-os:helper is green for the linked client, with the morning lane's own words", async () => {
  const ctx = makeFakeCtx(beat, beat.selfTest.pass());
  const result = await runBeat(beat, ctx);
  assert.equal(result.ok, true, result.detail);
  const step = result.steps.find((s) => s.name === "finance-os-helper");
  assert.ok(step && !step.skipped, "finance-os-helper ran");
  // Every read the beat made is one the read box takes whole, and none of them writes.
  const reads = ctxLog(ctx).reads;
  assert.ok(reads.some((r) => r.sql === door.LINKED_CLIENT_SQL), "picked the linked client");
  assert.ok(reads.some((r) => r.sql === helperRead.HELPER_CLIENT_SQL), "read the client row");
  assert.ok(reads.some((r) => /FROM money_helper_turns/.test(r.sql)), "read the thread");
  assert.ok(reads.some((r) => /FROM money_helper_threads/.test(r.sql)), "read the halt state");
  for (const r of reads) assert.equal(assertReadOnlySql(r.sql), r.sql);
  assert.deepEqual(ctxLog(ctx).refused, []);
});

test("money-tasks: a read under the helper screen that fails is red at finance-os-helper", async () => {
  const broken = passWith((sql) => {
    if (/FROM money_helper_turns/.test(sql)) throw new Error('column "brain" does not exist');
    return undefined;
  });
  const result = await runBeat(beat, makeFakeCtx(beat, broken));
  assert.equal(result.ok, false);
  assert.equal(result.step, "finance-os-helper");
  assert.match(result.detail, /money helper \(GET \/api\/money\/helper\) threw for linked client/);
  assert.match(result.detail, /column "brain" does not exist/);
});

test("money-tasks: the linked client's row missing is red at finance-os-helper (the page answers 404)", async () => {
  const gone = passWith((sql) => (sql === helperRead.HELPER_CLIENT_SQL ? [] : undefined));
  const result = await runBeat(beat, makeFakeCtx(beat, gone));
  assert.equal(result.ok, false);
  assert.equal(result.step, "finance-os-helper");
  assert.match(result.detail, /answered 404 for linked client/);
});

test("money-tasks: the linked-client read failing is red; no linked client is nothing to judge", async () => {
  const boom = passWith((sql) => {
    if (sql.includes("gap:finance-os-linked-client")) throw new Error("relation plaid_items does not exist");
    return undefined;
  });
  const red = await runBeat(beat, makeFakeCtx(beat, boom));
  assert.equal(red.ok, false);
  assert.equal(red.step, "finance-os-helper");
  assert.match(red.detail, /could not read a linked client: relation plaid_items does not exist/);

  const none = await runBeat(beat, makeFakeCtx(beat, passWith((sql) => (sql === door.LINKED_CLIENT_SQL ? [] : undefined))));
  assert.equal(none.ok, true, none.detail);
  assert.match(none.detail, /^1 money helper checks passed; 1 had nothing safe to judge$/);
  assert.ok(none.steps.find((s) => s.name === "finance-os-helper").skipped);
});

test("money-tasks: finance-os:helper is the morning lane's door, client pick, read and verdict, not a copy", async () => {
  // The lane's helper door is the lib's door plus its literal handler import.
  const laneDoor = financeLane.DOORS.find((d) => d.id === "finance-os:helper");
  for (const key of Object.keys(door.HELPER_DOOR)) assert.equal(laneDoor[key], door.HELPER_DOOR[key], key);
  assert.equal(typeof laneDoor.load, "function");
  // The lane's read-only payload is the page's own payload read with no step before it.
  const fake = {
    async query(sql) {
      if (sql === helperRead.HELPER_CLIENT_SQL) return { rows: [{ id: "c1", first_name: "Pat", last_name: "Lee" }] };
      if (/FROM agents WHERE org_id/.test(sql)) return { rows: [{ code: "FOS-01", name: "FinanceOS Money Helper", status: "shadow", prompt: "p", guardrails: {} }] };
      if (/FROM money_helper_turns/.test(sql)) return { rows: [{ id: "t1", kind: "message", actor: "client", input: "hi", status: "queued", actions: [], created_at: "2026-10-09T18:00:00Z" }] };
      return { rows: [] };
    }
  };
  const args = { orgId: SELF_TEST_ORG, clientId: "c1", staff: true, env: { MONEY_HELPER_RUNNER: "rules" }, now: SELF_TEST_NOW };
  const fromLane = await financeLane.readOnlyHelperPayload(fake, args);
  const fromLib = await helperRead.helperView(fake, args);
  assert.deepEqual(fromLane, fromLib);
  assert.deepEqual([fromLib.helper.on, fromLib.helper.brain, fromLib.pending, fromLib.turns[0].reason], [true, "rules", 1, null]);
  // The product's names are the lib's, re-exported (one copy).
  const helper = await import("../../finance/money-helper.mjs");
  const ai = await import("../../finance/money-agent-ai.mjs");
  const registry = await import("../../agents/registry.mjs");
  for (const name of ["threadState", "readThread", "viewTurn", "reasonWords", "bridgeStatus", "helperIsOn"]) {
    assert.equal(helper[name], helperRead[name], name);
  }
  assert.equal(registry.byCode, helperRead.byCode);
  assert.deepEqual([ai.AGENT_CODE, ai.AGENT_NAME, ai.RUNNER_ENV, ai.RUNNER_MODES], [helperRead.AGENT_CODE, helperRead.AGENT_NAME, helperRead.RUNNER_ENV, helperRead.RUNNER_MODES]);
  // The product's loadAgent keeps the in-code prompt as its fallback; the screen reads only code, name, status.
  const empty = { query: async () => ({ rows: [] }) };
  const productAgent = await helper.loadAgent(empty, { orgId: SELF_TEST_ORG });
  const libAgent = await helperRead.loadAgent(empty, { orgId: SELF_TEST_ORG });
  assert.equal(productAgent.prompt, ai.HELPER_PROMPT);
  assert.deepEqual([libAgent.code, libAgent.name, libAgent.status], [productAgent.code, productAgent.name, productAgent.status]);
});
