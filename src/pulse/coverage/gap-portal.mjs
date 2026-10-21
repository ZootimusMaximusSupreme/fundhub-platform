// Client portal after they are a client. Report only. Never auto-fix. Never text.
// Slice 26 already lists which doors sit in the pulse registry. This file does
// not repeat that list. It looks for four breaks on the live path:
//   portal page 404, portal summary 500, a paid client with no entitlement,
//   a journey step that should unlock and did not.
// Read-only SQL, plus a signed-out GET of the portal shell.
// Do not log in as a real client. One tripwire: existing Recon (AG-07).
// Do not invent a second watchdog.
//
// What this file does NOT do, on purpose:
//   - It does not ping GET /api/read/portal-summary. reg:read/portal-summary in
//     the registry already does, and a signed-out 401 never reaches the SQL.
//   - It does not read Recon. The daily pulse already has a `recon` check.
//
// Tier 1 tripwires (Claude, 2026-10-09), three more rows a customer would feel:
//   portal:page-scripts-load          the six customer pages and every script and
//                                     style file each one names, read live
//   portal:progress-read-real-client the real client-progress read, run for the
//                                     newest paying client, with every swallowed
//                                     read failure counted
//   portal:paid-client-never-signed-in a paying client holds access for 72 hours
//                                     and has never signed in
// All three are read only: GET for the web, SELECT for the database. The progress
// read goes through a guard that refuses anything that is not a plain read.
//
// THE SQL, THE PAGE READS AND THE VERDICTS LIVE IN src/pulse/beats/lib/portal-truth.mjs
// (2026-10-20), so the hourly beat client-portal runs the same checks as this lane:
// portal:page-scripts-load, portal:paid-entitlement, portal:next-step, portal:summary
// and portal:paid-client-never-signed-in. The real progress read check
// (portal:progress-read-real-client) lives in src/pulse/beats/lib/progress-check.mjs
// with the read it runs, so the hourly beat client-progress runs it too (2026-10-20).
// This file keeps the audit's re-check (naVerify) and the run's own fetch and org.

import {
  DEFAULT_BASE_URL,
  NEVER_SIGNED_IN_SQL,
  NEVER_SIGNED_IN_ID,
  check,
  clip,
  readNeverSignedIn,
  waitingOf,
  heldOnly,
  checkPortalPage as portalPageTruth,
  checkPageScripts as pageScriptsTruth,
  checkPortalSummary,
  checkPaidEntitlement,
  checkNextStep,
  checkPaidNeverSignedIn
} from "../beats/lib/portal-truth.mjs";

export * from "../beats/lib/portal-truth.mjs";

// THE PROGRESS CHECK LIVES IN src/pulse/beats/lib/progress-check.mjs (2026-10-20): the client pick, the row
// counts, the plain-read guard and the verdict, with the real progress read it runs (lib/progress-read.mjs).
// The hourly beat client-progress runs the same check. Imported back and re-exported here.
import {
  PROGRESS_CLIENT_SQL, PROGRESS_ROWS_SQL, checkProgressRead as progressReadTruth
} from "../beats/lib/progress-check.mjs";

export {
  PROGRESS_CLIENT_SQL, PROGRESS_ROWS_SQL, PROGRESS_TIMEOUT_MS, isPlainRead
} from "../beats/lib/progress-check.mjs";

/** The progress check, with the env this server process runs with (the referral link reads it, as the
    page always did). */
export function checkProgressRead(args = {}) {
  return progressReadTruth({ env: process.env, ...args });
}

/** The portal shell check, with this run's fetch as the web it reads. */
export function checkPortalPage({ fetchImpl, ...rest } = {}) {
  return portalPageTruth({ web: fetchImpl, ...rest });
}

/** The customer pages and their files, with this run's fetch as the web it reads. */
export function checkPageScripts({ fetchImpl, ...rest } = {}) {
  return pageScriptsTruth({ web: fetchImpl, ...rest });
}

async function defaultOrgId(db) {
  const { rows } = await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`);
  return rows[0]?.id || null;
}

export const READ_ONLY_SQL_TIER_1 = Object.freeze([
  NEVER_SIGNED_IN_SQL,
  PROGRESS_CLIENT_SQL,
  PROGRESS_ROWS_SQL
]);

/* The audit asks the lane again (src/pulse/self-audit.mjs, makeLaneNaVerify). True only when
   the same read still finds waiting clients and every one is a client the row named and the
   owner holds. A failed read, a new waiting client, or nobody waiting at all is false. */
export const naVerify = Object.freeze({
  "owner-hold-client": async (args, ctx = {}) => {
    if (!args || args.check !== NEVER_SIGNED_IN_ID || typeof args.orgId !== "string" || !args.orgId) return false;
    const named = Array.isArray(args.clients) ? [...args.clients].sort() : [];
    const run = readerFor(ctx);
    if (!run) return false;
    const held = heldOnly(waitingOf(await readNeverSignedIn(run, args.orgId)));
    return !!held && held.length === named.length && held.every((code, i) => code === named[i]);
  }
});

/** Reads go through the staff scope when the run has one, and the shared pool
    when it does not. Every statement is a plain read. */
function readerFor(ctx) {
  if (ctx && typeof ctx.scope === "function") return (fn) => ctx.scope(fn);
  if (ctx && ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

/** One answer per address for the run, so the portal page is not fetched twice. */
function sharedFetch(fetchImpl) {
  if (typeof fetchImpl !== "function") return fetchImpl;
  const seen = new Map();
  return (url, init) => {
    const key = `${String((init && init.method) || "GET").toUpperCase()} ${url}`;
    if (!seen.has(key)) {
      seen.set(key, (async () => {
        const res = await fetchImpl(url, init);
        const text = typeof res.text === "function" ? await res.text() : "";
        return { status: res.status, headers: res.headers, text };
      })());
    }
    return seen.get(key).then((r) => ({
      status: r.status,
      headers: r.headers,
      async text() { return r.text; }
    }));
  };
}

export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const rawFetch = ctx.fetchImpl || ctx.fetch || globalThis.fetch;
  const fetchImpl = sharedFetch(rawFetch);
  const baseUrl = ctx.baseUrl || DEFAULT_BASE_URL;
  let orgId = ctx.orgId || null;
  let orgError = null;
  if (!orgId && db) {
    try {
      orgId = await defaultOrgId(db);
    } catch (err) {
      orgError = err;
      orgId = null;
    }
  }
  const run = readerFor(ctx);
  if (orgError) {
    const detail = `could not read the default org: ${clip(orgError)}`;
    const [page, scripts] = await Promise.all([
      checkPortalPage({ fetchImpl, baseUrl }),
      checkPageScripts({ fetchImpl, baseUrl })
    ]);
    return [
      page,
      check("portal:summary", "FAIL", detail, "Read the default org. Do not auto-fix from this pulse."),
      check("portal:paid-entitlement", "FAIL", detail, "Read the default org. Do not auto-fix from this pulse."),
      check("portal:next-step", "FAIL", detail, "Read the default org. Do not auto-fix from this pulse."),
      scripts,
      check("portal:progress-read-real-client", "skip", detail),
      check("portal:paid-client-never-signed-in", "skip", detail)
    ];
  }
  // Every check starts at once, so the lane stays well inside one step's clock.
  return Promise.all([
    checkPortalPage({ fetchImpl, baseUrl }),
    checkPortalSummary({ db, orgId }),
    checkPaidEntitlement({ db, orgId }),
    checkNextStep({ db, orgId }),
    checkPageScripts({ fetchImpl, baseUrl }),
    checkProgressRead({ run, orgId }),
    checkPaidNeverSignedIn({ run, orgId })
  ]);
}
