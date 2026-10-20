// requireAuth — verifies a session and attaches the staff member to the request.
//
// Framework-agnostic in the same spirit as src/http/router.mjs: the pieces that
// do the work take plain values and return plain results, and only the thin
// requireAuth() wrapper touches a res object. That keeps it testable without a
// fake HTTP layer and usable from any handler shape.
//
// Attaches req.staff = { id, role, org_id, email, name, status, avatarUrl } and
// req.session = { id, expiresAt }.
//
// 401 is clean: { ok: false, error: "unauthorized" }. No detail about WHY —
// expired, revoked, suspended and never-existed are indistinguishable to the
// caller, because the difference is only useful to someone probing.

import { db as defaultDb } from "../../db.mjs";
import { verifySession } from "../../auth/session.mjs";
import { restrictedStaffAllowed } from "../restricted-staff.mjs";

// bearerToken — pulls the session token out of a request. Authorization:
// Bearer is the primary form; the x-session-token header and a fundhub_session
// cookie are accepted so a browser dashboard does not have to hold the token in
// JavaScript. Query strings are deliberately NOT accepted: they land in access
// logs, and this token is a live credential.
export function bearerToken(req) {
  const h = req?.headers || {};
  // Node lowercases incoming header names, but a serverless adapter or a test
  // may hand over the raw casing, so match without assuming either.
  const get = (n) => {
    if (h[n] !== undefined) return h[n];
    const want = String(n).toLowerCase();
    for (const k of Object.keys(h)) if (k.toLowerCase() === want) return h[k];
    return undefined;
  };

  const auth = get("authorization");
  if (typeof auth === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }

  const direct = get("x-session-token");
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const cookie = get("cookie");
  if (typeof cookie === "string") {
    for (const part of cookie.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === "fundhub_session") {
        const raw = part.slice(eq + 1).trim();
        // decodeURIComponent throws URIError on a malformed escape ("%zz").
        // That threw out of authenticate() — which is called BEFORE its own
        // try — and 500'd every authenticated route including logout, so a
        // browser holding one bad cookie could not clear it from inside the
        // app. A malformed cookie is simply not a valid token.
        try { return decodeURIComponent(raw); } catch { return raw; }
      }
    }
  }
  return null;
}

/* AUTH_UNAVAILABLE — "I could not check", which is NOT "you are not signed in".

   authenticate() used to swallow a database failure and return null, so every
   session-gated route answered 401 during an outage. That is actively
   misleading: the user is told their credentials are bad, the frontend treats it
   as signed-out, and the person retries a login that cannot succeed for a reason
   nothing on screen mentions. The original justification — leaving room for the
   dashboard shared-secret fallback — no longer holds, because that fallback now
   fails closed.

   Routes distinguish the two: a real 401 stays 401, an outage becomes 503 with
   db:"down", which public/app/data.js already classifies as "nodb" and renders
   as a backend-unavailable banner rather than "not signed in". */
export const AUTH_UNAVAILABLE = Symbol("auth_unavailable");

export async function authenticate(req, { db = defaultDb, env = process.env } = {}) {
  const token = bearerToken(req);
  if (!token) return null;
  try {
    const result = await verifySession(db, token, { env });
    if (result?.staff && !restrictedStaffAllowed(req, result.staff)) {
      req.authForbidden = true;
      return null;
    }
    return result;
  } catch (err) {
    // A bad token is not an error — verifySession returns null for that. Getting
    // here means the CHECK itself failed, which is our problem, not the caller's.
    return AUTH_UNAVAILABLE;
  }
}

// attachStaff — authenticate and, on success, hang the result off the request.
// Returns the staff object or null. Use when a route wants auth to be optional.
export async function attachStaff(req, opts = {}) {
  const result = await authenticate(req, opts);
  // Callers that only want "is there a staff member" treat an outage as "no",
  // but the flag is left on the request so requireAuth can tell them apart.
  if (result === AUTH_UNAVAILABLE) { req.authUnavailable = true; return null; }
  if (!result) return null;
  req.staff = result.staff;
  req.session = result.session;
  return result.staff;
}

// requireAuth — the gate. Returns the staff object, or writes a 401 and returns
// null. Call it as:
//
//   const staff = await requireAuth(req, res);
//   if (!staff) return;
//
export async function requireAuth(req, res, opts = {}) {
  const staff = await attachStaff(req, opts);
  if (!staff) {
    if (req.authForbidden) {
      res.status(403).json({ ok: false, error: "forbidden" });
      return null;
    }
    if (req.authUnavailable) {
      // Ours, not theirs. 503 + db:"down" is the shape data.js reads as an
      // outage, so the screens say "backend unavailable" instead of logging
      // everyone out.
      res.status(503).json({ ok: false, error: "auth_unavailable", db: "down" });
      return null;
    }
    res.status(401).json({ ok: false, error: "unauthorized" });
    return null;
  }
  return staff;
}

export default requireAuth;
