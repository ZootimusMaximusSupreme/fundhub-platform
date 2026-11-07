// whop-plans: every hour, is every Whop plan a client sees on Payments still true? (Finance OS unit W)
//
// Same SQL, same verdict as the morning lane gap-whop-plans.mjs (lib/whop-plans-truth.mjs). One read
// for the default company, one read for the check. No Whop call, no push, no web call.
//
//   payments:whop-plans-current
//     every open Whop plan of a real client was read from Whop in the last 36 hours, and none still
//     shows a charge day that has passed. The daily read is job finance-os-whop-plans-sweeper
//     (src/finance/whop-plans-sync.mjs); Payments and the phone alert both trust its copy.
//
// What it guards, and why it is on `covers` (the deep check tripwires.mjs names):
//   job:finance-os-whop-plans-sweeper                  payments:whop-plans-current
// Its other named check, alerts:phone-alerts-went-out, runs hourly in beat money-alerts.
//
// Read only: every read goes through ctx.read (the read box). No send, no write, no web call.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { CHECK_IDS as WHOP_CHECK_IDS, WHOP_PLANS_STALE_SQL, runWhopPlanChecks } from "./lib/whop-plans-truth.mjs";

const ONE = (row) => Object.freeze([Object.freeze(row)]);

export const LANE = Object.freeze({
  checks: Object.freeze(WHOP_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => runWhopPlanChecks({ db: { query: (sql, params) => io.read(sql, params) }, orgId: io.orgId, now: io.now }),
  selfTest: Object.freeze({
    // Every open Whop plan was read this morning and none shows a passed charge day.
    passRows: Object.freeze([Object.freeze([WHOP_PLANS_STALE_SQL, ONE({ n: 0, not_read: 0 })])]),
    // One plan was not read from Whop in 36 hours: red at payments-whop-plans-current.
    failRows: Object.freeze([Object.freeze([WHOP_PLANS_STALE_SQL, ONE({ n: 1, not_read: 1 })])])
  })
});

export const id = "whop-plans";
export const title = "Whop plans on Payments are current";
export const kind = "probe";
export const covers = ["job:finance-os-whop-plans-sweeper"];
export const box = false;
export const reads = [];
export const checkIds = WHOP_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 8000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "Whop plan" });
}

export const fixGuide = [
  "A Whop plan on a client's Payments screen is out of date: it was not read from Whop in 36 hours, or it still",
  "shows a charge day that has passed. The screen then shows a wrong next payment, and the phone alert lands on the wrong day.",
  "",
  "Likely causes:",
  "- The daily read finance-os-whop-plans-sweeper did not run, or it stopped at Whop (a missing or refused WHOP_API_KEY,",
  "  WHOP_ACCOUNT_ID, or a key without member:basic:read).",
  "- Whop's memberships list came back in a shape the reader does not know (src/messaging/providers/whop-memberships.mjs).",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs whop-plans and read the red step.",
  "- Read the newest job_heartbeats rows for finance-os-whop-plans-sweeper and their error.",
  "- Fix the key or the reader, then let the next 07:00 UTC run refresh the copy. Do not edit whop_memberships by hand.",
  "- A person fixes it. Do not send from the pulse and do not call Whop from here.",
  "Files: src/pulse/beats/lib/whop-plans-truth.mjs, src/finance/whop-plans-sync.mjs, src/messaging/providers/whop-memberships.mjs, src/workflows/finance-os-whop-plans-sweeper.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
