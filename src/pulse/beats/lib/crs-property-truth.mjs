// Read saved property receipts only. Never decrypt identity or call CRS.
import { row, runnerOf } from "./money-truth-utils.mjs";

export const CHECK_IDS = Object.freeze(["property:report-ledger"]);
export const PROPERTY_LEDGER_COUNTS = Object.freeze({
  rows_n: 0, scope_n: 0, consent_n: 0, identity_n: 0, state_n: 0,
  receipt_n: 0, report_n: 0, duplicate_receipt_n: 0, private_input_n: 0, stalled_n: 0, unresolved_n: 0
});
export const PROPERTY_LEDGER_SQL = `
WITH saved AS (
 SELECT r.*, c.org_id AS client_org, s.org_id AS staff_org
   FROM crs_property_requests r
   LEFT JOIN clients c ON c.id=r.client_id
   LEFT JOIN staff s ON s.id=r.requester_staff_id
  WHERE r.org_id=$1::uuid
  ORDER BY r.created_at DESC, r.id
  LIMIT 5001
), facts AS (
 SELECT *, CASE WHEN jsonb_typeof(normalized_response->'properties')='array'
   THEN jsonb_array_length(normalized_response->'properties') ELSE NULL END AS property_count
 FROM saved
)
SELECT count(*)::int AS rows_n,
 count(*) FILTER (WHERE client_org IS DISTINCT FROM org_id
   OR staff_org IS DISTINCT FROM org_id)::int AS scope_n,
 count(*) FILTER (WHERE consent_accepted_at IS NULL OR consent_accepted_at>now()+interval '5 minutes'
   OR consent_version IS DISTINCT FROM 'property-report-2026-11-06'
   OR length(btrim(COALESCE(consent_text,'')))<40)::int AS consent_n,
 count(*) FILTER (WHERE identity_fingerprint IS NULL
   OR identity_fingerprint !~ '^[a-f0-9]{64}$'
   OR identity_version_fingerprint IS NULL
   OR identity_version_fingerprint !~ '^[a-f0-9]{64}$')::int AS identity_n,
 count(*) FILTER (WHERE environment NOT IN ('sandbox','production')
   OR environment IS NULL OR status NOT IN ('in_flight','completed','needs_review','error')
   OR status IS NULL OR created_at IS NULL OR updated_at IS NULL
   OR created_at>now()+interval '5 minutes'
   OR finished_at<created_at
   OR (status='in_flight' AND finished_at IS NOT NULL)
   OR (status<>'in_flight' AND finished_at IS NULL))::int AS state_n,
 count(*) FILTER (WHERE (provider_request_id IS NOT NULL AND provider_request_id::text !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
   OR (status='completed' AND (provider_request_id IS NULL
   OR normalized_response->>'providerRequestId' IS DISTINCT FROM provider_request_id::text)))::int AS receipt_n,
 count(*) FILTER (WHERE status='completed' AND (
   normalized_response IS NULL OR jsonb_typeof(normalized_response) IS DISTINCT FROM 'object'
   OR normalized_response->>'product' IS DISTINCT FROM 'PitchPoint Property Ownership (Foreclosure)'
   OR property_count IS NULL OR property_count>200
   OR jsonb_typeof(normalized_response->'associatedAddressCount') IS DISTINCT FROM 'number'
   OR normalized_response->>'associatedAddressCount' IS DISTINCT FROM property_count::text
   OR jsonb_typeof(normalized_response->'summary') IS DISTINCT FROM 'object'
   OR COALESCE(normalized_response#>>'{summary,relatedAddressCount}','') !~ '^[0-9]+$'
   OR COALESCE(normalized_response#>>'{summary,ownedPropertyCount}','') !~ '^[0-9]+$'
   OR COALESCE(normalized_response#>>'{summary,foreclosureEventCount}','') !~ '^[0-9]+$'
   OR jsonb_typeof(normalized_response#>'{summary,relatedAddressCount}') IS DISTINCT FROM 'number'
   OR jsonb_typeof(normalized_response#>'{summary,ownedPropertyCount}') IS DISTINCT FROM 'number'
   OR jsonb_typeof(normalized_response#>'{summary,foreclosureEventCount}') IS DISTINCT FROM 'number'
   OR jsonb_typeof(normalized_response->'currentMortgageBalance') IS DISTINCT FROM 'null'
   OR jsonb_typeof(normalized_response->'currentEquity') IS DISTINCT FROM 'null'
   OR jsonb_typeof(normalized_response->'currentValuation') IS DISTINCT FROM 'null'
   OR EXISTS (
     SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(normalized_response->'properties')='array'
       THEN normalized_response->'properties' ELSE '[]'::jsonb END) AS property(value)
      WHERE jsonb_typeof(property.value) IS DISTINCT FROM 'object'
       OR jsonb_typeof(property.value->'borrowerOwnedAsset') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(property.value->'address') IS DISTINCT FROM 'object'
       OR jsonb_typeof(property.value->'providerCurrentOwners') IS DISTINCT FROM 'array'
       OR jsonb_typeof(property.value->'transactions') IS DISTINCT FROM 'array'
       OR jsonb_typeof(property.value->'transactionCount') IS DISTINCT FROM 'number'
       OR COALESCE(property.value->>'transactionCount','') !~ '^[0-9]+$'
       OR jsonb_typeof(property.value->'transactionsTruncated') IS DISTINCT FROM 'boolean'
       OR NOT (property.value ? 'recordedRecentSalePrice')
       OR jsonb_typeof(property.value->'recordedRecentSalePrice') NOT IN ('number','null')
       OR CASE WHEN jsonb_typeof(property.value->'recordedRecentSalePrice')='number'
         THEN (property.value->>'recordedRecentSalePrice')::numeric<0 ELSE false END
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE
         WHEN jsonb_typeof(property.value->'providerCurrentOwners')='array'
         THEN property.value->'providerCurrentOwners' ELSE '[]'::jsonb END) AS owner(value)
         WHERE jsonb_typeof(owner.value) IS DISTINCT FROM 'string')
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE
         WHEN jsonb_typeof(property.value->'transactions')='array'
         THEN property.value->'transactions' ELSE '[]'::jsonb END) AS transaction(value)
         WHERE jsonb_typeof(transaction.value) IS DISTINCT FROM 'object'
           OR jsonb_typeof(transaction.value->'originalLoanAmount') NOT IN ('number','null')
           OR jsonb_typeof(transaction.value->'salePrice') NOT IN ('number','null')
           OR NOT (transaction.value ? 'originalLoanAmount')
           OR NOT (transaction.value ? 'salePrice')
           OR CASE WHEN jsonb_typeof(transaction.value->'originalLoanAmount')='number'
             THEN (transaction.value->>'originalLoanAmount')::numeric<0 ELSE false END
           OR CASE WHEN jsonb_typeof(transaction.value->'salePrice')='number'
             THEN (transaction.value->>'salePrice')::numeric<0 ELSE false END))))::int AS report_n,
 count(*) FILTER (WHERE provider_request_id IN (
   SELECT provider_request_id FROM facts WHERE provider_request_id IS NOT NULL
   GROUP BY provider_request_id HAVING count(*)>1))::int AS duplicate_receipt_n,
 count(*) FILTER (WHERE normalized_response::text ~* '"(ssn|ssn_enc|dob|birthDate|password|token|refreshToken|Input)"[[:space:]]*:')::int AS private_input_n,
 count(*) FILTER (WHERE status='in_flight' AND created_at<now()-interval '15 minutes')::int AS stalled_n,
 count(*) FILTER (WHERE status IN ('needs_review','error'))::int AS unresolved_n
FROM facts
`.trim();

export async function readPropertyReportTruth(ctx = {}) {
  const id = CHECK_IDS[0], run = runnerOf(ctx);
  const fail = detail => [row(id, "FAIL", detail,
    "Read the saved property claim, consent, identity binding and provider receipt. Resolve the recorded cause; never order a report or auto-retry CRS from this check.")];
  if (!run) return fail("Property report integrity was not read: no database reader.");
  if (typeof ctx.orgId !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(ctx.orgId)) {
    return fail("Property report integrity was not read: no valid company scope.");
  }
  try {
    const out = await run(tx => tx.query(PROPERTY_LEDGER_SQL, [ctx.orgId]));
    const counts = out.rows?.[0];
    const keys = Object.keys(PROPERTY_LEDGER_COUNTS);
    if (!counts || keys.some(key => counts[key] == null || counts[key] === ""
        || !Number.isSafeInteger(Number(counts[key])) || Number(counts[key]) < 0)) {
      return fail("Property report integrity returned incomplete counts; no healthy result was established.");
    }
    if (Number(counts.rows_n) > 5000) return fail("Property report integrity exceeded its saved-row limit; the complete ledger was not judged.");
    const broken = keys.filter(key => key !== "rows_n" && Number(counts[key]) > 0);
    if (broken.length) return fail(`Saved property report break: ${broken.map(key => `${key}=${counts[key]}`).join(", ")}. No identity or report values were exposed.`);
    return [row(id, "PASS", Number(counts.rows_n) === 0
      ? "No property reports are saved. Stored integrity is clear; no production report or client flow is proved."
      : "Saved property claims, consent and normalized receipts are consistent. This does not prove current equity, a new provider order or a live client flow.")];
  } catch {
    return fail("Property report integrity could not be read; a failed SQL or missing table is not a healthy report ledger.");
  }
}
