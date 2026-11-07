import { db as defaultDb } from "../db.mjs";
import { requirePrincipal } from "../http/middleware/requirePrincipal.mjs";
import { OFFERS } from "../config/offers.mjs";

export const FULL_BLUEPRINT_PRODUCT = OFFERS.BLUEPRINT_SELF_FUNDING.productCode;
export const FULL_BLUEPRINT_ENTITLEMENT = "blueprint-client-fulfillment";

export async function getBlueprintFulfillmentAccess(db, { orgId, clientId, now = new Date() }) {
  if (!orgId || !clientId) return null;
  const { rows } = await db.query(
    `SELECT g.id, g.org_id AS "orgId", g.client_id AS "clientId",
            g.funding_round_id AS "roundId", g.opens_at AS "opensAt",g.submissions_closed_at AS "submissionsClosed", g.status, g.execution_owner AS "executionOwner",
            g.source_transaction_id AS "transactionId", g.source_entitlement_id AS "entitlementId",
            p.code AS "productCode", sp.sale_id AS "saleId",fr.status AS "roundStatus",
            fr.approved_amount AS "roundApprovedAmount",fr.funded_amount AS "roundFundedAmount",
            fr.round_number AS "roundNumber"
       FROM blueprint_fulfillment_engagements g
       JOIN entitlements e ON e.id=g.source_entitlement_id AND e.org_id=g.org_id AND e.client_id=g.client_id
       JOIN transactions t ON t.id=g.source_transaction_id AND t.id=e.source_transaction_id
          AND t.org_id=g.org_id AND t.client_id=g.client_id
       JOIN products p ON p.id=resolve_product_id(t.org_id,t.product_name) AND p.org_id=g.org_id
       LEFT JOIN funding_rounds fr ON fr.id=g.funding_round_id AND fr.org_id=g.org_id AND fr.client_id=g.client_id
       LEFT JOIN sale_payments sp ON sp.org_id=g.org_id AND sp.transaction_id=t.id
      WHERE g.org_id=$1 AND g.client_id=$2 AND p.code=$3 AND e.entitlement_code=$4
        AND ((g.status='active' AND e.revoked_at IS NULL AND (e.expires_at IS NULL OR e.expires_at>$5))
             OR (g.status='completed' AND e.revoke_reason='purchased_round_completed'))
        AND lower(btrim(t.status))='succeeded'
      ORDER BY (g.status='active') DESC,g.created_at DESC,g.id DESC LIMIT 1`,
    [orgId, clientId, FULL_BLUEPRINT_PRODUCT, FULL_BLUEPRINT_ENTITLEMENT, now]);
  return rows[0] || null;
}

export async function requireBlueprintFulfillmentScope(req, res, deps = {}) {
  res.setHeader("Cache-Control", "private, no-store");
  const db = deps.db || defaultDb;
  const principal = await (deps.requirePrincipal || requirePrincipal)(req, res, ["client"], { db });
  if (!principal) return null;
  if (principal.kind !== "client" || !principal.orgId || !principal.clientId || !principal.accountId) {
    res.status(403).json({ ok: false, error: "client_session_required" });
    return null;
  }
  const { orgId, clientId, accountId } = principal;
  const now = deps.now?.() || new Date();
  const engagement = await (deps.getBlueprintFulfillmentAccess || getBlueprintFulfillmentAccess)(db, { orgId, clientId, now });
  if (!engagement) {
    res.status(403).json({ ok: false, error: "full_blueprint_required" });
    return null;
  }
  if (req.method !== "GET" && (engagement.status !== "active" ||
      (engagement.executionOwner !== "client" && !deps.allowManagedWrites))) {
    res.status(409).json({ ok: false, error: "engagement_not_client_operated" });
    return null;
  }
  return { orgId, clientId, accountId, now, engagement };
}
