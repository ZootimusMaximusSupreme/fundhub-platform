// Ad cron jobs for the 7:00 a.m. pulse coverage map. Report only. Never auto-fix.
// A job is red after 3 times its schedule. Rows name whether machine.mjs or the
// GET registry already watch the job; otherwise proof names the gap.

import { MACHINE_CHECKS } from "../machine.mjs";
import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";

export const SLICE_ID = "04-ads";

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
const machineByFile = new Map(MACHINE_CHECKS.map((row) => [row.file, row]));

function job({ id, schedule, machineFile = null, registryKeys = [] }) {
  const machine = machineFile ? (machineByFile.get(machineFile) ?? null) : null;
  const inRegistry = registryKeys.some((key) => listed.has(key));
  const alreadyInRegistry = Boolean(machine) || inRegistry;
  let proof;
  if (machine) {
    proof = `machine row ${machine.id} (${machine.watches})`;
  } else if (inRegistry) {
    proof = "PASS";
  } else {
    proof = `gap: no machine row and no registry door for ${id}`;
  }
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    alreadyInRegistry,
    proof
  };
}

/** Scheduled ad / Meta jobs from src/workflows/index.mjs (plus Netlify ad-video). */
export const CHECKS = [
  job({
    id: "meta-campaign-sync-sweeper",
    schedule: "daily",
    machineFile: "src/workflows/meta-campaign-sync-sweeper.mjs"
  }),
  job({
    id: "meta-campaign-sync-hourly",
    schedule: "hourly"
  }),
  job({
    id: "ad-video-sweeper",
    schedule: "5min"
  }),
  job({
    id: "watch-curve-diagnosis-sweeper",
    schedule: "daily",
    machineFile: "src/workflows/watch-curve-diagnosis-sweeper.mjs"
  })
];

/** Rows the morning pulse still does not watch (audit-only inventory). */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry).map((row) => ({ id: row.id, proof: row.proof }));
}
