// Leftover event jobs for the 7:00 a.m. pulse.
// Report only. Never auto-fix. Never text.
// These have no cron, so they leave no heartbeat.
// A missed event is not red just because no GET ran.
// Journey pages that used to sit here are on PULSE_REGISTRY. The morning ping GETs them.

export const SLICE_ID = "40-more";

function row(id, schedule, proof) {
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    alreadyInRegistry: false,
    proof
  };
}

function eventJob(id, schedule, note) {
  return row(
    id,
    schedule,
    `Event ${schedule}. No cron, so a missed run leaves no heartbeat. ` +
      `Not in PULSE_REGISTRY, so the morning pulse does not ping it. ${note} ` +
      "Do not auto-fix. Never text."
  );
}

export const CHECKS = [
  eventJob(
    "at-01-first-touch-capture",
    "entry.captured",
    "Saves the first day we saw a new lead."
  ),
  eventJob(
    "dpc-02-call-outcome-enforcement",
    "booking.created",
    "Also wakes on booking.rescheduled. Marks the call showed or no-show."
  ),
  eventJob(
    "dpc-03-inbound-reply-router",
    "message.inbound",
    "Moves the deal when a person texts back yes, reschedule, or close."
  ),
  eventJob(
    "dpc-05-no-progress-escalation",
    "booking.created",
    "Chases a booked person who has been quiet for 72 hours."
  ),
  eventJob(
    "round-started-client-notify",
    "round.started",
    "Texts the client when a funding round starts."
  ),
  eventJob(
    "slo-genuine-checkout-sms",
    "slo.checkout_started",
    "Texts when a phone shows up at checkout and they have not paid."
  ),
  eventJob(
    "slo-genuine-reply",
    "message.inbound",
    "Sends message 2 after a reply on the $297 path."
  ),
  eventJob(
    "sys-01-client-value-calculator",
    "round.approved",
    "Saves a commission guess when a round is approved."
  ),
  eventJob(
    "sys-01-ltv-calculator",
    "round.funded",
    "Adds the funded amount to the lifetime total."
  ),
  eventJob(
    "u-02-analyzer-complete-delivery",
    "analysis.completed",
    "Tags the file funding or repair when the credit read finishes."
  )
];

/** Rows the morning pulse still does not watch. */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
