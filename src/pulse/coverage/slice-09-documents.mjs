// Document workflows and doors for the 7:00 a.m. pulse. Report only. Never auto-fix.
// A cron job is red after 3 times its schedule. A GET door is red when its
// morning ping is missing from the registry.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { SWEEP_CRON as DOC_CHECK_RETRY_CRON } from "../../workflows/doc-check-retry-sweeper.mjs";
import { SWEEP_CRON as DOCUMENT_VAULT_CHASE_CRON } from "../../workflows/document-vault-chase.mjs";

export const SLICE_ID = "09-documents";

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));

const INDEX_SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../workflows/index.mjs"),
  "utf8"
);

/** Served from index.mjs: import path plus the symbol in the functions array. */
const WORKFLOW_INDEX_MARKERS = Object.freeze({
  "doc-check": ["./doc-check.mjs", "docCheck,"],
  "doc-check-retry-sweeper": ["./doc-check-retry-sweeper.mjs", "docCheckRetrySweeper,"],
  "document-vault-chase": ["./document-vault-chase.mjs", "documentVaultChase,"]
});

/** True when the workflow is imported and listed in src/workflows/index.mjs. */
export function workflowInIndex(id) {
  const marks = WORKFLOW_INDEX_MARKERS[id];
  if (!marks) return false;
  return marks.every((m) => INDEX_SRC.includes(m));
}

/** Human schedule label from a cron string (matches slice redAfter wording). */
export function cronScheduleLabel(cron) {
  const every = /^\*\/(\d+) \* \* \* \*$/.exec(String(cron || "").trim());
  if (every) return `${every[1]} minutes`;
  if (/^\d{1,2} \d{1,2} \* \* \*$/.test(String(cron || "").trim())) return "daily";
  return String(cron || "unknown").trim() || "unknown";
}

function door(id) {
  const alreadyInRegistry = listed.has(id);
  return {
    id,
    schedule: "daily",
    redAfter: "3x daily",
    alreadyInRegistry,
    proof: alreadyInRegistry ? "PASS" : `Add route key ${id}.`
  };
}

function workflow(id, schedule) {
  const alreadyInRegistry = workflowInIndex(id);
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : `Register ${id} in src/workflows/index.mjs (Inngest createFunction).`
  };
}

const retrySchedule = cronScheduleLabel(DOC_CHECK_RETRY_CRON);
const vaultSchedule = cronScheduleLabel(DOCUMENT_VAULT_CHASE_CRON);

export const CHECKS = [
  door("documents-upload"),
  door("documents-download"),
  door("read/documents"),
  door("money/vault"),
  door("documents.html"),
  workflow("doc-check", "on docs.received"),
  workflow("doc-check-retry-sweeper", retrySchedule),
  workflow("document-vault-chase", vaultSchedule)
];

/** Rows that are not fully covered yet (missing registry line or unregistered workflow). */
export function gaps(rows = CHECKS) {
  return rows.filter((row) => !row.alreadyInRegistry || row.proof !== "PASS");
}
