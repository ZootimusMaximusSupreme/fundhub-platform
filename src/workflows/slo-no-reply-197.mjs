// If they do not reply to the first note, send the $197 offer.
// A reply takes them off this path. The first five who say yes get the
// roadmap free instead, in slo-genuine-followup.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { claimCustomFieldLock } from "./custom-fields.mjs";
import { createCheckoutSession } from "../payments/commas-api.mjs";
import { recordSloPaymentLink } from "../slo/buyer.mjs";
import { SLO_KEEP_TITLE, SLO_PURPOSE, SLO_SOURCE } from "../slo/offer.mjs";
import { DISCOUNT_CENTS, LOCK_197, REPLIED_KEY, discountCheckoutUrl, newDiscountRef, DISCOUNT_REF_KEY } from "../slo/discount-197.mjs";
import { enrollSloDrip } from "../slo/drip-plan.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { eligibleForGenuineM1, hasPaidDiagnostic, LOCK_M1 } from "./slo-genuine-followup.mjs";

export const EMAIL_197_KEY = "EMAIL-SLO-197";
export const SMS_197_KEY = "SMS-SLO-197";
export const WAIT_NO_REPLY = "24h";

const CHRIS = { sender_name: "Chris", sender: { name: "Chris" } };

export async function mintDiscountLink(db, { orgId, clientId, env = process.env, checkout = createCheckoutSession, record = recordSloPaymentLink }) {
  const session = await checkout({
    amountCents: DISCOUNT_CENTS,
    productTitle: SLO_KEEP_TITLE,
    type: "onetime_non_reusable",
    metadata: { purpose: SLO_PURPOSE, source: SLO_SOURCE, discount_cents: String(DISCOUNT_CENTS) },
    env
  });
  if (!session?.ok || !session.paymentLink) {
    return { ok: false, reason: session?.reason || "no_pay_link" };
  }
  const ref = `slo197-${String(clientId).replace(/-/g, "").slice(0, 12)}-${Date.now()}`;
  await record(db, {
    orgId,
    clientId,
    ref,
    checkoutUrl: session.paymentLink,
    amountCents: DISCOUNT_CENTS,
    commasSessionId: session.checkoutSessionId || null
  });
  return { ok: true, url: session.paymentLink };
}

async function repliedAlready(db, clientId) {
  const r = await db.query(
    `SELECT custom_fields->>$2 AS replied, custom_fields->>$3 AS m1
       FROM clients WHERE id = $1 LIMIT 1`,
    [clientId, REPLIED_KEY, LOCK_M1]
  );
  const row = r.rows[0];
  if (!row) return { replied: false, m1: false };
  return { replied: Boolean(row.replied), m1: Boolean(row.m1) };
}

export async function handleNoReply({ event, db, step, mint = mintDiscountLink }) {
  const payload = event.payload || {};
  const gate = eligibleForGenuineM1(payload);
  if (!gate.ok) return { done: false, reason: gate.reason };

  await step.sleep("wait-for-reply", WAIT_NO_REPLY);

  const orgId = event.orgId;
  const paid = await step.run("check-paid", () =>
    hasPaidDiagnostic(db, { orgId, email: gate.email }));
  if (paid) return { done: true, sent: false, reason: "already_paid" };

  const clientId = await step.run("resolve-client", () =>
    resolveClient(db, {
      orgId,
      payload: { email: gate.email, name: payload.name || null, phone: gate.phone, source: SLO_SOURCE }
    }));
  if (!clientId) return { done: false, reason: "no_client" };

  const lane = await step.run("check-reply", () => repliedAlready(db, clientId));
  if (!lane.m1) return { done: false, reason: "no_m1" };
  if (lane.replied) return { done: true, sent: false, reason: "they_replied" };

  const stillPaid = await step.run("recheck-paid", () =>
    hasPaidDiagnostic(db, { orgId, email: gate.email, clientId }));
  if (stillPaid) return { done: true, sent: false, reason: "already_paid" };

  const claimed = await step.run("claim-197", () =>
    claimCustomFieldLock(db, clientId, LOCK_197));
  if (!claimed) return { done: false, reason: "already_sent_197" };

  const ref = newDiscountRef();
  const payUrl = discountCheckoutUrl(ref);
  await step.run("save-ref", () =>
    mergeCustomFields(db, clientId, { [DISCOUNT_REF_KEY]: ref }));

  const eventId = event.id;
  const context = { ...CHRIS, pay_url: payUrl };
  let sms = null;
  if (gate.phone) {
    sms = await step.run("send-sms-197", () =>
      sendTemplated(db, {
        orgId, clientId, channel: "sms", templateKey: SMS_197_KEY, eventId, context
      }));
  }
  const email = await step.run("send-email-197", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "email", templateKey: EMAIL_197_KEY, eventId, context
    }));

  await step.run("enroll-drip", () => enrollSloDrip(db, clientId));

  return { done: true, sent: true, clientId, sms, email, payUrl };
}

/* handle — the injectable shape src/journeys/runner/registry.mjs calls. */
export const handle = ({ event, db: handleDb, step }) => handleNoReply({ event, db: handleDb, step });

export const sloNoReply197 = inngest.createFunction(
  { id: "slo-no-reply-197", name: "SLO — $197 offer when they do not reply" },
  { event: "slo.contact_started" },
  ({ event, step }) => handleNoReply({ event: event.data, db, step })
);
