// call-bookings: every hour, does each booked customer have a way to join the call, and was every call that
// already ended given an outcome?
//
// Same SQL, same verdicts as the morning lane gap-calls.mjs (the truth lives in lib/calls-truth.mjs):
//   calls:booked-no-join-link   a real booked call still ahead with no join link on the event, the bookings
//                               row or the closer's task; or none of the newest 5 real bookings carries a
//                               link, so the next booking will not either (this goes red before a customer
//                               is hit)
//   calls:booked-no-outcome     a booked call ended over 30 minutes ago and nobody logged what happened
// Test addresses, interviews, demo rows, cancelled and moved calls are left out, exactly as the lane does.
//
// What it guards, and why each surface is on `covers` (the deep checks src/pulse/tripwires.mjs names):
//   job:s-04-call-booked   handoff:booking-no-confirm (runs hourly in lead-handoff) and calls:booked-no-join-link
//   route:bookings         handoff:booking-no-confirm (runs hourly in lead-handoff) and calls:booked-no-outcome
// The hand-off half already runs every hour in beat lead-handoff; this beat runs the other half and does
// not repeat it.
//
// Read only: every read goes through ctx.read (the read box). No send, no write, no web call, no call placed.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import {
  BOOKED_NO_OUTCOME_SQL, JOIN_EVENTS_SQL, bookedNoJoinLink, bookedNoOutcome
} from "./lib/calls-truth.mjs";

export const HOURLY_CHECK_IDS = Object.freeze(["calls:booked-no-join-link", "calls:booked-no-outcome"]);

const PASS_ROWS = Object.freeze([
  Object.freeze([JOIN_EVENTS_SQL, Object.freeze([])]),
  Object.freeze([BOOKED_NO_OUTCOME_SQL, Object.freeze([])])
]);

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => {
    const db = { query: (sql, params) => io.read(sql, params) };
    const join = await bookedNoJoinLink({ db, orgId: io.orgId, now: io.now });
    const outcome = await bookedNoOutcome({ db, orgId: io.orgId, now: io.now });
    return [join, outcome];
  },
  selfTest: Object.freeze({
    passRows: PASS_ROWS,
    // A booked call that ended with nobody logging an outcome: the beat must stop at calls-booked-no-outcome.
    failRows: Object.freeze([
      Object.freeze([BOOKED_NO_OUTCOME_SQL, Object.freeze([Object.freeze({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })])])
    ])
  })
});

export const id = "call-bookings";
export const title = "Booked calls have a join link and an outcome";
export const kind = "probe";
export const covers = [
  "job:s-04-call-booked",
  "route:bookings"
];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 10000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "booked-call" });
}

export const fixGuide = [
  "A booked customer has no way to join their call, or a call ended and nobody logged what happened.",
  "",
  "Likely causes:",
  "- AI-SET-04 did not keep the Meet link: its keep-meet-link step names the miss (no_calendar_scope means",
  "  the Google token needs calendar read; no_matching_event means the call is not on the calendar it reads).",
  "- ClickFunnels stopped putting the Meet link on the host's Google Calendar event.",
  "- A closer held the call and did not log the outcome on the calendar or the closer desk.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs call-bookings and read the red step: it names the next call (masked).",
  "- Open the AI-SET-04 run for that booking, or the booking on the calendar, and fix the cause there.",
  "- Never place a call or text the customer from the pulse; the beat only reads.",
  "Files: src/pulse/beats/lib/calls-truth.mjs, src/bookings/meet-link.mjs, src/workflows/ai-set-04-3way-handoff.mjs, src/workflows/s-04-call-booked.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
