// Affiliate welcome mail — catalog key AF1 only.
//
// Templates AF, AF1–AF4, AF-06 already sit in message_templates. There was no
// send job. This queues AF1 (activation) onto messages; the existing dispatcher
// drains queued → sent. AF3/AF4 are commission events, not drips. AF-06 is
// retired. Do not invent a long sequence.
//
// Apply queues AF1 for that one new affiliate. The sweeper only backfills
// plus-tag sims (`+aff-` / `+sim-`) so a first pass cannot blast live affiliates.

import { renderTemplate } from "../lib/render-template.mjs";
import { isDraftTemplateRow } from "../messaging/draft-guard.mjs";

export const AFFILIATE_WELCOME_KEY = "AF1";
export const SWEEP_CAP = 5;
export const APP_ORIGIN = "https://fundhub.ai";

export function isAffiliatePlusTag(email) {
  const e = String(email || "").trim().toLowerCase();
  return e.includes("+aff-") || e.includes("+sim-");
}

export async function queueAffiliateTemplate(db, {
  orgId,
  email,
  name,
  trackingId,
  templateKey = AFFILIATE_WELCOME_KEY,
  eventId
} = {}) {
  const dest = String(email || "").trim().toLowerCase();
  if (!orgId || !dest) return { queued: false, reason: "no_destination" };

  const tpl = await db.query(
    `SELECT body, subject, compliance_passed
       FROM message_templates
      WHERE org_id = $1 AND template_key = $2
      LIMIT 1`,
    [orgId, templateKey]
  );
  const row = tpl.rows[0];
  if (!row) return { queued: false, reason: "template_pending" };
  if (isDraftTemplateRow(row)) return { queued: false, reason: "draft_template" };
  if (!row.compliance_passed) return { queued: false, reason: "template_pending" };

  const first = String(name || "").trim().split(/\s+/)[0] || "";
  const link = trackingId
    ? `${APP_ORIGIN}/start?ref=${encodeURIComponent(trackingId)}`
    : "";
  const dash = `${APP_ORIGIN}/app/affiliate.html`;
  const ctx = {
    contact: { first_name: first, email: dest },
    affiliate_link: link,
    affiliate_dashboard: dash,
    sender_name: "Chris",
    "cta-link": dash,
    custom_fields: { affiliate_tracking_id: trackingId || "" }
  };
  const rendered = renderTemplate(row.body, ctx);
  const subject = row.subject ? renderTemplate(row.subject, ctx) : row.subject;
  const providerRef = `affiliate-drip:${templateKey}:${eventId || dest}`;

  const ins = await db.query(
    `INSERT INTO messages (
        org_id, client_id, direction, channel, template_key,
        rendered_body, provider, provider_ref, status,
        compliance_check_passed, to_address, subject
      )
     VALUES ($1, NULL, 'outbound', 'email', $2, $3, 'internal', $4, 'queued', true, $5, $6)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
     RETURNING id`,
    [orgId, templateKey, rendered, providerRef, dest, subject]
  );

  return {
    queued: true,
    messageId: ins.rows[0]?.id || null,
    providerRef,
    templateKey
  };
}

export async function sweepAffiliateDrips(db, { cap = SWEEP_CAP } = {}) {
  const due = await db.query(
    `SELECT a.org_id, a.id, a.email, a.name, aff.tracking_id
       FROM accounts a
       JOIN affiliates aff ON aff.id = a.affiliate_id
      WHERE a.kind = 'affiliate'
        AND a.status = 'active'
        AND (a.email LIKE '%+aff-%' OR a.email LIKE '%+sim-%')
        AND NOT EXISTS (
          SELECT 1 FROM messages m
           WHERE m.org_id = a.org_id
             AND m.template_key = $1
             AND lower(m.to_address) = lower(a.email)
        )
      ORDER BY a.created_at ASC
      LIMIT $2`,
    [AFFILIATE_WELCOME_KEY, cap]
  );

  const results = [];
  for (const row of due.rows) {
    results.push(await queueAffiliateTemplate(db, {
      orgId: row.org_id,
      email: row.email,
      name: row.name,
      trackingId: row.tracking_id,
      eventId: row.id
    }));
  }
  return {
    ok: true,
    scanned: due.rows.length,
    queued: results.filter((r) => r.queued && r.messageId).length,
    results
  };
}
