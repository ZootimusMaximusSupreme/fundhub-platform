// Inquiry removal fulfillment (Specialist desk, cases API, setter + call sweepers,
// C-02/C-02B/C-03) for the 7:00 a.m. pulse. Report only. Never auto-fix.
// Never text. Never mail a bureau. A GET door is red when missing from
// PULSE_REGISTRY. A job is red after 3 times its schedule with no run.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";

export const SLICE_ID = "29-inquiry-remover";

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));

function door(id) {
  const alreadyInRegistry = listed.has(id);
  return {
    id,
    schedule: "daily",
    redAfter: "3x daily",
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : `Add route or desk key ${id} to PULSE_REGISTRY. Do not auto-fix from this pulse.`
  };
}

function workflow(id, schedule, note) {
  const alreadyInRegistry = listed.has(id);
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : `Add pulse registry row for workflow ${id} (${note}). Do not auto-fix from this pulse.`
  };
}

/** Rows not on the morning pulse — Chris fixes reds; this slice never auto-fixes. */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}

export const CHECKS = [
  door("inquiry-remover.html"),
  door("read/inquiry-cases"),
  door("inquiry-cases"),
  door("inquiry"),
  workflow("c-02b-inquiry-removal-requested", "deposit.paid", "event deposit.paid — queue IRA removal"),
  workflow("ai-set-01-josh-setter", "booking.created", "event booking.created — setter dial"),
  workflow(
    "ai-set-04-3way-handoff",
    "booking.created + booking.rescheduled",
    "events booking.created and booking.rescheduled — pre-call handoff"
  ),
  workflow(
    "ai-set-03-no-answer-cadence",
    "call.completed",
    "event call.completed — no-answer cadence (report only; pulse never texts)"
  ),
  workflow(
    "inquiry-call-sweeper",
    "15 minutes",
    "cron */15 * * * * — due bureau calls from inquiry-ops/call-scheduler.mjs"
  ),
  workflow(
    "c-02-inquiry-created",
    "analysis.completed",
    "event analysis.completed — new inquiries into inquiry_log + specialist task"
  ),
  workflow(
    "c-03-inquiry-removed-resume-or-hold",
    "inquiry.removed",
    "event inquiry.removed — case closed from POST /api/inquiry-cases"
  )
];
