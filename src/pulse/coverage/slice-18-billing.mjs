// Subscription billing and paid checkout expiry sweepers for the 7:00 a.m. pulse.
// Report only. Never auto-fix. Never text. Never charge.
// A job is red after 3 times its schedule. A sweeper is red when it has no
// MACHINE_CHECKS row (GET registry rows do not watch cron jobs).

import { MACHINE_CHECKS } from "../machine.mjs";
import {
  SWEEP_CRON as BILLING_SWEEP_CRON,
  SOURCE_WORKFLOW as BILLING_WORKFLOW_ID
} from "../../workflows/subscription-billing-sweeper.mjs";
import {
  SWEEP_CRON as CHECKOUT_EXPIRY_SWEEP_CRON,
  SOURCE_WORKFLOW as CHECKOUT_EXPIRY_WORKFLOW_ID
} from "../../workflows/paid-checkout-expiry-sweeper.mjs";

export const SLICE_ID = "18-billing";

const HOURLY = "hourly";

/** Workflow file paths watched by src/pulse/machine.mjs. */
const machineWorkflowFiles = new Set(MACHINE_CHECKS.map((row) => row.file));

function machineRowForWorkflowFile(workflowFile) {
  return MACHINE_CHECKS.find((row) => row.file === workflowFile) ?? null;
}

function sweeper(id, workflowFile, cron) {
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
    schedule: HOURLY,
    redAfter: `3x ${HOURLY}`,
    cron,
    workflowFile,
    machineId: machine?.id ?? null,
    alreadyInRegistry,
    proof
  };
}

export const CHECKS = [
  sweeper(
    BILLING_WORKFLOW_ID,
    "src/workflows/subscription-billing-sweeper.mjs",
    BILLING_SWEEP_CRON
  ),
  sweeper(
    CHECKOUT_EXPIRY_WORKFLOW_ID,
    "src/workflows/paid-checkout-expiry-sweeper.mjs",
    CHECKOUT_EXPIRY_SWEEP_CRON
  )
];

/** Rows with no machine pulse watch (never edits registry or machine). */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
