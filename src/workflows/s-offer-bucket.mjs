// Offer-bucket delivery. Spec 4.5 (2026-08-22).
// Trigger: call.completed from a closer save (disposition: "closer").
// Reads offerKey, not outcome. Email only.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { claimCustomFieldLock } from "./custom-fields.mjs";

export const LOCK_FIELD = "offer_bucket_email_sent_at";

export const OFFER_EMAIL = Object.freeze({
  SOFT_PULL: "EMAIL-OFFER-SOFT-PULL",
  FUNDING_DFY: "EMAIL-OFFER-FUNDING-DFY",
  REPAIR_DFY: "EMAIL-OFFER-REPAIR-DFY",
  REPAIR_TRIAL: "EMAIL-OFFER-REPAIR-TRIAL",
  UWIQ_DELIVERABLES: "EMAIL-OFFER-UWIQ-DELIVERABLES",
  FUNDING_MASTERY: "EMAIL-OFFER-FUNDING-MASTERY",
  none: "EMAIL-OFFER-NONE",
  not_a_fit: "EMAIL-OFFER-NONE"
});

export function templateForOffer({ offerKey, outcome } = {}) {
  const key = String(offerKey || "").trim();
  if (key && OFFER_EMAIL[key]) return OFFER_EMAIL[key];
  if (!key && outcome === "not_a_fit") return OFFER_EMAIL.not_a_fit;
  return null;
}

/** Paid Mastery pay link only — not a sent/unpaid ask. */
export function isMasteryPaidLink(row) {
  if (!row) return false;
  const paid = row.status === "paid" || row.paid_at;
  if (!paid) return false;
  const code = String(row.product_code || "").trim();
  const desc = String(row.description || "");
  return code === "funding-mastery" || /funding mastery/i.test(desc);
}

export async function masteryIsPaid(db, { orgId, clientId } = {}) {
  if (!orgId || !clientId) return false;
  const r = await db.query(
    `SELECT pl.status, pl.paid_at, pl.description, p.code AS product_code
       FROM payment_links pl
       LEFT JOIN products p ON p.id = pl.product_id
      WHERE pl.org_id = $1 AND pl.client_id = $2
        AND (pl.status = 'paid' OR pl.paid_at IS NOT NULL)`,
    [orgId, clientId]
  );
  return (r.rows || []).some(isMasteryPaidLink);
}

export async function handle({ event, db, step }) {
  const payload = event.payload || {};
  if (payload.disposition !== "closer") {
    return { done: false, reason: "not_closer_disposition" };
  }

  const templateKey = templateForOffer({
    offerKey: payload.offerKey || payload.offer_key,
    outcome: payload.outcome
  });
  if (!templateKey) return { done: false, reason: "no_offer_template" };

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  // This template says "Payment received." The closer can send an unpaid
  // soft-pull link and still log a callback, so the offer key alone is not proof.
  // call.completed carries only the transaction ID already verified and saved
  // by logCallOutcome for this exact payment link.
  if (templateKey === OFFER_EMAIL.SOFT_PULL && !payload.transactionId) {
    return { done: false, reason: "soft_pull_unpaid" };
  }

  if (templateKey === OFFER_EMAIL.FUNDING_MASTERY) {
    const paid = await step.run("check-mastery-paid", () =>
      masteryIsPaid(db, { orgId: event.orgId, clientId }));
    if (!paid) return { done: false, reason: "mastery_unpaid" };
  }

  const claimed = await step.run("claim-offer-email", () =>
    claimCustomFieldLock(db, clientId, LOCK_FIELD));
  if (!claimed) return { done: false, reason: "already_locked" };

  const email = await step.run("send-offer-email", () =>
    sendTemplated(db, {
      orgId: event.orgId,
      clientId,
      channel: "email",
      templateKey,
      eventId: event.id
    }));

  return { done: true, templateKey, email };
}

export const sOfferBucket = inngest.createFunction(
  { id: "s-offer-bucket", name: "S-OFFER — Closer Offer Bucket Email" },
  { event: "call.completed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
