// Morning and evening brief crons for the pulse coverage map. Report only.
// Never auto-fix. Never text. A job is red after 3 times its daily schedule
// (3 days). alreadyInRegistry is true only when existing pulse code already
// watches the job (machine.mjs, daily-pulse.mjs, or registry.mjs).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MACHINE_CHECKS } from "../machine.mjs";

export const SLICE_ID = "06-briefs";

export const BRIEF_TZ = "America/Phoenix";
export const MORNING_BRIEF_CRON = `TZ=${BRIEF_TZ} 0 6 * * *`;
export const EVENING_BRIEF_CRON = `TZ=${BRIEF_TZ} 0 21 * * *`;

export const MORNING_BRIEF_ID = "morning-brief";
export const EVENING_BRIEF_ID = "evening-brief";

const DAILY = "daily";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");

const INDEX_FILE = "src/workflows/index.mjs";
const PULSE_WATCH_FILES = [
  "src/pulse/daily-pulse.mjs",
  "src/pulse/machine.mjs",
  "src/pulse/registry.mjs"
];

/** Workflow file paths watched by src/pulse/machine.mjs. */
const machineWorkflowFiles = new Set(MACHINE_CHECKS.map((row) => row.file));

function machineRowForWorkflowFile(workflowFile) {
  return MACHINE_CHECKS.find((row) => row.file === workflowFile) ?? null;
}

function repoFileExists(relPath) {
  return fs.existsSync(path.join(REPO_ROOT, relPath));
}

function repoFileIncludes(relPath, needle) {
  if (!repoFileExists(relPath)) return false;
  return fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8").includes(needle);
}

function pulseAlreadyChecks({ id, workflowFile, pulseFile }) {
  if (machineWorkflowFiles.has(workflowFile)) return true;
  const needles = [
    id,
    path.basename(pulseFile, ".mjs"),
    path.basename(workflowFile, ".mjs")
  ];
  return PULSE_WATCH_FILES.some((rel) => needles.some((n) => repoFileIncludes(rel, n)));
}

function indexRegistersBrief(workflowFile, inngestExport) {
  if (!repoFileExists(INDEX_FILE)) return false;
  const text = fs.readFileSync(path.join(REPO_ROOT, INDEX_FILE), "utf8");
  return text.includes(workflowFile) || text.includes(inngestExport);
}

function isWired({ pulseFile, workflowFile, inngestExport }) {
  return (
    repoFileExists(pulseFile) &&
    repoFileExists(workflowFile) &&
    indexRegistersBrief(workflowFile, inngestExport)
  );
}

function briefRow({
  id,
  pulseFile,
  workflowFile,
  cron,
  inngestExport,
  after = null
}) {
  const machine = machineRowForWorkflowFile(workflowFile);
  const alreadyInRegistry = pulseAlreadyChecks({ id, workflowFile, pulseFile });
  let proof;
  if (alreadyInRegistry && machine) {
    proof = `PASS — machine row ${machine.id} reads what ${id} leaves behind (${machine.watches}).`;
  } else if (alreadyInRegistry) {
    proof = `PASS — ${id} is already watched in the morning pulse code.`;
  } else {
    proof =
      `Wire ${pulseFile} and ${workflowFile} (cron ${cron}), register ${inngestExport} in ` +
      `${INDEX_FILE}, then add a pulse watch (machine row or daily-pulse check). Do not auto-fix from this pulse.`;
  }
  return {
    id,
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
    pulseFile: "src/ops/morning-brief.mjs",
    workflowFile: "src/workflows/daily-pulse.mjs",
    cron: MORNING_BRIEF_CRON,
    inngestExport: "dailyPulse",
    after: "daily-pulse"
  }),
  briefRow({
    id: EVENING_BRIEF_ID,
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
