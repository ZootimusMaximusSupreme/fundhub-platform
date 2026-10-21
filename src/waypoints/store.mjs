// Thin DB helpers for client_waypoints and paid_service_requests
// (db/migrations/330, 331). Pure SQL — no clock in business logic beyond
// DEFAULT now(), no HTTP, no processor call.
//
// COMPLIANCE REVIEW REQUIRED — fee timing. requestPaidService() records what a
// client is asked to pay and when. IT CHARGES NOBODY. There is no processor
// call in this file and no stored card token is readable from it; the only rail
// this repository has is a hosted checkout link a human clicks
// (src/payments/commas-api.mjs), and minting one is somebody else's job.
//
// EVERY CONSTRAINT THAT MATTERS IS IN THE DATABASE, NOT HERE (CLAUDE.md §3a).
// This module builds rows the database will accept; it is not the thing that
// decides they are legal. Deleting this file cannot make a bad row storable.

import { sumComponents } from "./pricing.mjs";
import { isOverdue, listWaypointRows } from "../pulse/beats/lib/waypoints-read.mjs";

export class WaypointError extends Error {
  constructor(message, { status = 400, code = "waypoint" } = {}) {
    super(message);
    this.name = "WaypointError";
    this.status = status;
    this.code = code;
  }
}

/* The checklist read and the overdue rule live in src/pulse/beats/lib/waypoints-read.mjs (2026-10-20), unchanged,
   so the hourly beat client-progress builds the checklist the same way. listWaypoints keeps its id check here. */
export async function listWaypoints(db, { orgId, clientId, now = new Date() } = {}) {
  if (!orgId || !clientId) throw new WaypointError("orgId and clientId are required");
  return listWaypointRows(db, { orgId, clientId, now });
}

export { isOverdue };

/**
 * Create or update one waypoint, keyed on (client_id, key).
 *
 * paidAlternativePriceCents:
 *   omitted / null → no paid alternative. NOT free, and NOT zero — the column's
 *                    CHECK refuses 0 outright, so nothing downstream can read
 *                    one and call it free.
 *   a positive integer → the price.
 */
export async function upsertWaypoint(db, {
  orgId,
  clientId,
  key,
  title,
  detail = null,
  position = 0,
  ownerKind,
  state = "not_started",
  dueAt = null,
  completedAt = null,
  paidAlternativePriceCents = null,
  paidAlternativeLabel = null,
  paidAlternativeKind = null,
  /* db/migrations/360. NULL verifyKind means NOTHING THE PLATFORM CAN SEE
     closes this waypoint — not "we have not checked yet". `params` carries the
     per-client facts that check needs, money in integer cents under keys ending
     _cents. Both default to null so every existing caller is unchanged. */
  verifyKind = null,
  params = null
} = {}) {
  if (!orgId || !clientId) throw new WaypointError("orgId and clientId are required");
  if (!key) throw new WaypointError("key is required", { code: "key_required" });
  if (!title) throw new WaypointError("title is required", { code: "title_required" });
  if (ownerKind !== "client" && ownerKind !== "fundhub") {
    throw new WaypointError("ownerKind must be 'client' or 'fundhub'", { code: "owner_kind" });
  }
  if (paidAlternativePriceCents !== null && paidAlternativePriceCents !== undefined) {
    if (!Number.isInteger(paidAlternativePriceCents) || paidAlternativePriceCents <= 0) {
      throw new WaypointError(
        "paidAlternativePriceCents must be a positive integer number of cents, or null for no paid alternative",
        { code: "paid_price" }
      );
    }
  }

  if (verifyKind !== null && verifyKind !== undefined && !/^[a-z0-9_]{2,64}$/.test(String(verifyKind))) {
    throw new WaypointError("verifyKind must be a lower_snake name, or null for not checkable", { code: "verify_kind" });
  }
  if (params !== null && params !== undefined
      && (typeof params !== "object" || Array.isArray(params))) {
    throw new WaypointError("params must be a plain object, or null", { code: "params_shape" });
  }

  const r = await db.query(
    `INSERT INTO client_waypoints
       (org_id, client_id, key, title, detail, position, owner_kind, state,
        due_at, completed_at,
        paid_alternative_price_cents, paid_alternative_label, paid_alternative_kind,
        verify_kind, params)
     VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
     ON CONFLICT (client_id, key) DO UPDATE
        SET title                        = EXCLUDED.title,
            detail                       = EXCLUDED.detail,
            position                     = EXCLUDED.position,
            owner_kind                   = EXCLUDED.owner_kind,
            due_at                       = EXCLUDED.due_at,
            paid_alternative_price_cents = EXCLUDED.paid_alternative_price_cents,
            paid_alternative_label       = EXCLUDED.paid_alternative_label,
            paid_alternative_kind        = EXCLUDED.paid_alternative_kind,
            verify_kind                  = EXCLUDED.verify_kind,
            params                       = EXCLUDED.params
      RETURNING *`,
    [
      orgId, clientId, key, title, detail, position, ownerKind, state,
      dueAt, completedAt,
      paidAlternativePriceCents ?? null,
      paidAlternativeLabel,
      paidAlternativeKind,
      verifyKind ?? null,
      params == null ? null : JSON.stringify(params)
    ]
  );
  return r.rows[0];
}

/**
 * Mark a waypoint done. `state` and `completed_at` are written together
 * because a CHECK in the database refuses them apart.
 */
export async function completeWaypoint(db, { orgId, clientId, key, at = null } = {}) {
  const r = await db.query(
    `UPDATE client_waypoints
        SET state = 'done', completed_at = COALESCE($4::timestamptz, now())
      WHERE org_id = $1::uuid AND client_id = $2::uuid AND key = $3
      RETURNING *`,
    [orgId, clientId, key, at]
  );
  return r.rows[0] || null;
}

/**
 * The still-open waypoints on this client that name a machine check.
 *
 * A row with a NULL verify_kind is not in this list and never will be: NULL
 * means nothing the platform can see closes it (db/migrations/360), so a sweep
 * that touched those rows would be guessing by definition.
 */
export async function listVerifiableWaypoints(db, { orgId, clientId } = {}) {
  if (!orgId || !clientId) throw new WaypointError("orgId and clientId are required");
  const r = await db.query(
    `SELECT * FROM client_waypoints
      WHERE org_id = $1::uuid AND client_id = $2::uuid
        AND verify_kind IS NOT NULL
        AND state NOT IN ('done', 'skipped')
      ORDER BY position ASC, key ASC`,
    [orgId, clientId]
  );
  return r.rows || [];
}

/**
 * Move a waypoint to a state that is NOT done, with the reason on the row.
 *
 * 'done' is refused here on purpose. completeWaypoint() is the only way to
 * close a waypoint, because state and completed_at have to be written together
 * or a CHECK in the database refuses the row, and having one function that can
 * do both is how you end up with a half-written completion.
 *
 * completed_at is cleared, for the same CHECK: a row that is not done may not
 * carry a completion time.
 */
export async function markWaypointState(db, { orgId, clientId, key, state, reason = null } = {}) {
  if (!orgId || !clientId) throw new WaypointError("orgId and clientId are required");
  if (!key) throw new WaypointError("key is required", { code: "key_required" });
  const allowed = ["not_started", "in_progress", "blocked", "skipped"];
  if (!allowed.includes(state)) {
    throw new WaypointError(
      `state must be one of ${allowed.join(", ")} — use completeWaypoint() to finish one`,
      { code: "state" }
    );
  }
  const r = await db.query(
    `UPDATE client_waypoints
        SET state = $4, state_reason = $5, completed_at = NULL
      WHERE org_id = $1::uuid AND client_id = $2::uuid AND key = $3
      RETURNING *`,
    [orgId, clientId, key, state, reason]
  );
  return r.rows[0] || null;
}

/**
 * Record a "do it for me" request.
 *
 * IDEMPOTENCY. `idempotencyKey` is the natural key of the press — the same key
 * twice is the same request, not two. The partial unique index
 * uq_paid_service_requests_idem adjudicates that in the database, because two
 * simultaneous presses can both pass a SELECT before either reaches its INSERT.
 * A loser is handed the existing row with `created: false`, which is the same
 * answer the winner's second press would get. That is the shape 090 gave the
 * soft-pull double tap and it is copied rather than reinvented.
 *
 * A dispute round bought here does NOT consume repair_programs.rounds_cap.
 * `roundNo` is the self-serve counter and nothing in this function reads,
 * writes, or joins the program's cap.
 */
export async function requestPaidService(db, {
  orgId,
  clientId,
  waypointId = null,
  serviceKind,
  requestedByKind,
  requestedByAccountId = null,
  requestedByStaffId = null,
  components = [],
  roundNo = null,
  idempotencyKey = null,
  status = "quoted",
  checkoutUrl = null
} = {}) {
  if (!orgId || !clientId) throw new WaypointError("orgId and clientId are required");
  if (!serviceKind) throw new WaypointError("serviceKind is required", { code: "service_kind" });
  if (requestedByKind !== "client" && requestedByKind !== "staff") {
    throw new WaypointError("requestedByKind must be 'client' or 'staff'", { code: "requested_by" });
  }

  // A priced request carries its lines and its total together. NULL total means
  // "not priced yet" and is a real answer — it is not zero and it is not free.
  const totalCents = Array.isArray(components) && components.length
    ? sumComponents(components)
    : null;
  if (totalCents !== null && totalCents <= 0) {
    throw new WaypointError("a priced request must total more than zero cents", { code: "price_total" });
  }

  const r = await db.query(
    `INSERT INTO paid_service_requests
       (org_id, client_id, waypoint_id, service_kind,
        requested_by_kind, requested_by_account_id, requested_by_staff_id,
        status, price_components, price_total_cents, round_no, idempotency_key, checkout_url)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7::uuid,$8,$9::jsonb,$10,$11,$12,$13)
     ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING
     RETURNING *`,
    [
      orgId, clientId, waypointId, serviceKind,
      requestedByKind, requestedByAccountId, requestedByStaffId,
      status, JSON.stringify(components || []), totalCents, roundNo, idempotencyKey, checkoutUrl
    ]
  );

  if (r.rows[0]) return { created: true, request: r.rows[0] };

  // Lost the race, or this is the second press. Hand back the row that won.
  if (idempotencyKey) {
    const existing = await db.query(
      `SELECT * FROM paid_service_requests
        WHERE org_id = $1::uuid AND idempotency_key = $2 LIMIT 1`,
      [orgId, idempotencyKey]
    );
    if (existing.rows[0]) return { created: false, request: existing.rows[0] };
  }
  return { created: false, request: null };
}

/** One client's paid-service history, newest first. */
export async function listPaidServiceRequests(db, { orgId, clientId } = {}) {
  const r = await db.query(
    `SELECT * FROM paid_service_requests
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY requested_at DESC`,
    [orgId, clientId]
  );
  return r.rows || [];
}

/**
 * The next self-serve round number for a client.
 *
 * Counts ONLY paid_service_requests. repair_programs.rounds_cap is a different
 * counter and is deliberately not consulted (owner-set): a round bought here is
 * extra and does not consume one the client already paid for with their
 * program.
 */
export async function nextSelfServeRoundNo(db, { clientId } = {}) {
  const r = await db.query(
    `SELECT COALESCE(MAX(round_no), 0) + 1 AS next
       FROM paid_service_requests
      WHERE client_id = $1::uuid AND round_no IS NOT NULL`,
    [clientId]
  );
  return Number(r.rows?.[0]?.next || 1);
}
