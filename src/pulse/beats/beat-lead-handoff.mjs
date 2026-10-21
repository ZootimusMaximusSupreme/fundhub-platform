// lead-handoff: every hour, did each new lead, roadmap contact and booked call get the next message
// the company owes them?
//
// Same SQL, same verdicts as the morning lane gap-handoff.mjs (the truth lives in
// lib/handoff-truth.mjs). It reads the EFFECT: the message row that must exist after a saved event,
// minus the people the workflow skips on purpose (test addresses, opt-outs, people who already paid,
// replied or booked). Zero misses is green. One miss past its grace is red at that check's step.
//
// Four of the lane's five checks run here. The fifth (call-outcome-no-followup) guards no surface
// that lacks an hourly beat and costs three more reads, so it stays daily.
//
// The roadmap drip is the long tail of the same promise, so its check rides here too: same SQL and
// verdict as email:drip-step-no-email in gap-email.mjs (the truth lives in lib/email-truth.mjs). One
// read: a person on the drip whose step moved with no EMAIL-SLO-DRIP row is a person the drip skipped.
//
// What it guards, and why each surface is on `covers`:
//   job:s-01-new-lead-intake, job:s-02-incomplete-survey-nudge   handoff:lead-first-touches-missing
//   job:slo-genuine-followup, job:slo-no-reply-197,
//   job:slo-genuine-checkout-sms                                 handoff:contact-no-followup
//   job:s-04b-booking-reminders                                  handoff:reminder-missing and handoff:booking-no-confirm
//   job:slo-infinite-drip                                        email:drip-step-no-email
// Those are the exact deep checks src/pulse/tripwires.mjs names for each job.
//
// Read only: every read goes through ctx.read (the read box). No send, no write, no web call.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import {
  CONFIRM_SQL, CONTACT_197_SQL, CONTACT_M1_SQL, NOBOOK_SQL, NUDGE_SQL, REMIND_24H_SQL, REMIND_2H_SQL,
  WELCOME_SQL, runHandoffChecks
} from "./lib/handoff-truth.mjs";
import { DRIP_CHECK_ID, DRIP_SQL, judgeDrip, readDrip } from "./lib/email-truth.mjs";

export const HANDOFF_CHECK_IDS = Object.freeze([
  "handoff:lead-first-touches-missing",
  "handoff:contact-no-followup",
  "handoff:booking-no-confirm",
  "handoff:reminder-missing"
]);
export const HOURLY_CHECK_IDS = Object.freeze([...HANDOFF_CHECK_IDS, DRIP_CHECK_ID]);

/** The beat's harness cuts at deadlineMs. The lane gets a little less, so it ends on its own words. */
export const LANE_BUDGET_MS = 8500;
export const READ_TIMEOUT_MS = 4000;

const ZERO = Object.freeze([Object.freeze({ n: 0, newest: null, sample: null, silent_n: 0 })]);
const PASS_ROWS = Object.freeze([
  ...[WELCOME_SQL, NUDGE_SQL, NOBOOK_SQL, CONTACT_M1_SQL, CONTACT_197_SQL, CONFIRM_SQL, REMIND_24H_SQL, REMIND_2H_SQL]
    .map((sql) => Object.freeze([sql, ZERO])),
  Object.freeze([DRIP_SQL, Object.freeze([Object.freeze({ n: 0, missing: 0 })])])
]);

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => {
    const handoffs = await runHandoffChecks(
      { read: io.read, orgId: io.orgId, now: io.now, readTimeoutMs: READ_TIMEOUT_MS },
      { only: HANDOFF_CHECK_IDS, budgetMs: LANE_BUDGET_MS }
    );
    const drip = judgeDrip(await readDrip({ query: (sql, params) => io.read(sql, params) }, io.orgId));
    return [...handoffs, drip];
  },
  selfTest: Object.freeze({
    passRows: PASS_ROWS,
    // A roadmap contact who never got the 15-minute note: the beat must stop at contact-no-followup.
    failRows: Object.freeze([
      Object.freeze([CONTACT_M1_SQL, Object.freeze([Object.freeze({ n: 1, newest: "2026-10-09T17:00:00.000Z", sample: "FH-000999", silent_n: 0 })])])
    ])
  })
});

export const id = "lead-handoff";
export const title = "New leads and bookings get their next message";
export const kind = "probe";
export const covers = [
  "job:s-01-new-lead-intake",
  "job:s-02-incomplete-survey-nudge",
  "job:slo-genuine-followup",
  "job:slo-no-reply-197",
  "job:slo-genuine-checkout-sms",
  "job:s-04b-booking-reminders",
  "job:slo-infinite-drip"
];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 10000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "hand-off" });
}

export const fixGuide = [
  "A lead, roadmap contact or booked call did not get the message the company owes them.",
  "",
  "Likely causes:",
  "- The event was saved but the Inngest run never started (INNGEST_EVENT_KEY, or Inngest itself).",
  "- The run started but stopped before it queued the message: a missing or unapproved template, or a Commas refusal on the $197 step.",
  "- A reminder run was asleep and its sleep was lost.",
  "- The roadmap drip moved a person's step and no drip email row was written (a repeat provider_ref is ignored).",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs lead-handoff and read the red step: it names how many people and the newest one.",
  "- Open that person's saved event (entry.captured, survey.submitted, slo.contact_started or booking.created) and the matching run in Inngest.",
  "- Fix the workflow or the template. Do not send the missed message from the pulse; the beat only reads.",
  "Files: src/pulse/beats/lib/handoff-truth.mjs, src/workflows/s-00-welcome.mjs, src/workflows/slo-genuine-followup.mjs, src/workflows/s-04b-booking-reminders.mjs, src/workflows/slo-infinite-drip.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
