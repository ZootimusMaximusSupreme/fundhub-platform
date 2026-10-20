// src/invoices/notify.mjs — an invoice that actually reaches the client.
//
// WHAT WAS WRONG. `invoices.status` has included 'sent' since 017, and
// markSent() flips it — but nothing has ever emailed one. So "sent" meant
// "somebody pressed a button", and the client heard nothing. Two workflows
// (ds-02, f-07) create invoices automatically, so the platform has been quietly
// raising invoices nobody was told about.
//
// 119 separates the claim from the fact: `status = 'sent'` is what we did,
// `emailed_at` is what actually left. This module is what fills the second one.
//
// NOTHING HERE TRANSMITS. It renders an editable template, writes a `messages`
// row, and asks src/messaging/outbox.mjs to drain. Outbound fetch lives in
// src/messaging/providers/* and nowhere else (CLAUDE.md §12).
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7) — this is fee-timing communication.
// The seeded copy states an amount and a due date and makes no claim about
// credit outcomes; it is editable from the template editor like all other copy.

import { renderTemplate } from "../lib/render-template.mjs";
import { drain } from "../messaging/outbox.mjs";
import { threadMessage } from "../conversations/store.mjs";
import { destinationAddress } from "../auth/authorized-rep.mjs";

export const INVOICE_TEMPLATE_KEY = "INVOICE-SENT-EMAIL";

/** Money as a person reads it. Invoices store numeric(14,2); never print raw. */
export function formatAmount(amount, currency = "USD") {
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount ?? "");
  const body = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "USD" ? `$${body}` : `${body} ${currency}`;
}

/* A success-fee invoice is labelled for the client as the agreed service,
   while its stored funding_success_fee source remains the accounting key.

   EXPORTED so the portal prints the same words as the email. The client reads
   this label in her inbox and then again on the Payments tab of her portal
   (api/read/portal-summary.mjs); two copies of this transform is two places for
   the same invoice to acquire two names. */
export function invoiceKindLabel(row = {}) {
  if (row.source === "funding_success_fee" || row.invoice_type === "success_fee") {
    return "basic business consulting fee";
  }
  return String(row.source || row.invoice_type || "invoice")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

/* What an invoice email may say. Deliberately small, and deliberately NOT the
   whole invoice row — an internal note or a provider reference has no business
   in a client's inbox. */
export function invoiceContext({ invoice, client, orgName = "Fundhub" }) {
  const first = String(client?.first_name || "").trim() || "there";
  const due = invoice.due_at ? String(invoice.due_at).slice(0, 10) : null;
  return {
    contact: {
      first_name: first,
      name: [client?.first_name, client?.last_name].filter(Boolean).join(" ") || first,
      email: client?.email || null
    },
    invoice: {
      /* amount_due, NOT amount. 017 created the column as `amount`; 031 renamed
         it to `amount_due` and retired `invoice_type` to a projection of
         `source`. Reading the migration rather than the table is how you email a
         client "undefined". */
      amount: formatAmount(invoice.amount_due, invoice.currency),
      // 'deposit' → 'Deposit'. See invoiceKindLabel above — the portal shows the
      // client the same words for the same invoice.
      kind: invoiceKindLabel(invoice),
      due: due || "on receipt",
      reference: String(invoice.id).slice(0, 8),
      company: orgName
    }
  };
}

/**
 * emailInvoice — queue the invoice email and drain.
 *
 * Returns { ok, reason, messageId, delivery }. NEVER THROWS: an invoice is a
 * financial record and its existence must not depend on an email succeeding.
 *
 * IDEMPOTENT. provider_ref is `invoice:<id>:<purpose>` and migration 004's
 * unique index on (org_id, provider_ref) is the real guarantee — the same
 * invoice cannot be emailed twice for the same reason. A deliberate re-send
 * passes a different purpose, which is how a chase or a resend gets through.
 */
export async function emailInvoice(db, { orgId, invoiceId, purpose = "sent", now = null } = {}) {
  try {
    const { rows } = await db.query(
      `SELECT i.*, c.first_name, c.last_name, c.email AS client_email, o.name AS org_name
         FROM invoices i
         JOIN clients c ON c.id = i.client_id
         JOIN orgs o    ON o.id = i.org_id
        WHERE i.id = $1::uuid AND i.org_id = $2::uuid LIMIT 1`, [invoiceId, orgId]);
    const inv = rows[0];
    if (!inv) return { ok: false, reason: "not_found" };
    if (inv.status === "void") return { ok: false, reason: "voided" };
    const toEmail = await destinationAddress(db, inv.client_id, "email", inv.client_email);
    if (!toEmail) return { ok: false, reason: "no_email" };

    const tpl = (await db.query(
      `SELECT template_key, subject, body, compliance_passed
         FROM message_templates WHERE org_id = $1::uuid AND template_key = $2 LIMIT 1`,
      [orgId, INVOICE_TEMPLATE_KEY])).rows[0];
    if (!tpl) return { ok: false, reason: "no_template" };
    // Same rule sendTemplated applies everywhere else: unapproved copy does not
    // go out. The invoice still stands; only the email waits.
    if (!tpl.compliance_passed) return { ok: false, reason: "template_not_approved" };

    const context = invoiceContext({
      invoice: inv,
      client: { first_name: inv.first_name, last_name: inv.last_name, email: inv.client_email },
      orgName: inv.org_name
    });

    const ins = await db.query(
      `INSERT INTO messages
         (org_id, client_id, direction, channel, template_key, rendered_body,
          provider, provider_ref, status, compliance_check_passed, to_address, subject)
       VALUES ($1,$2,'outbound','email',$3,$4,NULL,$5,'queued',true,$6,$7)
       ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
       RETURNING id, created_at`,
      [orgId, inv.client_id, tpl.template_key,
       renderTemplate(tpl.body, context),
       `invoice:${inv.id}:${purpose}`,
       toEmail,
       tpl.subject ? renderTemplate(tpl.subject, context) : null]);

    if (!ins.rows[0]) return { ok: false, reason: "already_emailed" };
    const messageId = ins.rows[0].id;

    /* Put it on the client's email thread, so the Messaging screen can find
       this person by name. Without it the row is written with conversation_id
       NULL and api/read/inbox.mjs — which lists `conversations` — has nothing
       to show. Never throws: an invoice email must not fail because a list
       could not be updated. */
    await threadMessage(db, {
      orgId, clientId: inv.client_id, channel: "email",
      messageId, createdAt: ins.rows[0].created_at, source: "invoices"
    });

    /* emailed_at is stamped on the FIRST email and never moved, matching how
       markDelivered() treats a document: it is when the client was told, not
       when we last touched the row. */
    await db.query(
      `UPDATE invoices
          SET emailed_at = COALESCE(emailed_at, COALESCE($2::timestamptz, now())),
              email_message_id = COALESCE(email_message_id, $3::uuid),
              updated_at = now()
        WHERE id = $1::uuid`, [inv.id, now, messageId]);

    const delivery = await drain(db, { orgId, now });
    return { ok: true, reason: null, messageId, delivery };
  } catch (err) {
    console.warn(`[invoices] could not email invoice ${invoiceId}: ${err.message}`);
    return { ok: false, reason: "error", error: err.message };
  }
}

/**
 * unemailedInvoices — sent, but the client was never actually told.
 *
 * This is the backlog 119 makes visible for the first time. Every invoice the
 * two workflows have ever raised is in here.
 */
export async function unemailedInvoices(db, { orgId, limit = 100 } = {}) {
  const { rows } = await db.query(
    `SELECT i.id, i.amount_due, i.currency, i.status, i.due_at, i.created_at,
            c.first_name, c.last_name, c.email AS client_email
       FROM invoices i
       JOIN clients c ON c.id = i.client_id
      WHERE i.org_id = $1::uuid
        AND i.status = 'sent'
        AND i.emailed_at IS NULL
      ORDER BY i.created_at
      LIMIT $2`, [orgId, Math.max(1, Math.min(Number(limit) || 100, 500))]);
  return rows;
}

/**
 * emailOutstandingInvoices — send the ones nobody was told about.
 *
 * Bounded and reported. Deliberately NOT automatic on a schedule: mailing a
 * backlog of historical invoices is a decision with real consequences for real
 * people, and it should be somebody pressing a button having seen the count.
 */
export async function emailOutstandingInvoices(db, { orgId, limit = 50, now = null } = {}) {
  const due = await unemailedInvoices(db, { orgId, limit });
  const summary = { considered: due.length, emailed: 0, skipped: [] };
  for (const inv of due) {
    const res = await emailInvoice(db, { orgId, invoiceId: inv.id, now });
    if (res.ok) summary.emailed += 1;
    else summary.skipped.push({ id: inv.id, reason: res.reason });
  }
  return summary;
}
