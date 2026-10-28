// F-09 — Funding Declined / No Path.
// Source: the CRM workflow 2af6ed68-3661-4b3b-821f-5b4e49c0e52a (the CRM source-of-truth export).
//
// Original trigger was "Tag Added: funding:no-path" — an undocumented upstream
// assigner, same shape as N-01/02/03's tag problem. Here there's an actual concrete
// upstream signal already flowing through the system: F-11's Bank Email Event Router
// (src/workflows/f-11-bank-email-event-router.mjs) reacts to the same mail.response
// event and classifies DENIED bank replies. F-09 is that classification's deeper
// follow-through (ops flag + hold reason + review task) rather than F-11's bare
// "note it and exit" — so it reacts to the identical trigger: mail.response with
// classification === "DENIED". Gate: Product Path = Funding (src/config/product-path.mjs).
//
// DENIED mail opens a no-path review only when the current round has at least
// one tracked application and EVERY application is denied. Pin that round ID
// for the hold and review task; bank_inbox has no funding_round_id field.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { clientOutcomeTier, isFundingPath } from "../config/product-path.mjs";
import { addTags } from "./tags.mjs";
import { createTask } from "../lib/create-task.mjs";

const SOURCE_WORKFLOW = "f-09-funding-declined-no-path";
const TASK_TITLE = "Funding no-path decision";

// A DENIED email is not evidence that the customer has no funding path. Only
// documented applications in this organization's CURRENT round can prove that.
// An empty round, a missing round, or another organization's decision is UNKNOWN.
export async function denialDecision(db, { orgId, clientId } = {}) {
  if (!orgId || !clientId) return { ok: false, reason: "missing_ids", roundId: null };
  const roundRow = await db.query(
    `SELECT id FROM funding_rounds WHERE client_id = $1 AND org_id = $2
       ORDER BY round_number DESC LIMIT 1`,
    [clientId, orgId]
  );
  const roundId = roundRow.rows[0]?.id || null;
  if (!roundId) return { ok: false, reason: "no_funding_round", roundId: null };

  const apps = await db.query(
    `SELECT status FROM applications WHERE funding_round_id = $1 AND org_id = $2`,
    [roundId, orgId]
  );
  if (!apps.rows.length) return { ok: false, reason: "no_tracked_applications", roundId };
  if (!apps.rows.every((a) => a.status === "DENIED")) {
    return { ok: false, reason: "pending_applications", roundId };
  }
  return { ok: true, reason: null, roundId };
}

// Pin the reviewed round. A newer round may open while Inngest is processing
// the bank email; never put its hold on that newer round instead.
async function setRoundHoldReason(db, { orgId, clientId, roundId, reason }) {
  const r = await db.query(
    `UPDATE funding_rounds SET hold_reason = $2
       WHERE id = $1 AND org_id = $3 AND client_id = $4`,
    [roundId, reason, orgId, clientId]
  );
  return { updated: r.rowCount == null ? true : r.rowCount > 0, roundId };
}

// The no-path review is one task PER ROUND, not one for every distinct DENIED
// email the bank sends. F-11 separately creates per-email routing tasks.
async function createTaskOnce(db, { orgId, clientId, roundId }) {
  const dedupeKey = `no-path:${roundId}`;
  const dup = await db.query(
    `SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`,
    [clientId, SOURCE_WORKFLOW, dedupeKey]
  );
  if (dup.rows[0]) return { created: false };
  const task = await createTask(db, {
    orgId,
    clientId,
    title: TASK_TITLE,
    sourceWorkflow: SOURCE_WORKFLOW,
    assigneeRole: "funding_advisor",
    eventId: dedupeKey
  });
  return { created: task.created };
}

export async function handle({ event, db, step }) {
  if (event.payload?.classification !== "DENIED") return { done: false, reason: "not_denied" };

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const outcomeTier = await step.run("check-product-path", () => clientOutcomeTier(db, clientId));
  if (!isFundingPath(outcomeTier)) return { done: false, reason: `not_funding_path:${outcomeTier}` };

  const decision = await step.run("check-all-denied", () =>
    denialDecision(db, { orgId: event.orgId, clientId }));
  if (!decision.ok) return { done: false, reason: decision.reason };

  const round = await step.run("set-hold-reason", () =>
    setRoundHoldReason(db, {
      orgId: event.orgId, clientId, roundId: decision.roundId, reason: "Internal Review"
    }));
  if (!round.updated) return { done: false, reason: "round_missing_after_review" };

  await step.run("tag-ops-action-required", () => addTags(db, clientId, ["ops:action-required"]));
  const task = await step.run("create-task", () =>
    createTaskOnce(db, { orgId: event.orgId, clientId, roundId: decision.roundId }));

  return { done: true, round, task };
}

export const f09FundingDeclinedNoPath = inngest.createFunction(
  { id: "f-09-funding-declined-no-path", name: "F-09 — Funding Declined / No Path" },
  { event: "mail.response" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
