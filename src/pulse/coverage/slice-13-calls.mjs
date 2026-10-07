// Call-path sweepers and bookings door for the 7:00 a.m. pulse. Report only.
// Never auto-fix. Never text. A cron job is red after 3 times its schedule.
// Sweepers are red when they have no MACHINE_CHECKS row. GET doors are red when
// missing from PULSE_REGISTRY.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import { SWEEP_CRON as MEET_TRANSCRIPT_CRON } from "../../workflows/meet-transcript-sweeper.mjs";
import { BLAKE_LEAD_CRON } from "../../workflows/blake-lead-watch.mjs";

export const SLICE_ID = "13-calls";

/** Matches src/workflows/inquiry-call-sweeper.mjs createFunction cron. */
export const INQUIRY_CALL_CRON = "*/15 * * * *";

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
const machineWorkflowFiles = new Set(MACHINE_CHECKS.map((row) => row.file));

function machineRowForWorkflowFile(workflowFile) {
  return MACHINE_CHECKS.find((row) => row.file === workflowFile) ?? null;
}

function sweeper(id, workflowFile, cron, schedule) {
  const machine = machineRowForWorkflowFile(workflowFile);
  const alreadyInRegistry = machineWorkflowFiles.has(workflowFile);
  let proof;
  if (alreadyInRegistry && machine) {
    proof = `PASS — machine row ${machine.id} reads what ${id} leaves behind (${machine.watches}).`;
  } else {
    proof =
      `Add a MACHINE_CHECKS row in src/pulse/machine.mjs for ${workflowFile} ` +
      `(cron ${cron}). Do not auto-fix from this pulse.`;
  }
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    cron,
    workflowFile,
    machineId: machine?.id ?? null,
    alreadyInRegistry,
    proof
  };
}

function door(id) {
  const alreadyInRegistry = listed.has(id);
  return {
    id,
    schedule: "daily",
    redAfter: "3x daily",
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? `PASS — GET /api/${id} is in PULSE_REGISTRY.`
      : `Add route key ${id} to PULSE_REGISTRY. Do not auto-fix from this pulse.`
  };
}

export const CHECKS = [
  sweeper(
    "meet-transcript-sweeper",
    "src/workflows/meet-transcript-sweeper.mjs",
    MEET_TRANSCRIPT_CRON,
    "10 minutes"
  ),
  sweeper(
    "blake-lead-watch",
    "src/workflows/blake-lead-watch.mjs",
    BLAKE_LEAD_CRON,
    "5 minutes"
  ),
  sweeper(
    "inquiry-call-sweeper",
    "src/workflows/inquiry-call-sweeper.mjs",
    INQUIRY_CALL_CRON,
    "15 minutes"
  ),
  door("bookings")
];

/** Rows with no machine pulse watch or missing GET registry row. */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
