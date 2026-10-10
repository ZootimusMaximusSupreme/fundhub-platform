// Finance OS cron jobs for the 7:00 a.m. pulse coverage map. Report only.
// Never auto-fix. Never text. A job is red after 3 times its schedule.
// Rows name whether machine.mjs or the GET registry already watch the job;
// otherwise proof names the gap.

import { MACHINE_CHECKS } from "../machine.mjs";
import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import {
  SWEEP_CRON as PULL_CRON,
  SOURCE_WORKFLOW as PULL_ID
} from "../../workflows/finance-os-pull-sweeper.mjs";
import {
  SWEEP_CRON as CARD_DUE_CRON,
  SOURCE_WORKFLOW as CARD_DUE_ID
} from "../../workflows/finance-os-card-due-reminders.mjs";
import {
  SWEEP_CRON as MONEY_AGENT_CRON,
  SOURCE_WORKFLOW as MONEY_AGENT_ID
} from "../../workflows/finance-os-money-agent.mjs";
import {
  SWEEP_CRON as TRENDS_CRON,
  SOURCE_WORKFLOW as TRENDS_ID
} from "../../workflows/finance-os-trend-snapshots.mjs";
import {
  SWEEP_CRON as TRANSFERS_CRON,
  SOURCE_WORKFLOW as TRANSFERS_ID
} from "../../workflows/finance-os-money-transfers.mjs";
import {
  SWEEP_CRON as BLUEPRINT_ALERTS_CRON,
  SOURCE_WORKFLOW as BLUEPRINT_ALERTS_ID
} from "../../workflows/blueprint-finance-os-alerts.mjs";

export const SLICE_ID = "07-finance";

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
const machineByFile = new Map(MACHINE_CHECKS.map((row) => [row.file, row]));

function job({ id, schedule, machineFile = null, registryKeys = [], cron = null }) {
  const machine = machineFile ? (machineByFile.get(machineFile) ?? null) : null;
  const inRegistry = registryKeys.some((key) => listed.has(key));
  const alreadyInRegistry = Boolean(machine) || inRegistry;
  let proof;
  if (machine) {
    proof = `machine row ${machine.id} (${machine.watches})`;
  } else if (inRegistry) {
    proof = "PASS";
  } else {
    const cronBit = cron ? ` cron ${cron}` : "";
    proof = `gap: no machine row and no registry door for ${id}${cronBit}`;
  }
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    alreadyInRegistry,
    proof
  };
}

/** Finance OS sweepers registered in src/workflows/index.mjs. */
export const CHECKS = [
  job({
    id: PULL_ID,
    schedule: "daily",
    cron: PULL_CRON,
    registryKeys: ["finance/soft-pull", "read/finance-os"]
  }),
  job({
    id: CARD_DUE_ID,
    schedule: "daily",
    cron: CARD_DUE_CRON,
    registryKeys: ["finance/cards", "finance/cashflow"]
  }),
  job({
    id: MONEY_AGENT_ID,
    schedule: "daily",
    cron: MONEY_AGENT_CRON,
    registryKeys: ["money/helper", "money/tasks"]
  }),
  job({
    id: TRENDS_ID,
    schedule: "daily",
    cron: TRENDS_CRON,
    registryKeys: ["money/trends"]
  }),
  job({
    id: TRANSFERS_ID,
    schedule: "15min",
    cron: TRANSFERS_CRON,
    registryKeys: ["money/transfers"]
  }),
  job({
    id: BLUEPRINT_ALERTS_ID,
    schedule: "daily",
    cron: BLUEPRINT_ALERTS_CRON,
    registryKeys: ["money/alerts"]
  })
];

/** Rows the morning pulse still does not watch (audit-only inventory). */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry).map((row) => ({ id: row.id, proof: row.proof }));
}
