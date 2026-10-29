// F-11 — Bank Email Event Router (Inbound).
// Source: the CRM workflow f4a6d38d-7717-4f3c-96f6-84c81e885022 (the CRM source-of-truth export).
// Spec §4 adapter note: "Mailgun adapter: unchanged inbox classification, now writing
// bank_inbox + events directly (F-11 becomes a handler)" — this file IS that handler.
// src/handlers/comms.mjs's onMailResponse already writes the bank_inbox row; this
// adds the task-routing + APPROVED/COUNTEROFFER stage move on the same event.
//
// Trigger: mail.response (exact canonical match). Routes on payload.classification.
// DENIED gets its own deeper follow-through in f-09-funding-declined-no-path.mjs;
// MISSING_DOCS gets its own deeper follow-through in
// f-06-funding-conditions-missing-docs.mjs. This file's job is strictly the routing
// task the CRM created for every classification (APPROVAL/COUNTER/DOCS
// NEEDED/DENIED/ACTION REQUIRED/APP RECEIVED) — one task title per classification,
// deduped by event id like every other task in this directory.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
// Mail responses and document receipts are downstream fulfillment signals.
// Resolve ONLY an already-owned client: resolveClient can create a phantom lead,
// patch an explicit foreign clientId or sync a CRM contact before org validation.
// Missing/foreign identities must bail without tasks, tags, cards or messages.
import { findClient } from "../handlers/purchase-routing.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { moveCardToStage } from "./cards.mjs";
import { createTask } from "../lib/create-task.mjs";

const SOURCE_WORKFLOW = "f-11-bank-email-event-router";

const TASK_TITLES = {
  APPROVED: "APPROVAL: log amount + update round",
  COUNTEROFFER: "COUNTER: review + log offer + next step",
  MISSING_DOCS: "DOCS NEEDED: collect docs (see BANK_INBOX log)",
  DENIED: "DENIED: log denial + adjust plan",
  ACTION_REQUIRED: "ACTION REQUIRED: call/verify/sign (see BANK_INBOX log)",
  APP_RECEIVED: "APP RECEIVED: email logged"
};

async function createRoutingTask(db, { orgId, clientId, eventId, title }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await createTask(db, {
      orgId: orgId,
      clientId: clientId,
      title: title,
      sourceWorkflow: SOURCE_WORKFLOW,
      assigneeRole: "funding_advisor",
      eventId: eventId
    });
  return { created: true };
}

export async function handle({ event, db, step }) {
  const classification = event.payload?.classification;
  const title = TASK_TITLES[classification];
  if (!title) return { done: false, reason: `unclassified:${classification}` };

  const clientId = await step.run("resolve-client", () => findClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  const task = await step.run("create-routing-task", () => createRoutingTask(db, { orgId, clientId, eventId, title }));

  let card = null;
  if (classification === "APPROVED" || classification === "COUNTEROFFER") {
    await step.run("set-next-action", () => mergeCustomFields(db, clientId, { employee_next_action: "Prepare Next Funding Round" }));
    card = await step.run("move-to-approvals-stage", () =>
      moveCardToStage(db, { orgId, clientId, pipelineKey: "funding_card_stacking", stageKey: "approved" }));
  }

  return { done: true, classification, task, card };
}

export const f11BankEmailEventRouter = inngest.createFunction(
  { id: "f-11-bank-email-event-router", name: "F-11 — Bank Email Event Router" },
  { event: "mail.response" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
