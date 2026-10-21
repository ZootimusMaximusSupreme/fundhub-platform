// ONE COPY (2026-10-20). This file used to be src/repair/on-repair-path.mjs. It moved here whole, unchanged except its
// import paths, so the hourly beat client-progress runs the same progress read as GET /api/read/client-progress. A beat may import only from src/pulse/beats/lib.
// src/repair/on-repair-path.mjs re-exports everything here, so every caller imports from there as before. Change it here.
//
// Is this client on the REPAIR path? One answer, one place.
//
// WHY IT EXISTS. The owner's standing rule is that repair work only happens for
// clients on the repair offer path. Until 2026-09-03 that rule was enforced in
// the letter engine and nowhere near the screen: the client portal showed the
// "Sign to authorize dispute letters" card to EVERY client, and
// api/consent/capture.mjs recorded the signature for anybody who sent one. Walk
// finding F35 caught it on an Academy buyer — somebody who bought a course being
// asked to authorize credit disputes.
//
// TWO SIGNALS, AND BOTH ARE ALREADY LOAD-BEARING SOMEWHERE ELSE. Neither is
// invented here; this file only puts them behind one name so a screen and an
// endpoint cannot disagree about who counts as a repair client.
//
//   1. The `metro2-letter-pack` entitlement — granted on a repair purchase
//      (src/repair/enroll.mjs) and already the repair lane in
//      src/repair/upload-doors.mjs.
//   2. outcome_tier REPAIR_ONLY — the tier the DIY letter workflow refuses
//      without (src/workflows/ds-02-diy-letters.mjs:143).
//
// EITHER, NOT BOTH. A repair buyer has the entitlement before any pull has run,
// and a REPAIR_ONLY client on the DIY path has the tier before they have bought
// anything. Requiring both would shut the door on each of them in turn.
//
// FAILS CLOSED. No org, no client, or a database that will not answer → false.
// The cost of a false negative is a repair client who has to be sent the sign
// link by hand. The cost of a false positive is a course buyer being asked to
// authorize credit disputes, which is the thing this closes.

import { has } from "./entitlements-read.mjs";
import { isRepairOnlyPath } from "./product-path.mjs";

export const REPAIR_ENTITLEMENT_CODE = "metro2-letter-pack";

/** onRepairPath — true when this client may be asked to authorize dispute work.
 *
 * @param {object} db
 * @param {{ orgId: string, clientId: string, outcomeTier?: string|null }} opts
 *   `outcomeTier` is optional: pass it when the caller already read the column
 *   (the portal summary does) so this does not repeat the query.
 */
export async function onRepairPath(db, { orgId, clientId, outcomeTier } = {}) {
  if (!orgId || !clientId) return false;

  const tier = outcomeTier === undefined
    ? await readOutcomeTier(db, { orgId, clientId })
    : outcomeTier;
  if (isRepairOnlyPath(tier)) return true;

  try {
    return await has(db, { orgId, clientId, code: REPAIR_ENTITLEMENT_CODE });
  } catch (err) {
    console.warn("[repair] entitlement read failed:", err && err.message);
    return false;
  }
}

/* The tier is read WITH the org bound. clientOutcomeTier() in
   src/config/product-path.mjs looks up by client id alone, which is right for a
   workflow that already resolved the client and wrong for an endpoint deciding
   what to show a caller: a cross-tenant id must answer null, not a tier. */
async function readOutcomeTier(db, { orgId, clientId }) {
  try {
    const r = await db.query(
      `SELECT outcome_tier FROM clients WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    );
    return r.rows[0]?.outcome_tier ?? null;
  } catch (err) {
    console.warn("[repair] outcome_tier read failed:", err && err.message);
    return null;
  }
}
