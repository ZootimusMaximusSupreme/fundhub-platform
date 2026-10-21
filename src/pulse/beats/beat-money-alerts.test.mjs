import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as beat from "./beat-money-alerts.mjs";
import * as alertsTruth from "./lib/alerts-truth.mjs";
import * as cardDuePlan from "./lib/card-due-plan.mjs";
import * as alertsLane from "../coverage/gap-alerts.mjs";
import * as banking from "../../banking/card-due-reminders.mjs";
import { TEST_ADDRESS_RE as GAP_SMS_TEST_ADDRESS_RE } from "../coverage/gap-sms.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { laneSelfTest, SELF_TEST_NOW, SELF_TEST_ORG } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

const withRows = (rows) => laneSelfTest({ ...beat.LANE, selfTest: { passRows: rows } });
const swap = (sql, value) => beat.LANE.selfTest.passRows.map(([s, v]) => (s === sql ? [s, value] : [s, v]));

test("money-alerts is valid, green when every promised text went out, red at alerts-texts-went-out when one is missing", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-money-alerts.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true, passed.detail);
  assert.equal(passed.detail, "1 alert checks passed");
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "alerts-texts-went-out");
  assert.match(failed.detail, /1 of 1 payment reminder the job owed has no text \(Business Card due 2026-10-11\)/);
});

test("money-alerts: a file-protection text that failed, a card-due text stuck in the queue, and an unapproved template each go red", async () => {
  const failedAlert = await runBeat(beat, makeFakeCtx(beat, withRows(swap(alertsTruth.ALERT_TEXTS_SQL, [{
    kind: "promo_end", due_on: "2026-12-06", sent_at: "2026-10-09T16:00:00.000Z", message_id: "m1", status: "failed",
    blocked_reason: null, message_created_at: "2026-10-09T16:00:00.000Z", due_at: "2026-10-09T16:00:00.000Z", last_attempt_at: "2026-10-09T16:00:05.000Z"
  }]))));
  assert.equal(failedAlert.ok, false);
  assert.equal(failedAlert.step, "alerts-texts-went-out");
  assert.match(failedAlert.detail, /1 of 1 file-protection alert did not go out: promo_end: the text failed x1/);

  const ref = beat.LANE.selfTest.passRows.find(([sql]) => sql === alertsTruth.CARD_TEXTS_SQL)[1][0].provider_ref;
  const stuck = await runBeat(beat, makeFakeCtx(beat, withRows(swap(alertsTruth.CARD_TEXTS_SQL, [{
    provider_ref: ref, status: "queued", blocked_reason: null, due_at: "2026-10-09T15:00:00.000Z",
    last_attempt_at: null, message_created_at: "2026-10-09T15:00:00.000Z", message_id: "m2"
  }]))));
  assert.equal(stuck.ok, false);
  assert.equal(stuck.step, "alerts-texts-went-out");
  assert.match(stuck.detail, /1 card-due text did not go out \(Business Card due 2026-10-11: it has been queued since it was due\)/);

  const unapproved = await runBeat(beat, makeFakeCtx(beat, withRows(
    swap(alertsTruth.CARD_TEMPLATE_SQL, [{ compliance_passed: false }]).filter(([sql]) => sql !== alertsTruth.CARD_TEXTS_SQL)
  )));
  assert.equal(unapproved.ok, false);
  assert.match(unapproved.detail, /The card-due template is not approved, so the job queues nothing/);
});

test("money-alerts: nothing queued and nothing owed is green and says what it counted; a failed read is skipped, never green", async () => {
  const empty = await runBeat(beat, makeFakeCtx(beat, withRows([])));
  assert.equal(empty.ok, true, empty.detail);
  assert.equal(empty.detail, "1 alert checks passed");
  assert.ok(empty.steps.find((step) => step.name === "alerts-texts-went-out" && step.ok && !step.skipped));

  const spec = withRows([]);
  const broken = await runBeat(beat, makeFakeCtx(beat, {
    ...spec,
    read: async (sql, params) => {
      if (String(sql).includes("file_protection_alerts")) throw new Error("canceling statement due to statement timeout");
      return spec.read(sql, params);
    }
  }));
  assert.equal(broken.ok, true);
  assert.match(broken.detail, /^0 alert checks passed; 1 had nothing safe to judge$/);
  assert.ok(broken.steps.find((step) => step.name === "alerts-texts-went-out").skipped);
});

test("money-alerts: the beat hands the shared truth the same reads, in the same company, at the same clock", async () => {
  const seen = [];
  const spec = beat.selfTest.pass();
  const passed = await runBeat(beat, makeFakeCtx(beat, {
    ...spec,
    read: async (sql, params) => { seen.push({ sql, params }); return spec.read(sql, params); }
  }));
  assert.equal(passed.ok, true);
  const alertRead = seen.find((r) => r.sql === alertsTruth.ALERT_TEXTS_SQL);
  assert.deepEqual(alertRead.params, [SELF_TEST_ORG, "2026-10-06T19:07:00.000Z", "2026-10-09", GAP_SMS_TEST_ADDRESS_RE]);
  const cycleRead = seen.find((r) => r.sql === alertsTruth.CARD_CYCLES_SQL);
  assert.deepEqual(cycleRead.params, [SELF_TEST_ORG, SELF_TEST_NOW.toISOString(), GAP_SMS_TEST_ADDRESS_RE]);
  const textRead = seen.find((r) => r.sql === alertsTruth.CARD_TEXTS_SQL);
  assert.deepEqual(textRead.params, [SELF_TEST_ORG, ["workflow:SMS-FINANCE-OS-CARD-DUE:card-due:a0000000-0000-4000-8000-000000000001:2026-10-11"]]);
  for (const r of seen) assert.match(String(r.sql).trim(), /^SELECT\b/);
});

test("money-alerts: the daily lane, the hourly beat and the daily job share one SQL, one judge and one planner", async () => {
  // The morning lane re-exports the truth, so both clocks read the same SQL and run the same verdict.
  assert.equal(alertsLane.runAlertChecks, alertsTruth.runAlertChecks);
  for (const name of ["ALERT_TEXTS_SQL", "CARD_CYCLES_SQL", "CARD_TEXTS_SQL", "CARD_TEMPLATE_SQL", "alertProblem", "owedReminders", "lastPassDate", "CHECK_IDS"]) {
    assert.equal(alertsLane[name], alertsTruth[name], `gap-alerts.mjs ${name} must be the shared truth's own export`);
  }
  for (const checkId of beat.HOURLY_CHECK_IDS) assert.ok(alertsTruth.CHECK_IDS.includes(checkId), checkId);

  // The job imports its planner from src/banking/card-due-reminders.mjs, which re-exports the library planner.
  for (const name of ["planCardDue", "planLoanDue", "TEMPLATE_KEY"]) assert.equal(banking[name], cardDuePlan[name], name);
  const job = fs.readFileSync(path.join(ROOT, "src/workflows/finance-os-card-due-reminders.mjs"), "utf8");
  assert.match(job, /import \{ planCardDue, planLoanDue, TEMPLATE_KEY \} from "\.\.\/banking\/card-due-reminders\.mjs";/);
  const truth = fs.readFileSync(path.join(HERE, "lib/alerts-truth.mjs"), "utf8");
  assert.match(truth, /from "\.\/card-due-plan\.mjs";/);

  // The carried constant stays equal to the morning lanes' original.
  assert.equal(alertsTruth.TEST_ADDRESS_RE, GAP_SMS_TEST_ADDRESS_RE, "the test-address pattern drifted from gap-sms.mjs");

  // Same rows in, same verdict out: the lane's gapChecks on a plain database and the beat's read.
  for (const fail of [false, true]) {
    const spec = beat.selfTest[fail ? "fail" : "pass"]();
    const db = { query: (sql, params) => spec.read(sql, params) };
    const [laneRow] = await alertsLane.gapChecks({ db, orgId: SELF_TEST_ORG, now: spec.now });
    const [truthRow] = await beat.LANE.run({ read: spec.read, orgId: SELF_TEST_ORG, now: spec.now });
    assert.deepEqual(truthRow, laneRow);
    assert.equal(laneRow.status, fail ? "FAIL" : "PASS");
  }
});

test("money-alerts: every surface it covers has every named deep check run here", () => {
  assert.deepEqual([...beat.covers].sort(), [
    "desk:money-alerts.html", "job:blueprint-finance-os-alerts", "job:finance-os-card-due-reminders", "route:money/alerts"
  ]);
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) assert.ok(beat.HOURLY_CHECK_IDS.includes(checkId), `${surface} needs ${checkId}`);
  }
});
