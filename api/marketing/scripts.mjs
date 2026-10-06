// /api/marketing/scripts — the scripts list the Command Center and the
// teleprompter read (the Inbox, Approved, Shoot Day).
//
// Route key "marketing/scripts" (netlify/functions/api.mjs ROUTES; the key is
// this file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md
// §7.8; shape docs/specs/marketing-machine-api.md §6.2 (fixed shape 3).
//
//   GET ?status=&batch=  → 200 {scripts:[S], as_of}
//       status  one of draft, locked, rejected, filmed, superseded, expired
//               (superseded = the replaced versions; every other filter and no
//               filter = live versions only)
//       batch   one batch id
//       400 {error:'invalid', field:'status'|'batch', message}
//   Hidden (spec §7.4, §7.7): source 'import' rows, and every script of a
//   batch that is not released yet (released AND release_at <= now).
//   as_of = when this answer was built (no Meta numbers here).
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12). ad_scripts forces partner row
// security, so the read runs inside one asStaff() transaction (staffRead).

import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import { staffRead, sendKnownError, sendNotReady, hasCompany } from "../../src/marketing/http.mjs";
import { parseListQuery, listScripts, scriptView } from "../../src/marketing/scripts-store.mjs";

export const ROUTE = "marketing/scripts";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const now = deps.now ? deps.now() : new Date();

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read scripts." });
  }

  // The gate, in this file on purpose: scripts/journeys/extract.mjs reads each
  // route's gate from the route's own source.
  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;
  const orgId = staff.org_id;

  try {
    const { status, batch } = parseListQuery(req.query || {});
    const rows = await staffRead(database, (tx) => listScripts(tx, { orgId, status, batch }));
    return res.status(200).json({ scripts: rows.map(scriptView), as_of: now.toISOString() });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "The scripts list")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
