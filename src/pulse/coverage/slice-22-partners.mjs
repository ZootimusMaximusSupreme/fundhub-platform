// Partner + white-label doors for the 7:00 a.m. pulse. Report only. Never
// auto-fix. Never text.
//
// The monthly production-floor job is red when it is not watched in
// MACHINE_CHECKS, or when partner_production_reviews has no row newer than
// 3× its monthly schedule.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import { ROUTES } from "../../../netlify/functions/api.mjs";
import { SOURCE_WORKFLOW } from "../../workflows/partner-production-floor.mjs";

export const SLICE_ID = "22-partners";

/** One nominal month — used only for the 3× stale window. */
export const MONTHLY_MS = 31 * 24 * 60 * 60 * 1000;
export const RED_AFTER_MS = 3 * MONTHLY_MS;

export const FLOOR_JOB_ID = SOURCE_WORKFLOW;

export const FLOOR_LAST_RUN_SQL =
  "SELECT max(evaluated_at) AS last_run FROM partner_production_reviews";

/** Routed partner-site API doors — only checked when present in ROUTES. */
export const PARTNER_SITE_ROUTE_KEYS = [
  "public/partner-page",
  "public/partner-apply",
  "public/funnel-checkout"
];

/** White-label and partner-money doors that must appear in the morning ping list. */
export const WHITE_LABEL_DOOR_IDS = [
  "partner-addons",
  "partner-brand",
  "partner-brand/verify-domain",
  "partner-marketing/copy-history",
  "partner-marketing/enable",
  "partner-marketing/generate-copy",
  "partner-marketing/generate-logo",
  "partner-marketing/usage",
  "partner-pages",
  "partners/approve",
  "public/partner-apply",
  "public/partner-page",
  "public/funnel-checkout"
];

/** Staff/partner reads and desks tied to the production floor and partner home. */
export const PARTNER_SURFACE_DOOR_IDS = [
  "read/partner-home-tiles",
  "read/partner-production",
  "read/partner-training",
  "read/partners",
  "partner-galaxy.html",
  "partner-training.html"
];

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
const machineIds = new Set(MACHINE_CHECKS.map((row) => row.id));

function door(id, schedule = "daily") {
  const alreadyInRegistry = listed.has(id);
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : `Add route key ${id} to PULSE_REGISTRY (or ALLOWED_UNMONITORED with a written reason).`
  };
}

function partnerSiteDoor(routeKey) {
  if (!Object.prototype.hasOwnProperty.call(ROUTES, routeKey)) return null;
  return door(routeKey);
}

function floorJobRow({ lastRun = null, now = new Date() } = {}) {
  const schedule = "monthly";
  const redAfter = "3x monthly";
  const alreadyInRegistry = machineIds.has(FLOOR_JOB_ID);
  if (!alreadyInRegistry) {
    return {
      id: FLOOR_JOB_ID,
      schedule,
      redAfter,
      alreadyInRegistry,
      proof:
        "Add partner-production-floor to MACHINE_CHECKS in src/pulse/machine.mjs " +
        "with a SELECT on partner_production_reviews. Do not auto-fix from this slice."
    };
  }
  if (lastRun == null) {
    return {
      id: FLOOR_JOB_ID,
      schedule,
      redAfter,
      alreadyInRegistry,
      proof:
        "The production-floor job is watched but has never written partner_production_reviews."
    };
  }
  const at = lastRun instanceof Date ? lastRun : new Date(lastRun);
  if (!Number.isFinite(at.getTime())) {
    return {
      id: FLOOR_JOB_ID,
      schedule,
      redAfter,
      alreadyInRegistry,
      proof: "Could not read the last production-floor review time."
    };
  }
  const ageMs = now.getTime() - at.getTime();
  if (ageMs > RED_AFTER_MS) {
    return {
      id: FLOOR_JOB_ID,
      schedule,
      redAfter,
      alreadyInRegistry,
      proof:
        `Last production-floor review ${at.toISOString()} is older than ${redAfter} ` +
        `(~${Math.round(ageMs / MONTHLY_MS)} nominal months).`
    };
  }
  return {
    id: FLOOR_JOB_ID,
    schedule,
    redAfter,
    alreadyInRegistry,
    proof: "PASS"
  };
}

function buildDoorChecks() {
  const ids = new Set();
  const out = [];
  const push = (row) => {
    if (!row || ids.has(row.id)) return;
    ids.add(row.id);
    out.push(row);
  };
  for (const key of PARTNER_SITE_ROUTE_KEYS) push(partnerSiteDoor(key));
  for (const id of WHITE_LABEL_DOOR_IDS) push(door(id));
  for (const id of PARTNER_SURFACE_DOOR_IDS) push(door(id));
  return out;
}

/** Static checks (registry + job watch). Staleness needs evaluateChecks + scope. */
export const CHECKS = [floorJobRow(), ...buildDoorChecks()];

/**
 * Rows whose proof is not PASS — gaps to close before this slice is green.
 * @param {typeof CHECKS} [rows]
 */
export function gaps(rows = CHECKS) {
  return rows.filter((row) => row.proof !== "PASS");
}

/**
 * Rebuild checks, optionally stamping the floor job from a read-only DB scope.
 * @param {{ scope?: (fn: Function) => Promise<unknown>, now?: Date, checks?: typeof CHECKS }} [opts]
 */
export async function evaluateChecks({ scope = null, now = new Date(), checks = null } = {}) {
  const doors = buildDoorChecks();
  let floor = floorJobRow({ now });
  if (scope && machineIds.has(FLOOR_JOB_ID)) {
    try {
      const r = await scope((tx) => tx.query(FLOOR_LAST_RUN_SQL).then((x) => x.rows[0] || {}));
      floor = floorJobRow({ lastRun: r.last_run ?? null, now });
    } catch {
      floor = {
        ...floorJobRow({ now }),
        proof: "Could not read partner_production_reviews for the production-floor job."
      };
    }
  } else if (scope && !machineIds.has(FLOOR_JOB_ID)) {
    floor = floorJobRow({ now });
  }
  const merged = [floor, ...doors];
  return checks ? merged : merged;
}
