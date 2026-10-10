// Messaging and payment-queue sweepers for the 7:00 a.m. pulse. Report only.
// Never auto-fix. Never text. A job is red after 3 times its schedule. A
// sweeper is red when it has no MACHINE_CHECKS row (GET registry rows do not
// watch cron jobs).

import { MACHINE_CHECKS } from "../machine.mjs";
import {
  SWEEP_CRON as DISPATCH_CRON,
  SOURCE_WORKFLOW as DISPATCH_ID
} from "../../workflows/message-dispatch-sweeper.mjs";
import {
  SWEEP_CRON as NUDGE_CRON,
  SOURCE_WORKFLOW as NUDGE_ID
} from "../../workflows/waypoint-nudge-sweeper.mjs";
import {
  SWEEP_CRON as COMMAS_CRON,
  SOURCE_WORKFLOW as COMMAS_ID
} from "../../workflows/commas-inbox-drain.mjs";

export const SLICE_ID = "12-messaging";

/** Workflow file paths watched by src/pulse/machine.mjs. */
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
    alreadyInRegistry,
    proof
  };
}

export const CHECKS = [
  sweeper(
    DISPATCH_ID,
    "src/workflows/message-dispatch-sweeper.mjs",
    DISPATCH_CRON,
    "5m"
  ),
  sweeper(NUDGE_ID, "src/workflows/waypoint-nudge-sweeper.mjs", NUDGE_CRON, "hourly"),
  sweeper(COMMAS_ID, "src/workflows/commas-inbox-drain.mjs", COMMAS_CRON, "1m")
];

/** Rows with no machine pulse watch (never edits registry or machine). */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
