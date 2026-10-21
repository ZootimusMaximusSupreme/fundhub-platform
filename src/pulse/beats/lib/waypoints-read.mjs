// A client's checklist (client_waypoints): the read, the overdue rule, and how each step gets closed.
// ONE COPY (2026-10-20).
//
// The read and isOverdue used to live in src/waypoints/store.mjs; tickRefusal and closedBy in
// src/waypoints/self-attest.mjs. They moved here unchanged so the hourly beat client-progress builds the checklist
// the same way GET /api/read/client-progress does (a beat may import only from src/pulse/beats/lib). Both files
// import them back and re-export them. store.mjs keeps listWaypoints' id check and its WaypointError in front of
// listWaypointRows below. Read only.

/**
 * One client's checklist, in display order.
 * Returns rows exactly as stored — `overdue` is computed here rather than
 * stored, because it is a fact about the clock and the clock moves.
 */
export async function listWaypointRows(db, { orgId, clientId, now = new Date() } = {}) {
  const r = await db.query(
    `SELECT * FROM client_waypoints
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY position ASC, key ASC`,
    [orgId, clientId]
  );
  return (r.rows || []).map((row) => ({ ...row, overdue: isOverdue(row, now) }));
}

/**
 * Overdue is `due_at < now AND the row is still open`.
 *
 * NULL due_at is NOT overdue. It means nobody set a deadline (CLAUDE.md §12),
 * and treating unknown as breached would put a red flag on a client's screen
 * for a date that does not exist.
 */
export function isOverdue(row, now = new Date()) {
  if (!row || !row.due_at) return false;
  if (row.state === "done" || row.state === "skipped") return false;
  return new Date(row.due_at).getTime() < new Date(now).getTime();
}

/** Why a row may not be ticked by the client, or null when it may.
 *  Pure — takes a client_waypoints row. */
export function tickRefusal(row) {
  if (!row) return "not_found";
  if (row.owner_kind !== "client") return "our_step";
  const kind = row.verify_kind ?? null;
  if (kind === "paydown") return "closes_on_credit_report";
  if (kind === "no_new_credit") return "ongoing_rule";
  if (kind !== null) return "machine_checked";
  return null;
}

/** How a step gets closed, as a fact the progress page can draw.
 *  'client'         — the client ticks it.
 *  'credit_report'  — the next credit report closes it (paydown).
 *  'ongoing'        — a rule to keep; it is never ticked (no_new_credit).
 *  'fundhub'        — anything else: our step, or a machine check. */
export function closedBy(row) {
  const refusal = tickRefusal(row);
  if (refusal === null) return "client";
  if (refusal === "closes_on_credit_report") return "credit_report";
  if (refusal === "ongoing_rule") return "ongoing";
  return "fundhub";
}
