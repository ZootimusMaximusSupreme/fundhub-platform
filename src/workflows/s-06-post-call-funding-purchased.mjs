// S-06 — Post-Call Outcome: Funding Purchased.
// Source: the CRM system map SALES WORKFLOWS section.
// Trigger: deposit.paid — the verified funding-deposit signal (Chris-confirmed 2026-07-27;
// sale.closed is the DIY downsell, not funding). Payment, not the earlier CRS
// outcome_tier recommendation, establishes the customer-to-funding handoff.
// Marks the sale-side commitment; F-01 (Funding Intake) handles the funding-ops-side
// kickoff later, when round.started fires — these are sequential, not duplicated.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";

import { findClient, purchasedCategories } from "../handlers/purchase-routing.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags, removeTags } from "./tags.mjs";
import { createTask } from "../lib/create-task.mjs";

const SOURCE_WORKFLOW = "s-06-post-call-funding-purchased";

/* The client is promised the round starts within 24 hours of paying, so that is
   the deadline on the work that starts it. A due date is also the difference
   between a task existing and a task being SEEN: the only screen that reads
   tasks (public/app/calendar.html) drops every row whose due_at is null, so the
   version of this task without one reached nobody. */
const INTAKE_DUE_HOURS = 24;

function dueInHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

async function createIntakeTaskOnce(db, { orgId, clientId, eventId }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await createTask(db, {
      orgId: orgId,
      clientId: clientId,
      title: "Funding intake — pull CRS",
      sourceWorkflow: SOURCE_WORKFLOW,
      // Fulfilment work, not sales work. Closers sell and close; funding
      // advisors deliver, and pulling the CRS is delivery.
      assigneeRole: "funding_advisor",
      dueAt: dueInHours(INTAKE_DUE_HOURS),
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

  // deposit.paid is the verified funding-deposit event, not a CRS recommendation.
  // A stale REPAIR_ONLY outcome must not strand a customer who already paid.
  const orgId = event.orgId;
  // Keep the repair lane visible when the same customer has also paid for repair.
  // Clearing that tag unconditionally hid the concurrent, still-owed program.
  const bought = await step.run("read-paid-product-paths", () =>
    purchasedCategories(db, orgId, clientId));
  // deposit.paid is a webhook signal, not by itself evidence of a completed
  // funding sale. Even a valid repair/Blueprint deposit must never open a
  // funding advisor task or overwrite the customer's product path.
  if (!bought.funding) {
    return { done: false, reason: "no_verified_funding_purchase" };
  }
  const eventId = event.id;
  await step.run("set-lifecycle-and-path", () => mergeCustomFields(db, clientId, { lifecycle_status: "Funding Client", product_path: "Funding", employee_next_action: "Pull CRS" }));
  await step.run("tag-client-funding", () => addTags(db, clientId, ["client:funding"]));
  if (!bought.repair) {
    await step.run("remove-client-repair-tag", () => removeTags(db, clientId, ["client:repair"]));
  }
  const task = await step.run("create-intake-task", () => createIntakeTaskOnce(db, { orgId, clientId, eventId }));

  return { done: true, task };
}

export const s06PostCallFundingPurchased = inngest.createFunction(
  { id: "s-06-post-call-funding-purchased", name: "S-06 — Post-Call Outcome: Funding Purchased" },
  { event: "deposit.paid" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
