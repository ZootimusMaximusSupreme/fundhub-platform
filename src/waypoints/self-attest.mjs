// Which checklist steps a CLIENT may tick themselves, and the one writer that
// ticks (or unticks) one.
//
// THE RULE IS verify.mjs's, NOT A NEW ONE. src/waypoints/verify.mjs opens with
// "a waypoint is never marked done on a guess" and splits the rows by
// verify_kind:
//
//   verify_kind = 'paydown'        Closed ONLY by data — a fresh credit re-pull
//                                  showing the balance at or under target. A
//                                  client ticking it by hand would be a guess.
//   verify_kind = 'no_new_credit'  Never completed, by anything, ever. Nothing
//                                  is evidence the rule was KEPT.
//   verify_kind = any other value  A machine check owns it. Not the client's.
//   verify_kind IS NULL            "stays open until a person says otherwise"
//                                  (verify.mjs, header). THESE are the rows a
//                                  client may tick — today form_llc, get_ein,
//                                  business_checking and personal_loan
//                                  (db/migrations/362).
//
// The key is verify_kind IS NULL, not a list of waypoint keys. The catalog is
// data (db/migrations/361) and will grow; a hardcoded key list would silently
// refuse a new self-attested step, or worse, allow a new machine-checked one.
//
// AND ONLY THE CLIENT'S OWN JOBS. owner_kind = 'fundhub' means it is our step.
// A client saying our step is done is not a person with the facts saying so.
//
// UNTICK. Allowed on exactly the rows a client may tick, and nowhere else. A
// person said it, so a person can take it back. Nothing in store.mjs forbids it:
// markWaypointState() exists to move a row back to a not-done state and clears
// completed_at for the CHECK in 330. The row goes to 'not_started' with the
// reason recorded, so staff can see it was taken back rather than never done.
//
// ONE ROW, FOUND BY ID *AND* ORG *AND* CLIENT. A row that belongs to somebody
// else is returned as null — exactly what a row that does not exist returns —
// so a caller cannot tell the two apart (src/partners/scope.mjs, the comment on
// assertCanReadRow: saying a record exists but is not yours is itself a leak).

import { completeWaypoint, markWaypointState } from "./store.mjs";
import { tickRefusal, closedBy } from "../pulse/beats/lib/waypoints-read.mjs";

/* tickRefusal and closedBy live in src/pulse/beats/lib/waypoints-read.mjs (2026-10-20), unchanged, so the hourly
   beat client-progress says how each step closes the same way the progress page does. One copy; re-exported. */
export { tickRefusal, closedBy };

/** The sentence a refused tick carries. One place, so a screen never invents
 *  its own wording for "why can't I tick this". */
export const REFUSAL_MESSAGES = Object.freeze({
  closes_on_credit_report:
    "This step closes itself when your next credit report shows the new balance.",
  ongoing_rule:
    "This is a rule to keep while we work on your file, so there is nothing to tick.",
  machine_checked: "This step closes itself when we can see it is done.",
  our_step: "This step is ours. We will mark it done when it is.",
  skipped: "This step was taken off your list."
});

export const UNTICK_REASON = "unticked_by_client";

/**
 * Tick (done = true) or untick (done = false) one of the client's own steps.
 *
 * Returns one of:
 *   { ok: true,  row, changed }
 *   { ok: false, reason: 'not_found' }            — missing OR somebody else's
 *   { ok: false, reason: <refusal>, row }          — theirs, but not tickable
 *
 * Idempotent: ticking a done row, or unticking an open one, changes nothing
 * and answers ok with changed: false.
 */
export async function setClientTick(db, { orgId, clientId, waypointId, done, at = null } = {}) {
  if (!orgId || !clientId || !waypointId) return { ok: false, reason: "not_found" };

  const r = await db.query(
    `SELECT * FROM client_waypoints
      WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid`,
    [waypointId, orgId, clientId]
  );
  const row = r.rows[0] || null;
  if (!row) return { ok: false, reason: "not_found" };

  const refusal = tickRefusal(row);
  if (refusal) return { ok: false, reason: refusal, row };

  if (done) {
    if (row.state === "done") return { ok: true, row, changed: false };
    if (row.state === "skipped") return { ok: false, reason: "skipped", row };
    // The existing writer. It writes state and completed_at together.
    const updated = await completeWaypoint(db, { orgId, clientId, key: row.key, at });
    return updated ? { ok: true, row: updated, changed: true } : { ok: false, reason: "not_found" };
  }

  if (row.state !== "done") return { ok: true, row, changed: false };
  const updated = await markWaypointState(db, {
    orgId, clientId, key: row.key, state: "not_started", reason: UNTICK_REASON
  });
  return updated ? { ok: true, row: updated, changed: true } : { ok: false, reason: "not_found" };
}
