/* Inquiry removal cases — queue + clear/close actions. */

import { parseBureaus } from "../lenders/match.mjs";

export const CASE_STATUSES = Object.freeze([
  "Queued",
  "Scheduled",
  "In Progress",
  "Completed",
  "Escalated",
  "Blocked",
  "Canceled"
]);

const CASE_SET = new Set(CASE_STATUSES);
const ACTIVE = new Set(["Queued", "Scheduled", "In Progress", "Escalated", "Blocked"]);

function publicCase(row) {
  if (!row) return null;
  return {
    ...row,
    open_inquiry_count: row.open_inquiry_count != null ? Number(row.open_inquiry_count) : 0
  };
}

/**
 * The case queue, oldest first, with the size of the WHOLE queue beside it.
 *
 * Two things changed here on 2026-08-30, and they are the same bug seen twice:
 *
 *  1. ORDER BY was `requested_at DESC` — newest first. With a LIMIT, that means
 *     the rows dropped off the end are the OLDEST ones, which are exactly the
 *     cases the desk exists to clear. A worklist is worked top to bottom, so the
 *     top has to be the oldest.
 *  2. The screen counted its headline over whatever page it happened to get, so
 *     past the limit the number silently under-reported. `total` is COUNT(*) over
 *     the same WHERE clause, before LIMIT, so the screen can say plainly when it
 *     is showing a slice.
 *
 * Returns { cases, total }. Callers that only want rows read `.cases`.
 */
export async function listCases(db, {
  orgId,
  activeOnly = true,
  case_status = null,
  assigned_remover = null,
  clientId = null,
  limit = 100,
  offset = 0
} = {}) {
  const params = [orgId];
  const where = ["c.org_id = $1::uuid"];
  if (case_status && CASE_SET.has(case_status)) {
    params.push(case_status);
    where.push(`c.case_status = $${params.length}::inquiry_case_status`);
  } else if (activeOnly) {
    params.push([...ACTIVE]);
    where.push(`c.case_status::text = ANY($${params.length}::text[])`);
  }
  if (assigned_remover) {
    params.push(String(assigned_remover));
    where.push(`c.assigned_remover = $${params.length}`);
  }
  if (clientId) {
    params.push(clientId);
    where.push(`c.client_id = $${params.length}::uuid`);
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  params.push(Math.max(Number(offset) || 0, 0));
  const r = await db.query(
    `SELECT c.*,
            COUNT(*) OVER () AS queue_total,
            cl.first_name AS client_first_name,
            cl.last_name AS client_last_name,
            cl.email AS client_email,
            trim(both ' ' FROM concat_ws(' ', cl.first_name, cl.last_name)) AS client_name
       FROM inquiry_removal_cases c
       LEFT JOIN clients cl ON cl.id = c.client_id AND cl.org_id = c.org_id
         AND cl.custom_fields->>'crm_archived_at' IS NULL
      WHERE ${where.join(" AND ")}
        AND cl.id IS NOT NULL
      ORDER BY c.requested_at ASC NULLS LAST, c.created_at ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const rows = r.rows || [];
  /* No rows means no window to read a count from. That is honestly zero here —
     COUNT(*) OVER () counts the same WHERE clause, so an empty page from a
     zero-offset read IS an empty queue. */
  const total = rows.length ? Number(rows[0].queue_total) : 0;
  const cases = rows.map((row) => {
    const { queue_total, ...rest } = row;
    return publicCase(rest);
  });
  return { cases, total: Number.isFinite(total) ? total : cases.length };
}

export async function getActiveCaseForClient(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT *
       FROM inquiry_removal_cases
      WHERE org_id = $1::uuid
        AND client_id = $2::uuid
        AND case_status::text = ANY($3::text[])
        AND EXISTS (
          SELECT 1 FROM clients cl
           WHERE cl.id = inquiry_removal_cases.client_id
             AND cl.org_id = inquiry_removal_cases.org_id
             AND cl.custom_fields->>'crm_archived_at' IS NULL
        )
      ORDER BY requested_at DESC
      LIMIT 1`,
    [orgId, clientId, [...ACTIVE]]
  );
  return publicCase(r.rows[0] || null);
}

/* The bureaus a case is addressed to, as one comparable key. Empty string when
   the case names none — and an empty key never matches another empty one, see
   below. */
function bureauKeyOf(raw) {
  return [...new Set(parseBureaus(raw))].sort().join("+");
}

/* ── ONE CLIENT, ONE BUREAU, ONE OPEN CASE ────────────────────────────────
   Measured 2026-09-06 on the funding walkthrough client: four inquiries, SEVEN
   open cases. Three were made at 03:06 when the deposit was paid, before any
   funding round existed. Three MORE — the same three bureaus, exact duplicates
   — were made at 11:20 once a round did.

   Why: src/handlers/inquiry-gate.mjs looks for an existing case with
   `funding_round_id IS NOT DISTINCT FROM $5`. The first three carry a null
   round. The second trigger arrived carrying a round id, matched none of them,
   and made three fresh ones. If those had ever been sent, every bureau would
   have received the same dispute letter twice.

   Two open cases for the same client and the same bureau is never a real
   situation — it is two letters to one address. So the check lives HERE, at the
   one INSERT every path goes through, rather than in the caller that got its
   own lookup wrong. An existing open case is ADOPTED: it takes the funding
   round if it did not have one, and it is returned in place of a new row, so
   the caller's follow-up writes (letter draft, item count, status) land on the
   case that already exists.

   A case naming NO bureau is never adopted and never adopts. We cannot tell
   what such a case is for, and quietly folding one into another would be a
   guess. It gets its own row and is reported as the anomaly it is.

   NOTHING IS DELETED HERE and nothing is closed. This stops new duplicates; the
   ones already on the database are Chris's call. */
async function findOpenCaseForBureau(db, { orgId, clientId, bureauKey }) {
  if (!orgId || !clientId || !bureauKey) return null;
  const r = await db.query(
    `SELECT *
       FROM inquiry_removal_cases
      WHERE org_id = $1::uuid
        AND client_id = $2::uuid
        AND case_status::text = ANY($3::text[])
      ORDER BY requested_at ASC NULLS LAST, created_at ASC`,
    [orgId, clientId, [...ACTIVE]]
  );
  return (r.rows || []).find((c) => bureauKeyOf(c.selected_bureaus_raw) === bureauKey) || null;
}

export async function createCase(db, { orgId, row }) {
  const bureauKey = bureauKeyOf(row?.selected_bureaus_raw);
  const twin = await findOpenCaseForBureau(db, {
    orgId,
    clientId: row?.client_id,
    bureauKey
  });
  if (twin) {
    /* Adopting has to carry what the caller was going to put on the new row, or
       the second trigger becomes a no-op and the case keeps a stale item count.
       Three fields, each with its own rule:

         funding_round_id — taken only when the open case has none. A case
           already attached to a round is not moved to a different one here.
         open_inquiry_count — refreshed whenever the caller counted.
         case_status — moved ONLY between Queued and Blocked, which are the two
           the doc gate computes. A case that has already been sent is In
           Progress, and writing Queued over that would tell the desk to send a
           letter that is already in the mail. */
    const sets = ["updated_at = now()"];
    const params = [twin.id];
    if (row?.funding_round_id && !twin.funding_round_id) {
      params.push(row.funding_round_id);
      sets.push(`funding_round_id = $${params.length}::uuid`);
    }
    if (row?.open_inquiry_count != null) {
      params.push(Number(row.open_inquiry_count));
      sets.push(`open_inquiry_count = $${params.length}`);
    }
    const gateStatuses = ["Queued", "Blocked"];
    if (gateStatuses.includes(row?.case_status)
        && gateStatuses.includes(twin.case_status)
        && row.case_status !== twin.case_status) {
      params.push(row.case_status);
      sets.push(`case_status = $${params.length}::inquiry_case_status`);
    }
    const adopted = sets.length > 1
      ? (await db.query(
          `UPDATE inquiry_removal_cases
              SET ${sets.join(", ")}
            WHERE id = $1::uuid
            RETURNING *`,
          params
        )).rows[0] || twin
      : twin;
    return { ...publicCase(adopted), reused: true };
  }

  const caseId = String(row?.case_id || `IRC-${Date.now()}`).slice(0, 80);
  const status = CASE_SET.has(row?.case_status) ? row.case_status : "Queued";
  const r = await db.query(
    `INSERT INTO inquiry_removal_cases (
       org_id, client_id, funding_round_id, case_id, case_status,
       selected_bureaus_raw, ghl_contact_id, ai_call_scheduled_for,
       ai_call_status, request_source, requested_by, requested_at,
       assigned_remover, open_inquiry_count, master_call_state,
       hold_duration_display, remover_notes, inquiry_remover_user_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, $5::inquiry_case_status,
       $6, $7, $8,
       $9, $10, $11, COALESCE($12::timestamptz, now()),
       $13, COALESCE($14, 0), $15,
       $16, $17, $18
     ) RETURNING *`,
    [
      orgId,
      row.client_id,
      row.funding_round_id || null,
      caseId,
      status,
      row.selected_bureaus_raw || null,
      row.ghl_contact_id || null,
      row.ai_call_scheduled_for || null,
      row.ai_call_status || null,
      row.request_source || null,
      row.requested_by || null,
      row.requested_at || null,
      row.assigned_remover || null,
      row.open_inquiry_count != null ? Number(row.open_inquiry_count) : 0,
      row.master_call_state || null,
      row.hold_duration_display || null,
      row.remover_notes || null,
      row.inquiry_remover_user_id || null
    ]
  );
  return publicCase(r.rows[0]);
}

export async function updateCase(db, { orgId, id, patch }) {
  const sets = [];
  const params = [orgId, id];
  const writable = [
    "case_status", "selected_bureaus_raw", "ghl_contact_id",
    "ai_call_scheduled_for", "ai_call_status", "assigned_remover",
    "fraud_alert_after", "remover_notes", "inquiry_remover_user_id",
    "open_inquiry_count", "master_call_state", "hold_duration_display",
    "funding_round_id"
  ];
  for (const k of writable) {
    if (patch[k] === undefined) continue;
    if (k === "case_status" && !CASE_SET.has(patch[k])) continue;
    params.push(patch[k]);
    if (k === "case_status") sets.push(`case_status = $${params.length}::inquiry_case_status`);
    else if (k === "funding_round_id") sets.push(`funding_round_id = $${params.length}::uuid`);
    else if (k === "ai_call_scheduled_for") sets.push(`ai_call_scheduled_for = $${params.length}::timestamptz`);
    else sets.push(`${k} = $${params.length}`);
  }
  if (!sets.length) {
    const cur = await db.query(
      `SELECT * FROM inquiry_removal_cases WHERE org_id = $1::uuid AND id = $2::uuid`,
      [orgId, id]
    );
    return publicCase(cur.rows[0] || null);
  }
  const r = await db.query(
    `UPDATE inquiry_removal_cases
        SET ${sets.join(", ")}, updated_at = now()
      WHERE org_id = $1::uuid AND id = $2::uuid
      RETURNING *`,
    params
  );
  return publicCase(r.rows[0] || null);
}

/**
 * Mark case completed/cleared. Caller emits inquiry.removed on the bus.
 */
export async function closeCase(db, {
  orgId,
  id,
  case_status = "Completed",
  notes = null,
  staff = null
} = {}) {
  const status = CASE_SET.has(case_status) ? case_status : "Completed";
  const params = [orgId, id, status];
  let sql = `UPDATE inquiry_removal_cases
                SET case_status = $3::inquiry_case_status,
                    closed_at = COALESCE(closed_at, now()),
                    completed_at = CASE
                      WHEN $3::text = 'Completed' THEN COALESCE(completed_at, now())
                      ELSE completed_at
                    END,
                    updated_at = now()`;
  if (notes != null) {
    params.push(notes);
    sql += `, remover_notes = COALESCE(remover_notes || E'\\n', '') || $${params.length}`;
  }
  if (staff) {
    params.push(String(staff.id || staff.email || "").slice(0, 200));
    sql += `, inquiry_remover_user_id = COALESCE(inquiry_remover_user_id, $${params.length})`;
  }
  sql += ` WHERE org_id = $1::uuid AND id = $2::uuid RETURNING *`;
  const r = await db.query(sql, params);
  return publicCase(r.rows[0] || null);
}
