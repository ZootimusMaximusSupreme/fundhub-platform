// Sign-in links and sign-in sessions, read only: two login tripwires.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). These two checks, their SQL and their helpers used to live in
// src/pulse/coverage/gap-auth.mjs. They moved here unchanged so the morning lane (which imports them
// back) and the hourly beat auth-links run the same SQL and the same verdicts. A beat may import only
// from src/pulse/beats/lib, so the draft-template test is a copy of src/messaging/draft-guard.mjs;
// beat-auth-links.test.mjs holds the two equal.
//
//   gap:auth-magic-link-dead     the sign-in link template cannot send, or a link in 24 hours had no email
//   gap:auth-signin-no-session   a sign-in said yes (staff password or a used magic link) and made no session
//
// db is anything with query(sql, params). Read-only SELECTs. No writes. No sends.

export const MAGIC_LINK_TEMPLATE_KEY = "EMAIL-PORTAL-MAGIC-LINK";

/** A template whose body or subject still carries a [DRAFT] marker never reaches a client (src/messaging/draft-guard.mjs). */
export const DRAFT_RE = /\[DRAFT\b/i;

/** Copy of isDraftTemplateRow in src/messaging/draft-guard.mjs: true when body or subject is draft placeholder. */
export function isDraftTemplateRow(row = {}) {
  const draft = (text) => text != null && DRAFT_RE.test(String(text));
  return draft(row.body) || draft(row.subject);
}

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

export const FIX_MAGIC = "A sign-in link or a portal link had no email queued. Read EMAIL-PORTAL-MAGIC-LINK. Do not send from this pulse.";
export const FIX_SIGNIN = "A sign-in said yes and no session was made, so the person got an error. Read createSession and the account session insert. Do not write from this pulse.";

export function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

export function clip(err) {
  return String((err && err.message) || err).replace(/\s+/g, " ").trim().slice(0, 160);
}

// null and "" are "no answer", not zero. Number(null) is 0, which would read a
// count that never came back as a calm day.
export function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function usableTemplate(row) {
  if (!row || row.compliance_passed !== true) return false;
  return !isDraftTemplateRow(row);
}

export async function magicLink(db, orgId) {
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

export async function signinNoSession(db) {
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
