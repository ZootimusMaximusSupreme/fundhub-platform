// Funding advisor fulfillment (queue → next action → docs → apply → funded) for the
// 7:00 a.m. pulse. Report only. Never auto-fix. Never text.
// A cron job is red after 3 times its schedule. A GET door is red when missing
// from PULSE_REGISTRY. Event workflows are red when their id is missing from the
// registry. Sweepers are red when they have no MACHINE_CHECKS row.
//
// Journey: docs/journeys/role-funding-advisor-intended.md (doors); employee desk
// motion matches full-launch lattice funding-advisor lane (pipeline + CCP Apply).

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import {
  CATCH_UP_CRON,
  SOURCE_WORKFLOW as CATCH_UP_ID
} from "../../workflows/next-action-catch-up.mjs";

export const SLICE_ID = "28-funding-advisor";

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
  // Queue — pipeline list and funding desk
  door("dashboard/clients"),
  door("pipeline.html"),
  door("read/funding-rounds"),
  // Next action — panel truth and catch-up cron
  door("dashboard/client"),
  door("client-control-panel.html"),
  sweeper(
    CATCH_UP_ID,
    "src/workflows/next-action-catch-up.mjs",
    CATCH_UP_CRON,
    "5 minutes"
  ),
  // Docs — vault read and upload on the file
  door("read/documents"),
  door("documents-upload"),
  door("documents.html"),
  // Apply — lender match, application record, residential proxy door
  door("read/lender-matches"),
  door("applications"),
  door("proxy/launch"),
  // Funded — board write and post-funded automation
  door("pipeline-cards"),
  workflow(
    "f-07-funding-locked",
    "round.funded",
    "event round.funded — client funded flag and success-fee path"
  )
];

/** Rows with no pulse watch yet (never edits registry or machine). */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
