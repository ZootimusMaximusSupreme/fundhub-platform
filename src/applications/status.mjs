/* Application status transitions — always write application_decisions. */

import { APPLICATION_STATUS_SET } from "../lenders/tables.mjs";
import { toCents, fromCents } from "../commissions/money.mjs";
import { flagBilledFeeDrift } from "../funding/billed-fee-check.mjs";

export class ApplicationStatusError extends Error {
  constructor(message, { code = "application_status_error", status = 400 } = {}) {
    super(message);
    this.name = "ApplicationStatusError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Set application status and append an audit row. No silent status changes.
 *
 * @param {import("pg").Pool|object} db
 * @param {object} opts
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* The decisions a person makes by pressing a button. Each one is saved against the
   exact staff member (application_decisions.staff_id, migration 492), and the
   database refuses one without it. */
const STAFF_DECISIONS = new Set(["bank_decision", "approval_excluded", "approval_reinstated"]);

/** The staff member's id when it is a real id, else null. */
function staffIdOf(staff) {
  const id = staff && staff.id != null ? String(staff.id).trim() : "";
  return UUID_RE.test(id) ? id : null;
}

/** The name saved beside the id: name, else email, else id. */
function staffNameOf(staff) {
  return staff ? String(staff.name || staff.email || staff.id || "").trim().slice(0, 200) : "";
}

function requireDecisionStaff(staff, what) {
  if (!staffIdOf(staff) || !staffNameOf(staff)) {
    throw new ApplicationStatusError(
      `${what} is a decision that gets recorded against a person. No signed-in staff member, so nothing was saved.`,
      { code: "staff_required", status: 403 }
    );
  }
}

function cleanPlayName(playName) {
  const s = String(playName || "").trim();
  return s ? s.slice(0, 120) : null;
}

/**
 * A dollar amount a staff member typed -> the fixed 2dp string
 * applications.approved_amount (numeric(14,2)) wants.
 *
 * ABSENT IS UNKNOWN, NOT ZERO. Blank/undefined returns null, and the caller
 * must then leave the column alone rather than writing 0 over it — a zero says
 * the bank approved nothing, which is a different claim from "nobody has told
 * us yet" (docs/finance/CLOSEOUT-FEE-BASIS.md). Never let a missing amount become 0.
 *
 * Goes through integer cents so 450.10 cannot arrive as 450.09: toCents does
 * the rounding once, fromCents renders it back as dollars. Cents stay inside
 * this function — the column holds dollars.
 *
 * The browser validates first (public/app/money-input.js); this repeats it
 * because a handler must never trust what a client sent.
 */
export function normalizeApprovedAmount(value) {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (raw === "") return null;

  // Accept what people type: "$45,000", "45000.50", " 45000 ".
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new ApplicationStatusError(
      "approved_amount must be a dollar amount greater than zero, like 45000 or 45000.50",
      { code: "invalid_approved_amount" }
    );
  }
  let cents;
  try {
    cents = toCents(cleaned);
  } catch {
    throw new ApplicationStatusError(
      "approved_amount is out of range",
      { code: "invalid_approved_amount" }
    );
  }
  if (!(cents > 0)) {
    throw new ApplicationStatusError(
      "approved_amount must be greater than zero. If the bank approved nothing, that is a denial, not an approval.",
      { code: "invalid_approved_amount" }
    );
  }
  return fromCents(cents);
}

export async function setApplicationStatus(db, {
  orgId,
  applicationId,
  status,
  eventType = "status_change",
  staff = null,
  notes = null,
  playName = null,
  patch = null
} = {}) {
  const next = String(status || "").trim();
  if (!APPLICATION_STATUS_SET.has(next)) {
    throw new ApplicationStatusError(
      `status must be one of: ${[...APPLICATION_STATUS_SET].join(", ")}`,
      { code: "invalid_status" }
    );
  }
  const decisionType = String(eventType || "status_change").slice(0, 80);
  if (STAFF_DECISIONS.has(decisionType)) requireDecisionStaff(staff, "A bank answer");

  const sets = [
    "status = $3",
    "status_updated_date = now()",
    "updated_at = now()"
  ];
  const params = [orgId, applicationId, next];

  if (patch && typeof patch === "object") {
    for (const [k, v] of Object.entries(patch)) {
      if (![
        "lender_name", "product_name", "application_url", "lender_row_url",
        "requested_amount", "approved_amount", "condition_text", "bank",
        "submitted_date", "lender_id", "client_id"
      ].includes(k)) continue;
      params.push(v);
      if (k === "lender_id" || k === "client_id") {
        sets.push(`${k} = $${params.length}::uuid`);
      } else if (k === "submitted_date") {
        sets.push(`${k} = $${params.length}::date`);
      } else {
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (patch.lender_name != null && patch.bank === undefined) {
      params.push(patch.lender_name);
      sets.push(`bank = COALESCE(bank, $${params.length})`);
    }
  }

  const updated = await db.query(
    `UPDATE applications
        SET ${sets.join(", ")}
      WHERE org_id = $1::uuid AND id = $2::uuid
      RETURNING *`,
    params
  );
  const row = updated.rows[0];
  if (!row) {
    throw new ApplicationStatusError("application not found", {
      code: "not_found",
      status: 404
    });
  }

  // Sync legacy bank column from lender_name when status path sets name.
  if (row.lender_name && row.bank !== row.lender_name) {
    await db.query(
      `UPDATE applications SET bank = $2 WHERE id = $1 AND (bank IS NULL OR bank = '')`,
      [row.id, row.lender_name]
    );
  }

  await db.query(
    `INSERT INTO application_decisions (
       org_id, application_id, event_type, status, lender_table, decided_at, created_by, notes, play_name, staff_id
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4, $5::lender_table, now(), $6, $7, $8, $9::uuid
     )`,
    [
      orgId,
      row.id,
      decisionType,
      next,
      row.lender_table || null,
      staffNameOf(staff) || null,
      notes || null,
      cleanPlayName(playName),
      staffIdOf(staff)
    ]
  );

  // A bank answer that changes after the round was billed can leave the bill
  // disagreeing with the fee rule. Saved first, then a person is told (N7).
  await flagBilledFeeDrift(db, { orgId, application: row });

  return row;
}

/** Find or mint the application row for this client + lender, then stamp yes/no. */
export async function logBankDecision(db, {
  orgId,
  applicationId = null,
  clientId = null,
  lenderId = null,
  status,
  playName = null,
  staff = null,
  notes = null,
  approvedAmount = null
} = {}) {
  // Validate the money and the person BEFORE any row is created, so a bad
  // amount or a missing staff member cannot leave a half-made application behind.
  const approvedDollars = normalizeApprovedAmount(approvedAmount);
  requireDecisionStaff(staff, "A bank answer");
  let appId = applicationId;
  if (!appId) {
    if (!clientId || !lenderId) {
      throw new ApplicationStatusError(
        "application_id or client_id + lender_id is required",
        { code: "application_id required" }
      );
    }
    /* THE ANSWER BELONGS TO THIS ROUND. We bill per round, and a funding sequence
       has about six of them, often at the same banks. The lookup used to take the
       newest row for this client and bank from ANY round, so a round-2 "Bank yes"
       and its amount landed on the round-1 application: round 2 billed nothing for
       it and round 1's settled bill moved. Now the row is looked for on the
       client's current round (the newest one) only, and made there when missing. */
    const current = await db.query(
      `SELECT id FROM funding_rounds
        WHERE org_id = $1::uuid AND client_id = $2::uuid
        ORDER BY round_number DESC LIMIT 1`,
      [orgId, clientId]
    );
    const found = current.rows[0]
      ? await db.query(
        `SELECT id FROM applications
          WHERE org_id = $1::uuid AND client_id = $2::uuid AND lender_id = $3::uuid
            AND funding_round_id = $4::uuid
          ORDER BY updated_at DESC LIMIT 1`,
        [orgId, clientId, lenderId, current.rows[0].id]
      )
      : { rows: [] };
    if (found.rows[0]) {
      appId = found.rows[0].id;
    } else {
      const lender = await db.query(
        `SELECT id, name, product_name, application_url, lender_table
           FROM lenders WHERE org_id = $1::uuid AND id = $2::uuid`,
        [orgId, lenderId]
      );
      const L = lender.rows[0];
      if (!L) {
        throw new ApplicationStatusError("lender not found", {
          code: "lender_not_found",
          status: 404
        });
      }
      let round = current;
      if (!round.rows[0]) {
        round = await db.query(
          `INSERT INTO funding_rounds (org_id, client_id, round_number, status, product)
           VALUES ($1::uuid, $2::uuid, 1, 'open', 'card_stacking')
           RETURNING id`,
          [orgId, clientId]
        );
      }
      const created = await db.query(
        `INSERT INTO applications (
           org_id, funding_round_id, client_id, lender_id, bank, lender_name,
           product_name, application_url, lender_table, status
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9::lender_table, 'Apply'
         ) RETURNING id`,
        [
          orgId,
          round.rows[0].id,
          clientId,
          lenderId,
          L.name || null,
          L.name || null,
          L.product_name || null,
          L.application_url || null,
          L.lender_table || null
        ]
      );
      appId = created.rows[0].id;
    }
  }

  return setApplicationStatus(db, {
    orgId,
    applicationId: appId,
    status,
    eventType: "bank_decision",
    staff,
    notes,
    playName,
    // null means "not told" — no patch key, so the column keeps what it had.
    patch: approvedDollars != null ? { approved_amount: approvedDollars } : null
  });
}

/**
 * Record that a bank approval DOES NOT COUNT toward this round — or put it back.
 *
 * WHY THIS EXISTS. A round can no longer be marked Funded while any approval on
 * it has no dollar amount (guardFundedAmount, src/funding/card-stacking-rounds.mjs),
 * because we bill a percent of the approvals that carry an amount and a blank
 * one is never invoiced. But some approvals are never going to have an amount:
 * the bank said yes and the client never used the card, or the approval was
 * withdrawn. Without this, one dead row holds a round open forever.
 *
 * IT IS NOT A DENIAL, AND IT MUST NEVER LOOK LIKE ONE. applications.status is
 * what the BANK said, and it is left exactly as it was — 'Approved'. The bank
 * did approve. src/plays/outcomes.mjs reads approval-vs-denial off that column
 * ('Approved' → yes, 'Denied' → no), so writing 'Denied' here would invert the
 * approval rate, and a third status would delete the yes from the report
 * altogether. What we decided to do about the approval is a different fact, and
 * it lives in its own columns (migration 272).
 *
 * WHO AND WHEN ARE THE POINT. This is a decision somebody makes, so it is
 * refused without a staff member to put against it, and it appends an
 * application_decisions row exactly as every status change does — the same
 * audit trail, a different event_type. That row carries status NULL on purpose:
 * an exclusion is not a bank outcome, and listOutcomesForLaterPlays reads
 * `status IN ('Approved','Denied')`, so a NULL keeps it out of the bank yes/no
 * history instead of showing up there as a second, phantom approval.
 *
 * THE AMOUNT IS NEVER TOUCHED. approved_amount keeps its NULL. "We are not
 * billing for this" is not a claim that the bank approved nothing — that claim
 * is a zero, and it is refused on the way in (normalizeApprovedAmount).
 */
export async function setApprovalExclusion(db, {
  orgId,
  applicationId,
  excluded = true,
  reason = null,
  staff = null
} = {}) {
  requireDecisionStaff(staff, excluded ? "Excluding an approval" : "Counting an approval again");
  const who = staffNameOf(staff);

  /* The reason is the record. "Doesn't count" takes an approval off the bill and
     "Count again" puts it back, so both say why, in the person's own words. A
     filler sentence used to stand in when none was sent, which made a record with
     no reason look complete. */
  const cleanReason = reason == null ? null : String(reason).trim().slice(0, 500) || null;
  if (!cleanReason) {
    throw new ApplicationStatusError(
      excluded
        ? "Say why this approval does not count. Nothing was changed."
        : "Say why this approval counts again. Nothing was changed.",
      { code: "reason_required" }
    );
  }

  const current = await db.query(
    `SELECT id, status, approval_excluded_at
       FROM applications
      WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, applicationId]
  );
  const app = current.rows[0];
  if (!app) {
    throw new ApplicationStatusError("application not found", {
      code: "not_found",
      status: 404
    });
  }

  /* Only a bank YES can be excluded. Excluding a denial or an application still
     in flight would mean nothing, and quietly accepting it would hide whichever
     bug sent it. */
  if (excluded && String(app.status || "") !== "Approved") {
    throw new ApplicationStatusError(
      `Only an approved application can be marked as not counting. This one is "${app.status || "not set"}".`,
      { code: "not_approved" }
    );
  }

  const updated = await db.query(
    excluded
      ? `UPDATE applications
            SET approval_excluded_at = now(),
                approval_excluded_by = $3,
                approval_exclusion_reason = $4,
                updated_at = now()
          WHERE org_id = $1::uuid AND id = $2::uuid
          RETURNING *`
      : `UPDATE applications
            SET approval_excluded_at = NULL,
                approval_excluded_by = NULL,
                approval_exclusion_reason = NULL,
                updated_at = now()
          WHERE org_id = $1::uuid AND id = $2::uuid
          RETURNING *`,
    excluded ? [orgId, applicationId, who, cleanReason] : [orgId, applicationId]
  );
  const row = updated.rows[0];

  await db.query(
    `INSERT INTO application_decisions (
       org_id, application_id, event_type, status, lender_table, decided_at, created_by, notes, staff_id
     ) VALUES (
       $1::uuid, $2::uuid, $3, NULL, $4::lender_table, now(), $5, $6, $7::uuid
     )`,
    [
      orgId,
      row.id,
      excluded ? "approval_excluded" : "approval_reinstated",
      row.lender_table || null,
      who,
      cleanReason,
      staffIdOf(staff)
    ]
  );

  // Excluding or putting back an approval moves the fee basis too (N7).
  await flagBilledFeeDrift(db, { orgId, application: row });

  return row;
}

export async function listApplicationDecisions(db, { orgId, applicationId, limit = 50 }) {
  const r = await db.query(
    `SELECT *
       FROM application_decisions
      WHERE org_id = $1::uuid AND application_id = $2::uuid
      ORDER BY decided_at DESC
      LIMIT $3`,
    [orgId, applicationId, Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );
  return r.rows;
}

/** Latest named plays for a client's bank yes/no rows. Newest first. */
export async function listClientDecisionPlays(db, { orgId, clientId, limit = 50 }) {
  const r = await db.query(
    `SELECT d.play_name, d.status, d.decided_at, d.application_id,
            a.lender_id, a.lender_name
       FROM application_decisions d
       JOIN applications a ON a.id = d.application_id AND a.org_id = d.org_id
      WHERE d.org_id = $1::uuid
        AND a.client_id = $2::uuid
        AND d.play_name IS NOT NULL
        AND btrim(d.play_name) <> ''
      ORDER BY d.decided_at DESC
      LIMIT $3`,
    [orgId, clientId, Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );
  return r.rows;
}

/**
 * Every application on a client's file, with the one fact the fulfillment team
 * has to chase afterwards: how much the bank approved.
 *
 * WHY THIS EXISTS. An approved amount is OPTIONAL on a "Bank yes" (owner-set
 * 2026-08-29): when a bank comes back, the funding advisor very often does not
 * know the limit yet and has to ask the client or wait for the bank's approval
 * email. "Approved, amount unknown" is a real state. It only stays honest if
 * the screen can read the approval back — to show what was already saved, to
 * let the amount be filled in later, and to say out loud which approvals are
 * still waiting on one.
 *
 * listClientDecisionPlays above cannot answer any of that. It reads
 * application_decisions, throws away every row with no play name, and the
 * amount does not live on that table at all. This reads the applications rows
 * themselves, which is where approved_amount is.
 *
 * NULL SURVIVES. approved_amount comes back exactly as the column holds it —
 * null when nobody has said, a dollar string when they have. Never coalesced
 * to 0: a zero is a claim that the bank approved nothing, and unknown is not
 * nothing.
 *
 * The three approval_excluded_* columns ride along so the screen can tell the
 * difference between an approval still waiting on its amount and one somebody
 * has recorded as not counting — and can show who did that, and undo it.
 */
export async function listClientApplications(db, { orgId, clientId, limit = 200 }) {
  const r = await db.query(
    `SELECT id, lender_id, lender_name, bank, status, approved_amount, updated_at,
            approval_excluded_at, approval_excluded_by, approval_exclusion_reason
       FROM applications
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY updated_at DESC
      LIMIT $3`,
    [orgId, clientId, Math.min(Math.max(Number(limit) || 200, 1), 500)]
  );
  return r.rows;
}
