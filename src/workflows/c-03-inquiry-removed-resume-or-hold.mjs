// C-03 — Inquiry Removed -> Resume or Hold (Fraud Alert Gate).
// Source: the CRM system map CREDIT OPS WORKFLOWS section.
// Trigger: inquiry.removed (exact canonical match). Gate: fraud alert present in
// the payload (from whatever fraud-screening step runs during removal).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags, removeTags } from "./tags.mjs";
import { createTask } from "../lib/create-task.mjs";
import { loadActiveCasesForClient } from "../inquiry-ops/gate.mjs";
import { sensitiveBureaus } from "../lenders/match.mjs";
import { isBlockingFundingHold } from "../inquiry-ops/doc-gate.mjs";
import { assignFundingAdvisor } from "../funding/assign-advisor.mjs";

const SOURCE_WORKFLOW = "c-03-inquiry-removed-resume-or-hold";

async function boughtFunding(db, orgId, clientId) {
  // Match purchase-routing's active, net-paid funding category without loading
  // its payment event handlers into this Inngest workflow.
  const r = await db.query(
    `SELECT 1 FROM sales s
       JOIN products pr ON pr.id = s.product_id
      WHERE s.org_id = $1 AND s.client_id = $2
        AND s.status = 'active' AND pr.category = 'funding'
        AND EXISTS (
          SELECT 1 FROM sale_payments sp
           WHERE sp.org_id = s.org_id AND sp.sale_id = s.id
           GROUP BY sp.sale_id
          HAVING COALESCE(SUM(CASE
            WHEN sp.kind IN ('deposit', 'installment') THEN sp.amount
            WHEN sp.kind = 'refund' THEN -sp.amount
            ELSE 0 END), 0) > 0
        ) LIMIT 1`,
    [orgId, clientId]
  );
  return r.rows.length > 0;
}

async function createTaskOnce(db, { orgId, clientId, eventId, title, assigneeRole = "inquiry_specialist", assigneeStaffId = null }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await createTask(db, {
      orgId: orgId,
      clientId: clientId,
      title: title,
      sourceWorkflow: SOURCE_WORKFLOW,
      assigneeRole,
      assigneeStaffId,
      eventId: eventId
    });
  return { created: true };
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  const client = await step.run("read-current-holds", async () => {
    const r = await db.query(`SELECT custom_fields, tags FROM clients WHERE id = $1 AND org_id = $2`, [clientId, orgId]);
    return r.rows[0] || { custom_fields: {}, tags: [] };
  });
  const fields = client.custom_fields || {};
  const tags = client.tags || [];

  if (event.payload?.fraudAlert) {
    await step.run("set-fraud-hold", () => mergeCustomFields(db, clientId, {
      ready_for_next_round: false,
      ...(isBlockingFundingHold(fields.round_hold_reason) ? {} : { round_hold_reason: "Fraud Alert" }),
      employee_next_action: "Clear Fraud Alert"
    }));
    await step.run("tag-fraud-alert", () => addTags(db, clientId, ["fraud:alert-present"]));
    const task = await step.run("create-fraud-task", () => createTaskOnce(db, { orgId, clientId, eventId, title: "Fraud alert present — clear before resuming" }));
    return { done: true, branch: "fraud_hold", task };
  }

  const cases = await step.run("read-active-cases", () => loadActiveCasesForClient(db, { orgId, clientId }));
  const inquiries = await step.run("read-inquiry-log", async () => {
    const r = await db.query(
      `SELECT bureau, status, created_at, is_open FROM inquiry_log
        WHERE org_id = $1::uuid AND client_id = $2::uuid`,
      [orgId, clientId]
    );
    return r.rows;
  });
  const fraudCases = await step.run("read-fraud-cases", async () => {
    const r = await db.query(
      `SELECT 1 FROM inquiry_removal_cases
        WHERE org_id = $1::uuid AND client_id = $2::uuid
          AND NULLIF(btrim(fraud_alert_after), '') IS NOT NULL LIMIT 1`,
      [orgId, clientId]
    );
    return r.rows.length > 0;
  });
  if (fraudCases || tags.includes("fraud:alert-present") || fields.round_hold_reason === "Fraud Alert") {
    await step.run("keep-fraud-hold", () => mergeCustomFields(db, clientId, { ready_for_next_round: false }));
    return { done: true, branch: "fraud_hold" };
  }
  if (cases.length || inquiries.some((row) => row.is_open === true)) {
    await step.run("keep-inquiry-pending", () => mergeCustomFields(db, clientId, { ready_for_next_round: false }));
    return { done: true, branch: "inquiries_pending" };
  }

  await step.run("clear-inquiry-pending", () => removeTags(db, clientId, ["inquiry:pending"]));
  await step.run("tag-inquiry-completed", () => addTags(db, clientId, ["inquiry:completed"]));
  if (fields.round_hold_reason === "New Inquiries") {
    await step.run("clear-inquiry-hold", () => mergeCustomFields(db, clientId, { round_hold_reason: null }));
  }
  if (fields.round_hold_reason && fields.round_hold_reason !== "New Inquiries") {
    await step.run("keep-other-hold", () => mergeCustomFields(db, clientId, { ready_for_next_round: false }));
    return { done: true, branch: "other_hold" };
  }
  const protectedBureaus = sensitiveBureaus(inquiries, { cases });
  if (["EX", "EQ", "TU"].every((bureau) => protectedBureaus.has(bureau))) {
    await step.run("keep-recent-inquiry-gate", () => mergeCustomFields(db, clientId, { ready_for_next_round: false }));
    return { done: true, branch: "recent_inquiry_gate" };
  }
  const paidFunding = await step.run("read-paid-funding", () => boughtFunding(db, orgId, clientId));
  if (!paidFunding) {
    await step.run("keep-unpaid-file-unready", () => mergeCustomFields(db, clientId, { ready_for_next_round: false }));
    return { done: true, branch: "inquiry_done" };
  }

  const advisor = await step.run("assign-funding-advisor", () =>
    assignFundingAdvisor(db, { orgId, clientId }));
  if (!advisor.staffId) {
    await step.run("keep-unassigned-file-unready", () => mergeCustomFields(db, clientId, {
      ready_for_next_round: false, employee_next_action: "Assign Funding Advisor"
    }));
    const task = await step.run("create-unassigned-funding-task", () => createTaskOnce(db, {
      orgId, clientId, eventId, title: "Claim funding file and review clean bureaus",
      assigneeRole: "funding_advisor"
    }));
    return { done: true, branch: "advisor_unassigned", advisor, task };
  }
  await step.run("set-ready-for-next-round", () => mergeCustomFields(db, clientId, { ready_for_next_round: true, employee_next_action: "Apply for Funding" }));
  await step.run("close-unassigned-funding-task", () => db.query(
    `UPDATE tasks SET done = true, updated_at = now()
      WHERE org_id = $1::uuid AND client_id = $2::uuid
        AND source_workflow = $3 AND title = 'Claim funding file and review clean bureaus'
        AND done = false`, [orgId, clientId, SOURCE_WORKFLOW]
  ));
  const task = await step.run("create-next-round-task", () => createTaskOnce(db, {
    orgId, clientId, eventId, title: "Start next funding round — check clean bureaus",
    assigneeRole: "funding_advisor", assigneeStaffId: advisor.staffId
  }));
  return { done: true, branch: "resume", task, advisor, protectedBureaus: [...protectedBureaus] };
}

export const c03InquiryRemovedResumeOrHold = inngest.createFunction(
  { id: "c-03-inquiry-removed-resume-or-hold", name: "C-03 — Inquiry Removed" },
  { event: "inquiry.removed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
