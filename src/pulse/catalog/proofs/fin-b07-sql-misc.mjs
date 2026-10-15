// Finish-853 batch 07: the read-only SQL texts for the money vault, Plaid link, lenders Apply, business fields, agreements and social live checks.
// Each takes the company as $1::uuid and answers sample_count and bad_count. The common subset of
// Postgres and SQLite on purpose (see fin-b07-display-contracts.mjs), so the test can run the text.
// translate() is the one Postgres function the stand-in database adds (fin-b07-sql-kit.mjs).
// Imports nothing.

const W60 = "now() - interval '60 days'";
const W30 = "now() - interval '30 days'";

// ── Money vault, Plaid door, lenders Apply, business fields, agreements, social ──────────────

// "One document per file": api/documents-upload.mjs gives every file its own random key, so an upload
// that holds more than one version has collapsed several files onto one document, and two documents
// that name the same stored object are one file saved twice. The container (metadata.entity_id) must
// be a business of the same client that was not archived before the paper arrived.
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
         OR (SELECT count(*) FROM document_versions vv WHERE vv.document_id = d.id) > 1
         OR EXISTS (SELECT 1 FROM documents o
                     WHERE o.org_id = d.org_id AND o.id <> d.id AND o.storage_key = d.storage_key)
         OR (d.metadata->>'entity_id' IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM entities en
                WHERE en.org_id = d.org_id AND en.client_id = d.client_id
                  AND en.id::text = d.metadata->>'entity_id'
                  AND en.kind = 'business'
                  AND (en.archived_at IS NULL OR en.archived_at > d.created_at))))::int AS bad_count
  FROM documents d
  LEFT JOIN clients cl ON cl.org_id = d.org_id AND cl.id = d.client_id
  LEFT JOIN document_versions v ON v.org_id = d.org_id AND v.id = d.current_version_id
 WHERE d.org_id = $1::uuid
   AND (d.generated_by LIKE 'client:%' OR d.generated_by LIKE 'staff:%')
   AND COALESCE(d.is_demo, false) = false
   AND d.created_at >= ${W60}`;

// The token is stored sealed: encryptPlaidToken writes "<key id>:<iv>:<tag>:<ciphertext>", exactly four
// parts. A bare Plaid access token has no colon, so a stored plaintext reads wrong here. The consent
// scope is what the client agreed to when Link finished, written as ["accounts"]; an empty list means
// the item holds a login with no stated permission. "Every account" cannot be counted from the saved
// rows (Plaid's list is not kept), so it is judged as at least one saved account of the same client;
// the full list is held by fin-b07-link-exchange.test.mjs, which runs the real exchange.
export const LINK_EXCHANGE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR i.plaid_item_id IS NULL
         OR (i.link_state = 'active' AND (
               NULLIF(BTRIM(COALESCE(i.encrypted_access_token, '')), '') IS NULL
               OR i.encrypted_access_token NOT LIKE '_%:_%:_%:_%'
               OR i.encrypted_access_token LIKE '%:%:%:%:%'
               OR i.consent_granted_at IS NULL
               OR COALESCE(i.consent_scope::text, '[]') IN ('[]', 'null')
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

const STATES = [
  ["AL", "alabama"], ["AK", "alaska"], ["AZ", "arizona"], ["AR", "arkansas"], ["CA", "california"],
  ["CO", "colorado"], ["CT", "connecticut"], ["DE", "delaware"], ["DC", "district_of_columbia"],
  ["FL", "florida"], ["GA", "georgia"], ["HI", "hawaii"], ["ID", "idaho"], ["IL", "illinois"],
  ["IN", "indiana"], ["IA", "iowa"], ["KS", "kansas"], ["KY", "kentucky"], ["LA", "louisiana"],
  ["ME", "maine"], ["MD", "maryland"], ["MA", "massachusetts"], ["MI", "michigan"], ["MN", "minnesota"],
  ["MS", "mississippi"], ["MO", "missouri"], ["MT", "montana"], ["NE", "nebraska"], ["NV", "nevada"],
  ["NH", "new_hampshire"], ["NJ", "new_jersey"], ["NM", "new_mexico"], ["NY", "new_york"],
  ["NC", "north_carolina"], ["ND", "north_dakota"], ["OH", "ohio"], ["OK", "oklahoma"], ["OR", "oregon"],
  ["PA", "pennsylvania"], ["RI", "rhode_island"], ["SC", "south_carolina"], ["SD", "south_dakota"],
  ["TN", "tennessee"], ["TX", "texas"], ["UT", "utah"], ["VT", "vermont"], ["VA", "virginia"],
  ["WA", "washington"], ["WV", "west_virginia"], ["WI", "wisconsin"], ["WY", "wyoming"],
];
const STATE_NAMES = `(VALUES ${STATES.map(([abbr, name]) => `('${abbr}', '${name}')`).join(", ")})`;

/** A place the way src/adapters/oxylabs.mjs normalizeCity writes it: lower case, no apostrophe or full stop, dashes and spaces to underscores. */
const placeKey = (expr) => `replace(replace(replace(replace(lower(trim(COALESCE(${expr}, ''))), '''', ''), '.', ''), '-', '_'), ' ', '_')`;

// A session is the audit trail of where a bank application came from, so three things can be wrong
// with it beyond a blank field. (1) The application address is not the lender's (or the
// application's own): the advisor would be sent to another bank's page. It is judged only when that
// row has not been edited since the session began, because an edited address is a new fact, not a
// wrong one. (2) An ACTIVE session whose granted place is not the requested one: at city level one
// city name must sit inside the other, the way citiesMatch matches them; at state level the granted
// region must be the requested state, by abbreviation or by name. (3) A session that never closed:
// verifying for more than fifteen minutes.
export const LENDER_APPLY_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR NULLIF(BTRIM(COALESCE(ps.application_url, '')), '') IS NULL
         OR (ps.lender_id IS NULL AND ps.application_id IS NULL)
         OR (ps.application_id IS NOT NULL AND (ap.id IS NULL OR ap.client_id IS DISTINCT FROM ps.client_id))
         OR (ap.application_url IS NOT NULL AND ap.updated_at <= ps.started_at
             AND ps.application_url IS DISTINCT FROM ap.application_url)
         OR (ps.lender_id IS NOT NULL AND ap.application_url IS NULL
             AND ln.application_url IS NOT NULL AND ln.updated_at <= ps.started_at
             AND ps.application_url IS DISTINCT FROM ln.application_url)
         OR (ps.status = 'active' AND (ps.exit_ip IS NULL OR ps.granted_city IS NULL AND ps.granted_region IS NULL))
         OR (ps.status = 'active' AND ps.targeting_level = 'city' AND NOT (
               ${placeKey("ps.granted_city")} LIKE '%' || ${placeKey("ps.requested_city")} || '%'
               OR ${placeKey("ps.requested_city")} LIKE '%' || ${placeKey("ps.granted_city")} || '%'))
         OR (ps.status = 'active' AND ps.targeting_level = 'state' AND NOT EXISTS (
               SELECT 1 FROM ${STATE_NAMES} st
                WHERE (upper(trim(COALESCE(ps.requested_state, ''))) = st.column1
                       OR replace(${placeKey("ps.requested_state")}, 'us_', '') = st.column2)
                  AND (upper(trim(COALESCE(ps.granted_region, ''))) = st.column1
                       OR ${placeKey("ps.granted_region")} LIKE '%' || st.column2 || '%')))
         OR (ps.status = 'verifying' AND ps.started_at < now() - interval '15 minutes')
         OR (ps.status IN ('failed', 'mismatch') AND NULLIF(BTRIM(COALESCE(ps.error_code, '')), '') IS NULL))::int AS bad_count
  FROM proxy_sessions ps
  LEFT JOIN clients cl ON cl.org_id = ps.org_id AND cl.id = ps.client_id
  LEFT JOIN applications ap ON ap.org_id = ps.org_id AND ap.id = ps.application_id
  LEFT JOIN lenders ln ON ln.org_id = ps.org_id AND ln.id = ps.lender_id
 WHERE ps.org_id = $1::uuid AND COALESCE(cl.is_demo, false) = false
   AND ps.started_at >= ${W60}`;

// "End session" is the only button here that leaves a trace, and a session it never ended stays
// 'active' (which this query cannot tell from one nobody pressed it on). So this judges the rows
// that ARE closed: an end time that is not before the start, and the staff member who launched it.
// That End session really ends an active session is held by fin-b07-apply-dialog.test.mjs, which
// runs the real launch and the real end against this same table.
export const APPLY_DIALOG_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ps.ended_at IS NULL
         OR ps.ended_at < ps.started_at
         OR ps.staff_id IS NULL)::int AS bad_count
  FROM proxy_sessions ps
 WHERE ps.org_id = $1::uuid AND ps.status IN ('ended', 'failed', 'mismatch')
   AND ps.started_at >= ${W60}`;

const DIGITS = "'0123456789'";
const ZIP = "COALESCE(b.entity_data->>'postal_code', '')";
const EIN = "COALESCE(b.entity_data->>'ein', '')";
const STATE = "COALESCE(b.entity_data->>'state', '')";
const INC = "b.entity_data->>'incorporated_date'";

// The eight fields the staff approve form saves for a business, judged by the shape the approve
// handler (api/soft-pull-approve.mjs) enforces, plus the one rule the handler cannot: a ZIP is five
// digits (or nine, or ZIP+4), which the handler only checks as "not blank".
//   state   two capital letters
//   EIN     two digits, a dash, seven digits
//   month   YYYY-MM (or YYYY-MM-DD), month 1 to 12
//   age     the months between that month and the day the row was saved, within one month either way.
//           It is judged both ways: an age of 0 on a 2010 business is as wrong as 400 on a 2025 one.
// "Extra owner" is optional and saved as typed or empty, so it has no wrong value to read back; its
// save is held by src/http/soft-pull-approve.test.mjs.
export const BUSINESS_FIELDS_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR NULLIF(BTRIM(COALESCE(b.name, '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(b.entity_data->>'address_line1', '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(b.entity_data->>'city', '')), '') IS NULL
         OR NOT (length(${STATE}) = 2 AND translate(${STATE}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '') = '')
         OR NOT ((length(${ZIP}) IN (5, 9) AND translate(${ZIP}, ${DIGITS}, '') = '')
                 OR (length(${ZIP}) = 10 AND substr(${ZIP}, 6, 1) IN ('-', ' ')
                     AND translate(substr(${ZIP}, 1, 5) || substr(${ZIP}, 7, 4), ${DIGITS}, '') = ''))
         OR NOT (length(${EIN}) = 10 AND substr(${EIN}, 3, 1) = '-'
                 AND translate(substr(${EIN}, 1, 2) || substr(${EIN}, 4, 7), ${DIGITS}, '') = '')
         OR b.age_months IS NULL OR b.age_months < 0
         OR CASE WHEN length(COALESCE(${INC}, '')) >= 7 AND substr(${INC}, 5, 1) = '-'
                      AND translate(substr(${INC}, 1, 4) || substr(${INC}, 6, 2), ${DIGITS}, '') = ''
                 THEN CASE WHEN CAST(substr(${INC}, 6, 2) AS INTEGER) BETWEEN 1 AND 12
                           THEN ABS(COALESCE(b.age_months, 0)
                                    - ((CAST(substr(CAST(b.created_at AS text), 1, 4) AS INTEGER) - CAST(substr(${INC}, 1, 4) AS INTEGER)) * 12
                                       + (CAST(substr(CAST(b.created_at AS text), 6, 2) AS INTEGER) - CAST(substr(${INC}, 6, 2) AS INTEGER)))) > 1
                           ELSE true END
                 ELSE true END)::int AS bad_count
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

