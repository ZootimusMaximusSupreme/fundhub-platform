// Finish-853 batch 07: the read-only SQL texts for the money vault, Plaid link, lenders Apply, business fields, agreements and social live checks.
// Each takes the company as $1::uuid and answers sample_count and bad_count. The common subset of
// Postgres and SQLite on purpose (see fin-b07-display-contracts.mjs), so the test can run the text.
// Imports nothing.

const W60 = "now() - interval '60 days'";
const W30 = "now() - interval '30 days'";

// ── Money vault, Plaid door, lenders Apply, business fields, agreements, social ──────────────

export const VAULT_UPLOAD_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE d.client_id IS NULL OR cl.id IS NULL
         OR v.id IS NULL
         OR v.document_id IS DISTINCT FROM d.id
         OR NULLIF(BTRIM(COALESCE(v.storage_key, '')), '') IS NULL
         OR COALESCE(v.byte_size, 0) <= 0
         OR NULLIF(BTRIM(COALESCE(v.checksum, '')), '') IS NULL
         OR COALESCE(v.mime_type, '') NOT IN ('application/pdf', 'image/png', 'image/jpeg')
         OR v.storage_key IS DISTINCT FROM d.storage_key
         OR (d.metadata->>'entity_id' IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM entities en
                WHERE en.org_id = d.org_id AND en.client_id = d.client_id
                  AND en.id::text = d.metadata->>'entity_id')))::int AS bad_count
  FROM documents d
  LEFT JOIN clients cl ON cl.org_id = d.org_id AND cl.id = d.client_id
  LEFT JOIN document_versions v ON v.org_id = d.org_id AND v.id = d.current_version_id
 WHERE d.org_id = $1::uuid
   AND (d.generated_by LIKE 'client:%' OR d.generated_by LIKE 'staff:%')
   AND COALESCE(d.is_demo, false) = false
   AND d.created_at >= ${W60}`;

export const LINK_EXCHANGE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR i.plaid_item_id IS NULL
         OR (i.link_state = 'active' AND (
               NULLIF(BTRIM(COALESCE(i.encrypted_access_token, '')), '') IS NULL
               OR i.consent_granted_at IS NULL
               OR NOT EXISTS (
                    SELECT 1 FROM bank_accounts b
                     WHERE b.org_id = i.org_id AND b.plaid_item_id = i.id)))
         OR (i.link_state = 'error' AND NULLIF(BTRIM(COALESCE(i.last_error_code, '')), '') IS NULL)
         OR EXISTS (
              SELECT 1 FROM bank_accounts b
               WHERE b.plaid_item_id = i.id
                 AND (b.client_id IS DISTINCT FROM i.client_id OR b.org_id IS DISTINCT FROM i.org_id)))::int AS bad_count
  FROM plaid_items i
  LEFT JOIN clients cl ON cl.org_id = i.org_id AND cl.id = i.client_id
 WHERE i.org_id = $1::uuid AND COALESCE(cl.is_demo, false) = false
   AND i.created_at >= ${W60}`;

export const LENDER_APPLY_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR NULLIF(BTRIM(COALESCE(ps.application_url, '')), '') IS NULL
         OR (ps.lender_id IS NULL AND ps.application_id IS NULL)
         OR (ps.application_id IS NOT NULL AND (ap.id IS NULL OR ap.client_id IS DISTINCT FROM ps.client_id))
         OR (ps.status = 'active' AND (ps.exit_ip IS NULL OR ps.granted_city IS NULL AND ps.granted_region IS NULL))
         OR (ps.status = 'verifying' AND ps.started_at < now() - interval '15 minutes')
         OR (ps.status IN ('failed', 'mismatch') AND NULLIF(BTRIM(COALESCE(ps.error_code, '')), '') IS NULL))::int AS bad_count
  FROM proxy_sessions ps
  LEFT JOIN clients cl ON cl.org_id = ps.org_id AND cl.id = ps.client_id
  LEFT JOIN applications ap ON ap.org_id = ps.org_id AND ap.id = ps.application_id
 WHERE ps.org_id = $1::uuid AND COALESCE(cl.is_demo, false) = false
   AND ps.started_at >= ${W60}`;

export const APPLY_DIALOG_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ps.ended_at IS NULL
         OR ps.ended_at < ps.started_at
         OR ps.staff_id IS NULL)::int AS bad_count
  FROM proxy_sessions ps
 WHERE ps.org_id = $1::uuid AND ps.status IN ('ended', 'failed', 'mismatch')
   AND ps.started_at >= ${W60}`;

export const BUSINESS_FIELDS_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR NULLIF(BTRIM(COALESCE(b.name, '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(b.entity_data->>'address_line1', '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(b.entity_data->>'city', '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(b.entity_data->>'state', '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(b.entity_data->>'postal_code', '')), '') IS NULL
         OR COALESCE(b.entity_data->>'ein', '') NOT LIKE '__-_______'
         OR COALESCE(b.entity_data->>'incorporated_date', '') NOT LIKE '____-__%'
         OR b.age_months IS NULL OR b.age_months < 0
         OR CASE WHEN b.entity_data->>'incorporated_date' LIKE '____-__%'
                 THEN b.age_months > (date_part('year', now()) - CAST(substr(b.entity_data->>'incorporated_date', 1, 4) AS INTEGER)) * 12
                                   + (date_part('month', now()) - CAST(substr(b.entity_data->>'incorporated_date', 6, 2) AS INTEGER))
                 ELSE false END)::int AS bad_count
  FROM businesses b
  LEFT JOIN clients cl ON cl.org_id = b.org_id AND cl.id = b.client_id
 WHERE b.org_id = $1::uuid AND b.entity_data->>'source' = 'soft_pull_approve'
   AND COALESCE(cl.is_demo, false) = false
   AND b.created_at >= ${W60}`;

export const AGREEMENTS_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE s.id IS NULL
         OR (k.status IN ('sent', 'viewed', 'signed') AND k.document_id IS NULL)
         OR (k.status = 'signed' AND (
               k.signed_at IS NULL
               OR NULLIF(BTRIM(COALESCE(k.signer_name, '')), '') IS NULL
               OR k.signed_document_id IS NULL
               OR sd.id IS NULL)))::int AS bad_count
  FROM contracts k
  LEFT JOIN staff s ON s.org_id = k.org_id AND s.id = k.staff_id
  LEFT JOIN documents sd ON sd.org_id = k.org_id AND sd.id = k.signed_document_id
 WHERE k.org_id = $1::uuid AND k.staff_id IS NOT NULL
   AND COALESCE(k.is_demo, false) = false
   AND k.updated_at >= ${W60}`;

export const SOCIAL_CONNECT_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE p.id IS NULL
         OR p.org_id IS DISTINCT FROM sc.org_id
         OR sc.channel NOT IN ('facebook', 'instagram', 'linkedin')
         OR NULLIF(BTRIM(COALESCE(sc.external_account_id, '')), '') IS NULL
         OR (sc.channel = 'linkedin' AND lower(sc.external_account_id) LIKE 'urn:%')
         OR (sc.connection_state = 'active'
             AND NULLIF(BTRIM(COALESCE(sc.encrypted_access_token, '')), '') IS NULL))::int AS bad_count
  FROM social_channels sc
  LEFT JOIN partners p ON p.id = sc.partner_id
 WHERE sc.org_id = $1::uuid AND COALESCE(p.is_demo, false) = false
   AND sc.created_at >= ${W60}`;


