import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-pipeline-boards.mjs";
import * as boardsTruth from "./lib/pipeline-boards-truth.mjs";
import * as factsTruth from "./lib/pipeline-facts-truth.mjs";
import * as clock from "./lib/pipeline-read-clock.mjs";
import * as boardsLane from "../coverage/gap-pipeline-boards.mjs";
import * as crmLinks from "../coverage/gap-crm-links.mjs";
import { TEST_CLIENT_EMAIL_RE as CONSENT_TEST_CLIENT_EMAIL_RE } from "../coverage/gap-consent.mjs";
import { orgDemoModeEnabled as appOrgDemoModeEnabled } from "../../demo/exclude-demo.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { DEFAULT_ORG_SQL, SELF_TEST_NOW, SELF_TEST_ORG, laneSelfTest } from "./lib/money-hourly.mjs";
import { loadBeats } from "./index.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const redSpec = (step) => laneSelfTest({
  ...beat.LANE,
  selfTest: { passRows: beat.LANE.selfTest.passRows, failRows: [beat.RED_ROWS[step]] }
}, true);

test("pipeline-boards is valid, goes green on healthy boards and red at the nobody-lost step", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-pipeline-boards.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true, passed.detail);
  // dead-stage has no card on a dead stage, so it is "nothing to judge" (a skipped step), never red.
  assert.match(passed.detail, /^2 board checks passed; 1 had nothing safe to judge$/);
  assert.ok(passed.steps.find((step) => step.name === "pipeline-dead-stage").skipped);
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "pipeline-nobody-lost");
  assert.match(failed.detail, /1 paying client has no card on the board that owns what they bought/);
  // A red step ends the beat: the steps run are the ones up to and including it.
  assert.deepEqual(failed.steps.map((step) => step.name), beat.steps.slice(0, beat.steps.indexOf("pipeline-nobody-lost") + 1));
});

test("pipeline-boards: each of its three checks can go red on its own", async () => {
  assert.deepEqual(Object.keys(beat.RED_ROWS).sort(), beat.LANE.checks.map((check) => check.step).sort());
  for (const step of Object.keys(beat.RED_ROWS)) {
    const result = await runBeat(beat, makeFakeCtx(beat, redSpec(step)));
    assert.equal(result.ok, false, step);
    assert.equal(result.step, step);
  }
  const hidden = await runBeat(beat, makeFakeCtx(beat, redSpec("pipeline-count-true")));
  assert.match(hidden.detail, /1 card on a board is not on the screen: Sales booked holds 1 and shows 0/);
});

test("pipeline-boards: an unreadable database is never green", async () => {
  // The company is read, then every other read fails: each check is a skip with the reason, never PASS.
  const spec = {
    now: new Date(SELF_TEST_NOW.getTime()),
    read: async (sql) => {
      if (String(sql).trim() === DEFAULT_ORG_SQL) return { rows: [{ id: SELF_TEST_ORG }], rowCount: 1 };
      throw new Error("connection reset");
    }
  };
  const result = await runBeat(beat, makeFakeCtx(beat, spec));
  assert.equal(result.ok, true);
  assert.match(result.detail, /^0 board checks passed; 3 had nothing safe to judge$/);
  assert.ok(result.steps.filter((step) => step.name !== "read").every((step) => step.skipped));
});

test("pipeline-boards: the read clock refuses a late or hung read, so a slow hour is a skip", async () => {
  const late = clock.clockedRun(async () => ({ rows: [{ n: 1 }] }), 0);
  await assert.rejects(() => late((tx) => tx.query("SELECT 1", [])), /ran out of time/);
  const hung = clock.clockedRun(() => new Promise(() => {}), 5000, 20);
  await assert.rejects(() => hung((tx) => tx.query("SELECT 1", [])), /took too long/);
  const ok = clock.clockedRun(async (sql, params) => ({ rows: [{ sql, params }] }));
  assert.deepEqual(await ok((tx) => tx.query("SELECT 1", [7])), { rows: [{ sql: "SELECT 1", params: [7] }] });
  assert.ok(clock.LANE_BUDGET_MS < beat.deadlineMs, "the lane must end on its own words before the harness cuts it");
});

test("pipeline-boards: the daily lane and the hourly beat share one SQL and one judge", () => {
  for (const name of ["TRUTH_SQL", "HIRING_TRUTH_SQL", "HIRING_PAINTED_SQL", "DEAD_CARDS_SQL", "DEAD_APPLICATIONS_SQL",
    "PAID_NO_CARD_SQL", "ARCHIVED_THEN_PAID_SQL", "OFF_BOARD_SQL", "DEAD_STAGES", "DEAD_STAGE_KEYS", "BOARDS",
    "BOARD_READ_LIMIT", "HIRING_READ_LIMIT", "PAID_GRACE_MS", "judgeCounts"]) {
    assert.equal(boardsLane[name], boardsTruth[name], name);
  }
  for (const checkId of beat.HOURLY_CHECK_IDS) {
    assert.ok(boardsLane.CHECK_IDS.includes(checkId), checkId);
    assert.ok(boardsTruth.BOARDS_TRUTH_IDS.includes(checkId), checkId);
  }
  assert.deepEqual([...beat.HOURLY_CHECK_IDS].sort(), [...boardsTruth.BOARDS_TRUTH_IDS].sort());
});

test("pipeline-boards: the held copies equal their sources (route reads, demo mode, test clients)", async () => {
  assert.equal(boardsTruth.BOARD_STAGES_SQL, crmLinks.BOARD_STAGES_SQL);
  assert.equal(boardsTruth.BOARD_CARDS_SQL, crmLinks.BOARD_CARDS_SQL);
  assert.equal(factsTruth.TEST_CLIENT_EMAIL_RE, CONSENT_TEST_CLIENT_EMAIL_RE);
  assert.equal(boardsTruth.TEST_CLIENT_EMAIL_RE, CONSENT_TEST_CLIENT_EMAIL_RE);
  const org = "11111111-1111-4111-8111-111111111111";
  for (const answer of [[{ demo_mode_enabled: true }], [{ demo_mode_enabled: false }], []]) {
    const seen = { app: [], copy: [] };
    const db = (log) => ({ query: async (sql, params) => { log.push([sql, params]); return { rows: answer }; } });
    assert.equal(await boardsTruth.orgDemoModeEnabled(db(seen.copy), org), await appOrgDemoModeEnabled(db(seen.app), org));
    assert.deepEqual(seen.copy, seen.app);
  }
  assert.equal(await boardsTruth.orgDemoModeEnabled({ query: async () => { throw new Error("not called"); } }, null), false);
});

test("pipeline-boards: every surface it covers is a tripwire it guards, and every check that surface needs runs hourly", async () => {
  const hourly = new Set((await loadBeats()).flatMap((loaded) => [...(loaded.checkIds || [])]));
  for (const checkId of beat.HOURLY_CHECK_IDS) assert.ok(hourly.has(checkId), checkId);
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    assert.ok(wire.checks.some((checkId) => beat.HOURLY_CHECK_IDS.includes(checkId)), `${surface}: this beat runs none of its checks`);
    for (const checkId of wire.checks) assert.ok(hourly.has(checkId), `${surface} needs ${checkId}, which no hourly beat runs`);
  }
});
