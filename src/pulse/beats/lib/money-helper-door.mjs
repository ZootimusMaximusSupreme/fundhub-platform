// finance-os:helper — does the money helper screen's thread load for a client with a live bank link?
// Report only. Read only.
//
// ONE VERDICT, TWO CLOCKS (2026-10-20). The linked-client read and the door verdict (scoreDoor, its
// fix line and its row shape) used to live in src/pulse/coverage/gap-finance-os.mjs. They moved here,
// unchanged, so the morning lane (all seven Finance OS doors) and the hourly beat money-tasks (the
// money helper door) pick the same client and judge with the same words. A beat may import only from
// src/pulse/beats/lib.
//
// WHAT EACH CLOCK OPENS
//   morning  gap-finance-os.mjs opens the real api/money/helper.mjs handler in process, behind a staff
//            gate it fakes, with readOnlyHelperPayload as the payload builder: that builder is
//            helperView (./money-helper-read.mjs) with no step before the reads.
//   hourly   judgeHelperDoor below runs the same helperView for the same client, through the read box,
//            and scores what the handler would answer: 200 with the payload, 404 when the client is gone,
//            a throw when a read under the page fails. The handler's own sign-in gate (requirePrincipal,
//            requireRole, requireClientInOrg) is not run hourly; it is the shared staff gate every money
//            door uses, and the morning lane still opens it.
// The page's one write (answering turns left queued with the Mac off) is never run by either clock.

import { helperView } from "./money-helper-read.mjs";

const RECON =
  "Recon (AG-07) is the one tripwire. Leave that agent on the morning pulse. " +
  "Do not auto-fix. Do not call Plaid. Do not move money. Do not add another watcher.";

/** The money helper door. gap-finance-os.mjs adds its literal handler import to this. */
export const HELPER_DOOR = Object.freeze({
  id: "finance-os:helper",
  route: "money/helper",
  page: "/app/money-helper.html",
  label: "money helper",
  file: "api/money/helper.mjs"
});

export const LINKED_CLIENT_SQL = `
  /* gap:finance-os-linked-client */
  SELECT c.id::text AS id
    FROM clients c
   WHERE c.org_id = $1::uuid
     AND EXISTS (
       SELECT 1
         FROM plaid_items p
        WHERE p.org_id = c.org_id
          AND p.client_id = c.id
          AND p.link_state = 'active'
     )
   ORDER BY c.created_at DESC
   LIMIT 1
`;

export function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

export function clip(err, n = 180) {
  const msg = err && err.message ? err.message : err;
  return String(msg == null ? "" : msg).replace(/\s+/g, " ").trim().slice(0, n);
}

export function fix(door) {
  return `${RECON} Open GET /api/${door.route} for that linked client (${door.page}).`;
}

export function scoreDoor(door, clientId, outcome) {
  const name = `${door.label} (GET /api/${door.route})`;
  const who = `linked client ${clientId}`;
  if (outcome && outcome.thrown) {
    return row(door.id, "FAIL", `${name} threw for ${who}: ${clip(outcome.thrown)}`, fix(door));
  }
  const status = Number(outcome && outcome.status) || 0;
  const body = outcome ? outcome.body : null;
  const errorText = body && (body.error || body.message) ? clip(body.error || body.message, 120) : "";
  const bad = status === 0 || status >= 400 || (body && body.ok === false) || (body && body.error);
  if (!bad && status >= 200 && status < 300) {
    return row(door.id, "PASS", `${name} answered ${status} for ${who}`);
  }
  const why = errorText ? ` (${errorText})` : "";
  const detail = status
    ? `${name} answered ${status} for ${who}${why}`
    : `${name} returned no status for ${who}${why}`;
  return row(door.id, "FAIL", detail, fix(door));
}

/** The newest client in the org with an active bank link, or null. */
export async function linkedClientId(db, orgId) {
  const result = await db.query(LINKED_CLIENT_SQL, [orgId]);
  const id = result?.rows?.[0]?.id;
  return id ? String(id) : null;
}

/**
 * The hourly finance-os:helper row. io: { read(sql, params), orgId, now, env }.
 * The same client pick, the same payload read and the same verdict as the morning lane.
 */
export async function judgeHelperDoor({ read, orgId, now = new Date(), env = {} } = {}) {
  const door = HELPER_DOOR;
  const database = { query: (sql, params) => read(sql, params) };
  let clientId;
  try {
    clientId = await linkedClientId(database, orgId);
  } catch (err) {
    return row(door.id, "FAIL", `could not read a linked client: ${clip(err)}`, fix(door));
  }
  if (!clientId) {
    return row(door.id, "skip", `no client with an active bank link — ${door.label} was not opened`);
  }
  let outcome;
  try {
    // staff: true, as on the morning pulse (its gate signs in as staff).
    const payload = await helperView(database, { orgId, clientId, staff: true, env, now });
    outcome = payload
      ? { status: 200, body: payload, thrown: null }
      : { status: 404, body: { ok: false, error: "not_found" }, thrown: null };
  } catch (err) {
    outcome = { status: 0, body: null, thrown: err };
  }
  return scoreDoor(door, clientId, outcome);
}
