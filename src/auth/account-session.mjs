// Sessions for principals who are not employees.
//
// Mirrors src/auth/session.mjs exactly: same token generator, same
// sha256-of-token storage (the raw token is never persisted), same sliding
// expiry done in ONE statement so two concurrent requests cannot race a session
// past its expiry. It reuses those primitives rather than reimplementing them —
// a second, subtly different auth path is how one of them ends up weaker.

import { newToken, hashToken, normalizeIp, ttlMs } from "./session.mjs";
import { hashPassword, verifyPassword, validatePassword } from "./hash.mjs";
import { resolveDefaultOrg } from "./org.mjs";
import { demoLoginRefusal } from "./demo-logins.mjs";
import { actingClientId } from "./authorized-rep.mjs";

const truncate = (s, n) => (s == null ? null : String(s).slice(0, n));

export const PRINCIPAL_KINDS = new Set(["client", "affiliate", "partner"]);

/* createAccountSession — mint a session for an account. */
export async function createAccountSession(db, {
  accountId, orgId, ip, userAgent, env = process.env
} = {}) {
  if (!accountId) throw new Error("accountId required");
  const org = orgId || (await resolveDefaultOrg(db));
  const token = newToken();
  const expiresAt = new Date(Date.now() + ttlMs(env));
  const r = await db.query(
    `INSERT INTO account_sessions (org_id, account_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, expires_at`,
    [org, accountId, hashToken(token), expiresAt, normalizeIp(ip), truncate(userAgent, 512)]
  );
  return { token, sessionId: r.rows[0].id, expiresAt: r.rows[0].expires_at };
}

/* verifyAccountSession — token → { principal, session } or null.

   The returned principal carries its SUBJECT ID (clientId / affiliateId /
   partnerId), because that is what every downstream scope check needs.
   src/partners/scope.mjs refuses to build a query for a partner principal with
   no partnerId, so a session that cannot supply one is useless by design. */
export async function verifyAccountSession(db, token, { env = process.env } = {}) {
  if (!token) return null;
  const r = await db.query(
    `UPDATE account_sessions s
        SET last_seen_at = now(), expires_at = $2
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND EXISTS (
          SELECT 1 FROM accounts a
           WHERE a.id = s.account_id AND a.status = 'active'
        )
      RETURNING s.id, s.account_id, s.org_id, s.expires_at, s.active_client_id`,
    [hashToken(token), new Date(Date.now() + ttlMs(env))]
  );
  if (!r.rows[0]) return null;

  const a = await db.query(
    `SELECT id, org_id, kind, email, name, status, client_id, affiliate_id, partner_id
       FROM accounts WHERE id = $1`, [r.rows[0].account_id]);
  const row = a.rows[0];
  if (!row) return null;

  const session = { id: r.rows[0].id, expiresAt: r.rows[0].expires_at };
  if (row.kind === "authorized_rep") {
    const clientId = await actingClientId(db, {
      accountId: row.id,
      orgId: row.org_id,
      sessionId: session.id,
      activeClientId: r.rows[0].active_client_id
    });
    return {
      principal: {
        kind: "client",
        authorizedRep: true,
        accountKind: "authorized_rep",
        accountId: row.id,
        orgId: row.org_id,
        email: row.email,
        name: row.name,
        clientId,
        affiliateId: null,
        partnerId: null
      },
      session
    };
  }

  return {
    principal: {
      kind: row.kind,
      accountId: row.id,
      orgId: row.org_id,
      email: row.email,
      name: row.name,
      clientId: row.client_id,
      affiliateId: row.affiliate_id,
      partnerId: row.partner_id
    },
    session
  };
}

export async function revokeAccountSession(db, token) {
  if (!token) return false;
  const r = await db.query(
    `UPDATE account_sessions SET revoked_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id`,
    [hashToken(token)]
  );
  return r.rows.length > 0;
}

export async function revokeAllForAccount(db, accountId) {
  if (!accountId) return 0;
  const r = await db.query(
    `UPDATE account_sessions SET revoked_at = now()
      WHERE account_id = $1 AND revoked_at IS NULL RETURNING id`,
    [accountId]
  );
  return r.rows.length;
}

/* selfSignupAllowed — asks the policy TABLE, not a branch. 'partner' is
   invite-only, and this is the read that enforces it in code as well as in the
   044 trigger. */
export async function selfSignupAllowed(db, kind) {
  const r = await db.query(
    `SELECT self_signup FROM account_signup_policy WHERE kind = $1`, [kind]);
  return r.rows[0] ? r.rows[0].self_signup === true : false;
}

/* createAccount — the one writer.

   `invitedBy` is required for any kind whose policy says invite-only. The 044
   trigger enforces the same thing, so bypassing this function does not get you a
   self-registered partner either. */
export async function createAccount(db, {
  orgId, kind, email, name = null, password = null,
  clientId = null, affiliateId = null, partnerId = null,
  invitedBy = null, now = new Date()
} = {}) {
  const k = String(kind || "").trim().toLowerCase();
  if (!PRINCIPAL_KINDS.has(k)) {
    throw new Error(`createAccount: kind must be one of ${[...PRINCIPAL_KINDS].join(", ")}`);
  }
  const mail = String(email || "").trim().toLowerCase();
  if (!mail) throw new Error("createAccount: email is required");

  if (!(await selfSignupAllowed(db, k)) && !invitedBy) {
    throw new Error(`createAccount: ${k} is invite-only — invitedBy is required`);
  }

  let hash = null;
  if (password != null) {
    const bad = validatePassword(password);
    if (bad) throw new Error(`createAccount: ${bad}`);
    hash = await hashPassword(password);
  }

  const org = orgId || (await resolveDefaultOrg(db));
  const r = await db.query(
    `INSERT INTO accounts
       (org_id, kind, email, name, password_hash, status,
        client_id, affiliate_id, partner_id, invited_by, invited_at, activated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, kind, email, status`,
    [org, k, mail, name, hash, hash ? "active" : "invited",
     clientId, affiliateId, partnerId, invitedBy,
     invitedBy ? now : null, hash ? now : null]
  );
  return r.rows[0];
}

/* A booked client already has a client row, but may not have a portal login.
   Create the account now in the existing invited state; accepting the emailed
   sign-in link activates it through verifyMagicLink. A replay or two booking
   events must not create a second account or take over another person's email. */
export async function ensurePendingClientAccount(db, { orgId, clientId } = {}) {
  if (!orgId || !clientId) return { ok: false, reason: "client_required" };
  const found = await db.query(
    `SELECT id, email, first_name, last_name FROM clients
      WHERE id = $1 AND org_id = $2 LIMIT 1`, [clientId, orgId]
  );
  const client = found.rows[0];
  const email = String(client?.email || "").trim().toLowerCase();
  if (!email) return { ok: false, reason: "no_email" };

  const existing = await db.query(
    `SELECT id, kind, client_id, status FROM accounts
      WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`, [orgId, email]
  );
  const account = existing.rows[0];
  if (account) {
    return account.kind === "client" && account.client_id === clientId && account.status !== "suspended"
      ? { ok: true, accountId: account.id, created: false }
      : { ok: false, reason: "email_belongs_to_another_account" };
  }

  try {
    const created = await createAccount(db, {
      orgId, kind: "client", clientId, email,
      name: [client.first_name, client.last_name].filter(Boolean).join(" ") || null
    });
    return { ok: true, accountId: created.id, created: true };
  } catch (error) {
    if (error?.code !== "23505") throw error;
    const raced = await db.query(
      `SELECT id, kind, client_id, status FROM accounts
        WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`, [orgId, email]
    );
    const row = raced.rows[0];
    return row?.kind === "client" && row.client_id === clientId && row.status !== "suspended"
      ? { ok: true, accountId: row.id, created: false }
      : { ok: false, reason: "email_belongs_to_another_account" };
  }
}

/* loginAccount — email + password → session, or a refusal.

   Deliberately returns the SAME error for an unknown email and a wrong password.
   Distinguishing them turns the login form into a membership oracle. */
export async function loginAccount(db, { email, password, ip, userAgent, env = process.env } = {}) {
  const mail = String(email || "").trim().toLowerCase();
  if (!mail || !password) return { ok: false, status: 400, error: "email_and_password_required" };

  const org = await resolveDefaultOrg(db);
  // is_demo through to_jsonb, matching the staff query in src/auth/login.mjs:
  // the column arrives with db/migrations/094_demo_logins.sql and this lookup
  // must keep working against a database that has not applied it yet.
  const r = await db.query(
    `SELECT a.id, a.kind, a.email, a.name, a.status, a.password_hash,
            a.client_id, a.affiliate_id, a.partner_id,
            (to_jsonb(a) ->> 'is_demo') AS is_demo_flag
       FROM accounts a WHERE a.org_id = $1 AND lower(a.email) = $2 LIMIT 1`,
    [org, mail]
  );
  const acct = r.rows[0];

  // Decoy work on a miss, so a missing account is not measurably faster than a
  // wrong password. Same discipline as src/auth/login.mjs.
  if (!acct || !acct.password_hash) {
    await verifyPassword(password, "$scrypt$N=32768,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    return { ok: false, status: 401, error: "invalid_credentials" };
  }
  if (acct.status !== "active") {
    await verifyPassword(password, acct.password_hash);
    return { ok: false, status: 403, error: "account_not_active" };
  }
  if (!(await verifyPassword(password, acct.password_hash))) {
    return { ok: false, status: 401, error: "invalid_credentials" };
  }

  // Same gate, same placement, same reasoning as src/auth/login.mjs: AFTER the
  // password has verified, so this can only ever refuse a login and never grant
  // one. A demo principal on a deploy with DEMO_LOGINS_ENABLED unset gets 403
  // and no session row is minted.
  const demoRefusal = demoLoginRefusal(
    { email: acct.email, is_demo: acct.is_demo_flag }, env);
  if (demoRefusal) return demoRefusal;

  const s = await createAccountSession(db, { accountId: acct.id, orgId: org, ip, userAgent, env });
  await db.query(`UPDATE accounts SET last_login_at = now() WHERE id = $1`, [acct.id]);
  const verified = await verifyAccountSession(db, s.token, { env });
  if (!verified) return { ok: false, status: 401, error: "invalid_credentials" };

  return {
    ok: true,
    token: s.token,
    expiresAt: s.expiresAt,
    principal: verified.principal
  };
}
