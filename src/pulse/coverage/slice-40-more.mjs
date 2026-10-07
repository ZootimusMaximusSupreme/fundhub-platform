// Leftover live jobs and doors for the 7:00 a.m. pulse.
// Report only. Never auto-fix. Never text.
// A cron is red after 3 times its schedule with no run.
// A door is red when the morning pulse does not ping it.
// Event jobs here have no cron, so they leave no heartbeat.
// Skips anything already named in another slice CHECKS id or in PULSE_REGISTRY.
// Scheduled jobs already on the morning heartbeat list are not repeated here.

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

function door(id, note) {
  return row(
    id,
    "daily",
    `Live page ${id}. Not in PULSE_REGISTRY, so the morning pulse does not ping it. ` +
      `${note} A door is red when that ping is missing. Do not auto-fix. Never text.`
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
  ),
  door(
    "consulting/index.html",
    "Journey door /consulting/ (docs/journeys/fh-consulting-intended.md)."
  ),
  door(
    "consulting/privacy/index.html",
    "Privacy page on the consulting site."
  ),
  door(
    "consulting/refund/index.html",
    "Refund page on the consulting site."
  ),
  door(
    "consulting/terms/index.html",
    "Terms page on the consulting site."
  ),
  door(
    "optimize.html",
    "Journey page https://fundhub.ai/optimize (docs/journeys/optimize-intended.md). The pay API is a different door."
  ),
  door(
    "roadmap/pull.html",
    "Form after the $297 pay. Journey name /slo/pull.html. Live path /roadmap/pull.html."
  )
];

/** Rows the morning pulse still does not watch. */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
