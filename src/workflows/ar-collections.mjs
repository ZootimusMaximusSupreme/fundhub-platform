// AR collections on funding success-fee invoices. Spec 4.7 (2026-08-22).
// COMPLIANCE REVIEW REQUIRED — payment rails.
//
// invoice.sent (funding_success_fee only) → AR-01 now, AR-02 +7d, AR-03 +14d,
// then AR-04 task for a human CSM. Stops on invoice.paid.
// Re-checks payment before every send.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { withTransaction } from "../db/with-transaction.mjs";
import { findClient } from "../handlers/purchase-routing.mjs";
import { sendTemplated } from "./messaging.mjs";
import { addTags } from "./tags.mjs";
import { createTask } from "../lib/create-task.mjs";
import {
  getInvoice,
  markEscalated,
  invoiceDisplayNumber,
  formatBalanceDue
} from "../invoices/index.mjs";
import { allocatePayment, remainingDueCents, remainingDueAmount } from "../invoices/allocate.mjs";
import { isFundingSuccessFeeInvoice } from "../invoices/success-fee-source.mjs";
import { checkoutConfig } from "../payments/commas-api.mjs";
import { createPaymentLink } from "../payment-links/index.mjs";
import { retireInvoiceCheckoutLink } from "../payment-links/retire-invoice-checkout.mjs";

export const EMAIL_AR_01 = "EMAIL-AR-01-FIRST-NOTICE";
export const SMS_AR_01 = "SMS-AR-01-FIRST-NOTICE";
export const EMAIL_AR_02 = "EMAIL-AR-02-REMINDER";
export const SMS_AR_02 = "SMS-AR-02-REMINDER";
export const EMAIL_AR_03 = "EMAIL-AR-03-FINAL-NOTICE";
export const SMS_AR_03 = "SMS-AR-03-FINAL-NOTICE";

export const AR_04_TASK_TITLE = "Overdue balance — call the client";
export const AR_04_SOURCE_WORKFLOW = "ar-collections-handoff";

// A stray invoice.sent event must never collect on a draft that was not issued.
const COLLECTIBLE = ["sent", "reminded", "escalated", "partially_paid"];

// Recheck before every delayed notice: rows can be voided, replaced or moved
// while Inngest sleeps. Never trust an invoice.sent envelope over the DB.
function chaseInvoiceRejection(row, { orgId, clientId }) {
  if (!row) return "invoice_missing";
  if (!isFundingSuccessFeeInvoice(row)) return "not_success_fee";
  if (!orgId || !clientId ||
      String(row.org_id) !== String(orgId) ||
      String(row.client_id) !== String(clientId)) {
    return "invoice_identity_mismatch";
  }
  return null;
}

function stillOpen(row) {
  if (!row) return false;
  return COLLECTIBLE.includes(String(row.status || ""));
}

async function arContext(db, row, payload = {}) {
  const remaining = await remainingDueCents(db, row);
  const due = remainingDueAmount(remaining);
  return {
    invoice_number: invoiceDisplayNumber(row),
    balance_due: formatBalanceDue(due)
  };
}

async function retirePriorInvoiceLinks(db, row, env, retireLink = retireInvoiceCheckoutLink) {
  if (!row.funding_round_id) return;
  const prior = (await db.query(
    `SELECT pl.id, pl.invoice_id
       FROM payment_links pl
       JOIN invoices old ON old.id = pl.invoice_id
      WHERE old.org_id = $1 AND old.client_id = $2
        AND old.funding_round_id = $3
        AND old.sale_id IS NOT DISTINCT FROM $4
        AND old.id <> $5 AND old.status = 'void'
        AND pl.provider = 'commas'
        AND pl.status IN ('created', 'sent', 'expired')
      ORDER BY pl.created_at ASC, pl.id ASC`,
    [row.org_id, row.client_id, row.funding_round_id, row.sale_id || null, row.id]
  )).rows;
  for (const link of prior) {
    await retireLink(db, {
      linkId: link.id, orgId: row.org_id, invoiceId: link.invoice_id, env
    });
  }
}

export async function attachInvoicePayLink(
  db, row, env, createLink = createPaymentLink, retireLink = retireInvoiceCheckoutLink
) {
  if (!row?.id) throw new Error("Cannot mint a checkout without an invoice");
  const due = await remainingDueCents(db, row);
  if (due === null) throw new Error(`Invoice ${row.id} has no known balance`);
  if (due <= 0) return { settled: true };
  await retirePriorInvoiceLinks(db, row, env, retireLink);
  const stale = (await db.query(
    `SELECT id FROM payment_links
      WHERE invoice_id = $1 AND org_id = $2
        AND provider = 'commas'
        AND (status = 'expired' OR
             (status IN ('created', 'sent') AND amount_cents <> $3))
      ORDER BY created_at ASC, id ASC`,
    [row.id, row.org_id, due]
  )).rows;
  for (const link of stale) {
    await retireLink(db, { linkId: link.id, orgId: row.org_id, invoiceId: row.id, env });
  }
  const existing = await db.query(
    `SELECT id, amount_cents, checkout_url
       FROM payment_links
      WHERE invoice_id = $1 AND org_id = $2
        AND provider = 'commas'
        AND status IN ('created', 'sent')
        AND checkout_url IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [row.id, row.org_id]
  );
  if (existing.rows[0]) {
    if (Number(existing.rows[0].amount_cents) !== due) {
      throw new Error(`Invoice ${row.id} checkout amount no longer matches its balance`);
    }
    return existing.rows[0];
  }
  const cfg = checkoutConfig(env || {});
  if (!cfg.ok) throw new Error(cfg.reason);
  // description is stored on the Fundhub link. The Commas product title is
  // selected separately by createPaymentLink and keeps its safe catalog name.
  const link = await createLink(db, {
    orgId: row.org_id,
    clientId: row.client_id,
    purpose: "custom",
    description: "basic business consulting fee",
    amountCents: due,
    invoiceId: row.id,
    fundingRoundId: row.funding_round_id || null,
    env
  });
  if (!link?.id || !link.checkout_url) {
    throw new Error(`Invoice ${row.id} checkout was not saved with a payable URL`);
  }
  if (link.commas_session_id || link.link_ref) {
    await db.query(
      `UPDATE invoices SET external_ref = COALESCE(external_ref, $2) WHERE id = $1`,
      [row.id, link.commas_session_id || link.link_ref]
    );
  }
  return link;
}

async function sendPair(db, { orgId, clientId, eventId, emailKey, smsKey, context }) {
  const email = await sendTemplated(db, {
    orgId, clientId, channel: "email", templateKey: emailKey,
    eventId: `${eventId}:${emailKey}`, context
  });
  if (email?.reason === "template_pending" || email?.reason === "draft_template") {
    throw new Error(`AR notice template ${emailKey} is not ready`);
  }
  const sms = await sendTemplated(db, {
    orgId, clientId, channel: "sms", templateKey: smsKey,
    eventId: `${eventId}:${smsKey}`, context
  });
  if (sms?.reason === "template_pending" || sms?.reason === "draft_template") {
    throw new Error(`AR notice template ${smsKey} is not ready`);
  }
  return { email, sms };
}

async function chase({ event, db, step, env, createLink, retireLink }) {
  const payload = event.payload || {};
  const invoiceId = payload.invoiceId || payload.invoice_id;
  if (!invoiceId) return { done: false, reason: "no_invoice_id" };
  // invoice.sent is emitted by announceInvoice()/recovery with the canonical
  // clientId. Do not run resolveClient() here: it may CREATE or PATCH a CRM
  // contact from event metadata before invoice ownership is validated.
  const clientId = event.clientId || null;
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  // One debtor/invoice gets one notice of each stage and one CSM handoff,
  // even if invoice.sent is replayed with a DIFFERENT bus event ID.
  const collectionKey = `ar-success-fee:${orgId}:${invoiceId}`;
  const invoice = await getInvoice(db, { invoiceId });
  const rejected = chaseInvoiceRejection(invoice, { orgId, clientId });
  if (rejected) return { done: false, reason: rejected };

  const first = await step.run("send-ar-01", async () => {
    const row = await getInvoice(db, { invoiceId });
    const rejected = chaseInvoiceRejection(row, { orgId, clientId });
    if (rejected) return { skipped: true, reason: rejected };
    if (!stillOpen(row)) return { skipped: true, reason: row.status || "missing" };
    const link = await attachInvoicePayLink(db, row, env, createLink, retireLink);
    if (link.settled) return { skipped: true, reason: "no_balance" };
    return sendPair(db, {
      orgId, clientId, eventId: `${collectionKey}:01`,
      emailKey: EMAIL_AR_01, smsKey: SMS_AR_01,
      context: await arContext(db, row, payload)
    });
  });
  if (first.skipped) return { done: true, stoppedAt: "before-ar-01", first };

  await step.sleep("wait-7d", "7d");
  const second = await step.run("send-ar-02", async () => {
    const row = await getInvoice(db, { invoiceId });
    const rejected = chaseInvoiceRejection(row, { orgId, clientId });
    if (rejected) return { skipped: true, reason: rejected };
    if (!stillOpen(row)) return { skipped: true, reason: row.status || "missing" };
    const link = await attachInvoicePayLink(db, row, env, createLink, retireLink);
    if (link.settled) return { skipped: true, reason: "no_balance" };
    return sendPair(db, {
      orgId, clientId, eventId: `${collectionKey}:02`,
      emailKey: EMAIL_AR_02, smsKey: SMS_AR_02,
      context: await arContext(db, row, payload)
    });
  });
  if (second.skipped) return { done: true, stoppedAt: "before-ar-02", first, second };

  await step.sleep("wait-7d-more", "7d");
  const third = await step.run("send-ar-03", async () => {
    const row = await getInvoice(db, { invoiceId });
    const rejected = chaseInvoiceRejection(row, { orgId, clientId });
    if (rejected) return { skipped: true, reason: rejected };
    if (!stillOpen(row)) return { skipped: true, reason: row.status || "missing" };
    const link = await attachInvoicePayLink(db, row, env, createLink, retireLink);
    if (link.settled) return { skipped: true, reason: "no_balance" };
    return sendPair(db, {
      orgId, clientId, eventId: `${collectionKey}:03`,
      emailKey: EMAIL_AR_03, smsKey: SMS_AR_03,
      context: await arContext(db, row, payload)
    });
  });
  if (third.skipped) return { done: true, stoppedAt: "before-ar-03", first, second, third };

  /* AR-04. Three automated notices have not been paid, so the machine is done
     and a person takes over. Until 290_csm_role.sql there was nobody to take
     over: this step escalated the invoice, tagged the client, and stopped, so
     the ladder ended in a tag nothing read. The CSM owns the client after the
     sale, so the CSM gets the call.

     dedupeOn "event" means a replay of this run finds the existing task and
     reports created:false rather than stacking a second one on the same
     invoice — see createTask's header, a replay hitting an existing task is
     the system working. */
  const handoff = await step.run("ar-04-handoff", async () => withTransaction(db, async (tx) => {
    // A customer can pay between the final notice and this handoff. Take the
    // same invoice row lock as the receipt allocator, then decide from its
    // CURRENT status and balance. The tag/task must commit with escalation.
    const locked = await tx.query(
      `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId]
    );
    const row = locked.rows[0] || null;
    const rejected = chaseInvoiceRejection(row, { orgId, clientId });
    if (rejected) return { skipped: true, reason: rejected };
    if (!stillOpen(row)) return { skipped: true, reason: row.status || "missing" };
    const due = await remainingDueCents(tx, row);
    if (due === null || due <= 0) {
      return { skipped: true, reason: due === null ? "unknown_balance" : "no_balance" };
    }
    // A previous run can have committed the escalation before it delivered
    // the staff task. In that case, recover the missing task on replay.
    const escalated = row.status === "escalated" ? row : await markEscalated(tx, { invoiceId });
    if (!escalated) throw new Error("AR-04: locked invoice could not be escalated");
    await addTags(tx, clientId, ["ar:collections-handoff"]);

    const ctx = await arContext(tx, row, payload);
    const task = await createTask(tx, {
      orgId,
      clientId,
      title: AR_04_TASK_TITLE,
      sourceWorkflow: AR_04_SOURCE_WORKFLOW,
      assigneeRole: "csm",
      eventId: `${collectionKey}:04`,
      dedupeOn: "event",
      // createTask stores body as the UNIQUE dedupe key. Balance and the bus
      // envelope ID may change, so readable instructions must be in detail.
      body: `${collectionKey}:04`,
      detail: [
        `Invoice ${ctx.invoice_number} is still open. Balance due: ${ctx.balance_due}.`,
        "Three automated notices have gone out and none were paid. This one is a call, not another message.",
        "",
        "Log what happened with POST /api/customer-insights if the call turns into an interview,",
        "and take a payment through the link already on the invoice if they can pay now.",
        "",
        `[event:${eventId}]`
      ].join("\n")
    });

    return { skipped: false, escalated: true, taskCreated: !!task?.created, taskId: task?.id || null };
  }));

  return { done: true, first, second, third, handoff };
}

export async function handle({ event, db, step, env, createLink, retireLink }) {
  if (event.name === "payment.received") {
    // Receipt reconciliation MUST NOT create customers, change contact details,
    // or backfill CRM links. Lead capture is upstream of A/R. An untrusted
    // webhook's clientId is also not evidence of ownership by this tenant.
    if (!event.orgId) {
      return { done: true, allocated: false, path: "unresolved", reason: "missing_org" };
    }
    const clientId = await step.run("find-owned-client", () => findClient(db, event));
    // If the provider names a customer (ID or email), it MUST resolve to an
    // existing member of this org. A foreign/unknown locator cannot be
    // replaced by the invoice's own clientId or silently ignored.
    if (!clientId && (event.clientId || String(event.payload?.email || "").trim())) {
      // A valid provider payment may carry an obsolete email or wrong clientId.
      // Refuse allocation, but put the receipt on the REAL invoice owner's
      // review queue when an invoice in this org is identifiable. Never create
      // a task on a foreign event.clientId or disclose another org's invoice.
      const hintedId = event.payload?.invoiceId || event.payload?.invoice_id || null;
      let reviewTaskCreated = false;
      if (hintedId) {
        let invoice = null;
        try { invoice = await getInvoice(db, { invoiceId: hintedId }); }
        catch { /* malformed or unknown hint: no owner to attach a task to */ }
        if (invoice && String(invoice.org_id) === String(event.orgId)) {
          const ref = event.payload?.paymentId || event.payload?.providerRef || event.id;
          const review = await createTask(db, {
            orgId: event.orgId,
            clientId: invoice.client_id,
            title: "Unallocated receipt — verify payment customer identity",
            sourceWorkflow: "ar-allocate",
            assigneeRole: "funding_advisor",
            body: `receipt-owner-mismatch:${event.orgId}:${invoice.id}:${ref}`,
            dedupeOn: "event",
            detail: "Merchant receipt customer identity does not match the existing same-org buyer. Verify the original processor receipt and invoice before applying money."
          });
          reviewTaskCreated = review?.created === true;
        }
      }
      console.warn("[ar-collections] unmatched payment customer; allocation refused");
      return { done: true, allocated: false, path: "unresolved", reason: "client_not_owned", reviewTaskCreated };
    }
    // Some verified processor receipts identify only a precise invoice/session,
    // with no customer locator. Preserve the allocator's org + invoice/source
    // guards for those events rather than inventing a CRM contact.
    return step.run("allocate-payment", () =>
      allocatePayment(db, { ...event, clientId: clientId || null }));
  }
  return chase({ event, db, step, env, createLink, retireLink });
}

export const arCollections = inngest.createFunction(
  {
    id: "ar-collections",
    name: "AR — Success-Fee Collections",
    cancelOn: [
      {
        event: "invoice.paid",
        if: "event.data.payload.invoiceId != null && event.data.payload.invoiceId == async.data.payload.invoiceId"
      }
    ]
  },
  [{ event: "invoice.sent" }, { event: "payment.received" }],
  ({ event, step }) => handle({ event: { ...event.data, name: event.name }, db, step, env: process.env })
);
