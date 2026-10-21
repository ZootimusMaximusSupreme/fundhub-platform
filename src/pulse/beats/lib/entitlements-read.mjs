// The two entitlement READS the portal and the progress page use. ONE COPY (2026-10-20).
//
// forClient (what a client owns, one row per catalogue code) and has (one code, one boolean) used to live in
// src/entitlements/entitlements.mjs. They moved here unchanged so the hourly beat client-progress runs the same
// reads as GET /api/read/client-progress (a beat may import only from src/pulse/beats/lib).
// entitlements.mjs imports them back and re-exports them; the writers (grant, revoke, ...) stay there.
// Read only: SELECT, no I/O beyond the db handed in.

/* forClient — the portal's read. Returns every catalogued entitlement with an
   `active` flag, so the caller can render owned and locked tiles from one query
   without deciding the expiry rules itself.

   { held: [...active], locked: [...never granted or no longer active], all: [...] } */
export async function forClient(db, { orgId, clientId } = {}) {
  if (!orgId || !clientId) throw new Error("forClient: orgId and clientId are required");

  /* ONE CODE, ONE TILE.
     This is a LEFT JOIN from the catalogue onto the grants, and a client can
     hold more than one live grant of the same code — a repair buyer measured on
     production 2026-09-06 held metro2-letter-pack twice, once from the payment
     and once from the enrolment that followed it. Without DISTINCT ON the join
     multiplied the catalogue row and the portal drew the letter pack twice.
     A duplicate row in the ledger is a bookkeeping question; a duplicate tile on
     a client's screen is a wrong screen.

     Which grant represents the code: an ACTIVE one over a dead one, then the
     most recent. The outer query restores the catalogue's own ordering, which
     DISTINCT ON has to spend on the code. */
  const { rows } = await db.query(
    `SELECT code, name, description, kind, sort_order,
            granted_at, expires_at, revoked_at, active, source_transaction_id
       FROM (
         SELECT DISTINCT ON (c.code)
                c.code, c.name, c.description, c.kind, c.sort_order,
                e.granted_at, e.expires_at, e.revoked_at,
                COALESCE(e.active, false) AS active,
                e.source_transaction_id
           FROM entitlement_catalog c
           LEFT JOIN v_client_entitlements e
                  ON e.org_id = c.org_id AND e.entitlement_code = c.code
                 AND e.client_id = $2
          WHERE c.org_id = $1 AND c.active = true
          ORDER BY c.code, COALESCE(e.active, false) DESC, e.granted_at DESC NULLS LAST
       ) one_per_code
      ORDER BY sort_order, code`,
    [orgId, clientId]
  );

  return {
    held: rows.filter((r) => r.active),
    locked: rows.filter((r) => !r.active),
    all: rows
  };
}

/* has — the single gate. One code, one boolean. Expiry and revocation are
   resolved in the view so no caller re-implements them. */
export async function has(db, { orgId, clientId, code } = {}) {
  if (!orgId || !clientId || !code) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM v_client_entitlements
      WHERE org_id = $1 AND client_id = $2 AND entitlement_code = $3 AND active
      LIMIT 1`,
    [orgId, clientId, String(code).trim().toLowerCase()]
  );
  return rows.length > 0;
}
