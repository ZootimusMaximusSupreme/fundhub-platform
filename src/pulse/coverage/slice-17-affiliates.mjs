// Affiliate drip, referral capture, and payout run for the 7:00 a.m. pulse.
// Report only. Never auto-fix. Never text.
// Red when not in registry (machine row or capture door), or when the payout
// cron has been silent for 3 times its schedule.

import { MACHINE_CHECKS } from "../machine.mjs";
import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import {
  SWEEP_CRON as AF01_CRON,
  SOURCE_WORKFLOW as AF01_ID
} from "../../workflows/af-01-affiliate-drip.mjs";
import { PAYOUT_CRON, affiliatePayoutRun } from "../../workflows/affiliate-payout-run.mjs";

export const SLICE_ID = "17-affiliates";

const PAYOUT_ID = affiliatePayoutRun.id();
const AF02_ID = "af-02-referral-ownership-capture";

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
const machineByFile = new Map(MACHINE_CHECKS.map((row) => [row.file, row]));

/** Three calendar months — payout cron silent threshold (3x monthly). */
export const PAYOUT_RED_AFTER_MS = 92 * 24 * 60 * 60 * 1000;

function cronJob(id, schedule, workflowFile, cron) {
  const machine = machineByFile.get(workflowFile) ?? null;
  const alreadyInRegistry = Boolean(machine);
  let proof;
  if (machine) {
    proof = `machine row ${machine.id} (${machine.watches})`;
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

function referralCapture(id, schedule, registryKeys) {
  const alreadyInRegistry = registryKeys.every((key) => listed.has(key));
  const missing = registryKeys.filter((key) => !listed.has(key));
  let proof;
  if (alreadyInRegistry) {
    proof = `PASS — capture doors ${registryKeys.join(", ")} are on the morning ping list.`;
  } else {
    proof =
      `Add pulse registry rows for ${missing.join(", ")} (referral capture). ` +
      "Do not edit registry from this slice.";
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
  cronJob(AF01_ID, "15m", "src/workflows/af-01-affiliate-drip.mjs", AF01_CRON),
  referralCapture(AF02_ID, "entry.captured", ["public/affiliate-click", "affiliates/refer"]),
  cronJob(PAYOUT_ID, "monthly", "src/workflows/affiliate-payout-run.mjs", PAYOUT_CRON)
];

/**
 * True when a row is red: missing from registry, or payout cron silent 3x schedule.
 * `lastRunAt` is for affiliate-payout-run only (when the monthly job last wrote).
 */
export function isRed(row, { lastRunAt = null, now = new Date() } = {}) {
  if (!row || !row.alreadyInRegistry) return true;
  if (row.id !== PAYOUT_ID || lastRunAt == null || lastRunAt === "") return false;
  const t = lastRunAt instanceof Date ? lastRunAt : new Date(lastRunAt);
  if (!Number.isFinite(t.getTime())) return false;
  return now.getTime() - t.getTime() > PAYOUT_RED_AFTER_MS;
}

/** Rows the morning pulse still does not watch (audit-only inventory). */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
