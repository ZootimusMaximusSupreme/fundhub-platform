// /api/marketing/scripts/order — the film order for Shoot Day.
//
// Route key "marketing/scripts/order" (netlify/functions/api.mjs ROUTES; the
// key is this file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md
// §7.8, §8.2; shape docs/specs/marketing-machine-api.md §6.2.
//
//   POST {request_id, order:[root_script_id, ...]}  → 200 {ok:true}
//     film_order follows the list, first = 1, on the live version of each
//     script. Scripts not in the list keep their order. No version: the film
//     order is not an edit of the script, and no repo file is written for it
//     (film_order is not in the file's front matter, spec §7.9).
//   400 {error:'invalid', field:'order'|'request_id', message}
//       order is not a list of uuids, names a script twice, or names a script
//       this company's screens cannot see
//   A repeated request_id answers the first save again and writes nothing.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12). One asStaff() transaction
// (withRequest). Nothing is queued for the repo, so the worker is not woken.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany
} from "../../../src/marketing/http.mjs";
import { parseOrder, orderScripts } from "../../../src/marketing/scripts-store.mjs";

export const ROUTE = "marketing/scripts/order";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to set the film order." });
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
    const order = parseOrder(body.order);

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, (tx) =>
      orderScripts(tx, { orgId, order })
    );
    return res.status(200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "The film order")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
