// F-05 — Inquiry Cleanup Gate (Between Rounds).
// Trigger: round.approved. This is a downstream funding event, NOT a signup:
// it must never create a client or change another tenant's inquiry file.
//
// The previous UPDATE selected by client_id alone and rewrote *every* status
// except "Removed" / "Pending Removal". That could reopen a confirmed/cleared
// inquiry and, on an inconsistent cross-org row, modify another tenant's data.
// Preserve the inquiry's independent closure evidence (is_open/confirmed_at).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";

/** The approved round can only act on a client that ALREADY exists in its org.
 * Never call resolveClient here: its email fallback creates customer records,
 * and an explicit clientId can patch contact data before checking the org. */
export async function existingRoundClient(db, event) {
  if (!db?.query || !event?.orgId) return null;
  if (event.clientId) {
    const result = await db.query(
      `SELECT id FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [event.clientId, event.orgId]
    );
    return result.rows[0]?.id || null;
  }
  const email = String(event.payload?.email || "").trim().toLowerCase();
  if (!email) return null;
  const result = await db.query(
    `SELECT id FROM clients WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
    [event.orgId, email]
  );
  return result.rows[0]?.id || null;
}

/**
 * The card-stacking emitter includes a roundNumber. A delayed round.approved
 * event from an earlier round must not reopen inquiry cleanup after a new round
 * starts, and a fictitious round must not mutate a real client's file.
 *
 * Historical/non-card-stacking provider events may not identify a round; keep
 * their existing path rather than inferring an unrecorded round from a payload.
 * Only same-org, same-client, current recorded card-stacking rounds pass.
 */
export async function approvedCardStackingRound(db, { orgId, clientId, payload } = {}) {
  if (payload?.rail !== "card_stacking" && payload?.source !== "card_stacking") {
    return { ok: true };
  }
  const roundNumber = Number(payload?.roundNumber);
  if (!Number.isSafeInteger(roundNumber) || roundNumber < 1) {
    return { ok: false, reason: "invalid_round_number" };
  }
  const result = await db.query(
    `SELECT round_number, status FROM funding_rounds
       WHERE org_id = $1 AND client_id = $2
       ORDER BY round_number DESC LIMIT 1`,
    [orgId, clientId]
  );
  const current = result.rows[0];
  if (!current) return { ok: false, reason: "funding_round_not_found" };
  if (Number(current.round_number) !== roundNumber) {
    return { ok: false, reason: "stale_round_approval" };
  }
  // A late approval cannot reclassify inquiries after a round has finished.
  if (["funded", "closed", "completed", "cancelled", "canceled"].includes(
    String(current.status || "").toLowerCase()
  )) return { ok: false, reason: "round_terminal" };
  return { ok: true };
}

export async function markPendingRemoval(db, { orgId, clientId }) {
  const result = await db.query(
    `UPDATE inquiry_log
        SET status = 'Pending Removal'
      WHERE org_id = $1 AND client_id = $2
        AND status IS DISTINCT FROM 'Pending Removal'
        AND is_open = true
        AND confirmed_at IS NULL
        AND COALESCE(status, '') !~* '(^|[^[:alpha:]])(removed|confirmed|deleted|cleared)([^[:alpha:]]|$)'`,
    [orgId, clientId]
  );
  return { updated: result.rowCount ?? 0 };
}

export async function handle({ event, db, step }) {
  if (!event?.orgId) return { done: false, reason: "missing_org" };
  if (event.name && event.name !== "round.approved") {
    return { done: false, reason: "not_round_approved" };
  }
  const clientId = await step.run("resolve-existing-client", () => existingRoundClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };
  const gate = await step.run("verify-current-round", () =>
    approvedCardStackingRound(db, { orgId: event.orgId, clientId, payload: event.payload }));
  if (!gate.ok) return { done: false, reason: gate.reason };
  const result = await step.run("mark-pending-removal", () =>
    markPendingRemoval(db, { orgId: event.orgId, clientId }));
  return { done: true, ...result };
}

export const f05InquiryCleanupGate = inngest.createFunction(
  { id: "f-05-inquiry-cleanup-gate", name: "F-05 — Inquiry Cleanup Gate" },
  { event: "round.approved" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
