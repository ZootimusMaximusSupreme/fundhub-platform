// Funding workflows F-01 through F-11 for the 7:00 a.m. pulse coverage map.
// Report only. Never auto-fix. Never text.
// Event jobs only — not cron sweepers. A row is red when its workflow id is
// missing from PULSE_REGISTRY and has no COVERAGE_NOTES entry here.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { functions } from "../../workflows/index.mjs";

export const SLICE_ID = "14-funding";

/** Sorted f-01 … f-11 ids served from src/workflows/index.mjs. */
export const FUNDING_WORKFLOW_IDS = [
  "f-01-funding-intake",
  "f-02-portal-id-missing",
  "f-03-round-submitted",
  "f-04-round-approvals",
  "f-05-inquiry-cleanup-gate",
  "f-06-funding-conditions-missing-docs",
  "f-07-funding-locked",
  "f-08-post-funding-monitoring",
  "f-09-funding-declined-no-path",
  "f-10-client-funding-inbox-provisioner",
  "f-11-bank-email-event-router"
];

/**
 * Event workflows that are not GET registry rows but are named on this slice.
 * Keys must match Inngest function ids. Do not edit PULSE_REGISTRY from here.
 */
export const COVERAGE_NOTES = Object.freeze({});

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));

const byId = new Map(functions.map((fn) => [fn.id(), fn]));

/** Event trigger labels for one registered function (no cron). */
export function eventSchedule(fn) {
  const triggers = fn?.opts?.triggers ?? [];
  const crons = triggers.map((t) => t.cron).filter(Boolean);
  if (crons.length) {
    throw new Error(
      `slice ${SLICE_ID}: ${fn.id()} is cron-triggered (${crons.join(", ")}); this slice is event jobs only`
    );
  }
  const events = triggers.map((t) => t.event).filter(Boolean);
  if (!events.length) {
    throw new Error(`slice ${SLICE_ID}: ${fn.id()} has no event trigger`);
  }
  return events.join(" + ");
}

function workflowRow(id) {
  const fn = byId.get(id);
  if (!fn) {
    throw new Error(`slice ${SLICE_ID}: ${id} is not registered in src/workflows/index.mjs`);
  }
  const schedule = eventSchedule(fn);
  const note = COVERAGE_NOTES[id];
  const inRegistry = listed.has(id);
  const alreadyInRegistry = inRegistry || Boolean(note);
  let proof;
  if (inRegistry) {
    proof = "PASS";
  } else if (note) {
    proof = `PASS — coverage note: ${note}`;
  } else {
    proof =
      `Add pulse registry row for workflow ${id} (event ${schedule}) or name it in ` +
      `COVERAGE_NOTES in slice-14-funding.mjs. Do not auto-fix from this pulse.`;
  }
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    alreadyInRegistry,
    proof
  };
}

export const CHECKS = FUNDING_WORKFLOW_IDS.map((id) => workflowRow(id));

/** Rows still red: not in the GET registry and not named in COVERAGE_NOTES. */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
