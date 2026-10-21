// Shared database steps for bank outreach automation: approved copy, a queued
// banker email, a labelled history row, and a recorded stop. No fetch here:
// a queued `messages` row is handed to a provider only by
// src/messaging/dispatch.mjs (CLAUDE.md §12).
import { renderTemplate } from '../lib/render-template.mjs';
import { isDraftTemplateRow } from '../messaging/draft-guard.mjs';
import { PROGRAM_KEY } from './model.mjs';
import { searchName, stateName } from './finder.mjs';
import { mailConfig, footer, bankerUnsubscribeUrl, mailContext } from './mail.mjs';

export const iso = now => (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();

/* Approved, non-draft copy, or null. Same three refusals sendTemplated makes:
   missing, draft, unapproved. Missing copy is a named wait, never invented. */
export async function templateFor(db, orgId, key, { approvedOnly = true } = {}) {
  const row = (await db.query(`SELECT template_key, subject, body, compliance_passed FROM message_templates WHERE org_id=$1 AND template_key=$2 AND channel='email' LIMIT 1`, [orgId, key])).rows[0];
  if (!row || isDraftTemplateRow(row)) return null;
  if (approvedOnly && !row.compliance_passed) return null;
  return row;
}

export async function loadTarget(db, { orgId, contactId }) {
  return (await db.query(`SELECT c.id contact_id,c.org_id,c.account_id,c.name contact_name,c.email,c.email_opt_out_at,
      a.name account_name,a.state,a.status,a.next_action,a.next_due_at,a.assigned_staff_id
    FROM outreach_contacts c JOIN outreach_accounts a ON a.id=c.account_id AND a.org_id=c.org_id
    JOIN outreach_programs p ON p.id=a.program_id AND p.org_id=a.org_id
    WHERE c.org_id=$1 AND c.id=$2 AND p.key=$3`, [orgId, contactId, PROGRAM_KEY])).rows[0] || null;
}

/* Render one banker email from approved copy. Returns { subject, body } or a
   reason. The footer carries the real mailing address and both ways out. */
export function renderBankEmail(tpl, target, { env = process.env, missingQuestions = '', replySubject = '' } = {}) {
  const cfg = mailConfig(env);
  if (!cfg.ok) return { reason: 'not_configured', missing: cfg.missing };
  let unsubscribeUrl;
  try { unsubscribeUrl = bankerUnsubscribeUrl({ orgId: target.org_id, contactId: target.contact_id, env }); }
  catch { return { reason: 'not_configured', missing: ['UNSUBSCRIBE_TOKEN_SECRET'] }; }
  const ctx = mailContext({
    account: { name: target.account_name, search_name: searchName(target.account_name), state: target.state },
    contact: { name: target.contact_name },
    stateName: stateName(target.state),
    footerText: footer({ postal: cfg.postal, unsubscribeUrl }),
    missingQuestions,
    replySubject
  });
  return { subject: renderTemplate(tpl.subject || '', ctx), body: renderTemplate(tpl.body, ctx) };
}

/* The queued row and nothing else. Idempotent per provider_ref through 004's
   unique index, so a replayed pass queues one email, not two. */
export async function queueBankEmail(db, { target, templateKey, subject, body, providerRef }) {
  const to = String(target.email || '').trim().toLowerCase();
  if (!to.includes('@') || target.email_opt_out_at) return null;
  const { rows } = await db.query(`INSERT INTO messages (org_id, client_id, direction, channel, template_key, rendered_body, provider, provider_ref, status, compliance_check_passed, to_address, subject)
    VALUES ($1, NULL, 'outbound', 'email', $2, $3, NULL, $4, 'queued', true, $5, $6)
    ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING RETURNING id`,
  [target.org_id, templateKey, body, providerRef, to, subject || null]);
  return rows[0]?.id || null;
}

/* History written by the machine says so: actor 'automation', no staff id. */
export async function logAutomation(db, { orgId, accountId, contactId = null, channel = 'note', outcome, note = null, nextAction, nextDueAt }) {
  await db.query(`INSERT INTO outreach_activities(org_id,account_id,contact_id,staff_id,actor,channel,outcome,note,next_action,next_due_at)
    VALUES($1,$2,$3,NULL,'automation',$4,$5,$6,$7,COALESCE($8::timestamptz,now()))`,
  [orgId, accountId, contactId, channel, outcome, note, nextAction || 'Wait for banker reply', nextDueAt || null]);
}

/* One-way and first-reason-wins, like candidate outreach. */
export async function stopSequence(db, { orgId, contactId, reason, staffId = null, now = null }) {
  const { rows } = await db.query(`UPDATE outreach_email_sequences SET status='stopped',stopped_at=COALESCE($3::timestamptz,now()),stop_reason=$4,stopped_by=$5,updated_at=now()
    WHERE org_id=$1 AND contact_id=$2 AND status='active' RETURNING id`, [orgId, contactId, now ? iso(now) : null, reason, staffId]);
  return rows.length;
}

/* Start of today in Arizona, for the daily caps. */
export function arizonaDayStart(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix' }).format(now);
  return new Date(`${day}T00:00:00-07:00`).toISOString();
}
