// /api/marketing/shoot/take — Save the video on the teleprompter.
//
// The phone posts the original file here. This route puts those same bytes
// in the SLO Ads Drive folder (13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ). No ffmpeg.
// No re-encode. The picture is whatever the phone already recorded.
//
//   POST {name, bytes, content_type}  → 200 {ok, token, chunk_bytes, name}
//   PUT  raw bytes
//        header x-take-token, content-range: bytes start-end/total
//        → 200 {ok, done, received, name}
//   GET → 405. A ping never uploads.
//
// A signed-in save is owner and admin only: requireAuth, then
// requireRole(ROLE_SETS.MARKETING) (requireAuth ignores roles, CLAUDE.md §12).
// A film key (header x-shoot-film) uploads with no staff session. No token
// and no key uploads the same way the teleprompter shoot read works: no
// sign-in wall. The key cannot open the rest of the app.

import { db } from "../../../src/db.mjs";
import { bearerToken, requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import { hasCompany } from "../../../src/marketing/http.mjs";
import { FILM_LINK_CLOSED, filmFromReq, secretFromEnv } from "../../../src/marketing/shoot-film-key.mjs";
import { beginTake, continueTake } from "../../../src/marketing/take-upload.mjs";

export const ROUTE = "marketing/shoot/take";

export default async function handler(req, res, deps = {}) {
  if (req.method !== "POST" && req.method !== "PUT") {
    res.setHeader("Allow", "POST, PUT");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to start a save, or PUT to send the video." });
  }

  // The gate, in this file on purpose: scripts/journeys/extract.mjs reads each
  // route's gate from the route's own source. A signed-in save still goes
  // through requireAuth, then requireRole(res, staff, ROLE_SETS.MARKETING),
  // then hasCompany(res, staff). A film key uploads with no staff session.
  // No token and no key is the open teleprompter, same as the shoot read.
  const auth = deps.requireAuth ?? requireAuth;
  const film = filmFromReq(req, deps);
  if (film?.bad) {
    return res.status(404).json({ error: "not_found", message: FILM_LINK_CLOSED });
  }
  const openTake = !bearerToken(req) && !film;
  if (!film && !openTake) {
    const database = deps.db ?? db;
    const staff = await auth(req, res, { db: database });
    if (!staff) return;
    if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
    if (!hasCompany(res, staff)) return;
  }

  let filmSecret = deps.filmSecret;
  if (!filmSecret) {
    try { filmSecret = secretFromEnv(deps.env); }
    catch {
      return res.status(500).json({ ok: false, error: "not_ready", message: "Saving a video is not set up on this site yet." });
    }
  }
  const drive = { ...deps, filmSecret };

  if (req.method === "POST") {
    const body = req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? req.body : {};
    const out = await beginTake(body, drive);
    return res.status(out.status).json(out.body);
  }

  const out = await continueTake({
    token: header(req, "x-take-token"),
    range: header(req, "content-range"),
    bytes: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  }, drive);
  return res.status(out.status).json(out.body);
}

function header(req, name) {
  const h = req?.headers || {};
  if (h[name] != null) return Array.isArray(h[name]) ? h[name][0] : h[name];
  const want = name.toLowerCase();
  for (const key of Object.keys(h)) {
    if (key.toLowerCase() === want) return Array.isArray(h[key]) ? h[key][0] : h[key];
  }
  return "";
}
