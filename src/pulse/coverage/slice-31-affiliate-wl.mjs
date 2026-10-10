// Affiliate + white-label partner journey for the 7:00 a.m. pulse.
// End to end: referral capture, portals, partner marketing, both payout crons.
// Report only. Never auto-fix. Never text.
//
// Red when a door or job is not on the pulse list, or when a cron has been
// silent for 3 times its schedule (heartbeats for */15 jobs; DB stamps for monthly).

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { INNGEST_JOBS, STALE_MULTIPLE, cronIntervalMs } from "../heartbeats.mjs";
import { ROUTES } from "../../../netlify/functions/api.mjs";
import {
  SWEEP_CRON as AF01_CRON,
  SOURCE_WORKFLOW as AF01_ID
} from "../../workflows/af-01-affiliate-drip.mjs";
import { PAYOUT_CRON, affiliatePayoutRun } from "../../workflows/affiliate-payout-run.mjs";
import {
  REVIEW_CRON as PARTNER_FLOOR_CRON,
  SOURCE_WORKFLOW as PARTNER_FLOOR_ID
} from "../../workflows/partner-production-floor.mjs";

export const SLICE_ID = "31-affiliate-wl";

export const PAYOUT_ID = affiliatePayoutRun.id();
export const AF02_ID = "af-02-referral-ownership-capture";

/** One nominal month — 3× stale window for monthly payout jobs. */
export const MONTHLY_MS = 31 * 24 * 60 * 60 * 1000;
export const MONTHLY_RED_AFTER_MS = 3 * MONTHLY_MS;

export const AFFILIATE_PAYOUT_LAST_RUN_SQL =
  "SELECT max(created_at) AS last_run FROM affiliate_payouts";

export const PARTNER_FLOOR_LAST_RUN_SQL =
  "SELECT max(evaluated_at) AS last_run FROM partner_production_reviews";

/** Affiliate journey — click, refer, portal (payout tables), staff roster, desk. */
export const AFFILIATE_JOURNEY_DOORS = Object.freeze([
  "public/affiliate-click",
  "affiliates/refer",
  "read/affiliate-portal",
  "read/affiliates",
  "affiliate.html"
]);

/** White-label partner journey — sites, marketing suite, campaigns, creative, desks. */
export const PARTNER_WL_JOURNEY_DOORS = Object.freeze([
  "public/partner-page",
  "public/partner-apply",
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
  "read/partners",
  "read/partner-home-tiles",
  "read/partner-production",
  "read/partner-training",
  "partner-galaxy.html",
  "partner-training.html",
  "campaigns/list",
  "campaigns/connections",
  "creative-factory.html",
  "creative/generate"
]);

/** Optional routed checkout door for partner funnels. */
export const PARTNER_CHECKOUT_ROUTE = "public/funnel-checkout";

export const INNGEST_CRON_IDS = Object.freeze([
  AF01_ID,
  PAYOUT_ID,
  PARTNER_FLOOR_ID
]);

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
const heartbeatJobs = new Map(INNGEST_JOBS.map(([job, cron]) => [job, cron]));

function door(id, schedule = "daily") {
  const alreadyInRegistry = listed.has(id);
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : `Add ${id} to PULSE_REGISTRY (or ALLOWED_UNMONITORED with a written reason). Do not edit registry from this slice.`
  };
}

function routedDoor(routeKey) {
  if (!Object.prototype.hasOwnProperty.call(ROUTES, routeKey)) return null;
  return door(routeKey);
}

function referralCapture(id, schedule, registryKeys) {
  const alreadyInRegistry = registryKeys.every((key) => listed.has(key));
  const missing = registryKeys.filter((key) => !listed.has(key));
  let proof;
  if (alreadyInRegistry) {
    proof =
      `PASS — capture doors ${registryKeys.join(", ")} are on the morning ping list; ` +
      "event fires on entry.captured / diagnostic.paid / analysis.completed.";
  } else {
    proof =
      `Add pulse registry rows for ${missing.join(", ")} (referral ownership capture). ` +
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

function inngestCron(id, schedule, cron) {
  const alreadyInRegistry = heartbeatJobs.has(id);
  let proof;
  if (alreadyInRegistry) {
    proof =
      `PASS — job ${id} is on INNGEST_JOBS (cron ${cron}); red after ${schedule === "15m" ? "3x 15m" : `3x ${schedule}`} with no heartbeat or monthly DB stamp.`;
  } else {
    proof =
      `Add ${id} to INNGEST_JOBS in src/pulse/heartbeats.mjs (cron ${cron}). ` +
      "Do not auto-fix from this slice.";
  }
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    cron,
    alreadyInRegistry,
    proof
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
  for (const id of AFFILIATE_JOURNEY_DOORS) push(door(id));
  push(routedDoor(PARTNER_CHECKOUT_ROUTE));
  for (const id of PARTNER_WL_JOURNEY_DOORS) push(door(id));
  return out;
}

export const CHECKS = [
  referralCapture(AF02_ID, "entry.captured", ["public/affiliate-click", "affiliates/refer"]),
  inngestCron(AF01_ID, "15m", AF01_CRON),
  inngestCron(PAYOUT_ID, "monthly", PAYOUT_CRON),
  inngestCron(PARTNER_FLOOR_ID, "monthly", PARTNER_FLOOR_CRON),
  ...buildDoorChecks()
];

/**
 * True when a row is red: missing from the pulse list, or cron silent 3× schedule.
 * @param {object} row — one CHECKS row
 * @param {{ lastRunAt?: Date|string|null, lastHeartbeatAt?: Date|string|null, now?: Date }} [opts]
 */
export function isRed(row, { lastRunAt = null, lastHeartbeatAt = null, now = new Date() } = {}) {
  if (!row || !row.alreadyInRegistry) return true;

  if (row.cron && lastHeartbeatAt != null && lastHeartbeatAt !== "") {
    const interval = cronIntervalMs(row.cron);
    if (interval) {
      const t = lastHeartbeatAt instanceof Date ? lastHeartbeatAt : new Date(lastHeartbeatAt);
      if (Number.isFinite(t.getTime()) && now.getTime() - t.getTime() > STALE_MULTIPLE * interval) {
        return true;
      }
    }
  }

  if (row.id === PAYOUT_ID || row.id === PARTNER_FLOOR_ID) {
    if (lastRunAt == null || lastRunAt === "") return false;
    const t = lastRunAt instanceof Date ? lastRunAt : new Date(lastRunAt);
    if (!Number.isFinite(t.getTime())) return false;
    return now.getTime() - t.getTime() > MONTHLY_RED_AFTER_MS;
  }

  return false;
}

/** Rows not on the pulse list — close these before the slice is green. */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}

/**
 * Re-run monthly payout rows with DB last-run stamps (read-only SELECT).
 * @param {{ scope?: (fn: Function) => Promise<unknown>, now?: Date }} [opts]
 */
export async function evaluateChecks({ scope = null, now = new Date() } = {}) {
  const doors = buildDoorChecks();
  const eventRow = referralCapture(AF02_ID, "entry.captured", [
    "public/affiliate-click",
    "affiliates/refer"
  ]);
  const af01 = inngestCron(AF01_ID, "15m", AF01_CRON);
  const payout = await stampMonthlyJob(inngestCron(PAYOUT_ID, "monthly", PAYOUT_CRON), {
    scope,
    sql: AFFILIATE_PAYOUT_LAST_RUN_SQL,
    now
  });
  const floor = await stampMonthlyJob(inngestCron(PARTNER_FLOOR_ID, "monthly", PARTNER_FLOOR_CRON), {
    scope,
    sql: PARTNER_FLOOR_LAST_RUN_SQL,
    now
  });
  return [eventRow, af01, payout, floor, ...doors];
}

async function stampMonthlyJob(row, { scope, sql, now }) {
  if (!scope || !row.alreadyInRegistry) return row;
  try {
    const r = await scope((tx) => tx.query(sql).then((x) => x.rows[0] || {}));
    const lastRun = r.last_run ?? null;
    if (lastRun == null) {
      return {
        ...row,
        proof: `The ${row.id} job is on the pulse list but ${sql} returned no rows yet.`
      };
    }
    const at = lastRun instanceof Date ? lastRun : new Date(lastRun);
    if (!Number.isFinite(at.getTime())) {
      return { ...row, proof: `Could not read last run time for ${row.id}.` };
    }
    if (isRed(row, { lastRunAt: at, now })) {
      return {
        ...row,
        proof:
          `Last ${row.id} stamp ${at.toISOString()} is older than ${row.redAfter} ` +
          `(~${Math.round((now.getTime() - at.getTime()) / MONTHLY_MS)} nominal months).`
      };
    }
    return { ...row, proof: "PASS" };
  } catch {
    return { ...row, proof: `Could not run read-only stamp query for ${row.id}.` };
  }
}
