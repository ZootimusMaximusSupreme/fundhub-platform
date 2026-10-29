// N-04 — Post-Funding Nurture.
// Source: the CRM workflow e7607d09-4882-470a-ac56-8ed216c573a8 (the CRM source-of-truth export).
// Spec 4.9 (2026-08-22): fires on staff engagement closeout (`round.closeout`
// with stage closed), not on round.funded (that instant still belongs to F-07).
// Money-chain also emits round.closeout per funded round — those payloads have
// no stage/engagementComplete and are skipped here. n-06 stays on round.funded.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
// Post-funding messaging is never a signup, and must not patch an unknown
// or cross-tenant event client. Only resolve a pre-existing owned client.
import { findClient } from "../handlers/purchase-routing.mjs";
import { sendTemplated } from "./messaging.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-N04-POST-FUNDING";
export const SMS_TEMPLATE_KEY = "SMS-N04-POST-FUNDING";

export function isStaffEngagementCloseout(payload = {}) {
  // Card Stacking emits stage=closed for EVERY individual round while
  // engagementComplete=false. That explicit "not finished" is authoritative:
  // a single round closing must never send the whole-engagement nurture touch.
  // Historical staff closeouts lack engagementComplete; retain their stage
  // fallback until a durable sequence-close control/event is implemented.
  if (payload.engagementComplete === false) return false;
  return payload.engagementComplete === true || payload.stage === "closed";
}

export async function handle({ event, db, step }) {
  if (!isStaffEngagementCloseout(event.payload || {})) {
    return { sent: false, reason: "not_engagement_closeout" };
  }

  const clientId = await step.run("resolve-client", () => findClient(db, event));
  if (!clientId) return { sent: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));

  return { sent: true, email, sms };
}

export const n04PostFundingNurture = inngest.createFunction(
  { id: "n-04-post-funding-nurture", name: "N-04 — Post-Funding Nurture" },
  { event: "round.closeout" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
