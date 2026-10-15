// Finish-853 batch 07: the read-only SQL texts for the Specialist desk case drawer, work queue, identity line and erasure live checks.
// Each takes the company as $1::uuid and answers sample_count and bad_count. The common subset of
// Postgres and SQLite on purpose (see fin-b07-display-contracts.mjs), so the test can run the text.
// Imports nothing.

const W60 = "now() - interval '60 days'";
const W30 = "now() - interval '30 days'";

// ── Specialist desk: inquiry removal cases ───────────────────────────────────────────────────

export const CASE_CLOSE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE c.closed_at IS NULL
         OR cl.id IS NULL
         OR (c.completed_at IS NULL AND EXISTS (
              SELECT 1 FROM events e
               WHERE e.org_id = c.org_id AND e.name = 'inquiry.removed'
                 AND (e.payload->>'inquiryRemovalCaseId' = c.id::text OR e.payload->>'caseId' = c.id::text))))::int AS bad_count
  FROM inquiry_removal_cases c
  LEFT JOIN clients cl ON cl.org_id = c.org_id AND cl.id = c.client_id
 WHERE c.org_id = $1::uuid AND c.case_status::text = 'Canceled'
   AND COALESCE(c.is_demo, false) = false
   AND c.updated_at >= ${W60}`;

// The receipt is matched to THIS case. Every writer of inquiry.removed names the case it closed:
// api/inquiry-cases.mjs and the IRA webhook carry the case row id (payload.inquiryRemovalCaseId or
// payload.caseId), and src/inquiries/work.mjs carries it as payload.caseId. A client can hold up to
// three open cases (one per bureau), so matching on the client alone let one case's receipt cover
// a sibling case whose own emit was lost.
export const CASE_CLEARED_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE c.completed_at IS NULL
         OR cl.id IS NULL
         OR NOT EXISTS (
              SELECT 1 FROM events e
               WHERE e.org_id = c.org_id AND e.name = 'inquiry.removed'
                 AND e.client_id = c.client_id
                 AND (e.payload->>'inquiryRemovalCaseId' = c.id::text OR e.payload->>'caseId' = c.id::text)
                 AND e.created_at >= COALESCE(c.requested_at, c.created_at)))::int AS bad_count
  FROM inquiry_removal_cases c
  LEFT JOIN clients cl ON cl.org_id = c.org_id AND cl.id = c.client_id
 WHERE c.org_id = $1::uuid AND c.case_status::text = 'Completed'
   AND COALESCE(c.is_demo, false) = false
   AND c.updated_at >= ${W60}`;

export const CASE_GENERATE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE c.id IS NULL
         OR l.client_id IS DISTINCT FROM c.client_id
         OR l.org_id IS DISTINCT FROM c.org_id
         OR (upper(COALESCE(l.bureau, '')) IN ('EX', 'EQ', 'TU') AND NOT (
               upper(COALESCE(c.selected_bureaus_raw, '')) LIKE '%' || upper(l.bureau) || '%'
               OR (upper(l.bureau) = 'TU' AND upper(COALESCE(c.selected_bureaus_raw, '')) LIKE '%TRANS%'))))::int AS bad_count
  FROM inquiry_log l
  LEFT JOIN inquiry_removal_cases c ON c.id = l.case_id
 WHERE l.org_id = $1::uuid AND l.case_id IS NOT NULL
   AND COALESCE(l.is_demo, false) = false
   AND l.updated_at >= ${W60}`;

// A letter or portal attempt belongs to a case when it is the same client, the same bureau (send.mjs
// copies the case's bureau onto the inquiry line it logs the attempt on) and was logged after the case
// was requested. A sibling case holds another bureau, so its attempt can never stand in for this one.
const OWN_ATTEMPT = `a.org_id = c.org_id AND l.client_id = c.client_id
                  AND upper(COALESCE(l.bureau, '')) = upper(COALESCE(c.selected_bureaus_raw, ''))
                  AND a.created_at >= c.requested_at`;

export const CASE_SEND_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR c.case_status::text = 'Queued'
         OR (c.letter_provider_id IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM inquiry_attempts a
                 JOIN inquiry_log l ON l.id = a.inquiry_id
                WHERE ${OWN_ATTEMPT}
                  AND a.kind = 'letter' AND a.outcome = 'sent'))
         OR (c.portal_confirmation IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM inquiry_attempts a
                 JOIN inquiry_log l ON l.id = a.inquiry_id
                WHERE ${OWN_ATTEMPT}
                  AND a.kind = 'portal' AND a.note = 'experian_ref:' || c.portal_confirmation))
         OR (c.case_status::text = 'In Progress'
             AND c.letter_provider_id IS NULL AND c.portal_confirmation IS NULL
             AND EXISTS (
               SELECT 1 FROM inquiry_attempts a
                 JOIN inquiry_log l ON l.id = a.inquiry_id
                WHERE ${OWN_ATTEMPT}
                  AND a.kind = 'letter' AND a.outcome LIKE 'mail_failed%')
             AND NOT EXISTS (
               SELECT 1 FROM inquiry_attempts a
                 JOIN inquiry_log l ON l.id = a.inquiry_id
                WHERE ${OWN_ATTEMPT}
                  AND a.kind = 'letter' AND a.outcome = 'sent')))::int AS bad_count
  FROM inquiry_removal_cases c
  LEFT JOIN clients cl ON cl.org_id = c.org_id AND cl.id = c.client_id
 WHERE c.org_id = $1::uuid
   AND (c.letter_provider_id IS NOT NULL OR c.portal_confirmation IS NOT NULL
        OR EXISTS (
             SELECT 1 FROM inquiry_attempts a
               JOIN inquiry_log l ON l.id = a.inquiry_id
              WHERE ${OWN_ATTEMPT}
                AND a.kind IN ('letter', 'portal')))
   AND COALESCE(c.is_demo, false) = false
   AND c.updated_at >= ${W60}`;

// What can be wrong on the saved row behind each column of the queue. Client: the client belongs to
// another company (the join pins the company; the column itself is NOT NULL with a foreign key).
// Bureau: blank. Items: LOWER than the open inquiries attached to the case (a stale count: Send adds
// inquiry lines and never refreshes the number), which also covers a count below zero. A count HIGHER
// than the attached lines is normal before "Generate letters" has staged them, so that direction is
// not judged. Round: the round is missing, or belongs to another client or company. Status, Docs, Call and Delivery are drawn
// from the case row by the page and the read handler (see the page and handler practice tests).
export const CASE_QUEUE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR NULLIF(BTRIM(COALESCE(c.selected_bureaus_raw, '')), '') IS NULL
         OR COALESCE(c.open_inquiry_count, 0) < (
              SELECT count(*) FROM inquiry_log o
               WHERE o.org_id = c.org_id AND o.case_id = c.id AND COALESCE(o.is_open, true) = true)
         OR (c.funding_round_id IS NOT NULL AND fr.client_id IS DISTINCT FROM c.client_id))::int AS bad_count
  FROM inquiry_removal_cases c
  LEFT JOIN clients cl ON cl.org_id = c.org_id AND cl.id = c.client_id
  LEFT JOIN funding_rounds fr ON fr.org_id = c.org_id AND fr.id = c.funding_round_id
 WHERE c.org_id = $1::uuid
   AND c.case_status::text IN ('Queued', 'Scheduled', 'In Progress', 'Escalated', 'Blocked')
   AND COALESCE(c.is_demo, false) = false
   AND c.updated_at >= ${W60}`;

export const CASE_STATUS_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE (c.case_status::text = 'Completed' AND c.completed_at IS NULL)
         OR (c.case_status::text = 'Canceled' AND c.closed_at IS NULL)
         OR (c.case_status::text NOT IN ('Queued', 'Scheduled', 'In Progress', 'Escalated', 'Blocked', 'Completed', 'Canceled')))::int AS bad_count
  FROM inquiry_removal_cases c
 WHERE c.org_id = $1::uuid
   AND COALESCE(c.is_demo, false) = false
   AND c.updated_at >= ${W60}`;

// The control sends subtype additional_fraud_docs. api/documents-upload.mjs files an unrecognised
// subtype as "other" and keeps what the caller asked for in metadata.label.given, so a file the
// button sent is found by either name, and one filed under any other subtype is wrong.
export const CASE_UPLOAD_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR d.subtype IS DISTINCT FROM 'additional_fraud_docs'
         OR v.id IS NULL
         OR NULLIF(BTRIM(COALESCE(v.storage_key, '')), '') IS NULL
         OR COALESCE(v.byte_size, 0) <= 0
         OR NULLIF(BTRIM(COALESCE(v.checksum, '')), '') IS NULL
         OR COALESCE(v.mime_type, '') NOT IN ('application/pdf', 'image/png', 'image/jpeg'))::int AS bad_count
  FROM documents d
  LEFT JOIN clients cl ON cl.org_id = d.org_id AND cl.id = d.client_id
  LEFT JOIN document_versions v ON v.org_id = d.org_id AND v.id = d.current_version_id
 WHERE d.org_id = $1::uuid
   AND (d.subtype = 'additional_fraud_docs' OR d.metadata->'label'->>'given' = 'additional_fraud_docs')
   AND COALESCE(d.is_demo, false) = false
   AND d.created_at >= ${W60}`;

// ── Specialist desk: the work queue (inquiry_log) ────────────────────────────────────────────

export const WORK_QUEUE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR NULLIF(BTRIM(COALESCE(l.bureau, '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(l.inquiry_name, l.inquiry, '')), '') IS NULL
         OR COALESCE(l.call_attempts, 0) < 0)::int AS bad_count
  FROM inquiry_log l
  LEFT JOIN clients cl ON cl.org_id = l.org_id AND cl.id = l.client_id
 WHERE l.org_id = $1::uuid AND COALESCE(l.is_open, true) = true
   AND COALESCE(l.is_demo, false) = false
   AND l.updated_at >= ${W60}`;

export const WORK_ROW_SQL = `
SELECT ((SELECT count(*) FROM inquiry_attempts a
          JOIN inquiry_log l ON l.id = a.inquiry_id
         WHERE a.org_id = $1::uuid AND COALESCE(l.is_demo, false) = false AND a.created_at >= ${W60})
      + (SELECT count(*) FROM pii_identity p
          JOIN clients c ON c.org_id = p.org_id AND c.id = p.client_id
         WHERE p.org_id = $1::uuid AND p.ssn_enc IS NOT NULL AND COALESCE(c.is_demo, false) = false
           AND p.updated_at >= ${W60}))::int AS sample_count,
       ((SELECT count(*) FROM inquiry_attempts a
          JOIN inquiry_log l ON l.id = a.inquiry_id
          LEFT JOIN staff s ON s.id = a.staff_id
         WHERE a.org_id = $1::uuid AND COALESCE(l.is_demo, false) = false AND a.created_at >= ${W60}
           AND (l.org_id IS DISTINCT FROM a.org_id OR s.id IS NULL OR s.org_id IS DISTINCT FROM a.org_id
                OR NULLIF(BTRIM(COALESCE(s.name, '')), '') IS NULL))
      + (SELECT count(*) FROM pii_identity p
          JOIN clients c ON c.org_id = p.org_id AND c.id = p.client_id
         WHERE p.org_id = $1::uuid AND p.ssn_enc IS NOT NULL AND COALESCE(c.is_demo, false) = false
           AND p.updated_at >= ${W60} AND length(p.ssn_enc) < 30))::int AS bad_count`;

export const LOG_ATTEMPT_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE l.id IS NULL
         OR l.org_id IS DISTINCT FROM a.org_id
         OR s.id IS NULL
         OR s.org_id IS DISTINCT FROM a.org_id
         OR COALESCE(l.call_attempts, 0) IS DISTINCT FROM (
              SELECT count(*) FROM inquiry_attempts x
               WHERE x.inquiry_id = a.inquiry_id AND x.kind IN ('call', 'letter', 'portal')))::int AS bad_count
  FROM inquiry_attempts a
  LEFT JOIN inquiry_log l ON l.id = a.inquiry_id
  LEFT JOIN staff s ON s.id = a.staff_id
 WHERE a.org_id = $1::uuid AND COALESCE(l.is_demo, false) = false
   AND a.created_at >= ${W60}`;

export const MARK_CONFIRMED_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR COALESCE(l.is_open, true) = true
         OR l.cleared_at IS NULL
         OR (c.id IS NOT NULL AND (
               c.client_id IS DISTINCT FROM l.client_id
               OR (c.case_status::text IN ('Queued', 'Scheduled', 'In Progress', 'Escalated', 'Blocked')
                   AND NOT EXISTS (
                     SELECT 1 FROM inquiry_log o
                      WHERE o.case_id = c.id AND COALESCE(o.is_open, true) = true)))))::int AS bad_count
  FROM inquiry_log l
  LEFT JOIN clients cl ON cl.org_id = l.org_id AND cl.id = l.client_id
  LEFT JOIN inquiry_removal_cases c ON c.id = l.case_id
 WHERE l.org_id = $1::uuid AND l.confirmed_at IS NOT NULL
   AND COALESCE(l.is_demo, false) = false
   AND l.updated_at >= ${W60}`;

export const SET_STATUS_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE l.status <> TRIM(l.status)
         OR NULLIF(TRIM(l.status), '') IS NULL
         OR (l.confirmed_at IS NULL AND (
               lower(l.status) LIKE '%removed%' OR lower(l.status) LIKE '%confirmed%'
               OR lower(l.status) LIKE '%deleted%' OR lower(l.status) LIKE '%cleared%')))::int AS bad_count
  FROM inquiry_log l
 WHERE l.org_id = $1::uuid AND l.status IS NOT NULL
   AND COALESCE(l.is_demo, false) = false
   AND l.updated_at >= ${W60}`;

export const SAVE_EXPECTED_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE NULLIF(TRIM(l.expected_name), '') IS NULL
         OR l.expected_name <> TRIM(l.expected_name)
         OR length(l.expected_name) > 200)::int AS bad_count
  FROM inquiry_log l
 WHERE l.org_id = $1::uuid AND l.expected_name IS NOT NULL
   AND COALESCE(l.is_demo, false) = false
   AND l.updated_at >= ${W60}`;

export const REVEAL_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR NULLIF(BTRIM(COALESCE(a.accessed_by, '')), '') IS NULL
         OR a.field NOT LIKE 'ssn (%)'
         OR (length(a.accessed_by) = 36 AND s.id IS NULL))::int AS bad_count
  FROM pii_access_log a
  LEFT JOIN clients cl ON cl.org_id = a.org_id AND cl.id = a.client_id
  LEFT JOIN staff s ON s.org_id = a.org_id AND s.id::text = a.accessed_by
 WHERE a.org_id = $1::uuid AND a.field LIKE 'ssn%'
   AND COALESCE(cl.is_demo, false) = false
   AND a.created_at >= ${W60}`;

export const RECENT_LETTERS_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE l.id IS NULL
         OR cl.id IS NULL
         OR NULLIF(BTRIM(COALESCE(l.bureau, '')), '') IS NULL
         OR s.id IS NULL
         OR (a.kind = 'letter' AND a.outcome LIKE 'mail_failed%' AND NOT EXISTS (
               SELECT 1 FROM inquiry_attempts b
                WHERE b.inquiry_id = a.inquiry_id AND b.kind = 'letter' AND b.outcome = 'sent'
                  AND b.created_at > a.created_at)))::int AS bad_count
  FROM inquiry_attempts a
  LEFT JOIN inquiry_log l ON l.id = a.inquiry_id AND l.org_id = a.org_id
  LEFT JOIN clients cl ON cl.org_id = a.org_id AND cl.id = l.client_id
  LEFT JOIN staff s ON s.org_id = a.org_id AND s.id = a.staff_id
 WHERE a.org_id = $1::uuid AND a.kind IN ('letter', 'portal')
   AND COALESCE(l.is_demo, false) = false
   AND a.created_at >= ${W60}`;

// Everything src/privacy/erasure.mjs says it removes, read back after the erasure finished: the
// identity row, the bank logins and accounts, the client row (both names, email, phone, the CRM
// contact id, the 252-field CRM bag and the tags) and the merchant name and raw payload on every
// bank transaction. A row touched after the erasure completed is not judged: that is new data.
export const CLEAN_PERSONAL_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM pii_identity p
               WHERE p.client_id = e.subject_client_id AND p.updated_at <= e.completed_at)
         OR EXISTS (
              SELECT 1 FROM plaid_items pi
               WHERE pi.client_id = e.subject_client_id AND pi.created_at <= e.completed_at)
         OR EXISTS (
              SELECT 1 FROM bank_accounts b
               WHERE b.client_id = e.subject_client_id AND b.created_at <= e.completed_at)
         OR EXISTS (
              SELECT 1 FROM bank_transactions t
               WHERE t.org_id = e.org_id
                 AND (t.subject_client_id = e.subject_client_id OR t.client_id = e.subject_client_id)
                 AND t.updated_at <= e.completed_at
                 AND (t.merchant_name IS NOT NULL OR COALESCE(t.raw::text, '{}') <> '{}'))
         OR EXISTS (
              SELECT 1 FROM clients c
               WHERE c.id = e.subject_client_id AND c.updated_at <= e.completed_at
                 AND (c.email IS NOT NULL OR c.phone IS NOT NULL
                      OR c.first_name IS DISTINCT FROM '[erased]'
                      OR c.last_name IS DISTINCT FROM '[erased]'
                      OR c.ghl_contact_id IS NOT NULL
                      OR COALESCE(c.custom_fields::text, '{}') <> '{}'
                      OR COALESCE(c.tags::text, '{}') NOT IN ('{}', '[]'))))::int AS bad_count
  FROM erasure_requests e
 WHERE e.org_id = $1::uuid AND e.kind = 'client_erasure' AND e.status = 'completed'
   AND e.completed_at >= now() - interval '400 days'`;
