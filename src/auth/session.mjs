// Sessions — create, verify, revoke, expire.
//
// The token is 32 random bytes from the CSPRNG, base64url-encoded. It is never
// sequential, never derived from the staff id, and never stored: the sessions
// table holds sha256(token) only, so a leaked database yields no live sessions.
// The cleartext token exists in exactly one place — the return value of
// createSession() — and it is the caller's job not to log it.
//
// Expiry is sliding: every successful verify pushes expires_at to now + TTL.
// Default TTL 7 days (SESSION_TTL_DAYS overrides).

import crypto from "node:crypto";
import { isIP } from "node:net";
import { resolveDefaultOrg } from "./org.mjs";

export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;

export function ttlMs(env = process.env) {
  const days = Number(env.SESSION_TTL_DAYS);
  return Number.isFinite(days) && days > 0 ? days * 24 * 60 * 60 * 1000 : DEFAULT_TTL_MS;
}

// newToken — 32 CSPRNG bytes → 43-char base64url string.
export function newToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

// hashToken — sha256 hex. Fast on purpose: a 256-bit random token has no
// guessable structure, so there is nothing for a slow KDF to protect here.
export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

// normalizeIp — sessions.ip and auth_attempts.ip are inet, which rejects
// malformed input. Takes the first hop of an x-forwarded-for style value and
// returns null rather than letting a bad proxy header break a login.
export function normalizeIp(ip) {
  if (!ip) return null;
  const first = String(ip).split(",")[0].trim();
  if (!first) return null;
  // Unwrap [::1]:1234 / strip an IPv4 :port, then validate.
  const unbracketed = first.startsWith("[") ? first.slice(1, first.indexOf("]")) : first;
  const candidate = /^\d+\.\d+\.\d+\.\d+:\d+$/.test(unbracketed)
    ? unbracketed.split(":")[0]
    : unbracketed;
  return isIP(candidate) ? candidate : null;
}

// createSession — mints a session and returns the ONLY copy of the cleartext
// token. { token, sessionId, expiresAt }.
export async function createSession(db, { staffId, orgId, ip, userAgent,
  mfaVerified = false, env = process.env } = {}) {
  if (!staffId) throw new Error("staffId required");
  const org = orgId || (await resolveDefaultOrg(db));
  const token = newToken();
  const expiresAt = new Date(Date.now() + ttlMs(env));
  const params = [org, staffId, hashToken(token), expiresAt,
    normalizeIp(ip), truncate(userAgent, 512)];
  let r;
  try {
    r = await db.query(
      `INSERT INTO sessions (org_id, staff_id, token_hash, expires_at, ip, user_agent, mfa_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $7::boolean THEN now() ELSE NULL END)
       RETURNING id, expires_at`, [...params, !!mfaVerified]);
  } catch (error) {
    // A deploy may briefly reach a database before migration 543. Ordinary
    // native sessions keep working; an MFA session must never lose its stamp.
    if (mfaVerified || error?.code !== "42703" ||
        !/mfa_verified_at/i.test(error.message || "")) throw error;
    r = await db.query(
      `INSERT INTO sessions (org_id, staff_id, token_hash, expires_at, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, expires_at`, params);
  }
  return { token, sessionId: r.rows[0].id, expiresAt: r.rows[0].expires_at };
}

// verifySession — token → { staff, session } or null.
//
// One statement does the lookup, the liveness check and the slide together, so
// two concurrent requests cannot race a session past its expiry. The WHERE
// clause is the authority: expired or revoked rows simply do not update.
//
// staff.status must be 'active'. If 012_attribution.sql has landed it also adds
// staff.active — read through to_jsonb so this works with or without that
// column, and treat an explicit false as a lockout.
export async function verifySession(db, token, { env = process.env } = {}) {
  if (!token || typeof token !== "string") return null;
  const ms = ttlMs(env);
  const assignedRoles = `COALESCE((
              SELECT array_agg(DISTINCT lower(btrim(sr.key)) ORDER BY lower(btrim(sr.key)))
                FROM staff_role_assignments a
                JOIN staff_roles sr ON sr.id = a.role_id AND sr.org_id = a.org_id
               WHERE a.staff_id = s.id AND a.org_id = s.org_id AND sr.active
                 AND lower(btrim(sr.key)) NOT IN ('owner', 'admin')
            ), ARRAY[]::text[])`;
  const sessionSql = (withAssignments) => `WITH live AS (
       UPDATE sessions
          SET expires_at   = now() + ($2::bigint * interval '1 millisecond'),
              last_seen_at = now()
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > now()
        RETURNING id, staff_id, org_id, expires_at,
                  to_jsonb(sessions)->>'mfa_verified_at' AS mfa_verified_at
     )
     SELECT live.id AS session_id, live.expires_at, live.mfa_verified_at,
            s.id AS staff_id, s.org_id, s.role, s.email, s.name, s.status, s.avatar_key,
            ${withAssignments ? assignedRoles : "ARRAY[]::text[]"} AS assigned_roles,
            (to_jsonb(s) ->> 'active') AS active_flag
       FROM live JOIN staff s ON s.id = live.staff_id AND s.org_id = live.org_id`;
  const params = [hashToken(token), String(ms)];
  let r;
  try {
    r = await db.query(sessionSql(true), params);
  } catch (err) {
    // Ship can run before this additive migration. Only this missing table may
    // fall back: all other auth/database failures stay unavailable, never 401.
    if (err?.code !== "42P01" || !/\bstaff_role_assignments\b/i.test(
      `${err.table || ""} ${err.message || ""}`)) throw err;
    r = await db.query(sessionSql(false), params);
  }
  if (!r.rows.length) return null;
  const row = r.rows[0];

  // A staff member suspended mid-session loses it on the next request rather
  // than at the next expiry.
  if (row.status !== "active" || row.active_flag === "false") {
    await db.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [row.session_id]);
    return null;
  }

  const role = String(row.role || "").trim().toLowerCase();
  // External and restricted identities never gain employee privileges through
  // a secondary assignment, including after a primary-role change.
  const canStackRoles = role && !["partner", "client", "affiliate", "outbound_rep"].includes(role);
  const roles = [...new Set([
    role,
    ...(canStackRoles && Array.isArray(row.assigned_roles)
      ? row.assigned_roles.filter((assigned) => !["owner", "admin"].includes(String(assigned || "").trim().toLowerCase()))
      : [])
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];

  return {
    staff: {
      id: row.staff_id,
      org_id: row.org_id,
      role: row.role,
      roles,
      email: row.email,
      name: row.name,
      status: row.status,
      avatarUrl: row.avatar_key ? "/api/staff/avatar" : null
    },
    session: { id: row.session_id, expiresAt: row.expires_at,
      mfaVerifiedAt: row.mfa_verified_at ?? null }
  };
}

// revokeSession — by cleartext token. Idempotent: revoking twice is one row,
// already stamped. Returns true if this call was the one that revoked it.
export async function revokeSession(db, token) {
  if (!token || typeof token !== "string") return false;
  const r = await db.query(
    `UPDATE sessions SET revoked_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL
      RETURNING id`,
    [hashToken(token)]
  );
  return r.rows.length > 0;
}

// revokeAllForStaff — "sign out everywhere". Also the correct response to a
// password change or a suspension. Returns the number of live sessions killed.
export async function revokeAllForStaff(db, staffId, { exceptSessionId = null } = {}) {
  if (!staffId) return 0;
  const r = await db.query(
    `UPDATE sessions SET revoked_at = now()
      WHERE staff_id = $1 AND revoked_at IS NULL
        AND ($2::uuid IS NULL OR id <> $2::uuid)
      RETURNING id`,
    [staffId, exceptSessionId]
  );
  return r.rows.length;
}

// expireSessions — housekeeping. Deletes rows that are past expiry or were
// revoked more than `graceDays` ago (the grace window keeps recent revocations
// visible for incident review). Safe to run on a schedule; returns the count.
export async function expireSessions(db, { graceDays = 30 } = {}) {
  const r = await db.query(
    `DELETE FROM sessions
      WHERE expires_at < now() - ($1::int * interval '1 day')
         OR (revoked_at IS NOT NULL AND revoked_at < now() - ($1::int * interval '1 day'))
      RETURNING id`,
    [graceDays]
  );
  return r.rows.length;
}

function truncate(value, max) {
  if (value == null) return null;
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}
