// Banking sweepers and sync doors for the 7:00 a.m. pulse. Report only. Never auto-fix.
// A job is red after 3 times its schedule. A sweeper is red when it has no
// MACHINE_CHECKS row. A GET sync door is red when it is missing from the registry.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import {
  SWEEP_CRON as PLAID_SWEEP_CRON,
  SOURCE_WORKFLOW as PLAID_WORKFLOW_ID
} from "../../workflows/plaid-transactions-sweeper.mjs";
import {
  SWEEP_CRON as MERCHANT_SWEEP_CRON,
  SOURCE_WORKFLOW as MERCHANT_WORKFLOW_ID
} from "../../workflows/merchant-pull-sweeper.mjs";

export const SLICE_ID = "08-banks";

const DAILY = "daily";

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));

/** Workflow file paths watched by src/pulse/machine.mjs. */
const machineWorkflowFiles = new Set(MACHINE_CHECKS.map((row) => row.file));

function machineRowForWorkflowFile(workflowFile) {
  return MACHINE_CHECKS.find((row) => row.file === workflowFile) ?? null;
}

function door(id) {
  const alreadyInRegistry = listed.has(id);
  return {
    id,
    schedule: DAILY,
    redAfter: `3x ${DAILY}`,
    alreadyInRegistry,
    proof: alreadyInRegistry ? "PASS" : `Add route key ${id}.`
  };
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
    schedule: DAILY,
    redAfter: `3x ${DAILY}`,
    alreadyInRegistry,
    proof
  };
}

export const CHECKS = [
  sweeper(
    PLAID_WORKFLOW_ID,
    "src/workflows/plaid-transactions-sweeper.mjs",
    PLAID_SWEEP_CRON
  ),
  sweeper(
    MERCHANT_WORKFLOW_ID,
    "src/workflows/merchant-pull-sweeper.mjs",
    MERCHANT_SWEEP_CRON
  ),
  door("banking/sync-accounts"),
  door("banking/sync-liabilities"),
  door("banking/sync-transactions")
];

/** Rows with no machine pulse watch or missing registry door (never edits registry or machine). */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
