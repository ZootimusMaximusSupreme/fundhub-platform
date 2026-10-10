// Closer path (booked call → show → present → close → contract → pay link) for the
// 7:00 a.m. pulse. Report only. Never auto-fix. Never text.
// A cron job is red after 3 times its schedule. A GET door is red when missing
// from PULSE_REGISTRY. Event workflows are red when their id is missing from the
// registry. Sweepers are red when they have no MACHINE_CHECKS row.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import { SWEEP_CRON as MEET_TRANSCRIPT_CRON } from "../../workflows/meet-transcript-sweeper.mjs";
import { CHASE_CRON } from "../../workflows/contract-chaser.mjs";

export const SLICE_ID = "27-closer";

const DAILY = "daily";

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
const machineWorkflowFiles = new Set(MACHINE_CHECKS.map((row) => row.file));

function machineRowForWorkflowFile(workflowFile) {
  return MACHINE_CHECKS.find((row) => row.file === workflowFile) ?? null;
}

function door(id, schedule = DAILY) {
  const alreadyInRegistry = listed.has(id);
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : `Add route key ${id} to PULSE_REGISTRY. Do not auto-fix from this pulse.`
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

export const CHECKS = [
  // Booked call
  door("bookings"),
  door("read/closer-call"),
  door("closer-call.html"),
  workflow("s-04-call-booked", "booking.created", "event booking.created"),
  // Show (live cockpit + Meet words → closer context)
  door("read/closer-now"),
  sweeper(
    "meet-transcript-sweeper",
    "src/workflows/meet-transcript-sweeper.mjs",
    MEET_TRANSCRIPT_CRON,
    "10 minutes"
  ),
  workflow("s-05a-no-show-recovery", "booking.noshow", "event booking.noshow"),
  // Present
  door("present.html"),
  door("closer-deck"),
  door("read/closer-deck"),
  door("closer-dashboard.html"),
  // Close
  door("call-outcomes"),
  door("read/call-outcomes"),
  workflow("s-offer-bucket", "call.completed", "event call.completed (closer disposition)"),
  // Contract
  door("contracts"),
  door("contracts.html"),
  sweeper("contract-chaser", "src/workflows/contract-chaser.mjs", CHASE_CRON, DAILY),
  door("contracts/sign"),
  // Pay link
  door("payment-links")
];

/** Rows with no pulse watch yet (never edits registry or machine). */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
