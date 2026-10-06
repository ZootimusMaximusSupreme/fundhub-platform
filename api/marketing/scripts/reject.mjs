// /api/marketing/scripts/reject — Chris rejects a draft.
//
// Route key "marketing/scripts/reject" (netlify/functions/api.mjs ROUTES; the
// key is this file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md
// §7.8, §7.4 (a draft becomes rejected), §4 trap 17; shape
// docs/specs/marketing-machine-api.md §6.2.
//
//   POST {request_id, id, version, reason?}  → 200 {script:S}
//     Only a draft can be rejected. rejected_at = now, rejected_by = the
//     caller's staff id, rejected_reason = the reason, or
//     "rejected from the app, no reason given" when none is sent.
//     The script's repo file is queued (outbox, mode 'replace').
//   400 {error:'invalid', field:'id'|'version'|'reason'|'request_id', message}
//       (id is also refused when the script is not a draft)
//   404 {error:'not_found', message}
//   409 {error:'stale', message, current:{version, body, parts}}
//   A repeated request_id answers the first save again and writes nothing.
//
// Only a person rejects (spec §4 trap 17). Owner and admin only: requireAuth,
// then requireRole(ROLE_SETS.MARKETING) (requireAuth ignores roles, CLAUDE.md
// §12). One asStaff() transaction (withRequest); the worker is woken after it
// commits.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany
} from "../../../src/marketing/http.mjs";
import { parseScriptRef, parseReason, rejectScript } from "../../../src/marketing/scripts-store.mjs";
import { wakeWorker } from "../../../src/marketing/wake.mjs";

export const ROUTE = "marketing/scripts/reject";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to reject a script." });
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
    const body = readBody(req);
    const requestId = checkRequestId(body.request_id);
    const { id, version } = parseScriptRef(body);
    const reason = parseReason(body.reason);

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, (tx) =>
      rejectScript(tx, { orgId, id, version, reason, staffId: staff.id ?? null, requestId })
    );
    // After the commit: the outbox row is saved, so the worker can commit it.
    await (deps.wake ?? wakeWorker)(deps.env ?? process.env);
    return res.status(200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Rejecting scripts")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
