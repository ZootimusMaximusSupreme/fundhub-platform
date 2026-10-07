// Contract chaser and the client sign door for the 7:00 a.m. pulse. Report only.
// Never auto-fix. Never text. A job is red after 3 times its schedule. The chaser
// is red when it has no MACHINE_CHECKS row. The sign route is red when it is
// missing from the GET registry.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import { CHASE_CRON } from "../../workflows/contract-chaser.mjs";

export const SLICE_ID = "10-contracts";

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

function chaser(id, workflowFile, cron) {
  const machine = machineRowForWorkflowFile(workflowFile);
  const alreadyInRegistry = machineWorkflowFiles.has(workflowFile);
  let proof;
  if (alreadyInRegistry && machine) {
    proof = `PASS — machine row ${machine.id} reads what ${id} leaves behind (${machine.watches}).`;
  } else {
    proof =
      `Add a MACHINE_CHECKS row in src/pulse/machine.mjs for ${workflowFile} ` +
      `(cron ${cron}; red if no chase row in 3x daily). Do not auto-fix from this pulse.`;
  }
  return {
    id,
    schedule: DAILY,
    redAfter: `3x ${DAILY}`,
    cron,
    workflowFile,
    machineId: machine?.id ?? null,
    alreadyInRegistry,
    proof
  };
}

export const CHECKS = [
  chaser("contract-chaser", "src/workflows/contract-chaser.mjs", CHASE_CRON),
  door("contracts/sign")
];

/** Rows with no machine pulse watch or missing registry door (never edits registry or machine). */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
