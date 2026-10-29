// F-03 — Round Submitted (F2/F4/F6...F20).
// Source: the CRM workflow 40fc2df8-ac2c-4c75-ae75-5ac598ecb95e (the CRM source-of-truth export).
// Audit fix applied (Spec §6 + workflow-coherence-audit.md "Ready-to-paste copy"):
// real, compliance-scrubbed SMS + email copy, not the blank/"test" original —
// seeded via src/workflows/templates-seed.mjs (SMS-F03-ROUND-SUBMITTED /
// EMAIL-F03-ROUND-SUBMITTED), opt-out included.
//
// Trigger: round.submitted (exact canonical match — this is the file the task brief
// used as its own naming example). Gate: "Funding Round Number is not empty" — a
// submitted round always has round_number set, so this reduces to "a funding round
// exists for this client", checked via the round-lookup helper.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
// This is downstream paid-fulfillment activity, never a new lead capture.
// Only already-existing clients owned by this event's org may be changed;
// resolveClient could patch an explicit foreign ID or mint an unknown email.
import { findClient } from "../handlers/purchase-routing.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-F03-ROUND-SUBMITTED";
export const SMS_TEMPLATE_KEY = "SMS-F03-ROUND-SUBMITTED";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => findClient(db, event));
  if (!clientId) return { sent: false, reason: "no_client" };

  const roundNumber = event.payload?.roundNumber ?? event.payload?.round_number;
  if (roundNumber == null) return { sent: false, reason: "no_round_number" };

  const orgId = event.orgId;
  const eventId = event.id;
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));
  await step.run("set-next-action", () => mergeCustomFields(db, clientId, { employee_next_action: "Remove Inquiries" }));

  return { sent: true, email, sms };
}

export const f03RoundSubmitted = inngest.createFunction(
  { id: "f-03-round-submitted", name: "F-03 — Round Submitted" },
  { event: "round.submitted" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
