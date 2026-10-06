// When a job that waits for a booked call's time must stop (Inngest cancelOn).
//
// Shared by the 15-minute text (ai-set-04-3way-handoff.mjs) and the no-show
// check (dpc-02-call-outcome-enforcement.mjs), so the two cannot drift. Its own
// module, not an export of either workflow: dpc-02 → ai-set-04 → s-04b → dpc-02
// would be an import loop.
//
// `event` is the event that started the waiting run; `async` is the incoming
// cancel or move. Matched by the call's id OR by email: the email rule is what
// reaches a run started from a call saved under an old message id
// (src/adapters/clickfunnels.mjs, before 2026-10-05).

/** A cancel of the same call stops the run. */
export const CANCEL_RULES = Object.freeze([
  {
    event: "booking.cancelled",
    if: "event.data.payload.bookingUid != null && event.data.payload.bookingUid == async.data.payload.bookingUid"
  },
  {
    event: "booking.cancelled",
    if: "event.data.payload.email != null && event.data.payload.email == async.data.payload.email"
  }
]);

/** A move of the same call to a DIFFERENT time stops the run for the old time.
 *  The time check is what keeps the run a move itself starts (the workflow also
 *  triggers on booking.rescheduled) from being cancelled by that same move, and
 *  leaves a "move" to the same time alone. */
export const RESCHEDULE_CANCEL_RULES = Object.freeze([
  {
    event: "booking.rescheduled",
    if: "event.data.payload.bookingUid != null && event.data.payload.bookingUid == async.data.payload.bookingUid && event.data.payload.startTime != async.data.payload.startTime"
  },
  {
    event: "booking.rescheduled",
    if: "event.data.payload.email != null && event.data.payload.email == async.data.payload.email && event.data.payload.startTime != async.data.payload.startTime"
  }
]);
