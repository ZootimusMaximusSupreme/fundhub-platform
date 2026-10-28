// S-08 — Post-Call: Funding Didn't Buy.
// Source: the CRM system map SALES WORKFLOWS section.
// Trigger: call.completed for a closer call that did not buy. Closer logs
// "not_a_fit"; older callers may still send "declined". Repair referrals have
// their own DS-01 lane.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { addTags } from "./tags.mjs";
import { createTask } from "../lib/create-task.mjs";

const SOURCE_WORKFLOW = "s-08-post-call-funding-declined";
const CALLBACK_WORKFLOW = "s-08-post-call-callback";
// A declined call requires a visible human follow-up; null due_at leaves it off
// calendar-based queues. One day sets a deadline without sending a message.
const FOLLOWUP_DUE_MS = 24 * 60 * 60 * 1000;

async function createFollowupTaskOnce(db, { orgId, clientId, eventId, isCallback = false }) {
  const sourceWorkflow = isCallback ? CALLBACK_WORKFLOW : SOURCE_WORKFLOW;
  const dup = await db.query(
    `SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3 AND org_id = $4`,
    [clientId, sourceWorkflow, eventId, orgId]
  );
  if (dup.rows[0]) return { created: false };
  return createTask(db, {
    orgId,
    clientId,
    title: isCallback ? "Client requested callback — follow up" : "Funding didn't buy — follow-up",
    sourceWorkflow,
    assigneeRole: "closer",
    eventId,
    dueAt: new Date(Date.now() + FOLLOWUP_DUE_MS).toISOString()
  });
}

export async function handle({ event, db, step }) {
  const payload = event.payload || {};
  const legacyDecline = payload.outcome === "declined";
  const closerDecline = payload.disposition === "closer" && payload.outcome === "not_a_fit";
  const closerCallback = payload.disposition === "closer" && payload.outcome === "callback";
  if ((!legacyDecline && !closerDecline && !closerCallback) || payload.repairReferral === true) {
    return { done: false, reason: "not_funding_decline" };
  }

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  // A callback is an open sales commitment, not a funding decline.
  if (!closerCallback) {
    await step.run("tag-funding-didnt-buy", () => addTags(db, clientId, ["offer:funding-didnt-buy"]));
  }
  const task = await step.run("create-followup-task", () => createFollowupTaskOnce(db, {
    orgId, clientId, eventId, isCallback: closerCallback
  }));

  return { done: true, task };
}

export const s08PostCallFundingDeclined = inngest.createFunction(
  { id: "s-08-post-call-funding-declined", name: "S-08 — Post-Call: Funding Didn't Buy" },
  { event: "call.completed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
