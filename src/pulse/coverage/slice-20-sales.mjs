// Sales Inngest automations (S-00 through S-08) for the 7:00 a.m. pulse.
// Report only. Never auto-fix. Never text.
// A job is red after 3 times its schedule. A workflow is red when its id is
// missing from the pulse registry.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";

export const SLICE_ID = "20-sales";

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));

function workflow(id, schedule, note) {
  const alreadyInRegistry = listed.has(id);
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : `Add pulse registry row for workflow ${id} (${note}).`
  };
}

/** Rows not named in PULSE_REGISTRY — the morning pulse should list these. */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}

export const CHECKS = [
  workflow("s-00-welcome", "entry.captured", "event entry.captured"),
  workflow("s-01-new-lead-intake", "entry.captured", "event entry.captured"),
  workflow("s-02-incomplete-survey-nudge", "entry.captured", "event entry.captured"),
  workflow("s-04-call-booked", "booking.created", "event booking.created"),
  workflow(
    "s-04b-booking-reminders",
    "booking.created",
    "events booking.created and booking.rescheduled"
  ),
  workflow("s-04c-staff-booked-alert", "booking.created", "event booking.created"),
  workflow("s-portal-invite", "booking.created", "event booking.created (retired; still registered)"),
  workflow("s-nobook-chase", "survey.submitted", "event survey.submitted"),
  workflow("s-05a-no-show-recovery", "booking.noshow", "event booking.noshow"),
  workflow("s-06-post-call-funding-purchased", "deposit.paid", "event deposit.paid"),
  workflow("s-doc-collection", "deposit.paid", "event deposit.paid"),
  workflow("s-offer-bucket", "call.completed", "event call.completed (closer disposition)"),
  workflow("s-08-post-call-funding-declined", "call.completed", "event call.completed")
];
