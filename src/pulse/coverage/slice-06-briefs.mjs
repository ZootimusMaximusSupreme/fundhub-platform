// Morning and evening brief crons for the pulse coverage map. Report only.
// Never auto-fix. Never text. A job is red after 3 times its daily schedule
// (3 days). alreadyInRegistry is true only when existing pulse code already
// watches the job (machine.mjs or the pulse job list in heartbeats.mjs).
//
// No repo files are read at run time (CLAUDE.md section 12). "Is the workflow
// registered" is answered by the bundled function list, and "does the pulse
// watch it" by the machine rows and the job list, all imported.

import { functions } from "../../workflows/index.mjs";
import { INNGEST_JOBS } from "../heartbeats.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";

export const SLICE_ID = "06-briefs";

export const BRIEF_TZ = "America/Phoenix";
export const MORNING_BRIEF_CRON = `TZ=${BRIEF_TZ} 0 6 * * *`;
export const EVENING_BRIEF_CRON = `TZ=${BRIEF_TZ} 0 21 * * *`;

export const MORNING_BRIEF_ID = "morning-brief";
export const EVENING_BRIEF_ID = "evening-brief";

const DAILY = "daily";

/** Workflow file paths watched by src/pulse/machine.mjs. */
const machineWorkflowFiles = new Set(MACHINE_CHECKS.map((row) => row.file));

/** Inngest function ids in the bundled list (src/workflows/index.mjs). */
const registeredIds = new Set(functions.map((fn) => fn && fn.opts && fn.opts.id).filter(Boolean));

/** Job ids the pulse job list (heartbeats.mjs) already reads. */
const pulseJobIds = new Set(INNGEST_JOBS.map(([job]) => job));

function machineRowForWorkflowFile(workflowFile) {
  return MACHINE_CHECKS.find((row) => row.file === workflowFile) ?? null;
}

function pulseAlreadyChecks({ jobId, workflowFile }) {
  return machineWorkflowFiles.has(workflowFile) || pulseJobIds.has(jobId);
}

function isWired({ jobId }) {
  return registeredIds.has(jobId) && pulseJobIds.has(jobId);
}

function briefRow({
  id,
  jobId,
  pulseFile,
  workflowFile,
  cron,
  inngestExport,
  after = null
}) {
  const machine = machineRowForWorkflowFile(workflowFile);
  const alreadyInRegistry = pulseAlreadyChecks({ jobId, workflowFile });
  let proof;
  if (alreadyInRegistry && machine) {
    proof = `PASS — machine row ${machine.id} reads what ${id} leaves behind (${machine.watches}).`;
  } else if (alreadyInRegistry) {
    proof = `PASS — ${id} is already watched in the morning pulse code (job ${jobId}).`;
  } else {
    proof =
      `Wire ${pulseFile} and ${workflowFile} (cron ${cron}), register ${inngestExport} in ` +
      `src/workflows/index.mjs, then add a pulse watch (machine row or daily-pulse check). Do not auto-fix from this pulse.`;
  }
  return {
    id,
    jobId,
    schedule: DAILY,
    redAfter: `3x ${DAILY}`,
    cron,
    timezone: BRIEF_TZ,
    pulseFile,
    workflowFile,
    inngestExport,
    after,
    machineId: machine?.id ?? null,
    alreadyInRegistry,
    proof
  };
}

export const CHECKS = [
  briefRow({
    id: MORNING_BRIEF_ID,
    jobId: "daily-pulse",
    pulseFile: "src/ops/morning-brief.mjs",
    workflowFile: "src/workflows/daily-pulse.mjs",
    cron: MORNING_BRIEF_CRON,
    inngestExport: "dailyPulse",
    after: "daily-pulse"
  }),
  briefRow({
    id: EVENING_BRIEF_ID,
    jobId: "evening-brief",
    pulseFile: "src/ops/morning-brief.mjs",
    workflowFile: "src/workflows/evening-brief.mjs",
    cron: EVENING_BRIEF_CRON,
    inngestExport: "eveningBrief"
  })
];

/** Whether each brief is registered end-to-end (read-only; never edits index). */
export function wired(checks = CHECKS) {
  return checks.map((row) => ({
    id: row.id,
    wired: isWired(row)
  }));
}

/** Rows the morning pulse still does not watch (audit-only inventory). */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
