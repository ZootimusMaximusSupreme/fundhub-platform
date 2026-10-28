// F-01 — Funding Intake (F1).
// Source: the CRM workflow 2cc2c234-c7ff-4889-9501-b5f75c67b3c9 (the CRM source-of-truth export).
//
// Original trigger: "Opportunity Stage changes to Funding Pipeline -> F1 Funding
// Intake", gated on "Product Path = Funding". round.started is the canonical-spine
// event that puts a client into the Funding pipeline in the first place, so it's the
// trigger here; the gate uses src/config/product-path.mjs (Rule 4: route by name,
// never amount — outcome_tier is the closest existing categorical column to the CRM's
// "Product Path" field, logged in workflow-migration-table.md).
//
// POD-01B (auto pod/advisor lookup via an external `lookup_pod` webhook) has no
// adapter to call — merged into this file's existing "pod missing -> task" fallback
// rather than inventing a new adapter; see workflow-migration-table.md.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";

import { clientOutcomeTier, isFundingPath } from "../config/product-path.mjs";
import { findClient, purchasedCategories } from "../handlers/purchase-routing.mjs";
import { addTags } from "./tags.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { createTask } from "../lib/create-task.mjs";

const POD_TASK_SOURCE = "f-01-funding-intake";
const POD_TASK_TITLE = "Assign pod roles for funding client";
const POD_TASK_DUE_HOURS = 24; // Calendar hides undated tasks; paid intake has a 24-hour commitment.

async function podAssigned(db, clientId) {
  const r = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
  return Boolean(r.rows[0]?.custom_fields?.pod_name);
}

async function createPodTask(db, { orgId, clientId, eventId }) {
  const dup = await db.query(
    `SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`,
    [clientId, POD_TASK_SOURCE, eventId]
  );
  if (dup.rows[0]) return { created: false };
  await createTask(db, {
      orgId: orgId,
      clientId: clientId,
      title: POD_TASK_TITLE,
      sourceWorkflow: POD_TASK_SOURCE,
      assigneeRole: "funding_advisor",
      dueAt: new Date(Date.now() + POD_TASK_DUE_HOURS * 60 * 60 * 1000),
      eventId: eventId
    });
  return { created: true };
}

export async function handle({ event, db, step }) {
  // A payment/round can only start work for a pre-existing client in THIS org.
  // resolveClient would accept a foreign clientId and patch that customer before
  // checking ownership; it also creates phantom clients on unknown emails.
  const clientId = await step.run("find-owned-client", () => findClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const outcomeTier = await step.run("check-product-path", () => clientOutcomeTier(db, clientId));
  if (!isFundingPath(outcomeTier)) {
    // A stale credit recommendation cannot cancel work already purchased.
    // But an unpaid, repair-only manual move still must not open funding intake.
    const bought = await step.run("check-paid-funding", () =>
      purchasedCategories(db, event.orgId, clientId));
    if (!bought.funding) return { done: false, reason: `not_funding_path:${outcomeTier}` };
  }

  await step.run("tag-client-funding", () => addTags(db, clientId, ["client:funding"]));
  await step.run("set-lifecycle-status", () => mergeCustomFields(db, clientId, { lifecycle_status: "Funding Client" }));

  const hasPod = await step.run("check-pod-assigned", () => podAssigned(db, clientId));
  let podTask = { created: false };
  if (!hasPod) {
    await step.run("tag-ops-action-required", () => addTags(db, clientId, ["ops:action-required"]));
    podTask = await step.run("create-pod-task", () => createPodTask(db, { orgId: event.orgId, clientId, eventId: event.id }));
  }

  await step.run("set-next-action", () => mergeCustomFields(db, clientId, { employee_next_action: "Collect Documents" }));

  return { done: true, podTask };
}

export const f01FundingIntake = inngest.createFunction(
  { id: "f-01-funding-intake", name: "F-01 — Funding Intake" },
  { event: "round.started" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
