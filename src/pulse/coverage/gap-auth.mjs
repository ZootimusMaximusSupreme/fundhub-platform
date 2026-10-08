// Login and session gaps for the morning pulse. Report only.
// These are the breaks the door pings do not see. Recon stays the tripwire.
// Read-only SELECTs. No writes. No sends. No texts.

import { isDraftTemplateRow } from "../../messaging/draft-guard.mjs";

export const MAGIC_LINK_TEMPLATE_KEY = "EMAIL-PORTAL-MAGIC-LINK";

/** Failed sign-ins with zero successes, from at least this many addresses. */
export const LOGIN_FAIL_MIN = 5;
/** One person mistyping a password is not "nobody can log in". */
export const LOGIN_FAIL_EMAILS = 2;

/** Not a real token. Proves the session tables can be read. */
export const SESSION_PROBE_HASH = "0".repeat(64);

// Only attempts whose email is a real staff login are counted. The one sign-in
// form tries the staff table first, so every client, affiliate and partner
// sign-in writes a failed staff attempt before it succeeds as an account.
// Counting those would call a normal client day a login storm.
export const STAFF_LOGIN_SQL = `
/* gap:auth-staff-login */
WITH recent AS (
  SELECT a.successful, lower(a.email) AS email
    FROM auth_attempts a
   WHERE a.created_at > now() - interval '24 hours'
     AND a.email IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM staff s
        WHERE lower(s.email) = lower(a.email)
          AND COALESCE(to_jsonb(s) ->> 'is_demo', 'false') IS DISTINCT FROM 'true'
     )
)
SELECT
  (SELECT count(*)::int
     FROM staff s
    WHERE s.status = 'active'
      AND s.password_hash IS NOT NULL
      AND btrim(s.password_hash) <> ''
      AND COALESCE(to_jsonb(s) ->> 'is_demo', 'false') IS DISTINCT FROM 'true'
  ) AS active_with_password,
  (SELECT count(*)::int FROM recent WHERE successful) AS ok_n,
  (SELECT count(*)::int FROM recent WHERE NOT successful) AS bad_n,
  (SELECT count(DISTINCT email)::int FROM recent WHERE NOT successful) AS bad_emails
`.trim();

// sendTemplated() reads the template for the org that asks. Same here, so a
// good row in some other org cannot hide a missing one.
export const MAGIC_TEMPLATE_SQL = `
/* gap:auth-magic-link-template */
SELECT template_key, compliance_passed, body, subject
  FROM message_templates
 WHERE template_key = 'EMAIL-PORTAL-MAGIC-LINK'
   AND ($1::uuid IS NULL OR org_id = $1::uuid)
`.trim();

export const MAGIC_DEAD_SQL = `
/* gap:auth-magic-link-dead */
SELECT count(*)::int AS n
  FROM account_magic_links m
 WHERE m.outcome = 'issued'
   AND m.token_hash IS NOT NULL
   AND m.created_at > now() - interval '24 hours'
   AND m.created_at < now() - interval '2 minutes'
   AND m.expires_at IS NOT NULL
   AND m.expires_at <= m.created_at + interval '20 minutes'
   AND NOT EXISTS (
     SELECT 1
       FROM messages g
      WHERE g.template_key = 'EMAIL-PORTAL-MAGIC-LINK'
        AND g.created_at >= m.created_at - interval '2 minutes'
        AND g.created_at <= m.created_at + interval '10 minutes'
        AND (
          g.provider_ref LIKE ('%magic-link:' || m.id::text)
          OR (m.client_id IS NOT NULL AND g.client_id = m.client_id)
          OR lower(g.to_address) = m.email
        )
   )
`.trim();

// The same columns and joins verifySession() and verifyAccountSession() read
// (src/auth/session.mjs, src/auth/account-session.mjs), minus their UPDATE.
// A column that drifts away makes the real session check 500, and this fails
// the same way. A bare token_hash count would not.
export const SESSION_READ_SQL = `
/* gap:auth-session-read */
SELECT
  (SELECT count(*)::int FROM (
     SELECT x.id AS session_id, x.expires_at, x.last_seen_at, x.revoked_at,
            s.id AS staff_id, s.org_id, s.role, s.email, s.name, s.status, s.avatar_key,
            (to_jsonb(s) ->> 'active') AS active_flag
       FROM sessions x
       JOIN staff s ON s.id = x.staff_id
      WHERE x.token_hash = $1
  ) staff_read) AS staff_hits,
  (SELECT count(*)::int FROM (
     SELECT x.id, x.account_id, x.org_id, x.expires_at, x.last_seen_at, x.revoked_at,
            x.active_client_id,
            a.kind, a.email, a.name, a.status, a.client_id, a.affiliate_id, a.partner_id
       FROM account_sessions x
       JOIN accounts a ON a.id = x.account_id
      WHERE x.token_hash = $1
  ) account_read) AS account_hits
`.trim();

// A sign-in that was said yes to but left no session behind. login() writes the
// "successful" attempt first and createSession() second, so a break in the
// second step is a 500 the person sees and nothing else records. The magic-link
// verify does the same in the other order: it spends the link first, then makes
// the account and the session. A suspended account is a real "no", so it does
// not count.
export const SIGNIN_NO_SESSION_SQL = `
/* gap:auth-signin-no-session */
WITH staff_ok AS (
  SELECT a.created_at, lower(a.email) AS email
    FROM auth_attempts a
   WHERE a.successful
     AND a.created_at > now() - interval '24 hours'
     AND a.created_at < now() - interval '3 minutes'
     AND a.email IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM staff s
        WHERE lower(s.email) = lower(a.email)
          AND COALESCE(to_jsonb(s) ->> 'is_demo', 'false') IS DISTINCT FROM 'true'
     )
), links_used AS (
  SELECT m.email, m.account_id, m.client_id, m.consumed_at
    FROM account_magic_links m
   WHERE m.consumed_at > now() - interval '24 hours'
     AND m.consumed_at < now() - interval '3 minutes'
)
SELECT
  (SELECT count(*)::int FROM staff_ok) AS staff_ok,
  (SELECT count(*)::int
     FROM staff_ok o
    WHERE NOT EXISTS (
      SELECT 1
        FROM sessions x
        JOIN staff s ON s.id = x.staff_id
       WHERE lower(s.email) = o.email
         AND x.created_at >= o.created_at - interval '1 minute'
         AND x.created_at <= o.created_at + interval '2 minutes'
    )
  ) AS staff_no_session,
  (SELECT count(*)::int FROM links_used) AS links_used,
  (SELECT count(*)::int
     FROM links_used l
    WHERE NOT EXISTS (
      SELECT 1
        FROM account_sessions x
        JOIN accounts a ON a.id = x.account_id
       WHERE (a.id = l.account_id
              OR lower(a.email) = l.email
              OR (l.client_id IS NOT NULL AND a.client_id = l.client_id))
         AND x.created_at >= l.consumed_at - interval '1 minute'
         AND x.created_at <= l.consumed_at + interval '2 minutes'
    )
    AND NOT EXISTS (
      SELECT 1
        FROM accounts a
       WHERE (a.id = l.account_id OR lower(a.email) = l.email)
         AND a.status = 'suspended'
    )
  ) AS links_no_session
`.trim();

// Password reset mail does NOT go through the messages queue. api/auth/reset.mjs
// hands it straight to Resend (sendStaffCredentialEmail), so no messages row is
// ever written and a database read cannot see whether one went out. What can be
// read is whether the reset table works, whether this run holds a usable Resend
// key, and (so a masked copy of the key on a laptop is not called a company
// break) whether Resend has sent anything real this week.
export const RESET_READ_SQL = `
/* gap:auth-reset-mail */
SELECT
  (SELECT count(*)::int
     FROM password_resets pr
    WHERE pr.kind = 'reset'
      AND pr.created_at > now() - interval '24 hours'
  ) AS asked,
  (SELECT count(*)::int
     FROM messages g
    WHERE g.channel = 'email'
      AND g.provider = 'resend'
      AND g.status IN ('sent', 'delivered')
      AND g.created_at > now() - interval '7 days'
  ) AS resend_ok_7d
`.trim();

export const READ_ONLY_SQL = [
  STAFF_LOGIN_SQL,
  MAGIC_TEMPLATE_SQL,
  MAGIC_DEAD_SQL,
  SESSION_READ_SQL,
  SIGNIN_NO_SESSION_SQL,
  RESET_READ_SQL
];

/** The two env names src/messaging/providers/resend.mjs refuses to send without. */
export const RESEND_ENV_KEYS = ["RESEND_API_KEY", "RESEND_FROM"];

const SKIP = "no database in this run — this login check was not read";
const SKIP_ENV = "no env in this run — the reset mail setup was not read";

const FIX_LOGIN = "People cannot sign in. Read staff passwords and the sign-in tries. Do not reset a password from this pulse.";
const FIX_MAGIC = "A sign-in link or a portal link had no email queued. Read EMAIL-PORTAL-MAGIC-LINK. Do not send from this pulse.";
const FIX_SESSION = "The session tables could not be read, so a session check would 500 and logout cannot see the row. Do not write from this pulse.";
const FIX_SIGNIN = "A sign-in said yes and no session was made, so the person got an error. Read createSession and the account session insert. Do not write from this pulse.";
const FIX_RESET = "Password reset mail cannot go out. Reset mail goes straight to Resend, not the message queue. Read RESEND_API_KEY and RESEND_FROM on Netlify. Do not send from this pulse.";

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String((err && err.message) || err).replace(/\s+/g, " ").trim().slice(0, 160);
}

// null and "" are "no answer", not zero. Number(null) is 0, which would read a
// count that never came back as a calm day.
function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function usableTemplate(row) {
  if (!row || row.compliance_passed !== true) return false;
  return !isDraftTemplateRow(row);
}

async function staffLogin(db) {
  const id = "gap:auth-staff-login";
  let row;
  try {
    const out = await db.query(STAFF_LOGIN_SQL);
    row = out && out.rows && out.rows[0];
  } catch (err) {
    return check(id, "FAIL", `Staff login could not be read: ${clip(err)}`, FIX_LOGIN);
  }
  if (!row) return check(id, "FAIL", "Staff login counts did not come back.", FIX_LOGIN);

  const active = num(row.active_with_password);
  const okN = num(row.ok_n);
  const badN = num(row.bad_n);
  const emails = num(row.bad_emails);
  if (active == null || okN == null || badN == null || emails == null) {
    return check(id, "FAIL", "Staff login counts did not come back.", FIX_LOGIN);
  }

  const nobody = active === 0;
  const storm = badN >= LOGIN_FAIL_MIN && okN === 0 && emails >= LOGIN_FAIL_EMAILS;
  if (nobody && storm) {
    return check(
      id,
      "FAIL",
      `No active staff login has a password. ${badN} failed sign-ins from ${emails} emails in 24 hours. None succeeded.`,
      FIX_LOGIN
    );
  }
  if (nobody) {
    return check(id, "FAIL", "No active staff login has a password, so people cannot sign in.", FIX_LOGIN);
  }
  if (storm) {
    return check(
      id,
      "FAIL",
      `${badN} failed sign-ins from ${emails} emails in 24 hours. None succeeded.`,
      FIX_LOGIN
    );
  }
  return check(
    id,
    "PASS",
    `Active staff logins: ${active}. Sign-ins in 24 hours: ${okN} ok, ${badN} failed.`
  );
}

async function magicLink(db, orgId) {
  const id = "gap:auth-magic-link-dead";
  let templates;
  try {
    templates = await db.query(MAGIC_TEMPLATE_SQL, [orgId || null]);
  } catch (err) {
    return check(id, "FAIL", `Sign-in link template could not be read: ${clip(err)}`, FIX_MAGIC);
  }
  const rows = (templates && templates.rows) || [];
  if (!rows.some(usableTemplate)) {
    const why = rows.length === 0
      ? `${MAGIC_LINK_TEMPLATE_KEY} is missing, so a magic link or portal link never queues an email.`
      : `${MAGIC_LINK_TEMPLATE_KEY} cannot send, so a magic link or portal link never queues an email.`;
    return check(id, "FAIL", why, FIX_MAGIC);
  }

  let dead;
  try {
    dead = await db.query(MAGIC_DEAD_SQL);
  } catch (err) {
    return check(id, "FAIL", `Sign-in link queue could not be read: ${clip(err)}`, FIX_MAGIC);
  }
  const n = num(dead && dead.rows && dead.rows[0] && dead.rows[0].n);
  if (n == null) return check(id, "FAIL", "Sign-in link queue count did not come back.", FIX_MAGIC);
  if (n > 0) {
    const noun = n === 1 ? "link" : "links";
    return check(id, "FAIL", `${n} sign-in ${noun} in 24 hours had no email queued.`, FIX_MAGIC);
  }
  return check(id, "PASS", "Sign-in link template can send. No short link in 24 hours is missing its email.");
}

async function sessionRead(db) {
  const id = "gap:auth-session-read";
  try {
    const out = await db.query(SESSION_READ_SQL, [SESSION_PROBE_HASH]);
    const row = out && out.rows && out.rows[0];
    if (!row || num(row.staff_hits) == null || num(row.account_hits) == null) {
      return check(id, "FAIL", "Session read did not come back.", FIX_SESSION);
    }
  } catch (err) {
    return check(id, "FAIL", `Session read failed: ${clip(err)}`, FIX_SESSION);
  }
  return check(id, "PASS", "Staff sessions and client sessions can be read the way sign-in reads them.");
}

async function signinNoSession(db) {
  const id = "gap:auth-signin-no-session";
  let row;
  try {
    const out = await db.query(SIGNIN_NO_SESSION_SQL);
    row = out && out.rows && out.rows[0];
  } catch (err) {
    return check(id, "FAIL", `Sign-in sessions could not be read: ${clip(err)}`, FIX_SIGNIN);
  }
  const staffOk = num(row && row.staff_ok);
  const staffMiss = num(row && row.staff_no_session);
  const linksUsed = num(row && row.links_used);
  const linksMiss = num(row && row.links_no_session);
  if (staffOk == null || staffMiss == null || linksUsed == null || linksMiss == null) {
    return check(id, "FAIL", "Sign-in session counts did not come back.", FIX_SIGNIN);
  }

  const parts = [];
  if (staffMiss > 0) {
    parts.push(`${staffMiss} of ${staffOk} staff sign-ins said yes and made no session`);
  }
  if (linksMiss > 0) {
    parts.push(`${linksMiss} of ${linksUsed} used magic links made no session`);
  }
  if (parts.length) {
    return check(id, "FAIL", `In 24 hours, ${parts.join(". ")}.`, FIX_SIGNIN);
  }
  if (staffOk === 0 && linksUsed === 0) {
    return check(id, "PASS", "No staff sign-in or used magic link in 24 hours to check.");
  }
  return check(
    id,
    "PASS",
    `${staffOk} staff sign-ins and ${linksUsed} used magic links in 24 hours. Each one has a session.`
  );
}

/** A key that is empty, or a masked copy like ****************abcd, cannot send. */
function envMissing(env) {
  const bad = [];
  for (const key of RESEND_ENV_KEYS) {
    const v = String((env && env[key]) == null ? "" : env[key]).trim();
    if (!v || /\*{4,}/.test(v)) bad.push(key);
  }
  return bad;
}

async function resetMail(db, env) {
  const id = "gap:auth-reset-mail";
  let row;
  try {
    const out = await db.query(RESET_READ_SQL);
    row = out && out.rows && out.rows[0];
  } catch (err) {
    return check(id, "FAIL", `Password reset table could not be read: ${clip(err)}`, FIX_RESET);
  }
  const asked = num(row && row.asked);
  const sent7d = num(row && row.resend_ok_7d);
  if (asked == null || sent7d == null) {
    return check(id, "FAIL", "Password reset counts did not come back.", FIX_RESET);
  }

  if (!env || typeof env !== "object") return check(id, "skip", SKIP_ENV);
  const bad = envMissing(env);
  if (bad.length) {
    const names = bad.join(" and ");
    // This run holds a masked or empty copy. If Resend sent real mail this week,
    // the live key works and this run is the odd one out (a laptop .env). Say so.
    if (sent7d > 0) {
      return check(
        id,
        "skip",
        `This run's copy of ${names} is empty or masked, so it was not proved here. Resend sent ${sent7d} emails in 7 days, so the live key works.`
      );
    }
    return check(
      id,
      "FAIL",
      `Reset and invite mail cannot go out: ${names} ${bad.length === 1 ? "is" : "are"} not set to a real value, and Resend sent no email in 7 days.`,
      FIX_RESET
    );
  }
  return check(
    id,
    "PASS",
    `Reset mail setup is in place (${RESEND_ENV_KEYS.join(", ")}). ${asked} reset${asked === 1 ? "" : "s"} asked in 24 hours.`
  );
}

/**
 * Checks for login breaks the morning door pings do not cover.
 * `ctx.db.query` is read only. No database returns skip, not a fake pass.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx && ctx.db;
  if (!db || typeof db.query !== "function") {
    return [
      "gap:auth-staff-login",
      "gap:auth-magic-link-dead",
      "gap:auth-session-read",
      "gap:auth-signin-no-session",
      "gap:auth-reset-mail"
    ].map((id) => check(id, "skip", SKIP));
  }
  return [
    await staffLogin(db),
    await magicLink(db, ctx.orgId),
    await sessionRead(db),
    await signinNoSession(db),
    await resetMail(db, ctx.env)
  ];
}
