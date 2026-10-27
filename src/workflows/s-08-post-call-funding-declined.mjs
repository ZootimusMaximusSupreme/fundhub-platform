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

async function createFollowupTaskOnce(db, { orgId, clientId, eventId }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await createTask(db, {
      orgId: orgId,
      clientId: clientId,
      title: "Funding didn't buy — follow-up",
      sourceWorkflow: SOURCE_WORKFLOW,
      assigneeRole: "closer",
      eventId: eventId
    });
  return { created: true };
}

export async function handle({ event, db, step }) {
  const payload = event.payload || {};
  const legacyDecline = payload.outcome === "declined";
  const closerDecline = payload.disposition === "closer" && payload.outcome === "not_a_fit";
  if ((!legacyDecline && !closerDecline) || payload.repairReferral === true) {
    return { done: false, reason: "not_funding_decline" };
  }

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  await step.run("tag-funding-didnt-buy", () => addTags(db, clientId, ["offer:funding-didnt-buy"]));
  const task = await step.run("create-followup-task", () => createFollowupTaskOnce(db, { orgId, clientId, eventId }));

  return { done: true, task };
}

export const s08PostCallFundingDeclined = inngest.createFunction(
  { id: "s-08-post-call-funding-declined", name: "S-08 — Post-Call: Funding Didn't Buy" },
  { event: "call.completed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
