// Lead flow tripwires for the morning pulse. Read only.
//
// The SQL and the verdicts live in src/pulse/beats/lib/lead-truth.mjs, so this morning lane and
// the hourly beat lead-pipe judge with the same code. This file hands the lane its reader (the
// staff scope when the pulse has one, else the plain pool) and keeps naVerify, which the audit
// calls with the morning ctx. It never sends BEGIN, COMMIT or SET on the shared pool.

import {
  CHECK_IDS, CONTACTS_SQL, MIN_AD_CLICKS, MIN_FORM_PAGE_VIEWS, contactParams, noAdRan, nowOf, readAdSync, readFacts,
  runLeadChecks
} from "../beats/lib/lead-truth.mjs";

export * from "../beats/lib/lead-truth.mjs";

function bind(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  if (ctx && ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

/** The company a re-check reads: the one the row carries, else the one the caller has, else all. */
function orgOf(args, ctx) {
  return (args && args.orgId) || (ctx && ctx.orgId) || null;
}

/**
 * The audit calls these to prove a "nothing to judge" row again. Each reads with
 * the same SQL and the same minimum the lane used, and answers true only when the
 * read really shows the quiet condition. No read, a count that is missing, or a
 * row for another check is false. A read that throws is left to throw: the audit
 * counts a throw as false.
 * @param {{ check?: string, orgId?: string }} args
 * @param {{ db?: any, scope?: Function, now?: Date|string|number, orgId?: string }} ctx
 */
export const naVerify = Object.freeze({
  "low-traffic": async (args, ctx = {}) => {
    const check = args && args.check;
    if (check !== CHECK_IDS[0] && check !== CHECK_IDS[1]) return false;
    const run = bind(ctx);
    if (!run) return false;
    const f = await readFacts(run, orgOf(args, ctx), nowOf(ctx));
    if (check === CHECK_IDS[0]) return f.adRows > 0 && f.adClicks < MIN_AD_CLICKS;
    return f.formViews < MIN_FORM_PAGE_VIEWS;
  },
  /* The ad table is still empty for the two ad days, the Meta sync pulled after they closed,
     and no ad is switched on. Same two reads, same rule, as the lane. */
  "no-running-ad": async (args, ctx = {}) => {
    if (!args || args.check !== CHECK_IDS[0]) return false;
    const run = bind(ctx);
    if (!run) return false;
    const orgId = orgOf(args, ctx);
    const f = await readFacts(run, orgId, nowOf(ctx));
    if (f.adRows !== 0) return false;
    return noAdRan(await readAdSync(run, orgId, f.last));
  },
  "no-real-lead": async (args, ctx = {}) => {
    if (!args || args.check !== CHECK_IDS[2]) return false;
    const run = bind(ctx);
    if (!run) return false;
    const out = await run((tx) => tx.query(CONTACTS_SQL, contactParams(orgOf(args, ctx), nowOf(ctx))));
    return Array.isArray(out && out.rows) && out.rows.length === 0;
  }
});

/**
 * Read-only lead flow checks.
 * ctx: { db, scope, now, orgId }. Rows are { id, status, detail, suggestedFix }.
 */
export async function gapChecks(ctx = {}) {
  return runLeadChecks({ run: bind(ctx), now: ctx.now, orgId: ctx.orgId || null });
}
