// Report only. Never auto-fix. Never pull credit. Never charge.
//
// Slice 19 lists SLO workflow names. Slice 21 lists the underwrite door and
// the CRS jobs. This file does not repeat those lists. It reads whether a
// paid roadmap client has no pack, whether letters that should be on file
// are missing, whether the pack job failed, and whether the read door
// answers 500.
//
// Tripwire is Recon (AG-07) on the morning pulse. Do not invent a second watchdog.
//
// Claude review 2026-10-08:
//  - uw-read-door used to GET the door with no login. That always answers 401,
//    and daily-pulse already pings the door the same way (its "suggestions"
//    check), so it could not see a 500 behind the login. It now runs the real
//    handler in this process on one real stored credit file.
//  - uw-paid-roadmap-no-pack used to fail every paid buyer 2 hours after paying,
//    but the pack is built after the buyer fills the pull form and the pull
//    finishes. It now fails only when the pull finished and no pack exists.

// ONE JUDGE, TWO CLOCKS (2026-10-20). The paid-roadmap pack, pack-files and pack-email checks, their
// SQL and their judges live in src/pulse/beats/lib/underwrite-truth.mjs, so this lane and the hourly
// beat roadmap-delivery run the same code. The letters, offer-fulfillment and read-door checks stay here.
import {
  RECON, check, checkPackEmail, checkPackFiles, checkPaidRoadmap, clip, cutoffIso, hasDb, num, sample
} from "../beats/lib/underwrite-truth.mjs";

export * from "../beats/lib/underwrite-truth.mjs";
/** What deliverSloPack writes when the pack does not land. */
export const SLO_PACK_FAILED = "Delivery Failed — Retry";
/** In-process handlers that build the pack. Named in failed_events.handler_name. */
export const PACK_HANDLERS = Object.freeze([
  "onAnalysisCompletedDeliverables",
  "onAnalysisCompletedSloPack"
]);
export const CHECK_IDS = Object.freeze([
  "uw-paid-roadmap-no-pack",
  "uw-letters-missing",
  "uw-offer-fulfillment-failed",
  "uw-read-door",
  "uw-pack-files-incomplete",
  "uw-pack-email-not-queued"
]);
const DOOR_FIX =
  "Fix GET /api/read/underwrite so staff can open it. Do not change UnderwriteIQ dollar math. " +
  RECON;
export const LETTERS_SQL = `
SELECT count(*)::int AS n,
       min(c.id::text) AS sample_id
  FROM clients c
 WHERE c.is_demo = false
   AND ($2::uuid IS NULL OR c.org_id = $2::uuid)
   AND EXISTS (
     SELECT 1
       FROM events e
      WHERE e.client_id = c.id
        AND e.org_id = c.org_id
        AND e.name = 'analysis.completed'
        AND e.payload->>'source' = 'crs'
        AND e.is_demo = false
        AND e.created_at <= $1::timestamptz
   )
   AND (
     (
       (
         CASE WHEN COALESCE(c.custom_fields->>'crs_inquiries_ex', '') ~ '^[0-9]+$'
              THEN (c.custom_fields->>'crs_inquiries_ex')::int ELSE 0 END
         + CASE WHEN COALESCE(c.custom_fields->>'crs_inquiries_eq', '') ~ '^[0-9]+$'
              THEN (c.custom_fields->>'crs_inquiries_eq')::int ELSE 0 END
         + CASE WHEN COALESCE(c.custom_fields->>'crs_inquiries_tu', '') ~ '^[0-9]+$'
              THEN (c.custom_fields->>'crs_inquiries_tu')::int ELSE 0 END
       ) > 0
       AND NOT EXISTS (
         SELECT 1
           FROM documents d
          WHERE d.client_id = c.id
            AND d.org_id = c.org_id
            AND d.kind = 'deliverable'
            AND d.subtype = 'funding_inquiry_removal'
       )
     )
     OR
     (
       CASE WHEN COALESCE(c.custom_fields->>'crs_negative_items_count', '') ~ '^[0-9]+$'
            THEN (c.custom_fields->>'crs_negative_items_count')::int ELSE 0 END > 0
       AND EXISTS (
         SELECT 1
           FROM dispute_cases dc
          WHERE dc.client_id = c.id
            AND dc.org_id = c.org_id
            AND dc.status <> 'cancelled'
       )
       AND NOT EXISTS (
         SELECT 1
           FROM dispute_letters dl
          WHERE dl.client_id = c.id
            AND dl.org_id = c.org_id
       )
     )
   )`;
export const OFFER_DEAD_LETTER_SQL = `
SELECT count(*)::int AS n,
       (array_agg(handler_name ORDER BY last_seen_at DESC))[1] AS handler_name,
       left((array_agg(error_message ORDER BY last_seen_at DESC))[1], 160) AS error_message
  FROM failed_events
 WHERE status IN ('pending', 'exhausted')
   AND handler_name = ANY($1::text[])
   AND ($2::uuid IS NULL OR org_id = $2::uuid)`;
export const OFFER_PACK_STATUS_SQL = `
SELECT count(*)::int AS n,
       min(id::text) AS sample_id
  FROM clients
 WHERE is_demo = false
   AND custom_fields->>'slo_pack_status' = $1
   AND ($2::uuid IS NULL OR org_id = $2::uuid)`;
// The newest real stored credit file. The read door is run on this one.
export const READ_DOOR_CLIENT_SQL = `
SELECT c.id::text AS id
  FROM clients c
  JOIN crs_results r
    ON r.client_id = c.id
   AND r.org_id = c.org_id
 WHERE c.org_id = $1::uuid
   AND COALESCE(c.is_demo, false) = false
   AND COALESCE(r.is_demo, false) = false
 ORDER BY r.created_at DESC
 LIMIT 1`;
async function checkLetters(db, { orgId = null, now = new Date() } = {}) {
  const id = "uw-letters-missing";
  if (!hasDb(db)) {
    return check(id, "skip", "no database in this run — letters not read");
  }
  try {
    const { rows } = await db.query(LETTERS_SQL, [cutoffIso(now), orgId]);
    const row = rows[0] || {};
    const n = num(row);
    if (n === 0) {
      return check(id, "PASS", "no client with inquiries or an open dispute case is missing letters");
    }
    const word = n === 1 ? "client is" : "clients are";
    return check(
      id,
      "FAIL",
      `${n} ${word} missing letters that should be on file.${sample(row)}`,
      "Read the credit file and the letter rows. Do not change UnderwriteIQ dollar math. " + RECON
    );
  } catch (err) {
    return check(id, "FAIL", `could not read letter rows: ${clip(err && err.message)}`, RECON);
  }
}
async function checkOfferFulfillment(db, { orgId = null } = {}) {
  const id = "uw-offer-fulfillment-failed";
  if (!hasDb(db)) {
    return check(id, "skip", "no database in this run — offer fulfillment not read");
  }
  try {
    const dead = await db.query(OFFER_DEAD_LETTER_SQL, [PACK_HANDLERS, orgId]);
    const stamped = await db.query(OFFER_PACK_STATUS_SQL, [SLO_PACK_FAILED, orgId]);
    const deadRow = (dead.rows && dead.rows[0]) || {};
    const stampRow = (stamped.rows && stamped.rows[0]) || {};
    const deadN = num(deadRow);
    const stampN = num(stampRow);
    if (deadN === 0 && stampN === 0) {
      return check(id, "PASS", "offer fulfillment has no open failure");
    }
    const parts = [];
    if (deadN > 0) {
      const who = deadRow.handler_name ? ` (${deadRow.handler_name})` : "";
      const why = deadRow.error_message ? `: ${clip(deadRow.error_message, 120)}` : "";
      parts.push(`${deadN} pack job failure${deadN === 1 ? "" : "s"}${who}${why}`);
    }
    if (stampN > 0) {
      parts.push(`${stampN} client pack status is ${SLO_PACK_FAILED}.${sample(stampRow)}`);
    }
    return check(
      id,
      "FAIL",
      parts.join(" "),
      "Read the failed pack job. Do not re-run it from this pulse. " + RECON
    );
  } catch (err) {
    return check(id, "FAIL", `could not read offer fulfillment: ${clip(err && err.message)}`, RECON);
  }
}
function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}
// The only fake in the door run: the staff session lookup. verifySession checks
// the token with one UPDATE-and-SELECT on sessions. That statement is answered
// here with a staff row, so nothing is written and no login is minted. Every
// other statement goes to the real database, so the door runs its real reads
// and its real engine.
const SESSION_STATEMENT = /UPDATE\s+sessions[\s\S]*RETURNING\s+id,\s*staff_id,\s*org_id/i;
export function doorDatabase(db, orgId, now = new Date()) {
  return {
    async query(sql, params) {
      if (SESSION_STATEMENT.test(String(sql))) {
        return {
          rows: [{
            session_id: "00000000-0000-4000-8000-0000000000a1",
            expires_at: new Date(now.getTime() + 60 * 60 * 1000),
            staff_id: "00000000-0000-4000-8000-0000000000a2",
            org_id: orgId,
            role: "owner",
            email: "pulse@fundhub.ai",
            name: "Morning pulse",
            status: "active",
            avatar_key: null,
            active_flag: null
          }]
        };
      }
      return db.query(sql, params);
    }
  };
}
/** GET /api/read/underwrite in this process for one client. Reads only. */
export async function openReadDoor({ db, orgId, clientId, now = new Date(), handler = null }) {
  const run = handler || (await import("../../../api/read/underwrite.mjs")).default;
  const res = mockRes();
  const req = {
    method: "GET",
    headers: { authorization: "Bearer morning-pulse-in-process" },
    query: { client_id: clientId }
  };
  try {
    await run(req, res, { db: doorDatabase(db, orgId, now) });
    return { status: res.statusCode, body: res.body, thrown: null };
  } catch (err) {
    return { status: res.statusCode, body: res.body, thrown: err };
  }
}
export async function checkReadDoor(db, { orgId = null, now = new Date(), ctx = {} } = {}) {
  const id = "uw-read-door";
  if (!hasDb(db) || !orgId) {
    return check(id, "skip", "no database in this run — underwrite read door not opened");
  }
  let clientId;
  try {
    const { rows } = await db.query(READ_DOOR_CLIENT_SQL, [orgId]);
    clientId = rows && rows[0] && rows[0].id;
  } catch (err) {
    return check(id, "FAIL", `could not pick a stored credit file for the read door: ${clip(err && err.message)}`, DOOR_FIX);
  }
  if (!clientId) {
    return check(id, "skip", "no real client has a stored credit file — underwrite read door not opened");
  }
  const open = typeof ctx.openReadDoor === "function" ? ctx.openReadDoor : openReadDoor;
  let out;
  try {
    out = await open({ db, orgId, clientId, now, handler: ctx.underwriteHandler || null });
  } catch (err) {
    // The handler file would not even load.
    return check(id, "FAIL", `underwrite read door would not load for client ${clientId}: ${clip(err && err.message)}`, DOOR_FIX);
  }
  const status = Number(out && out.status) || 0;
  const body = (out && out.body) || null;
  if (out && out.thrown) {
    return check(
      id,
      "FAIL",
      `underwrite read door would answer 500 for client ${clientId}: ${clip(out.thrown && out.thrown.message)}`,
      DOOR_FIX
    );
  }
  if (status === 200 && body && body.ok === true) {
    return check(id, "PASS", `underwrite read door answered 200 for client ${clientId}`);
  }
  const why = body && (body.error || body.message) ? ` (${clip(body.error || body.message, 80)})` : "";
  if (status >= 500 && !(body && body.error === "auth_unavailable")) {
    return check(id, "FAIL", `underwrite read door answered ${status} for client ${clientId}${why}`, DOOR_FIX);
  }
  // 401, 403, 404, 400, or the session lookup itself: this run could not open the
  // door. That is not proof it works. It is not a PASS.
  return check(
    id,
    "skip",
    `underwrite read door could not be opened in this run: answered ${status || "nothing"}${why}`
  );
}
/**
 * @param {{ db?: { query: Function }, orgId?: string|null, now?: Date|string|number, openReadDoor?: Function, underwriteHandler?: Function }} [ctx]
 * @returns {Promise<Array<{ id: string, status: string, detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const now = ctx.now ? new Date(ctx.now) : new Date();
  const scope = { orgId, now };
  return [
    await checkPaidRoadmap(db, scope),
    await checkLetters(db, scope),
    await checkOfferFulfillment(db, scope),
    await checkReadDoor(db, { orgId, now, ctx }),
    await checkPackFiles(db, scope),
    await checkPackEmail(db, scope)
  ];
}
