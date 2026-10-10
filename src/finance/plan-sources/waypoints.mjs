// Plan source: the client's own checklist (client_waypoints, migration 330).
//
// One pin per waypoint whose due date falls in the window. The rows are the
// Capital Blueprint / optimization checklist seeded on pay or on enrolment
// (src/waypoints/seed.mjs, src/waypoints/purchase.mjs) — nothing here creates,
// prices or re-dates a waypoint. A waypoint with no due date is not a pin: NULL
// means nobody set a deadline (db/migrations/330), and drawing it on a day would
// invent one. A skipped waypoint was taken off the list, so it is not a pin
// either.
//
// THE DATE is the UTC calendar day of due_at — the same day the progress page
// prints for that step (public/progress.html longDate reads the UTC date).
//
// STATUS:
//   done     state = 'done'
//   missed   overdue — due_at has passed and the row is still open
//            (src/waypoints/store.mjs isOverdue; NULL due_at is never overdue)
//   planned  everything else
//
// STAFF MARK — reuses the one completion path and its proof rules. A person
// may close only a step that nothing the platform can see closes
// (verify_kind IS NULL — src/waypoints/verify.mjs header; the same test
// src/waypoints/self-attest.mjs tickRefusal makes). A paydown step closes only
// on a credit re-pull, no-new-credit never closes, and any other machine check
// owns its own row: each is refused with the reason self-attest.mjs already
// words. Unlike a client, staff may close a step that is Fundhub's own job
// (owner_kind 'fundhub') — a client cannot vouch for our step, a staff member
// can. The write is completeWaypoint() (src/waypoints/store.mjs), which writes
// state and completed_at together for the CHECK in 330.
//
// "missed" is never written. It is worked out from the date every time this
// source reads, so there is no missed state to store.

import { isOverdue, completeWaypoint } from "../../waypoints/store.mjs";
import { tickRefusal, REFUSAL_MESSAGES } from "../../waypoints/self-attest.mjs";

export const name = "waypoints";

/** What a staff member may set on a waypoint pin. */
export const MARKS = Object.freeze(["done"]);

const PREFIX = "waypoint:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v));

/** The UTC calendar day of a timestamp, or null. */
export function utcDay(v) {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** The pin kind for a waypoint. Only the icon on the plan depends on this. */
export function kindOf(row) {
  if (row?.verify_kind === "paydown") return "pay_down";
  if (row?.key === "business_checking") return "open_account";
  return "checkpoint";
}

/** Why staff may NOT mark this row done, or null when they may.
 *  The client's own rule (tickRefusal), minus "our step". */
export function staffRefusal(row) {
  if (!row) return "not_found";
  if (row.state === "skipped") return "skipped";
  const refusal = tickRefusal(row);
  return refusal === "our_step" ? null : refusal;
}

/** One client_waypoints row → one pin. Pure; `now` is the caller's clock. */
export function toPin(row, now = new Date()) {
  const date = utcDay(row?.due_at);
  if (!row || !row.id || !date) return null;
  const status = row.state === "done" ? "done" : isOverdue(row, now) ? "missed" : "planned";
  return {
    id: PREFIX + String(row.id),
    date,
    kind: kindOf(row),
    title: text(row.title) || "A step on your checklist",
    detail: text(row.detail),
    amount_cents: null,
    bank: null,
    container_id: null,
    status,
    source: name,
    can_mark: status !== "done" && staffRefusal(row) === null ? [...MARKS] : []
  };
}

/* Window edges as UTC instants, so the session time zone never moves a day. */
const WINDOW_SQL = `
  SELECT id, key, title, detail, owner_kind, state, due_at, completed_at, verify_kind
    FROM client_waypoints
   WHERE org_id = $1::uuid AND client_id = $2::uuid
     AND due_at IS NOT NULL
     AND state <> 'skipped'
     AND due_at >= ($3::date)::timestamp AT TIME ZONE 'UTC'
     AND due_at <  (($4::date) + 1)::timestamp AT TIME ZONE 'UTC'
   ORDER BY due_at ASC, position ASC, key ASC`;

export async function pins(db, { orgId, clientId, from, to, now = new Date() } = {}) {
  const r = await db.query(WINDOW_SQL, [orgId, clientId, from, to]);
  return (r.rows || []).map((row) => toPin(row, now)).filter(Boolean);
}

/**
 * Staff marks one waypoint pin. Only "done" is a thing that can be written.
 * Returns { ok: true, changed, pin } or { ok: false, reason, message? }.
 * The row is found by id AND org AND client; somebody else's is not_found.
 */
export async function mark(db, { orgId, clientId, pinId, status, at = null, now = new Date() } = {}) {
  if (status !== "done") {
    return {
      ok: false,
      reason: "missed_is_worked_out",
      message: "A step shows as missed by itself when its date passes and it is still open."
    };
  }
  const id = typeof pinId === "string" && pinId.startsWith(PREFIX) ? pinId.slice(PREFIX.length) : "";
  if (!UUID.test(id) || !orgId || !clientId) return { ok: false, reason: "not_found" };

  const r = await db.query(
    `SELECT * FROM client_waypoints
      WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid`,
    [id, orgId, clientId]
  );
  const row = r.rows?.[0] || null;
  const refusal = staffRefusal(row);
  if (refusal === "not_found") return { ok: false, reason: "not_found" };
  if (refusal) return { ok: false, reason: refusal, message: REFUSAL_MESSAGES[refusal] || "This step cannot be marked here." };

  if (row.state === "done") return { ok: true, changed: false, pin: toPin(row, now) };
  const updated = await completeWaypoint(db, { orgId, clientId, key: row.key, at });
  if (!updated) return { ok: false, reason: "not_found" };
  return { ok: true, changed: true, pin: toPin(updated, now) };
}
