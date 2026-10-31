// Gate: does this client currently authorize Fundhub to PREPARE dispute
// letters and complaint drafts?
//
// Wraps hasValidConsent for kind `dispute_authorization`. Fail-closed: a
// missing org, client, or row is false. Does not mail or file anything.
// Dated/live complaint packs must pass this. DIY undated templates may still
// generate with a "sign the declaration before filing" cover.
//
// Generate and Stage may write letters only when a signed repair agreement
// is on file. Staff consent or enroll alone is not that paper.

import { hasValidConsent, CONSENT_VALID_SQL } from "../consent/index.mjs";

function signedRepairSql(orgPos = 1, clientPos = 2) {
  if (![orgPos, clientPos].every(n => Number.isInteger(n) && n >= 1 && n <= 9))
    throw new TypeError("invalid bind position");
  return `SELECT 1
    FROM contracts c
    LEFT JOIN contract_templates t
      ON t.org_id = c.org_id AND t.template_key = c.template_key
   WHERE c.org_id = $${orgPos}::uuid
     AND c.client_id = $${clientPos}::uuid
     AND c.status = 'signed'
     AND (
       t.subtype = 'credit_repair'
       OR c.template_key ILIKE '%REPAIR%'
     )
   LIMIT 1`;
}
const SIGNED_REPAIR_SQL = signedRepairSql(1, 2);

// Recheck paper/consent in the claim's own SQL snapshot. This uses the same
// signed-contract check and canonical revocation/expiry predicate as preflight.
export function currentRepairMailAuthorizationSql(orgPos = 2, clientPos = 3) {
  if (![orgPos, clientPos].every(n => Number.isInteger(n) && n >= 1 && n <= 9))
    throw new TypeError("invalid bind position");
  return `(EXISTS (${signedRepairSql(orgPos, clientPos)})
    OR EXISTS (
      SELECT 1 FROM client_consents
       WHERE org_id = $${orgPos}::uuid AND client_id = $${clientPos}::uuid
         AND kind = 'dispute_authorization'
         AND (${CONSENT_VALID_SQL})
    ))`;
}

export async function hasCurrentRepairMailAuthorization(db, { orgId, clientId } = {}) {
  if (!db?.query || !orgId || !clientId) return false;
  try {
    const r = await db.query(`SELECT ${currentRepairMailAuthorizationSql(1, 2)} AS authorized`, [orgId, clientId]);
    return r.rows?.[0]?.authorized === true;
  } catch { return false; }
}


export async function hasDisputeAuthorization(db, { orgId, clientId } = {}) {
  return hasValidConsent(db, { orgId, clientId, kind: "dispute_authorization" });
}

/** True only when a signed repair agreement is on file. Fail-closed. */
export async function hasRepairAgreement(db, { orgId, clientId } = {}) {
  if (!db?.query || !orgId || !clientId) return false;
  try {
    const signed = await db.query(SIGNED_REPAIR_SQL, [orgId, clientId]);
    return Boolean(signed.rows[0]);
  } catch {
    return false;
  }
}
