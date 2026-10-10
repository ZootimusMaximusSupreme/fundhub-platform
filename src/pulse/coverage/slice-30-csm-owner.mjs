// Owner, sales manager, and CSM live desks and API doors for the 7:00 a.m. pulse.
// Report only. Never auto-fix. Never text.
//
// Grounded in docs/journeys/role-owner-intended.md, role-sales-manager-intended.md,
// role-csm-actual.md (no role-csm-intended.md yet), plus matching -actual route tables.
// Scope: dashboards, task/shift surfaces, and approval doors these roles rely on.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";

export const SLICE_ID = "30-csm-owner";

const SCHEDULE = "daily";

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));

/** Owner home and roll-up dashboards (pipeline, ops pulse, marketing command). */
export const OWNER_DASHBOARD_DOOR_IDS = [
  "pipeline.html",
  "dashboard/kpis",
  "dashboard/pipeline",
  "dashboard/pipeline-counts",
  "dashboard/clients",
  "dashboard/client",
  "read/ops-pulse",
  "ops-admin.html",
  "marketing-command-center.html",
  "marketing/today"
];

/** Owner-only or owner-primary approval writes and reads. */
export const OWNER_APPROVAL_DOOR_IDS = [
  "company-brain/reviews",
  "partners/approve",
  "marketing/scripts/approve",
  "marketing/flywheel/approve",
  "hiring/decide",
  "hiring.html",
  "creative/approvals",
  "read/blueprint-combined-approval"
];

/** Sales manager home (sales floor) and finance-gated team desks. */
export const SALES_MANAGER_DASHBOARD_DOOR_IDS = [
  "sales-floor.html",
  "read/sales-floor",
  "products-commissions.html",
  "staff-teams.html",
  "read/staff",
  "read/commissions",
  "staff/telemetry",
  "commissions",
  "commission-rules",
  "company-brain/sync"
];

/** Task claim, shift clock, and calendar — shared staff motion (CSM queue, SM floor). */
export const SHARED_TASK_DOOR_IDS = ["tasks", "shifts", "calendar.html"];

/** CSM accountability queue, consent, and insight writes. */
export const CSM_DOOR_IDS = [
  "csm-queue.html",
  "read/csm-queue",
  "consent-capture.html",
  "consent/capture",
  "customer-insights",
  "read/customer-insights"
];

function door(id, note) {
  const alreadyInRegistry = listed.has(id);
  return {
    id,
    schedule: SCHEDULE,
    redAfter: `3x ${SCHEDULE}`,
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : `Add pulse registry row for ${id} (${note}). Do not auto-fix from this slice. Never text.`
  };
}

function pushUnique(rows, id, note) {
  if (rows.some((row) => row.id === id)) return;
  rows.push(door(id, note));
}

function buildChecks() {
  const rows = [];
  for (const id of OWNER_DASHBOARD_DOOR_IDS) {
    pushUnique(rows, id, "role-owner dashboard or ops read");
  }
  for (const id of OWNER_APPROVAL_DOOR_IDS) {
    pushUnique(rows, id, "role-owner approval or hiring decide");
  }
  for (const id of SALES_MANAGER_DASHBOARD_DOOR_IDS) {
    pushUnique(rows, id, "role-sales_manager sales floor or finance desk");
  }
  for (const id of SHARED_TASK_DOOR_IDS) {
    pushUnique(rows, id, "staff tasks, shifts, or calendar");
  }
  for (const id of CSM_DOOR_IDS) {
    pushUnique(rows, id, "role-csm queue, consent, or customer insights");
  }
  return rows;
}

export const CHECKS = buildChecks();

/** Doors not on the morning ping list yet. */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
