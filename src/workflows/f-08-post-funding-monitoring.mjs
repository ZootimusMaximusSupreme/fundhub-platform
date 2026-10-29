// F-08 — Post-Funding Monitoring (F23).
// Source: the CRM workflow b1dae8c5-8cca-4b0d-a29f-dcedaff796a8 (the CRM source-of-truth export).
// Audit fix applied (workflow-coherence-audit.md: "dangling wait with nothing after
// it. Remove or add follow-up") — the trailing no-op wait is simply not ported.
//
// Trigger: round.funded. Original "Add to Workflow -> N-04 Post-Funding Nurture" step
// needs no explicit enrollment call here — N-04 (src/workflows/n-04-post-funding-
// nurture.mjs) already listens on round.funded directly; both functions react to the
// same event independently. This file's own unique action is the 30-day check-in task.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
// This is downstream paid-fulfillment activity, never a new lead capture.
// Only already-existing clients owned by this event's org may be changed;
// resolveClient could patch an explicit foreign ID or mint an unknown email.
import { findClient } from "../handlers/purchase-routing.mjs";
import { createTask } from "../lib/create-task.mjs";

const SOURCE_WORKFLOW = "f-08-post-funding-monitoring";
const TASK_TITLE = "30-day check-in + prep for next wave";

async function createCheckinTask(db, { orgId, clientId, eventId }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await createTask(db, {
      orgId: orgId,
      clientId: clientId,
      title: TASK_TITLE,
      sourceWorkflow: SOURCE_WORKFLOW,
      assigneeRole: "funding_advisor",
      eventId: eventId
    });
  return { created: true };
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => findClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const task = await step.run("create-checkin-task", () => createCheckinTask(db, { orgId: event.orgId, clientId, eventId: event.id }));
  return { done: true, task };
}

export const f08PostFundingMonitoring = inngest.createFunction(
  { id: "f-08-post-funding-monitoring", name: "F-08 — Post-Funding Monitoring" },
  { event: "round.funded" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
