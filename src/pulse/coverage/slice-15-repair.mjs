// Repair lane Inngest workflows (C-00–C-06, DS-01/02, bureau reader) for pulse coverage.
// Report only. Never auto-fix. Never text.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";

export const SLICE_ID = "15-repair";

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
  workflow("c-00-crs-soft-pull-request", "diagnostic.paid", "event diagnostic.paid"),
  workflow("c-02-inquiry-created", "analysis.completed", "event analysis.completed"),
  workflow("c-02b-inquiry-removal-requested", "deposit.paid", "event deposit.paid"),
  workflow("c-03-inquiry-removed-resume-or-hold", "inquiry.removed", "event inquiry.removed"),
  workflow("c-05-pre-funding-review", "round.started", "event round.started"),
  workflow("c-06-crs-results-router", "analysis.completed", "event analysis.completed"),
  workflow("ds-01-repair-referral", "call.completed", "event call.completed"),
  workflow("ds-02-diy-letters", "payment.received", "event payment.received"),
  workflow(
    "repair-bureau-response-reader",
    "docs.received",
    "event docs.received — bureau response upload reader"
  )
];
