// /api/marketing/scripts/approve — Chris approves a script: it is locked and
// gets its ad number, once.
//
// Route key "marketing/scripts/approve" (netlify/functions/api.mjs ROUTES; the
// key is this file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md
// §7.8, §7.4, §4 traps 17 and 21; shape docs/specs/marketing-machine-api.md §6.2.
//
//   POST {request_id, id, version}
//     → 200 {script:S, ad_number, registry:'queued'|'skipped', registry_note}
//     ad_number   next_ad_number() in the same transaction (91 or higher), once.
//                 A script that already has a number keeps it; a second approve
//                 answers the same number and queues nothing new.
//     registry    'queued' when the lane has a rule in registry.json (an outbox
//                 edit registry_add_ad is waiting; it goes live at the next ship),
//                 'skipped' with a plain registry_note when it has none (lane slo
//                 has none by design). It never blocks the approve.
//     The script's repo file is queued too (outbox, mode 'replace').
//   400 {error:'invalid', field:'id'|'version'|'request_id', message}
//       (id is also refused when the script is rejected or expired)
//   404 {error:'not_found', message}
//   409 {error:'stale', message, current:{version, body, parts}}
//   A repeated request_id answers the first save again and writes nothing.
//
// Only a person approves (spec §4 trap 17): locked_by = the caller's staff id.
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12). One asStaff() transaction
// (withRequest); the worker is woken after it commits.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany
} from "../../../src/marketing/http.mjs";
import { parseScriptRef, approveScript } from "../../../src/marketing/scripts-store.mjs";
import { wakeWorker } from "../../../src/marketing/wake.mjs";

export const ROUTE = "marketing/scripts/approve";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to approve a script." });
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

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, (tx) =>
      approveScript(tx, { orgId, id, version, staffId: staff.id ?? null, requestId })
    );
    // After the commit: the outbox rows are saved, so the worker can commit them.
    await (deps.wake ?? wakeWorker)(deps.env ?? process.env);
    return res.status(200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Approving scripts")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
