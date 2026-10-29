// N-06 — Renewal / Second-Wave Funding.
// Source: the CRM workflow 61b70897-fbf8-47e2-ae09-ea51a4af0279 (the CRM source-of-truth export).
// Ports the live definition. Audit fix applied (workflow-coherence-audit.md: "N-06 /
// AR-03 (AGENT DRAFT) — SMS step dropped vs the DECOM version — re-add"): the SMS
// send is present below, unlike the AGENT DRAFT copy.
//
// Original the CRM trigger was "Daily Scheduler", gated on "Funding Locked Date older
// than 6 months AND tag client:funding present" — a nightly table scan, which is
// exactly the polling this port isn't allowed to do. Converted to event + durable
// wait instead: trigger once off round.funded, step.sleep 6 months, then re-check
// eligibility at wake time (clients.funded still true — the closest existing typed
// column to "Funding Locked Date"/"tag client:funding"; there's no funding-locked-
// date column to check against directly). No new canonical event, no cron.
//
// SMS copy is confirmed missing in the CRM (Chris's tracking note). Wired but gated on a
// template existing.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
// Post-funding messaging is never a signup, and must not patch an unknown
// or cross-tenant event client. Only resolve a pre-existing owned client.
import { findClient } from "../handlers/purchase-routing.mjs";
import { sendTemplated } from "./messaging.mjs";
import { createTask } from "../lib/create-task.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-N06-RENEWAL";
export const SMS_TEMPLATE_KEY = "SMS-N06-RENEWAL";
export const SOURCE_WORKFLOW = "n-06-renewal";
const TASK_TITLE = "Second wave funding — outreach + prep next round";

// clients.funded is a schema column but nothing writes it. Real "funded" signal is
// a funding_rounds row with funded_amount > 0 (written when a round is closed/funded).
async function isStillFundingClient(db, clientId) {
  const r = await db.query(
    `SELECT 1 FROM funding_rounds WHERE client_id = $1 AND funded_amount > 0 LIMIT 1`,
    [clientId]
  );
  return Boolean(r.rows[0]);
}

async function createRenewalTask(db, { orgId, clientId, eventId }) {
  const dup = await db.query(
    `SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`,
    [clientId, SOURCE_WORKFLOW, eventId]
  );
  if (dup.rows[0]) return { created: false, reason: "duplicate" };
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

// handle — pure business logic, directly testable. In production the 6-month sleep
// happens inside step.sleep before this runs its post-wait half; tests call handle()
// already "post-wait" since fakeStep().sleep is a no-op.
export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => findClient(db, event));
  if (!clientId) return { sent: false, reason: "no_client" };

  await step.sleep("wait-6-months", "180d");

  const stillEligible = await step.run("check-still-funding-client", () => isStillFundingClient(db, clientId));
  if (!stillEligible) return { sent: false, reason: "no_longer_funding_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  const task = await step.run("create-renewal-task", () => createRenewalTask(db, { orgId, clientId, eventId }));
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));

  return { sent: true, task, email, sms };
}

export const n06RenewalSecondWave = inngest.createFunction(
  { id: "n-06-renewal-second-wave", name: "N-06 — Renewal / Second-Wave Funding" },
  { event: "round.funded" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
