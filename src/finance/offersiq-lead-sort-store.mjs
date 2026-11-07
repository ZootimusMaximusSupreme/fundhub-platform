// Ranking writes never republish the client cache or change paid-check identity.
import { classifyOffersIqReceipt } from "./offersiq-lead-sort.mjs";
import { isUuid } from "../http/read-api.mjs";

export async function persistOffersIqLeadSort(db, rowId, orgId, summary,
  { config, reevaluated = false, expectedSourceReceipt = summary } = {}) {
  if (!isUuid(rowId) || !isUuid(orgId) || !summary
      || !Number.isSafeInteger(summary.rule_set_id)
      || !["production", "sandbox"].includes(summary.environment)
      || !/^[a-f0-9]{64}$/.test(summary.identity_fingerprint || "")) {
    throw new Error("offersiq_sort_receipt_invalid");
  }
  const result = classifyOffersIqReceipt(summary, config);
  const updated = await db.query(
    `UPDATE offersiq_requests SET lead_sort_bucket=$3, lead_sort_points=$4,
       lead_sort_version=$5, lead_sort_reasons=$6::jsonb, lead_sort_result=$7::jsonb,
       lead_sort_receipt=CASE WHEN $8 THEN $9::jsonb ELSE lead_sort_receipt END,
       lead_sort_updated_at=now()
     WHERE id=$1 AND org_id=$2 AND status <> 'in_flight'
       AND rule_set_id=$10 AND environment=$11 AND identity_fingerprint=$12
       AND ($8 OR COALESCE(lead_sort_receipt, normalized_response) IS NOT DISTINCT FROM $13::jsonb)
     RETURNING id`,
    [rowId, orgId, result.bucket, result.points, result.version,
      JSON.stringify(result.reasons), JSON.stringify(result), reevaluated,
      JSON.stringify(summary), summary.rule_set_id, summary.environment, summary.identity_fingerprint,
      expectedSourceReceipt === null ? null : JSON.stringify(expectedSourceReceipt)]
  );
  if (updated.rows.length !== 1) throw new Error("offersiq_sort_receipt_changed_or_missing");
  return result;
}
