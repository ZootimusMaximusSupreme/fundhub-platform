// AI setter, pre-call, collections, and responsiveness workflows for the 7:00 a.m. pulse.
// Report only. Never text. Never auto-fix. Never start a call.
// A job is red after 3 times its schedule. A workflow is red when its id is
// missing from the pulse registry.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";

export const SLICE_ID = "24-agents";

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
  workflow("ai-set-01-josh-setter", "booking.created", "event booking.created"),
  workflow("ai-set-03-no-answer-cadence", "call.completed", "event call.completed"),
  workflow(
    "ai-set-04-3way-handoff",
    "booking.created",
    "events booking.created and booking.rescheduled"
  ),
  workflow(
    "bs-01-precall-launcher",
    "booking.created",
    "events booking.created and booking.rescheduled"
  ),
  workflow(
    "ar-collections",
    "invoice.sent",
    "events invoice.sent and payment.received"
  ),
  workflow("bc-01-customer-responsiveness", "round.started", "event round.started"),
  workflow("bc-02-customer-friction", "round.started", "event round.started")
];
