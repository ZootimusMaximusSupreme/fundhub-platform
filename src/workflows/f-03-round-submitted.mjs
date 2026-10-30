// F-03 — Round Submitted (F2/F4/F6...F20).
// Source: the CRM workflow 40fc2df8-ac2c-4c75-ae75-5ac598ecb95e (the CRM source-of-truth export).
// Audit fix applied (Spec §6 + workflow-coherence-audit.md "Ready-to-paste copy"):
// real, compliance-scrubbed SMS + email copy, not the blank/"test" original —
// seeded via src/workflows/templates-seed.mjs (SMS-F03-ROUND-SUBMITTED /
// EMAIL-F03-ROUND-SUBMITTED), opt-out included.
//
// Trigger: canonical round.submitted. Card Stacking requires an owned current
// nonterminal round AND a current round_submitted card before notifying a buyer.
// The event's roundNumber alone does not prove that its submission is current;
// legacy provider events without verifiable round identity remain explicitly
// unproved and retain their previous flow.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
// This is downstream paid-fulfillment activity, never a new lead capture.
// Only already-existing clients owned by this event's org may be changed;
// resolveClient could patch an explicit foreign ID or mint an unknown email.
import { findClient } from "../handlers/purchase-routing.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-F03-ROUND-SUBMITTED";
export const SMS_TEMPLATE_KEY = "SMS-F03-ROUND-SUBMITTED";

/**
 * A queued card-stacking round.submitted notice is only correct while the
 * exact current OWNED round is still at "round_submitted". The event's
 * roundNumber is a claim, not proof: delayed/replayed messages must not tell a
 * customer an older or already-funded round was just submitted, nor overwrite
 * the staff next action. Keep legacy provider events unchanged until they
 * supply an independently verifiable round identifier.
 */
export async function currentSubmittedCardStackingRound(db, { orgId, clientId, payload } = {}) {
  if (payload?.rail !== "card_stacking" && payload?.source !== "card_stacking") {
    return { ok: true, legacyUnverified: true };
  }
  const roundNumber = Number(payload?.roundNumber ?? payload?.round_number);
  if (!Number.isSafeInteger(roundNumber) || roundNumber < 1) {
    return { ok: false, reason: "invalid_round_number" };
  }
  const round = await db.query(
    `SELECT round_number, status FROM funding_rounds
       WHERE org_id = $1 AND client_id = $2
       ORDER BY round_number DESC LIMIT 1`,
    [orgId, clientId]
  );
  const current = round.rows[0];
  if (!current) return { ok: false, reason: "funding_round_not_found" };
  if (Number(current.round_number) !== roundNumber) {
    return { ok: false, reason: "stale_round_submission" };
  }
  if (["funded", "closed", "completed", "cancelled", "canceled"].includes(
    String(current.status || "").trim().toLowerCase()
  )) return { ok: false, reason: "round_terminal" };

  // A newer stage move can occur before this queued workflow wakes. The
  // card's current stage, not the old event's stage text, is authoritative.
  const card = await db.query(
    `SELECT ps.key AS stage_key FROM cards c
       JOIN pipelines p ON p.id = c.pipeline_id AND p.org_id = $2
       JOIN pipeline_stages ps
         ON ps.id = c.stage_id AND ps.pipeline_id = p.id AND ps.org_id = $2
      WHERE c.client_id = $1 AND c.org_id = $2
        AND p.key = 'funding_card_stacking' LIMIT 1`,
    [clientId, orgId]
  );
  if (card.rows[0]?.stage_key !== "round_submitted") {
    return { ok: false, reason: "card_not_submitted" };
  }
  return { ok: true, legacyUnverified: false };
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => findClient(db, event));
  if (!clientId) return { sent: false, reason: "no_client" };

  if (event.name && event.name !== "round.submitted") {
    return { sent: false, reason: "not_round_submitted" };
  }
  const roundNumber = event.payload?.roundNumber ?? event.payload?.round_number;
  if (roundNumber == null || String(roundNumber).trim() === "") {
    return { sent: false, reason: "no_round_number" };
  }
  if (!Number.isSafeInteger(Number(roundNumber)) || Number(roundNumber) < 1) {
    return { sent: false, reason: "invalid_round_number" };
  }

  const gate = await step.run("verify-current-submission", () =>
    currentSubmittedCardStackingRound(db, {
      orgId: event.orgId, clientId, payload: event.payload
    }));
  if (!gate.ok) return { sent: false, reason: gate.reason };

  const orgId = event.orgId;
  const eventId = event.id;
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));
  await step.run("set-next-action", () => mergeCustomFields(db, clientId, { employee_next_action: "Remove Inquiries" }));

  return { sent: true, email, sms };
}

export const f03RoundSubmitted = inngest.createFunction(
  { id: "f-03-round-submitted", name: "F-03 — Round Submitted" },
  { event: "round.submitted" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
