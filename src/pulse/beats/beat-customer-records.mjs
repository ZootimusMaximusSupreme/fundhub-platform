// customer-records: every hour, was every erasure finished, was every identity reveal made by the
// client's own company, and does the AI bureau caller have a number and a menu for every bureau?
//
// Same SQL, same judges as the morning checks in gap-records.mjs (the truth lives in
// lib/records-truth.mjs). Three reads:
//   privacy:erasure          an erasure or bank-revoke request still 'requested' after a day, or 'failed'
//   privacy:pii-company      an identity reveal in the last 7 days by staff from another company
//   bureau-config:complete   a bureau the caller dials has no usable number or menu, in the table OR the
//                            caller's own script (number from the Netlify setting, else the script)
// The morning lane builds the dial plan from the call scripts themselves; the live bundle cannot import
// them into a beat, so this beat uses lib/bureau-dial-facts.mjs, which a drift test holds equal to the
// scripts, and the live setting from ctx.env.
//
// What it guards, and why each surface is on `covers`:
//   route:ai-bureau-config   bureau-config:complete
//   route:banking/revoke     privacy:erasure (a bank revoke writes the same erasure_requests row)
//   route:privacy/erasure    privacy:erasure
//   route:pii                privacy:pii-company
// Those are the exact deep checks src/pulse/tripwires.mjs names; the test holds each to a step here.
//
// Read only: three reads through ctx.read (the read box). No send, no web call, no erasure.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { BUREAU_SQL, ERASURE_SQL, PII_COMPANY_SQL, recordsChecks } from "./lib/records-truth.mjs";
import { dialPlanFromFacts } from "./lib/bureau-dial-facts.mjs";

export const HOURLY_CHECK_IDS = Object.freeze(["privacy:erasure", "privacy:pii-company", "bureau-config:complete"]);
/** Deep checks a covered surface names that run hourly in another beat. None: all run here. */
export const RUNS_ELSEWHERE = Object.freeze({});

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => recordsChecks(
    { db: { query: (sql, params) => io.read(sql, params) }, orgId: io.orgId, now: io.now },
    { only: HOURLY_CHECK_IDS, dialPlan: dialPlanFromFacts(io.env || {}) }
  ),
  selfTest: Object.freeze({
    passRows: Object.freeze([
      Object.freeze([ERASURE_SQL, Object.freeze([Object.freeze({ waiting: 0, failed: 0, oldest_waiting: null, oldest_failed: null })])]),
      Object.freeze([PII_COMPANY_SQL, Object.freeze([Object.freeze({ reveals: 0, by_staff: 0, across: 0, clients: 0, staff_n: 0, latest: null })])]),
      Object.freeze([BUREAU_SQL, Object.freeze([])])
    ]),
    // A bank-revoke request left 'failed': the beat must stop at privacy-erasure.
    failRows: Object.freeze([
      Object.freeze([ERASURE_SQL, Object.freeze([Object.freeze({ waiting: 0, failed: 1, oldest_waiting: null, oldest_failed: "2026-10-09T10:00:00.000Z" })])])
    ])
  })
});

export const id = "customer-records";
export const title = "Erasures finish and identity stays in company";
export const kind = "probe";
export const covers = ["route:ai-bureau-config", "route:banking/revoke", "route:privacy/erasure", "route:pii"];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 9000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "records" });
}

export const fixGuide = [
  "A removal was not finished, an identity was opened across companies, or a bureau has no number.",
  "",
  "Likely causes:",
  "- An erasure or bank-revoke request was left requested or failed, so a person asked to be removed and was not.",
  "- A staff member from another company revealed a client's identity (api/pii.mjs checks the client, not the company).",
  "- A bureau dispute number setting on Netlify is empty or not a +1 number, and the table has none either.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs customer-records and read the red step: it names the count and the age.",
  "- For an erasure, read erasure_requests (failure_reason) and finish it through POST /api/privacy/erasure or /api/banking/revoke.",
  "- For a bureau, set EXPERIAN_DISPUTE_NUMBER, EQUIFAX_DISPUTE_NUMBER or TRANSUNION_DISPUTE_NUMBER to the bureau's real number. Never invent one.",
  "Files: src/pulse/beats/lib/records-truth.mjs, src/privacy/erasure.mjs, src/banking/revoke.mjs, api/pii.mjs, src/inquiry-ops/bureau-dial-plan.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE, false),
  fail: () => laneSelfTest(LANE, true)
};
