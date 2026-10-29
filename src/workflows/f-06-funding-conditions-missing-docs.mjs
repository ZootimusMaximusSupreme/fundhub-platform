// F-06 — Funding Conditions / Missing Docs.
// Source: the CRM workflow 6e296a07-a758-49cb-ac71-686b1ec1da54 (the CRM source-of-truth export).
// Ports the live [AGENT DRAFT] definition.
//
// Original trigger was "Custom Field: Funding Condition Required = true" — a
// downstream consequence of the bank actually asking for more docs, which is exactly
// what F-11's Bank Email Event Router already classifies as MISSING_DOCS off
// mail.response. Rather than invent a synthetic "custom field updated" event, this
// reacts to mail.response directly (classification === "MISSING_DOCS"), gated on a
// non-empty condition description in the payload. The "docs received, clear the
// hold" half reacts to docs.received (already a canonical event) for the same client.
//
// Round Hold Reason is a CONTACT field (05/30 doc lines 184-190, Part B). C-02 and C-03
// both write clients.custom_fields.round_hold_reason; this workflow wrote
// funding_rounds.hold_reason instead, so nothing that reads the contact field ever saw
// F-06's hold and BC-01's path selection could never see "Missing Documents".

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
// Mail responses and document receipts are downstream fulfillment signals.
// Resolve ONLY an already-owned client: resolveClient can create a phantom lead,
// patch an explicit foreign clientId or sync a CRM contact before org validation.
// Missing/foreign identities must bail without tasks, tags, cards or messages.
import { findClient } from "../handlers/purchase-routing.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags, removeTags } from "./tags.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-F06-MISSING-DOCS";
export const SMS_TEMPLATE_KEY = "SMS-F06-MISSING-DOCS";

// Writes the contact field C-02/C-03 use, plus the paired Employee Next Action (doc 165).
async function setLatestRoundHoldReason(db, clientId, reason) {
  await mergeCustomFields(db, clientId, {
    round_hold_reason: reason,
    employee_next_action: "Collect Documents"
  });
  return { updated: true };
}

async function handleMissingDocs({ event, db, step }) {
  if (event.payload?.classification !== "MISSING_DOCS") return { done: false, reason: "not_missing_docs" };
  if (!event.payload?.conditionDescription) return { done: false, reason: "no_condition_description" };

  const clientId = await step.run("resolve-client", () => findClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  await step.run("tag-docs-missing", () => addTags(db, clientId, ["docs:missing"]));
  const round = await step.run("set-hold-reason", () => setLatestRoundHoldReason(db, clientId, "Missing Documents"));
  await step.run("set-next-action", () => mergeCustomFields(db, clientId, { employee_next_action: "Collect Documents" }));
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));

  return { done: true, branch: "missing_docs", round, email, sms };
}

async function handleDocsReceived({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => findClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  await step.run("clear-docs-missing", () => removeTags(db, clientId, ["docs:missing"]));
  // Only clear hold_reason when this workflow set it — do not clobber F-09's "Internal Review".
  const round = await step.run("clear-hold-reason", () => clearHoldIfMissingDocs(db, clientId));

  return { done: true, branch: "docs_received", round };
}

// Only clear when THIS workflow set it — never clobber F-09's "Internal Review" or
// C-02's "New Inquiries". Also clears Funding Condition Required, which the old version
// left set forever (doc 1832).
async function clearHoldIfMissingDocs(db, clientId) {
  const r = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
  const cf = r.rows[0]?.custom_fields;
  if (!cf) return { updated: false };
  if (cf.round_hold_reason !== "Missing Documents") return { updated: false, reason: "hold_reason_not_ours" };
  await mergeCustomFields(db, clientId, {
    round_hold_reason: null,
    funding_condition_required: false
  });
  return { updated: true };
}

export async function handle({ event, db, step }) {
  if (event.name === "docs.received") return handleDocsReceived({ event, db, step });
  return handleMissingDocs({ event, db, step });
}

export const f06FundingConditionsMissingDocs = inngest.createFunction(
  { id: "f-06-funding-conditions-missing-docs", name: "F-06 — Funding Conditions / Missing Docs" },
  [{ event: "mail.response" }, { event: "docs.received" }],
  ({ event, step }) => handle({ event: event.data, db, step })
);
