// Underwrite read door and CRS/analysis workflows for pulse coverage.
// Report only. Never auto-fix. Never live CRS. Never outbound text.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";

export const SLICE_ID = "21-underwrite";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));

const slice15Mod = await import(pathToFileURL(path.join(HERE, "slice-15-crs.mjs")).href).catch(() => null);
const SLICE15_OWNS_C00 = Boolean(
  slice15Mod?.CHECKS?.some((row) => row.id === "c-00-crs-soft-pull-request")
);

function door(id) {
  const alreadyInRegistry = listed.has(id);
  return {
    id,
    schedule: "daily",
    redAfter: "3x daily",
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : `Add route key ${id} to PULSE_REGISTRY (do not edit registry from this slice).`
  };
}

function workflow(id, schedule) {
  const alreadyInRegistry = listed.has(id);
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : "Event workflow — not a GET ping; proved by registration in src/workflows/index.mjs and journey runner touches."
  };
}

const workflowRows = [
  ...(SLICE15_OWNS_C00 ? [] : [workflow("c-00-crs-soft-pull-request", "diagnostic.paid")]),
  workflow("dpc-01-analyzer-lock", "analysis.completed"),
  workflow("u-03-crs-snapshot-sync", "analysis.completed"),
  workflow("u-04-promote-crs-primary", "analysis.completed")
];

/** GET /api/read/underwrite plus CRS → snapshot → primary automations. */
export const CHECKS = [door("read/underwrite"), ...workflowRows];

/** Rows that are red: missing from the morning GET registry. */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
