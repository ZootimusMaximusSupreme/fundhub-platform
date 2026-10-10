// Hiring bench and candidate outreach sweepers for the 7:00 a.m. pulse. Report only.
// Never auto-fix. Never text. A job is red after 3 times its schedule. A sweeper
// is red when it is missing from src/workflows/index.mjs or has no MACHINE_CHECKS
// row (GET registry rows do not watch cron jobs).

// No repo files are read at run time (CLAUDE.md section 12): the bundled
// function list is imported, so this slice loads on the server too.

import { functions } from "../../workflows/index.mjs";
import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import {
  SWEEP_CRON as BENCH_CRON,
  SOURCE_WORKFLOW as BENCH_ID
} from "../../workflows/hiring-bench-sweeper.mjs";
import {
  SWEEP_CRON as OUTREACH_CRON,
  SOURCE_WORKFLOW as OUTREACH_ID
} from "../../workflows/hiring-outreach-cadence.mjs";

export const SLICE_ID = "11-hiring";

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));

/** GET hiring/* keys present in PULSE_REGISTRY (cron sweepers are not registry rows). */
export const hiringRegistryDoorCount = [...listed].filter((k) => k.startsWith("hiring/")).length;

/** Inngest function ids in the bundled list (src/workflows/index.mjs). */
const registeredIds = new Set(functions.map((fn) => fn && fn.opts && fn.opts.id).filter(Boolean));

/** True when the workflow id is registered in src/workflows/index.mjs. */
export function workflowInIndex(id) {
  return registeredIds.has(String(id));
}

const machineWorkflowFiles = new Set(MACHINE_CHECKS.map((row) => row.file));

function machineRowForWorkflowFile(workflowFile) {
  return MACHINE_CHECKS.find((row) => row.file === workflowFile) ?? null;
}

function sweeper(id, workflowFile, cron, schedule) {
  const inIndex = workflowInIndex(id);
  const machine = machineRowForWorkflowFile(workflowFile);
  const inMachine = machineWorkflowFiles.has(workflowFile);
  const alreadyInRegistry = inIndex && inMachine;
  let proof;
  if (!inIndex) {
    proof = `Register ${id} in src/workflows/index.mjs (Inngest createFunction). Do not auto-fix from this pulse.`;
  } else if (!inMachine) {
    proof =
      `Add a MACHINE_CHECKS row in src/pulse/machine.mjs for ${workflowFile} ` +
      `(cron ${cron}). Do not auto-fix from this pulse.`;
  } else {
    proof = `PASS — machine row ${machine.id} reads what ${id} leaves behind (${machine.watches}).`;
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
  sweeper(BENCH_ID, "src/workflows/hiring-bench-sweeper.mjs", BENCH_CRON, "daily"),
  sweeper(
    OUTREACH_ID,
    "src/workflows/hiring-outreach-cadence.mjs",
    OUTREACH_CRON,
    "30m"
  )
];

/** Rows not fully watched (missing index registration or machine row). */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
