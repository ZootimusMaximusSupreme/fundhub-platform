// Nurture lane (N-01–N-06) and next-step catch-up for the 7:00 a.m. pulse.
// Report only. Never auto-fix. Never text.
// A workflow is red when its id is missing from the pulse registry. The catch-up
// cron is also red after 3 times its schedule with no run (15m for */5).

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { CATCH_UP_CRON, SOURCE_WORKFLOW as CATCH_UP_ID } from "../../workflows/next-action-catch-up.mjs";

export const SLICE_ID = "16-nurture";

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
      : `Add pulse registry row for workflow ${id} (${note}). Do not edit registry from this slice.`
  };
}

function catchUpCron() {
  const schedule = "5m";
  const redAfter = `3x ${schedule}`;
  const alreadyInRegistry = listed.has(CATCH_UP_ID);
  let proof;
  if (alreadyInRegistry) {
    proof =
      `PASS — cron ${CATCH_UP_CRON}; red after ${redAfter} with no run ` +
      "(employee_next_action catch-up must fire at least every 15 minutes).";
  } else {
    proof =
      `Add pulse registry row for workflow ${CATCH_UP_ID} (cron ${CATCH_UP_CRON}). ` +
      `When listed, red after ${redAfter} with no run. Do not edit registry from this slice.`;
  }
  return {
    id: CATCH_UP_ID,
    schedule,
    redAfter,
    cron: CATCH_UP_CRON,
    alreadyInRegistry,
    proof
  };
}

/** Rows not named in PULSE_REGISTRY — the morning pulse should list these. */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}

export const CHECKS = [
  workflow("n-01-cold-nurture", "retired", "triggers removed 2026-08-22 — registered in index.mjs only"),
  workflow("n-02-warm-nurture", "retired", "triggers removed 2026-08-22 — registered in index.mjs only"),
  workflow("n-03-hot-nurture", "retired", "disabled 2026-08-22 — registered in index.mjs only"),
  workflow("n-04-post-funding-nurture", "round.closeout", "event round.closeout"),
  workflow(
    "n-05-repair-complete-nurture",
    "unwired",
    "repair-done nurture copy exists; no src/workflows/n-05-*.mjs or index.mjs registration yet"
  ),
  workflow("n-06-renewal-second-wave", "round.funded", "event round.funded + 6-month sleep"),
  catchUpCron()
];
