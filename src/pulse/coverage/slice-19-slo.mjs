// SLO Inngest automations for the 7:00 a.m. pulse. Report only. Never auto-fix.
// Never text. A job is red after 3 times its schedule. A workflow is red when
// its id is missing from the pulse registry.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { SWEEP_CRON as SLO_DRIP_CRON } from "../../workflows/slo-infinite-drip.mjs";

export const SLICE_ID = "19-slo";

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
  workflow("slo-infinite-drip", "daily", `cron ${SLO_DRIP_CRON}`),
  workflow("slo-no-reply-197", "slo.contact_started", "event slo.contact_started"),
  workflow("slo-genuine-followup", "slo.contact_started", "event slo.contact_started"),
  workflow("slo-paid-form-nudge", "payment.received", "event payment.received"),
  workflow("slo-pack-delivery", "analysis.completed", "event analysis.completed")
];
