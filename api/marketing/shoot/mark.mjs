// /api/marketing/shoot/mark — one take rolled on Shoot Day: Got it, or
// Another take. Pressed on the teleprompter (or its remote) or on the Shoot tab.
//
// Route key "marketing/shoot/mark" (netlify/functions/api.mjs ROUTES; the key
// is this file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md
// §8.1 (the remote at the end of a script), §8.2; shape
// docs/specs/marketing-machine-api.md §7.1. Unit X5.
//
//   POST {request_id, shoot_id, root_script_id, mark}  → 200 {marks}
//     mark  got_it        the take just rolled is the one to keep
//           another_take  the take just rolled is not; roll it again
//     Both count the take, so the next file name moves to the next take.
//     marks = {<root_script_id>: {takes, got_it, at}}.
//     The first mark moves a planned shoot to filming.
//     Got it marks the shoot only. The script becomes filmed when the video
//     pipeline matches its take (spec §7.4), never here.
//   400 {error:'invalid', field:'mark'|'shoot_id'|'root_script_id'|'request_id', message}
//       (shoot_id is also refused when the shoot is closed)
//   404 {error:'not_found', message}  no such shoot, or the script is not on it
//   A repeated request_id answers the first save again and writes nothing, so
//   a press queued on the phone while offline is never counted twice.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12). One asStaff() transaction
// (withRequest). Free.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany
} from "../../../src/marketing/http.mjs";
import { parseMarkWrite, markShoot } from "../../../src/marketing/shoot-store.mjs";

export const ROUTE = "marketing/shoot/mark";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to mark a take." });
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
    const { shootId, root, mark } = parseMarkWrite(body);
    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, (tx) =>
      markShoot(tx, { orgId, shootId, root, mark, now: deps.now ? deps.now() : new Date() })
    );
    return res.status(200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Marking takes")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
