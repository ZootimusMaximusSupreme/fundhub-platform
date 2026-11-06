import { SoftPullError } from "../finance/soft-pulls.mjs";

export const INCLUDED_REPORT_DAYS = 30;

export async function readBlueprintReportAllowance(db, { orgId, clientId, engagement, now = new Date() }) {
  const result = await db.query(
    `SELECT id, status, requested_at FROM soft_pull_requests
      WHERE org_id = $1 AND client_id = $2 AND blueprint_report_kind = 'included'
        AND status <> 'cancelled'
        AND NOT EXISTS (SELECT 1 FROM crs_results cr WHERE cr.id = soft_pull_requests.crs_result_id
          AND (cr.result->>'simulated' = 'true' OR cr.result->>'environment' IN ('sandbox','simulated')))
      ORDER BY requested_at DESC LIMIT 1`,
    [orgId, clientId]
  );
  const last = result.rows[0];
  const next = last ? new Date(new Date(last.requested_at).getTime() + INCLUDED_REPORT_DAYS * 86400000) : null;
  return {
    includedAvailable: engagement?.status === "active" && (!next || next <= now),
    nextIncludedAt: next?.toISOString() || null,
    pendingRequestId: last && ["queued", "processing"].includes(last.status) ? last.id : null,
    engagementActive: engagement?.status === "active"
  };
}

export async function authorizeBlueprintReportExecution(db, ledger) {
  if (!ledger.blueprint_engagement_id) return;
  if (ledger.blueprint_report_kind === "paid_round") {
    const requestId = /^paid_round_pull:([0-9a-f-]{36})$/.exec(String(ledger.idempotency_key || ""))?.[1];
    const paidRound = await db.query(`SELECT id FROM paid_service_requests WHERE id=$1 AND org_id=$2 AND client_id=$3
      AND service_kind='dispute_round' AND status IN ('paid','staged') AND paid_at IS NOT NULL
      AND payment_ref IS NOT NULL AND amount_paid_cents>=price_total_cents`, [requestId || null, ledger.org_id, ledger.client_id]);
    if (paidRound.rows[0]) return;
    throw new SoftPullError("The paid round report needs payment review.", { status: 409, code: "blueprint_report_payment_required" });
  }
  const result = await db.query(
    `SELECT e.status, s.state AS service_status, s.payment_ref,
       p.status AS payment_status,p.price_total_cents,p.amount_paid_cents,
       ent.revoked_at,ent.expires_at,t.status AS purchase_status
       FROM blueprint_fulfillment_engagements e
       LEFT JOIN blueprint_client_services s ON s.id = $4 AND s.org_id = e.org_id AND s.client_id = e.client_id
       LEFT JOIN paid_service_requests p ON p.id=s.id AND p.org_id=e.org_id AND p.client_id=e.client_id
       JOIN entitlements ent ON ent.id=e.source_entitlement_id AND ent.org_id=e.org_id AND ent.client_id=e.client_id
       JOIN transactions t ON t.id=e.source_transaction_id AND t.org_id=e.org_id AND t.client_id=e.client_id
      WHERE e.id = $1 AND e.org_id = $2 AND e.client_id = $3`,
    [ledger.blueprint_engagement_id, ledger.org_id, ledger.client_id, ledger.blueprint_service_request_id || null]
  );
  const current = result.rows[0];
  const paid = ledger.blueprint_report_kind === "paid" && current?.payment_ref && ["paid", "in_progress"].includes(current.service_status)
    && ["paid", "staged"].includes(current.payment_status) && Number(current.price_total_cents) === Number(current.amount_paid_cents);
  const included = current?.status === "active" && !current.revoked_at && (!current.expires_at || new Date(current.expires_at) > new Date()) && current.purchase_status === "succeeded";
  const allowed = ledger.blueprint_report_kind === "paid" ? paid
    : ledger.blueprint_report_kind === "diagnostic" || included;
  if (!current || !allowed) {
    throw new SoftPullError("This report request no longer has active purchased access.", {
      status: 409, code: "blueprint_report_access_ended"
    });
  }
}
