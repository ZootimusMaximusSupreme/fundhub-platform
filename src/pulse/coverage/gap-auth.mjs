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

export const STAFF_LOGIN_SQL = `
/* gap:auth-staff-login */
SELECT
  (SELECT count(*)::int
     FROM staff s
    WHERE s.status = 'active'
      AND s.password_hash IS NOT NULL
      AND btrim(s.password_hash) <> ''
      AND COALESCE(to_jsonb(s) ->> 'is_demo', 'false') IS DISTINCT FROM 'true'
  ) AS active_with_password,
  (SELECT count(*)::int
     FROM auth_attempts a
    WHERE a.created_at > now() - interval '24 hours'
      AND a.successful
  ) AS ok_n,
  (SELECT count(*)::int
     FROM auth_attempts a
    WHERE a.created_at > now() - interval '24 hours'
      AND NOT a.successful
  ) AS bad_n,
  (SELECT count(DISTINCT lower(a.email))::int
     FROM auth_attempts a
    WHERE a.created_at > now() - interval '24 hours'
      AND NOT a.successful
      AND a.email IS NOT NULL
  ) AS bad_emails
`.trim();

export const MAGIC_TEMPLATE_SQL = `
/* gap:auth-magic-link-template */
SELECT template_key, compliance_passed, body, subject
  FROM message_templates
 WHERE template_key = 'EMAIL-PORTAL-MAGIC-LINK'
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

export const SESSION_READ_SQL = `
/* gap:auth-session-read */
SELECT
  (SELECT count(*)::int FROM sessions WHERE token_hash = $1) AS staff_hits,
  (SELECT count(*)::int FROM account_sessions WHERE token_hash = $1) AS account_hits
`.trim();

export const RESET_QUEUE_SQL = `
/* gap:auth-reset-queue */
SELECT
  count(*)::int AS asked,
  count(*) FILTER (WHERE mail_queued)::int AS queued
  FROM (
    SELECT EXISTS (
      SELECT 1
        FROM messages g
       WHERE g.channel = 'email'
         AND g.created_at >= pr.created_at - interval '2 minutes'
         AND g.created_at <= pr.created_at + interval '10 minutes'
         AND lower(g.to_address) = lower(COALESCE(st.email, ac.email))
         AND (
           COALESCE(g.subject, '') ILIKE '%password%'
           OR COALESCE(g.template_key, '') ILIKE '%reset%'
           OR COALESCE(g.rendered_body, '') ILIKE '%reset%'
         )
    ) AS mail_queued
      FROM password_resets pr
      LEFT JOIN staff st ON st.id = pr.staff_id
      LEFT JOIN accounts ac ON ac.id = pr.account_id
     WHERE pr.kind = 'reset'
       AND pr.created_at > now() - interval '24 hours'
  ) resets
`.trim();

export const READ_ONLY_SQL = [
  STAFF_LOGIN_SQL,
  MAGIC_TEMPLATE_SQL,
  MAGIC_DEAD_SQL,
  SESSION_READ_SQL,
  RESET_QUEUE_SQL
];

const SKIP = "no database in this run — this login check was not read";

const FIX_LOGIN = "People cannot sign in. Read staff passwords and the sign-in tries. Do not reset a password from this pulse.";
const FIX_MAGIC = "A sign-in link or a portal link had no email queued. Read EMAIL-PORTAL-MAGIC-LINK. Do not send from this pulse.";
const FIX_SESSION = "The session tables could not be read, so a session check would 500 and logout cannot see the row. Do not write from this pulse.";
const FIX_RESET = "A password reset was saved and no email was queued. Read the reset mail. Do not send from this pulse.";

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String((err && err.message) || err).replace(/\s+/g, " ").trim().slice(0, 160);
}

function num(v) {
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

async function magicLink(db) {
  const id = "gap:auth-magic-link-dead";
  let templates;
  try {
    templates = await db.query(MAGIC_TEMPLATE_SQL);
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
  return check(id, "PASS", "Staff sessions and client sessions can be read.");
}

async function resetQueue(db) {
  const id = "gap:auth-reset-queue";
  let row;
  try {
    const out = await db.query(RESET_QUEUE_SQL);
    row = out && out.rows && out.rows[0];
  } catch (err) {
    return check(id, "FAIL", `Password reset queue could not be read: ${clip(err)}`, FIX_RESET);
  }
  if (!row) return check(id, "FAIL", "Password reset counts did not come back.", FIX_RESET);
  const asked = num(row.asked);
  const queued = num(row.queued);
  if (asked == null || queued == null) {
    return check(id, "FAIL", "Password reset counts did not come back.", FIX_RESET);
  }
  if (asked > 0 && queued < asked) {
    const missed = asked - queued;
    return check(
      id,
      "FAIL",
      `${missed} password reset${missed === 1 ? "" : "s"} in 24 hours had no email queued.`,
      FIX_RESET
    );
  }
  if (asked === 0) return check(id, "PASS", "No password reset was asked for in 24 hours.");
  return check(id, "PASS", `${asked} password reset${asked === 1 ? "" : "s"} in 24 hours had an email queued.`);
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
      "gap:auth-reset-queue"
    ].map((id) => check(id, "skip", SKIP));
  }
  return [
    await staffLogin(db),
    await magicLink(db),
    await sessionRead(db),
    await resetQueue(db)
  ];
}
