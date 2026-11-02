// Login — email + password → session.
//
// Password comparison is constant-time (hash.verifyPassword → timingSafeEqual),
// and an unknown email still pays the full scrypt cost via verifyDecoy so
// response timing does not enumerate the staff list.
//
// Rate limited by email AND ip, independently, against the auth_attempts table.
// It has to be a table: the dashboard runs as serverless functions, so an
// in-process counter resets on every cold start and enforces nothing.
//
// NOTHING HERE LOGS. Not the password, not the hash, not the session token. The
// return value carries the cleartext token exactly once — hand it to the client
// and drop it.

import { verifyPassword, verifyDecoy, needsRehash, hashPassword } from "./hash.mjs";
import { createSession, normalizeIp, verifySession } from "./session.mjs";
import { resolveDefaultOrg } from "./org.mjs";
import { demoLoginRefusal } from "./demo-logins.mjs";

// Failures are counted only since that identity's last SUCCESSFUL login, so a
// clean login resets the counter for the person who owns the account.
export const LIMITS = {
  windowMinutes: 15,
  maxPerEmail: 5,    // targeted guessing against one staff member
  maxPerIp: 20       // spraying many emails from one source
};

export const normalizeEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : "";

// checkRateLimit — { limited, emailFails, ipFails, retryAfterMinutes }.
// Exported so a login endpoint can surface a Retry-After header.
export async function checkRateLimit(db, { orgId, email, ip, limits = LIMITS } = {}) {
  const r = await db.query(
    `SELECT
       (SELECT count(*) FROM auth_attempts a
         WHERE a.org_id = $1 AND NOT a.successful
           AND lower(a.email) = $2
           AND a.created_at > now() - ($4::int * interval '1 minute')
           AND a.created_at > COALESCE(
                 (SELECT max(created_at) FROM auth_attempts
                   WHERE org_id = $1 AND successful AND lower(email) = $2),
                 '-infinity'::timestamptz)
       )::int AS email_fails,
       (SELECT count(*) FROM auth_attempts a
         WHERE a.org_id = $1 AND NOT a.successful
           AND $3::inet IS NOT NULL AND a.ip = $3::inet
           AND a.created_at > now() - ($4::int * interval '1 minute')
           AND a.created_at > COALESCE(
                 (SELECT max(created_at) FROM auth_attempts
                   WHERE org_id = $1 AND successful AND ip = $3::inet),
                 '-infinity'::timestamptz)
       )::int AS ip_fails`,
    [orgId, normalizeEmail(email), normalizeIp(ip), limits.windowMinutes]
  );
  const emailFails = Number(r.rows[0].email_fails);
  const ipFails = Number(r.rows[0].ip_fails);
  return {
    limited: emailFails >= limits.maxPerEmail || ipFails >= limits.maxPerIp,
    emailFails,
    ipFails,
    retryAfterMinutes: limits.windowMinutes
  };
}

// recordAttempt — identity of the attempt only. Never the password, never a
// hash of it, never a token.
export async function recordAttempt(db, { orgId, email, ip, successful }) {
  await db.query(
    `INSERT INTO auth_attempts (org_id, email, ip, successful) VALUES ($1,$2,$3,$4)`,
    [orgId, normalizeEmail(email) || null, normalizeIp(ip), !!successful]
  );
}

// login — the whole flow.
//   → { ok: true,  token, expiresAt, staff: { id, org_id, role, roles, email, name } }
//   → { ok: false, status, error }
export async function login(db, { email, password, ip, userAgent, orgId, env = process.env } = {}) {
  const org = orgId || (await resolveDefaultOrg(db));
  const normEmail = normalizeEmail(email);

  if (!normEmail || typeof password !== "string" || password.length === 0) {
    return { ok: false, status: 400, error: "email_and_password_required" };
  }

  // Checked before any password work, so a locked-out identity cannot be used
  // to burn CPU. Deliberately NOT recorded as a further attempt: recording here
  // would let an attacker hold a colleague's account locked indefinitely.
  const rate = await checkRateLimit(db, { orgId: org, email: normEmail, ip });
  if (rate.limited) {
    return { ok: false, status: 429, error: "too_many_attempts", retryAfterMinutes: rate.retryAfterMinutes };
  }

  // is_demo is read through to_jsonb for the same reason active_flag is: the
  // column arrives with db/migrations/094_demo_logins.sql, and this query has to
  // keep working against a database that has not applied it yet. A missing
  // column reads as NULL rather than aborting the statement.
  const found = await db.query(
    `SELECT id, org_id, role, email, name, status, password_hash,
            (to_jsonb(s) ->> 'active')  AS active_flag,
            (to_jsonb(s) ->> 'is_demo') AS is_demo_flag
       FROM staff s
      WHERE org_id = $1 AND lower(email) = $2
      LIMIT 1`,
    [org, normEmail]
  );
  const staff = found.rows[0];

  // Unknown email, or a staff row that has no credential yet: burn the same
  // scrypt cost as a real verify before answering.
  if (!staff || !staff.password_hash) {
    await verifyDecoy(password);
    await recordAttempt(db, { orgId: org, email: normEmail, ip, successful: false });
    return { ok: false, status: 401, error: "invalid_credentials" };
  }

  const ok = await verifyPassword(password, staff.password_hash);
  if (!ok) {
    await recordAttempt(db, { orgId: org, email: normEmail, ip, successful: false });
    return { ok: false, status: 401, error: "invalid_credentials" };
  }

  // Correct password on a suspended/invited account. Naming the reason here
  // reveals nothing to anyone who does not already hold the password, and saves
  // a support ticket for the person who does.
  if (staff.status !== "active" || staff.active_flag === "false") {
    await recordAttempt(db, { orgId: org, email: normEmail, ip, successful: false });
    return { ok: false, status: 403, error: `account_${staff.status === "active" ? "inactive" : staff.status}` };
  }

  // A seeded demo row, on a deploy where demo logins are switched off.
  //
  // DELIBERATELY HERE, AFTER verifyPassword — not before it. This is a refusal
  // stacked on top of the real credential check, never a substitute for one, so
  // there is no path through this file where a demo row authenticates without a
  // correct password. It sits next to the status check because it is the same
  // kind of decision: the credential was right, the account may not be used.
  //
  // Costs a real account nothing: demoLoginRefusal returns null immediately for
  // any row that is not flagged is_demo and is not on demo.fundhub.local, so
  // chris@fundhub.ai behaves identically whether the flag is set or not.
  const demoRefusal = demoLoginRefusal(
    { email: staff.email, is_demo: staff.is_demo_flag }, env);
  if (demoRefusal) {
    await recordAttempt(db, { orgId: org, email: normEmail, ip, successful: false });
    return demoRefusal;
  }

  // Transparent upgrade if PARAMS moved since this hash was written.
  if (needsRehash(staff.password_hash)) {
    try {
      const upgraded = await hashPassword(password);
      await db.query(`UPDATE staff SET password_hash = $2 WHERE id = $1`, [staff.id, upgraded]);
    } catch {
      // An upgrade failure must never cost a valid user their login.
    }
  }

  await recordAttempt(db, { orgId: org, email: normEmail, ip, successful: true });
  await db.query(`UPDATE staff SET last_login_at = now() WHERE id = $1`, [staff.id]);

  const session = await createSession(db, {
    staffId: staff.id, orgId: staff.org_id, ip, userAgent, env
  });
  // Resolve the just-minted session through the same server-side role lookup
  // used by every subsequent request, so the first login response is current.
  const verified = await verifySession(db, session.token, { env });
  if (!verified) return { ok: false, status: 403, error: "account_inactive" };

  return {
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    staff: { id: staff.id, org_id: staff.org_id, role: staff.role, roles: verified.staff.roles,
      email: staff.email, name: staff.name }
  };
}
