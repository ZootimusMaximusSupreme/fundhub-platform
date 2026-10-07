// /api/marketing/shoot — Shoot Day: what to film, in what order, how long it
// takes, the exact file name for each take, and where each clip is now.
//
// Route key "marketing/shoot" (netlify/functions/api.mjs ROUTES; the key is
// this file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md
// §8.2; design docs/specs/command-center-design-2026-10-05.md §3.4; shape
// docs/specs/marketing-machine-api.md §7.1. Unit X5. The Shoot tab
// (public/app/cc-tab-shoot.js) and the teleprompter (public/app/teleprompter.html)
// both read this one answer.
//
//   GET ?wpm=  → 200 {shoot|null, plan_candidates:[P], plan_estimated_minutes,
//                     past_shoots[], wpm, as_of}
//       shoot            the open shoot (any status but done), with scripts:[P]
//                        in the shoot's order, board[], landed_unmatched
//       plan_candidates  every approved script (locked, or filmed and needing
//                        a retake) with no Got it mark on the open shoot;
//                        retakes first, then film order
//       P                the Script object S plus angle_name, offer_word,
//                        take_no, take_file_name, take_name_problem,
//                        last_take_file_name, takes, got_it, first_line_only,
//                        teleprompter_text, words, read_seconds
//       wpm              the reading speed the estimates use (80–260, default 150)
//       400 {error:'invalid', field:'wpm', message}
//
//   POST {request_id, shoot_date?, root_script_ids}          → 200 {shoot}  create
//   POST {request_id, id, root_script_ids?, shoot_date?, status?} → 200 {shoot}  change
//       Close the shoot: {request_id, id, status:'done'}.
//       400 invalid root_script_ids | status | shoot_date | id (a shoot is
//           already open on create; the shoot is closed on change)
//       404 not_found when id names no shoot in this company
//   Saving the order also sets each script's film order (one order, two tabs).
//   A repeated request_id answers the first save again and writes nothing.
//
// POST is owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12). A GET with a sign-in still reads
// that company's shoot. A GET with no sign-in reads the default company's shoot
// so the teleprompter can roll on set. A GET reads in one asStaff() transaction
// (staffRead); a POST writes in one (withRequest). Free: no model, no vendor,
// nothing queued for the repo.

import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { bearerToken, requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import {
  staffRead, withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany
} from "../../src/marketing/http.mjs";
import { parseWpm, parseShootWrite, readShootPage, writeShoot } from "../../src/marketing/shoot-store.mjs";

export const ROUTE = "marketing/shoot";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const now = deps.now ? deps.now() : new Date();

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read the shoot or POST to save it." });
  }

  // The gate, in this file on purpose: scripts/journeys/extract.mjs reads each
  // route's gate from the route's own source. POST (and a signed-in GET) still
  // go through requireAuth, then requireRole(res, staff, ROLE_SETS.MARKETING),
  // then hasCompany(res, staff). A GET with no token skips that and reads the
  // default company only.
  const auth = deps.requireAuth ?? requireAuth;
  const openRead = req.method === "GET" && !bearerToken(req);
  let orgId = null;
  if (!openRead) {
    const staff = await auth(req, res, { db: database });
    if (!staff) return;
    if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
    if (!hasCompany(res, staff)) return;
    orgId = staff.org_id;
  }

  try {
    if (req.method === "GET") {
      const wpm = parseWpm(req.query || {});
      if (openRead) {
        orgId = await defaultOrgId(database);
        if (!orgId) {
          return res.status(200).json({
            shoot: null,
            plan_candidates: [],
            plan_estimated_minutes: 0,
            past_shoots: [],
            wpm,
            as_of: now.toISOString()
          });
        }
      }
      const page = await staffRead(database, (tx) => readShootPage(tx, { orgId, wpm }));
      return res.status(200).json({ ...page, as_of: now.toISOString() });
    }

    const body = readBody(req);
    const requestId = checkRequestId(body.request_id);
    const move = parseShootWrite(body);
    const wpm = parseWpm({ wpm: body.wpm });
    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, (tx) =>
      writeShoot(tx, { orgId, move, wpm })
    );
    return res.status(200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Shoot Day")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}

async function defaultOrgId(database) {
  if (!database || typeof database.query !== "function") return null;
  const org = await database.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`);
  return org.rows[0]?.id || null;
}
