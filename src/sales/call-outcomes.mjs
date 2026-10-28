// call-outcomes — write and read closer dispositions.
//
// Cash collected is ALWAYS derived from a paid transaction row. The closer
// never types an amount. Unlogged calls are cal.com closer tasks whose due
// window has passed with no matching call_outcomes row.

import { toCents } from "../commissions/money.mjs";
import { emit } from "../events/bus.mjs";
import {
  BELIEF_LABELS,
  normalizeBelief,
  normalizeOutcome,
  OUTCOME_LABELS
} from "./beliefs.mjs";

export class CallOutcomeError extends Error {
  constructor(message, { status = 400, code = "bad_request" } = {}) {
    super(message);
    this.name = "CallOutcomeError";
    this.status = status;
    this.code = code;
  }
}

const PAID = `status IN ('paid','succeeded','complete','completed')`;

export async function paidTransactionForLink(db, {
  orgId, clientId, staffId, paymentLinkId, productCode
}) {
  if (!paymentLinkId || !productCode) return null;
  const paid = await db.query(
    `SELECT t.id FROM payment_links pl
     JOIN products p ON p.id = pl.product_id AND p.org_id = pl.org_id
     JOIN sale_payments sp ON sp.payment_link_id = pl.id AND sp.org_id = pl.org_id
     JOIN transactions t ON t.id = sp.transaction_id AND t.org_id = pl.org_id
     WHERE pl.id = $1 AND pl.org_id = $2 AND pl.client_id = $3
       AND pl.created_by_staff_id = $4 AND p.code = $5
       AND sp.kind = 'deposit' AND sp.amount > 0
       AND t.status IN ('paid','succeeded','complete','completed')
     ORDER BY sp.paid_at DESC LIMIT 1`,
    [paymentLinkId, orgId, clientId, staffId, productCode]
  );
  return paid.rows[0]?.id || null;
}

const CHECKLIST_KEYS = [
  "call_recorded",
  "personal_guarantee",
  "month_14_cliff",
  "bank_decides",
  "incorporation_verified"
];

function normalizeChecklist(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const k of CHECKLIST_KEYS) {
    out[k] = raw[k] === true;
  }
  return out;
}

/**
 * Resolve cash for a deposit/downsell from the transaction record.
 * Require an explicit transactionId. A different purchase by the same client
 * must never become cash for this call.
 */
export async function resolveCashCollected(db, {
  orgId, clientId, transactionId = null, outcome
}) {
  if (outcome !== "deposit" && outcome !== "downsell") {
    return { cashCollectedCents: 0, transactionId: null };
  }

  if (transactionId) {
    const r = await db.query(
      `SELECT id, amount_paid FROM transactions
        WHERE id = $1 AND org_id = $2 AND client_id = $3
          AND ${PAID}`,
      [transactionId, orgId, clientId]
    );
    const row = r.rows[0];
    if (!row) {
      throw new CallOutcomeError(
        "That payment was not found for this client.",
        { status: 404, code: "transaction_not_found" }
      );
    }
    return { cashCollectedCents: toCents(row.amount_paid), transactionId: row.id };
  }

  return { cashCollectedCents: 0, transactionId: null };
}

/**
 * Log a disposition. Mandatory fields: orgId, clientId, staffId, outcome.
 * beliefFailed optional (null = none). Cash never accepted from the caller.
 */
export async function logCallOutcome(db, input) {
  const {
    orgId,
    clientId,
    staffId,
    taskId = null,
    bookingRef = null,
    outcome: rawOutcome,
    beliefFailed: rawBelief = null,
    transactionId = null,
    recordingUrl = null,
    durationSeconds = null,
    notes = null,
    checklist = null,
    offerKey: rawOfferKey = null,
    repairReferral = false
  } = input || {};

  if (!orgId) throw new CallOutcomeError("orgId is required", { status: 403, code: "forbidden" });
  if (!staffId) throw new CallOutcomeError("staffId is required", { status: 401, code: "unauthorized" });
  if (!clientId) throw new CallOutcomeError("client_id is required");

  const outcome = normalizeOutcome(rawOutcome);
  if (!outcome) {
    throw new CallOutcomeError(
      "outcome must be deposit, downsell, callback, no_show, or not_a_fit"
    );
  }

  const beliefFailed = normalizeBelief(rawBelief);
  if (beliefFailed === undefined) {
    throw new CallOutcomeError(
      "belief_failed must be one of pain, doubt, cost, desire, money, support, trust, or none"
    );
  }

  const client = await db.query(
    `SELECT id, custom_fields FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  if (!client.rows[0]) {
    throw new CallOutcomeError("client not found", { status: 404, code: "not_found" });
  }

  const storedOffer = offerKeyFromCustomFields(client.rows[0].custom_fields);
  const offerKey = rawOfferKey || storedOffer || null;
  const isRepairReferral = repairReferral === true;

  // A same-company task can still belong to another customer. Never close it
  // or attach its outcome to this customer through a mismatched task ID.
  if (taskId) {
    const t = await db.query(
      `SELECT id FROM tasks WHERE id = $1 AND org_id = $2 AND client_id = $3`,
      [taskId, orgId, clientId]
    );
    if (!t.rows[0]) {
      throw new CallOutcomeError("task not found", { status: 404, code: "not_found" });
    }
  }

  if (taskId || bookingRef) {
    const existing = await db.query(
      `SELECT * FROM call_outcomes
        WHERE org_id = $1
          AND client_id = $4
          AND (
            ($2::uuid IS NOT NULL AND task_id = $2)
            OR ($3::text IS NOT NULL AND booking_ref = $3)
          )
        LIMIT 1`,
      [orgId, taskId, bookingRef, clientId]
    );
    if (existing.rows[0]) {
      await emitCloserCallCompleted(db, existing.rows[0], {
        offerKey, repairReferral: isRepairReferral
      });
      return { row: existing.rows[0], created: false };
    }
  }

  const cash = await resolveCashCollected(db, {
    orgId, clientId, transactionId, outcome
  });

  const checks = normalizeChecklist(checklist);
  let noteText = notes == null ? "" : String(notes);
  if (checks) {
    noteText = (noteText ? noteText + "\n" : "") + "checklist:" + JSON.stringify(checks);
  }
  noteText = noteText ? noteText.slice(0, 4000) : null;

  const res = await db.query(
    `INSERT INTO call_outcomes (
        org_id, client_id, staff_id, task_id, booking_ref,
        outcome, belief_failed, cash_collected_cents, transaction_id,
        recording_url, duration_seconds, notes
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,
        $10,$11,$12
      )
      RETURNING *`,
    [
      orgId, clientId, staffId, taskId, bookingRef || null,
      outcome, beliefFailed, cash.cashCollectedCents, cash.transactionId,
      recordingUrl || null,
      durationSeconds == null ? null : Number(durationSeconds),
      noteText
    ]
  );

  if (!res.rows[0]) {
    throw new CallOutcomeError("could not save the call outcome", { status: 500, code: "write_failed" });
  }

  if (taskId) {
    await db.query(
      `UPDATE tasks SET done = true, updated_at = now()
        WHERE id = $1 AND org_id = $2`,
      [taskId, orgId]
    );
  }

  await emitCloserCallCompleted(db, res.rows[0], {
    offerKey, repairReferral: isRepairReferral
  });

  return { row: res.rows[0], created: true };
}

function offerKeyFromCustomFields(raw) {
  const fields = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  const key = fields?.closer_deck_disposition?.offer_key;
  return key ? String(key) : null;
}

async function emitCloserCallCompleted(db, row, { offerKey, repairReferral }) {
  if (!row?.id) return;
  const clientId = row.client_id;
  const orgId = row.org_id;
  await emit(db, "call.completed", {
    clientId,
    orgId,
    outcome: row.outcome,
    offerKey: offerKey || null,
    disposition: "closer",
    repairReferral: repairReferral === true,
    declineReason: null,
    taskId: row.task_id || null,
    transactionId: row.transaction_id || null
  }, {
    orgId,
    clientId,
    idempotencyKey: `call.completed:closer:${row.id}`
  });
}

/* A booking task is found by its TITLE, not by a vendor name.

   This used to filter `source_workflow = 'calcom'`. That column held the string
   "calcom" on every booking task, including the 27 that actually arrived from
   ClickFunnels — measured live 2026-08-18: 27 clickfunnels booking.created
   events, 0 from Cal.com, ever. T7 corrected the column to record the real
   origin, which would have left this query hunting for a value that no longer
   exists and quietly returning nothing — an empty "calls you have not logged"
   list on Closer Call, My Numbers and Sales Floor, with real overdue calls in
   the table.

   The title is the stable key: src/handlers/comms.mjs writes every booking task
   as "Strategy session booked" / "…rescheduled" from one shared constant, and
   its own four lookups match on the same `Strategy session%` prefix. Matching a
   vendor label here was always coupling this screen to which company happened
   to send the webhook, which is not what "a closer owes a call outcome" means. */
const BOOKING_TASK_TITLE_LIKE = "Strategy session%";

/** Closer tasks past due with no disposition row. */
export async function listUnloggedCalls(db, { orgId, staffId = null, limit = 50 } = {}) {
  if (!orgId) throw new CallOutcomeError("orgId is required", { status: 403 });
  const params = [orgId];
  let staffClause = "";
  if (staffId) {
    params.push(staffId);
    staffClause = `AND (t.assignee_staff_id = $${params.length} OR t.assignee_staff_id IS NULL)`;
  }
  params.push(BOOKING_TASK_TITLE_LIKE);
  const titleParam = `$${params.length}`;
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));

  const r = await db.query(
    `SELECT t.id AS task_id,
            t.client_id,
            t.title,
            t.body AS booking_ref,
            t.due_at,
            t.meeting_url,
            t.assignee_staff_id,
            c.first_name,
            c.last_name,
            COALESCE(NULLIF(trim(c.first_name || ' ' || c.last_name), ''), c.email, 'Client') AS client_name
       FROM tasks t
       LEFT JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
       LEFT JOIN call_outcomes o ON o.task_id = t.id AND o.org_id = t.org_id
      WHERE t.org_id = $1
        AND t.assignee_role = 'closer'
        AND t.title LIKE ${titleParam}
        AND t.due_at IS NOT NULL
        AND t.due_at < now()
        AND o.id IS NULL
        ${staffClause}
      ORDER BY t.due_at ASC
      LIMIT $${params.length}`,
    params
  );
  return r.rows;
}

export async function countUnlogged(db, { orgId, staffId = null } = {}) {
  const rows = await listUnloggedCalls(db, { orgId, staffId, limit: 500 });
  return rows.length;
}

export function presentOutcome(row) {
  if (!row) return null;
  return {
    id: row.id,
    client_id: row.client_id,
    staff_id: row.staff_id,
    task_id: row.task_id,
    booking_ref: row.booking_ref,
    outcome: row.outcome,
    outcome_label: OUTCOME_LABELS[row.outcome] || row.outcome,
    belief_failed: row.belief_failed,
    belief_label: row.belief_failed ? (BELIEF_LABELS[row.belief_failed] || row.belief_failed) : null,
    cash_collected_cents: Number(row.cash_collected_cents) || 0,
    transaction_id: row.transaction_id,
    recording_url: row.recording_url,
    duration_seconds: row.duration_seconds,
    notes: row.notes,
    checklist: row.checklist || checklistFromNotes(row.notes),
    logged_at: row.logged_at
  };
}

function checklistFromNotes(notes) {
  if (!notes || typeof notes !== "string") return null;
  const i = notes.lastIndexOf("checklist:");
  if (i < 0) return null;
  try {
    return normalizeChecklist(JSON.parse(notes.slice(i + 10)));
  } catch (e) {
    return null;
  }
}

export async function createMarketingFlag(db, {
  orgId,
  staffId,
  belief: rawBelief,
  leadSource = null,
  setterLabel = null,
  outcomeCount = 0,
  periodStart,
  periodEnd,
  note = null
}) {
  if (!orgId) throw new CallOutcomeError("orgId is required", { status: 403 });
  if (!staffId) throw new CallOutcomeError("staffId is required", { status: 401 });
  const belief = normalizeBelief(rawBelief);
  if (!belief) {
    throw new CallOutcomeError("belief is required (pain, doubt, cost, desire, money, support, trust)");
  }
  if (!periodStart || !periodEnd) {
    throw new CallOutcomeError("period_start and period_end are required");
  }
  // A flag is a belief seen on real calls. With no calls behind it, or no lead source or
  // setter to route it by, it can never match a call, so it is refused instead of stored.
  if (
    !((Number(outcomeCount) || 0) > 0)
    || !String(leadSource ?? "").trim()
    || !String(setterLabel ?? "").trim()
  ) {
    throw new CallOutcomeError("There are no calls behind this belief yet, so there is nothing to flag.");
  }

  const r = await db.query(
    `INSERT INTO marketing_flags (
        org_id, flagged_by, belief, lead_source, setter_label,
        outcome_count, period_start, period_end, note
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
    [
      orgId, staffId, belief,
      leadSource || null, setterLabel || null,
      Math.max(0, Number(outcomeCount) || 0),
      periodStart, periodEnd,
      note == null ? null : String(note).slice(0, 2000)
    ]
  );
  return r.rows[0];
}
