// DS-01 — Repair Referral.
// Source: the CRM DOWNSELL WORKFLOWS section (draft status).
// Audit fix: real, compliance-scrubbed SMS copy exists (Workflow-SMS-Fixes-Ready-to-
// Paste.md), but needs the real partner referral link filled in before activation
// (spec §6: "DS-01: partner referral link filled before activation") — still a
// placeholder today, so the send stays gated on the template existing, same as every
// other pending-copy case in this directory. Never invented here.
//
// Trigger: call.completed with an explicit repair referral. Closer logs
// "not_a_fit" with repairReferral=true; older callers send "declined".
// Gated additionally on
// NOT being on the funding path (same product-path check DS-02 uses), so this and
// DS-02 can never both fire for the same outcome.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { clientOutcomeTier, isFundingPath } from "../config/product-path.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags } from "./tags.mjs";

async function hasIdentity(db, clientId) {
  const r = await db.query(`SELECT email, phone FROM clients WHERE id = $1`, [clientId]);
  const c = r.rows[0];
  return Boolean(c && c.email && c.phone);
}

export const SMS_TEMPLATE_KEY = "SMS-DS01-REPAIR-REFERRAL";
export const EMAIL_TEMPLATE_KEY = "EMAIL-DS01-REPAIR-REFERRAL";

// 05/30 doc lines 74-78: DS-01 fires on the rep's Stage 5 outcome "Repair Referral Sent".
// A closer's not_a_fit disposition enters only with an explicit repairReferral flag.
//
// Two things this must never fire on, both of which it used to:
//   - a HARD DECLINE (OFAC / fraud / severe public record). Doc lines 84-86 route those
//     to C-06's DECLINE branch: tag, decline email + SMS, close. Sending a repair partner
//     referral to a fraud decline is the wrong outbound message entirely.
//   - "Funding Didn't Buy" (doc line 157), which is a funding-lane outcome and gets S-08's
//     follow-up, not a repair referral.
const HARD_DECLINE_OUTCOMES = ["ofac", "fraud", "hard_decline", "disqualified"];

export function isRepairReferral(payload) {
  const p = payload || {};
  if (p.salesOutcome) return String(p.salesOutcome) === "Repair Referral Sent";
  if (p.outcome !== "declined" && !(p.disposition === "closer" && p.outcome === "not_a_fit")) return false;
  const reason = String(p.declineReason || p.reason || "").toLowerCase();
  if (HARD_DECLINE_OUTCOMES.some((r) => reason.includes(r))) return false;
  return p.repairReferral === true;
}

export async function handle({ event, db, step }) {
  if (!isRepairReferral(event.payload)) return { done: false, reason: "not_repair_referral" };

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  // Doc 1281-1285 / Part B 140-141: identity gate. This fires an SMS, so a contact with
  // no email still got texted and tagged before.
  const identity = await step.run("check-identity", () => hasIdentity(db, clientId));
  if (!identity) return { done: false, reason: "missing_identity" };

  const outcomeTier = await step.run("check-product-path", () => clientOutcomeTier(db, clientId));
  if (isFundingPath(outcomeTier)) return { done: false, reason: `blocked_funding_route:${outcomeTier}` };

  const orgId = event.orgId;
  const eventId = event.id;
  await step.run("tag-repair-referral", () => addTags(db, clientId, ["client:repair-referral"]));
  await step.run("set-product-path", () => mergeCustomFields(db, clientId, { product_path: "Referred" }));
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));

  return { done: true, email, sms };
}

export const ds01RepairReferral = inngest.createFunction(
  { id: "ds-01-repair-referral", name: "DS-01 — Repair Referral" },
  { event: "call.completed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
