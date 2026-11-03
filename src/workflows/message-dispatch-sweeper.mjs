// The message dispatch sweeper — the thing that calls the dispatcher on a
// schedule.
//
// ═══════════════════════════════════════════════════════════════════════════
// IT IS NOW REGISTERED. WHAT CHANGED, AND WHY — 2026-08-02
//
// This file used to open by explaining at length that it was deliberately NOT in
// src/workflows/index.mjs, so that outbound sending could not start without the
// owner's say-so. That reasoning was right for the state of the product it was
// written in, and it is what shipped: twenty-six workflows queued client email
// and NOTHING EVER DRAINED IT. Every message this platform ever composed sat in
// a table, invisibly, forever.
//
// The owner's instruction, verbatim: "holy shit, we gotta send out emails.
// Right? That's kind of like an obvious… it's not like the workflow is something
// that we turn on… it should be an option, the ability to set it up."
//
// So the gate moved rather than disappearing. It is no longer "this function is
// not registered"; it is db/migrations/126_outbound_switch.sql —
// messaging_settings.outbound_enabled, PER COMPANY, visible in the CRM,
// changeable by an owner, and attributed to whoever changed it. Every one of
// those is a property an env var did not have.
//
// WHAT STILL PROTECTS AGAINST AN ACCIDENT, all of it unchanged:
//   * src/messaging/outbox.mjs drain() refuses when the switch is off, and
//     enforces a per-company daily cap so a looping workflow mails 500 people
//     and stops rather than 50,000.
//   * The compliance gate runs on every single message inside dispatch.mjs, in
//     the order gate → route → send, with no override and no bypass.
//   * With no provider credentials nothing leaves whatever any flag says. That
//     is the real control and always was.
//
// So this switch is a PAUSE BUTTON, not an ignition key. Registering the
// function does not itself send anything either: Inngest invokes nothing until
// INNGEST_EVENT_KEY is set, which remains the owner's to set. Until then the
// same drain runs from the CRM's Outbox screen and from
// POST /api/messages-outbound { action: "dispatch" }.
//
//
// WHY A SWEEPER AND NOT AN EVENT HANDLER.
//
// Reacting to message.queued would dispatch each message the instant it was
// written, which sounds better and is worse:
//
//   * A message with a future scheduled_at is not due yet, so most of those
//     reactions would have nothing to do.
//   * A text deferred overnight has no new event to wake it. Something has to
//     come back and look.
//   * A retryable provider failure is the same shape — the message goes back on
//     the queue with no event attached to it.
//
// A backlog that drains on a clock handles all three with one mechanism. This is
// the one place in this repo where polling is the right answer rather than the
// lazy one: n-06's header explains why a nightly scan is the wrong port of a CRM
// workflow trigger, and that reasoning is about business rules firing on a
// timer, not about a delivery queue draining.
//
//
// EVERY PASS IS BOUNDED. One pass claims at most DEFAULT_BATCH messages and
// dispatches them one at a time. It does not loop until the queue is empty: an
// unbounded drain holds a function open for as long as the backlog is long, and
// a backlog that cannot be worked through in one pass is worked through in the
// next one. Nothing is lost by stopping early — an unclaimed message is still
// queued and still due.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// F1 — WHERE THE THREE MINUTES ACTUALLY GO. MEASURED, 2026-09-03.
//
// The owner booked five simulated calls on the live site and the confirmation
// text, email and AI call all landed roughly three minutes later against a
// 60-second target. Measured against the production database afterwards, on
// the real `events` and `messages` rows from that walk (all times UTC):
//
//   booking → the row is QUEUED           44s, 69s, 188s  (three bookings)
//   queued  → the dispatcher first tries  46s to 270s
//
// Worked example, the last sim client of the walk:
//   01:07:58  booking.created written
//   01:11:06  SMS-S04-01-CONFIRM queued   (188s after the booking)
//   01:12:01  EMAIL-S04-01-CONFIRM queued (243s)
//   01:15:35  first dispatch attempt on both — 7m37s after the booking.
//
// So it is TWO delays, not one, and neither is small:
//
//   1. THIS SWEEPER'S CADENCE, and it is the half this file owns. Every
//      templated message waits for the next pass. Worst case is one whole
//      cron interval — five minutes — and the measured waits (46s…270s) are
//      exactly the spread you get from arriving at a random point in a
//      five-minute cycle. A 60-second target cannot be met by a five-minute
//      clock, whatever else is fixed.
//
//   2. WORKFLOW-SIDE LATENCY BEFORE THE ROW EXISTS — s-04b-booking-reminders
//      resolves the client, queues the text, mints a portal link, then queues
//      the email, and each of those is a separate Inngest step round trip.
//      That cost 44s for the first sim client of the walk and 188s for the
//      fifth, i.e. it grows under load. NOT this file's to fix; recorded here
//      because halving the sweep interval alone would still miss the target.
//
// The single-message path that answers (1) is outbox.drainMessageNow(). The
// cadence below is unchanged pending the owner's call — see that function.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { DEFAULT_BATCH } from "../messaging/dispatch.mjs";
import { drainAll } from "../messaging/outbox.mjs";
import { sweepBookingHandoffs } from "../events/booking-handoff.mjs";

/** How often a pass would run once this is registered. Every five minutes: the
    quiet-hours window opens on the hour, and a text held overnight should go out
    within a few minutes of 11:00 rather than up to an hour after it. */
export const SWEEP_CRON = "*/5 * * * *";

export const SOURCE_WORKFLOW = "message-dispatch-sweeper";

/* sweep — one pass. Pure enough to test directly: `db` and the batch size are
   arguments, so the tests drive it without Inngest and without a scheduler.

   Never throws. A pass that fails must not take the scheduled function down with
   it, because the next pass is the recovery: every message it did not finish is
   still queued and still due. The error is returned so a caller can log it. */
export async function sweep(db, options = {}) {
  const { limit = DEFAULT_BATCH, bookingHandoffImpl = sweepBookingHandoffs, ...rest } = options;
  // Independent of the message drain: a handoff error cannot strand existing
  // queued mail. Only the newly ticketed booking namespace is read by this job.
  const handoff = Promise.resolve().then(() => bookingHandoffImpl(db)).catch(() =>
    ({ scanned: 0, accepted: 0, pending: 0, exhausted: 0, ignored: 0, errors: 1 }));
  try {
    /* THROUGH outbox.drainAll(), NOT dispatchDue() DIRECTLY. That is what makes
       the per-company switch and the daily cap apply to the scheduled run as
       well as to the button — a sweeper that went straight to the dispatcher
       would ignore both, and an operator who paused sending would find it still
       sending on the hour. */
    const result = await drainAll(db, { ...rest, limit });
    const bookingHandoffs = await handoff;
    return { ...result, bookingHandoffs, ok: bookingHandoffs.errors===0 && bookingHandoffs.exhausted===0 };
  } catch (err) {
    return {
      ok: false,
      orgs: 0,
      dispatched: 0,
      sent: 0,
      per: [],
      error: String((err && err.message) || err).slice(0, 300)
    };
  }
}

/* handle — the shape src/journeys/runner/registry.mjs expects of every
   registered workflow, so that "every registered workflow is callable" stays
   true rather than this one becoming the exception that softens the rule.

   It has no event trigger (it is a cron), so no journey will ever reach it and
   it will always appear in the runner's neverFired list. That is the correct
   outcome for a scheduled job, not a coverage hole. */
export async function handle({ db: handleDb, step } = {}) {
  const run = () => sweep(handleDb || db);
  return step && typeof step.run === "function" ? step.run("sweep", run) : run();
}

/* The scheduled definition. Registered in src/workflows/index.mjs since
   2026-08-02 — see the header for what moved and what still guards it. */
export const messageDispatchSweeper = inngest.createFunction(
  { id: "message-dispatch-sweeper", name: "Message dispatch sweeper" },
  { cron: SWEEP_CRON },
  () => sweep(db)
);

export default sweep;
