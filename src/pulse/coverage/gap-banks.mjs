// Banks missing on the money screen. Report only. Read-only SQL.
//
// The SQL and the verdicts live in src/pulse/beats/lib/banks-truth.mjs, so this morning lane and the
// hourly beat bank-links judge with the same code. This file hands the lane its reader (the staff scope
// when the pulse has one, else the plain pool) and works out the bank sync's schedule from the sweeper
// and the heartbeat rule. No Plaid call. No token exchange. Recon (AG-07) is the one tripwire.

import { cronIntervalMs, STALE_MULTIPLE } from "../heartbeats.mjs";
import {
  SOURCE_WORKFLOW as PLAID_SYNC_JOB,
  SWEEP_CRON as PLAID_SYNC_CRON
} from "../../workflows/plaid-transactions-sweeper.mjs";
import { runBanksChecks } from "../beats/lib/banks-truth.mjs";

export * from "../beats/lib/banks-truth.mjs";

export const PLAID_SYNC_JOB_ID = PLAID_SYNC_JOB;

const INTERVAL_MS = cronIntervalMs(PLAID_SYNC_CRON);
/** Daily bank sync is red after 3 times its schedule (3 days). */
export const RED_AFTER_MS = INTERVAL_MS == null ? null : INTERVAL_MS * STALE_MULTIPLE;

/** What judgeStale needs to know about the sync it judges. */
export const SYNC_SCHEDULE = Object.freeze({ redAfterMs: RED_AFTER_MS, cron: PLAID_SYNC_CRON, job: PLAID_SYNC_JOB_ID });

function reader(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  const db = ctx && ctx.db;
  if (db && typeof db.query === "function") return (fn) => fn(db);
  return null;
}

/**
 * gapChecks(ctx) → [{ id, status, detail, suggestedFix }]
 * status is PASS, FAIL, or skip.
 * ctx: { db } or { scope }, optional { now, orgId }.
 * SELECT only. Never calls Plaid.
 */
export async function gapChecks(ctx = {}) {
  return runBanksChecks({ run: reader(ctx), now: ctx.now, orgId: ctx.orgId || null, schedule: SYNC_SCHEDULE });
}
