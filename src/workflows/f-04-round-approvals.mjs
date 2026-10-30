// F-04 — Round Approvals (F3/F5/F7...F21).
// Source: the CRM workflow 79c4a7b9-5875-40b6-bfc4-fbbd5f740410 (the CRM source-of-truth export).
// Audit fix applied: real ready-to-paste SMS/email copy (workflow-coherence-audit.md),
// seeded via src/workflows/templates-seed.mjs — not the original blank SMS + subject.
//
// Trigger: round.approved (exact canonical match). Gate: "Total Approved Amount > 0"
// — this is a validity check (was anything actually approved), not product-amount
// routing, so it doesn't run afoul of Rule 4.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
// This is downstream paid-fulfillment activity, never a new lead capture.
// Only already-existing clients owned by this event's org may be changed;
// resolveClient could patch an explicit foreign ID or mint an unknown email.
import { findClient } from "../handlers/purchase-routing.mjs";
import { approvedCardStackingRound } from "./f-05-inquiry-cleanup-gate.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-F04-ROUND-APPROVALS";
export const SMS_TEMPLATE_KEY = "SMS-F04-ROUND-APPROVALS";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => findClient(db, event));
  if (!clientId) return { sent: false, reason: "no_client" };

  const approvedAmount = Number(event.payload?.approvedAmount ?? 0);
  if (!(approvedAmount > 0)) return { sent: false, reason: "not_approved" };

  const orgId = event.orgId;
  // A delayed/replayed approval on an old, fictitious or terminal card-stacking
  // round must not send a customer an inaccurate approval notification or
  // overwrite the next staff action. Reuse F-05's same-org current-round gate.
  // Other provider rails without round identifiers retain their existing path
  // until their own provider provenance contract can be verified.
  const gate = await step.run("verify-current-card-stacking-round", () =>
    approvedCardStackingRound(db, { orgId, clientId, payload: event.payload }));
  if (!gate.ok) return { sent: false, reason: gate.reason };

  const eventId = event.id;
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));
  await step.run("set-next-action", () => mergeCustomFields(db, clientId, { employee_next_action: "Prepare Next Funding Round" }));

  return { sent: true, email, sms };
}

export const f04RoundApprovals = inngest.createFunction(
  { id: "f-04-round-approvals", name: "F-04 — Round Approvals" },
  { event: "round.approved" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
