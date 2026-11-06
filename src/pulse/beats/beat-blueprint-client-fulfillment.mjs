// Read-only integrity checks for the full self-operated Blueprint purchase.
// Normal client work and bureau waiting are not delivery incidents.
export const id = "blueprint-client-fulfillment";
export const title = "Blueprint paid work and saved proof stay sound";
export const kind = "infra";
export const covers = [
  "route:blueprint/funding", "route:blueprint/inquiries", "route:blueprint/repair", "route:blueprint/services",
  "desk:client-portal.html", "desk:csm-queue.html", "job:blueprint-bank-evidence"
];
export const box = false;
export const reads = [];
export const steps = ["paid-installation", "round-access", "funding-evidence", "inquiry-evidence", "inquiry-calls", "repair-evidence", "report-delivery", "paid-help"];
export const CHECK_IDS = [
  "blueprint-full:paid-installation", "blueprint-full:round-access", "blueprint-full:funding-evidence",
  "blueprint-full:inquiry-evidence", "blueprint-full:inquiry-calls", "blueprint-full:repair-evidence",
  "blueprint-full:report-delivery", "blueprint-full:paid-help"
];
export const deadlineMs = 11000;
export const damp = 1;
export const ORG_SQL = "SELECT id FROM orgs WHERE slug = 'fundhub'";
export const TEST_CLIENT_EMAIL_RE = String.raw`\+(walk|sim)-[0-9]+@|@example\.(com|net|org)$|\.(test|example|invalid|localhost|local)$`;
const SCOPE = `WITH scope AS (SELECT $1::uuid AS org_id, $2::timestamptz AS at, $3::text AS test_email),
real_clients AS (
  SELECT c.* FROM clients c, scope s WHERE c.org_id=s.org_id
    AND COALESCE(c.is_demo,false)=false AND COALESCE(c.custom_fields->>'synthetic','')<>'true'
    AND COALESCE(c.email,'') !~* s.test_email
)`;
const AT = "(SELECT at FROM scope)";

export const PAID_INSTALLATION_SQL = `/* blueprint-full:paid-installation */
${SCOPE}
SELECT count(*)::int AS n FROM (
  SELECT t.id FROM transactions t JOIN real_clients c ON c.id=t.client_id AND c.org_id=t.org_id
  JOIN products p ON p.id=resolve_product_id(t.org_id,t.product_name) AND p.org_id=t.org_id
  WHERE p.code='blueprint-self-funding' AND lower(btrim(t.status))='succeeded'
    AND COALESCE(t.is_demo,false)=false AND t.created_at < ${AT}-interval '15 minutes'
    AND NOT EXISTS (SELECT 1 FROM entitlements ent JOIN blueprint_fulfillment_engagements g
      ON g.source_entitlement_id=ent.id AND g.source_transaction_id=t.id
        AND g.org_id=t.org_id AND g.client_id=t.client_id
      WHERE ent.source_transaction_id=t.id AND ent.org_id=t.org_id AND ent.client_id=t.client_id
        AND ent.entitlement_code='blueprint-client-fulfillment'
        AND (g.status='completed' OR (ent.revoked_at IS NULL AND (ent.expires_at IS NULL OR ent.expires_at>${AT}))))
  UNION ALL
  SELECT g.id FROM blueprint_fulfillment_engagements g JOIN real_clients c ON c.id=g.client_id AND c.org_id=g.org_id
  WHERE NOT EXISTS (SELECT 1 FROM transactions t JOIN products p
      ON p.id=resolve_product_id(t.org_id,t.product_name) AND p.org_id=t.org_id
    JOIN entitlements ent ON ent.id=g.source_entitlement_id AND ent.source_transaction_id=t.id
      AND ent.org_id=t.org_id AND ent.client_id=t.client_id AND ent.entitlement_code='blueprint-client-fulfillment'
    WHERE t.id=g.source_transaction_id AND t.org_id=g.org_id AND t.client_id=g.client_id
      AND p.code='blueprint-self-funding' AND lower(btrim(t.status))='succeeded' AND COALESCE(t.is_demo,false)=false)
  UNION ALL
  SELECT ent.id FROM entitlements ent JOIN real_clients c ON c.id=ent.client_id AND c.org_id=ent.org_id
  WHERE ent.entitlement_code='blueprint-client-fulfillment' AND NOT EXISTS (
    SELECT 1 FROM blueprint_fulfillment_engagements g WHERE g.source_entitlement_id=ent.id
      AND g.source_transaction_id=ent.source_transaction_id AND g.org_id=ent.org_id AND g.client_id=ent.client_id)
) broken`;

export const ROUND_ACCESS_SQL = `/* blueprint-full:round-access */
${SCOPE}
SELECT count(*)::int AS n FROM blueprint_fulfillment_engagements g
JOIN real_clients c ON c.id=g.client_id AND c.org_id=g.org_id
LEFT JOIN funding_rounds r ON r.id=g.funding_round_id AND r.org_id=g.org_id AND r.client_id=g.client_id
WHERE (g.funding_round_id IS NOT NULL AND (r.id IS NULL OR r.product IS DISTINCT FROM
    CASE WHEN g.execution_owner='fundhub' THEN 'blueprint_managed_funding' ELSE 'blueprint_self_funding' END))
  OR (g.execution_owner='fundhub' AND (r.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM blueprint_client_services service
    JOIN paid_service_requests payment ON payment.id=service.id
      AND payment.org_id=service.org_id AND payment.client_id=service.client_id
    JOIN accounts authorizer ON authorizer.id=service.authorized_account_id
      AND authorizer.org_id=service.org_id AND authorizer.client_id=service.client_id AND authorizer.kind='client'
    WHERE service.engagement_id=g.id AND service.org_id=g.org_id AND service.client_id=g.client_id
      AND service.service_kind='funding_round' AND service.state IN ('in_progress','completed')
      AND ((service.scope_type='engagement' AND service.target_id=g.id)
        OR (service.scope_type='funding_round' AND service.target_id=g.funding_round_id))
      AND service.authorized_at IS NOT NULL AND payment.service_kind='blueprint_help'
      AND payment.status IN ('paid','staged','fulfilled') AND payment.paid_at IS NOT NULL
      AND NULLIF(btrim(payment.payment_ref),'') IS NOT NULL AND payment.price_total_cents>0
      AND payment.amount_paid_cents=payment.price_total_cents AND service.payment_ref=payment.payment_ref)))
  OR (g.status='active' AND EXISTS (SELECT 1 FROM product_entitlements required
    WHERE required.org_id=g.org_id AND required.product_code='blueprint-self-funding' AND NOT EXISTS (
      SELECT 1 FROM entitlements ent WHERE ent.org_id=g.org_id AND ent.client_id=g.client_id
        AND ent.source_transaction_id=g.source_transaction_id AND ent.entitlement_code=required.entitlement_code
        AND ent.revoked_at IS NULL AND (ent.expires_at IS NULL OR ent.expires_at>${AT}))))
  OR (r.status IN ('closed','funded') AND g.status<>'completed')
  OR (g.status='completed' AND (r.id IS NULL OR r.status NOT IN ('closed','funded') OR g.completed_at IS NULL
    OR EXISTS (SELECT 1 FROM entitlements ent WHERE ent.org_id=g.org_id AND ent.client_id=g.client_id
      AND ent.source_transaction_id=g.source_transaction_id AND ent.revoked_at IS NULL)))`;

export const FUNDING_EVIDENCE_SQL = `/* blueprint-full:funding-evidence */
${SCOPE}
SELECT count(*)::int AS n FROM (
  SELECT h.id FROM blueprint_funding_handoffs h JOIN real_clients c ON c.id=h.client_id AND c.org_id=h.org_id
  LEFT JOIN blueprint_fulfillment_engagements g ON g.id=h.engagement_id AND g.org_id=h.org_id AND g.client_id=h.client_id
  LEFT JOIN applications a ON a.id=h.application_id AND a.org_id=h.org_id AND a.client_id=h.client_id
  WHERE g.id IS NULL OR a.id IS NULL OR a.funding_round_id IS DISTINCT FROM g.funding_round_id
    OR a.lender_id IS DISTINCT FROM h.lender_id
    OR NOT EXISTS (SELECT 1 FROM crs_results r WHERE r.id=h.source_credit_report_id AND r.org_id=h.org_id
      AND r.client_id=h.client_id AND r.is_demo IS NOT TRUE AND r.provider IS DISTINCT FROM 'crs_softview_simulated'
      AND COALESCE(r.result->>'simulated','false') NOT IN ('true','1')
      AND lower(COALESCE(r.result->>'environment','')) NOT IN ('sandbox','simulated'))
    OR (h.business_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM businesses b
      WHERE b.id=h.business_id AND b.org_id=h.org_id AND b.client_id=h.client_id))
    OR EXISTS (SELECT 1 FROM blueprint_application_reports report WHERE report.handoff_id=h.id AND (
      NOT EXISTS (SELECT 1 FROM accounts ac WHERE ac.id=report.reported_by AND ac.org_id=h.org_id
        AND ac.client_id=h.client_id AND ac.kind='client')
      OR (report.evidence_document_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM documents d
        WHERE d.id=report.evidence_document_id AND d.org_id=h.org_id AND d.client_id=h.client_id))))
    OR EXISTS (SELECT 1 FROM blueprint_bank_evidence e WHERE e.handoff_id=h.id AND (
      (e.source_kind='bank_mail' AND NOT EXISTS (SELECT 1 FROM bank_inbox m WHERE m.id=e.source_id
        AND m.org_id=h.org_id AND m.client_id=h.client_id AND m.raw->>'source'='mailgun'
        AND NULLIF(m.raw->>'authenticatedBankDomain','') IS NOT NULL AND m.created_at>=h.opened_at))
      OR (e.source_kind='posted_transaction' AND NOT EXISTS (SELECT 1 FROM bank_transactions t
        JOIN bank_accounts b ON b.id=t.bank_account_id AND b.org_id=t.org_id AND b.client_id=t.client_id
        WHERE t.id=e.source_id AND t.org_id=h.org_id AND t.client_id=h.client_id AND t.provider='plaid'
          AND NULLIF(t.provider_transaction_id,'') IS NOT NULL AND NOT t.is_pending AND t.amount_cents>0
          AND NOT (t.raw ? 'fundhub_removed_at') AND b.raw->>'plaid_environment_source'='server_transport'
          AND b.raw->>'plaid_environment'='production' AND b.currency_code='USD'
          AND t.posted_on >= (h.opened_at AT TIME ZONE 'UTC')::date))
      OR (e.source_kind='reviewed_document' AND NOT EXISTS (SELECT 1 FROM documents d
        JOIN document_versions v ON v.document_id=d.id AND v.org_id=d.org_id AND v.version=e.source_version
        JOIN staff s ON s.id=e.reviewed_by AND s.org_id=h.org_id AND s.role IN ('owner','admin','csm','funding_advisor')
        WHERE d.id=e.source_id AND d.org_id=h.org_id AND d.client_id=h.client_id AND d.kind='client_upload'
          AND v.byte_size>0 AND NULLIF(btrim(v.storage_key),'') IS NOT NULL
          AND EXISTS (SELECT 1 FROM blueprint_application_reports report
            WHERE report.handoff_id=h.id AND report.evidence_document_id=d.id)))
    ))
  UNION ALL
  SELECT g.id FROM blueprint_fulfillment_engagements g JOIN real_clients c ON c.id=g.client_id AND c.org_id=g.org_id
  JOIN funding_rounds r ON r.id=g.funding_round_id AND r.org_id=g.org_id AND r.client_id=g.client_id
  CROSS JOIN LATERAL blueprint_verified_round_totals(g.id,g.org_id,g.client_id,r.id) facts
  WHERE g.execution_owner='client' AND r.status IN ('funded','closed') AND
    (g.submissions_closed_at IS NULL OR facts.total=0 OR facts.total<>facts.final
      OR facts.funded IS DISTINCT FROM r.funded_amount
      OR (r.status='funded') IS DISTINCT FROM (facts.funded IS NOT NULL))
) broken`;

export const INQUIRY_EVIDENCE_SQL = `/* blueprint-full:inquiry-evidence */
${SCOPE}
SELECT count(*)::int AS n FROM blueprint_inquiry_evidence e
JOIN real_clients c ON c.id=e.client_id AND c.org_id=e.org_id
LEFT JOIN inquiry_removal_cases k ON k.id=e.case_id AND k.org_id=e.org_id AND k.client_id=e.client_id
LEFT JOIN crs_results baseline ON baseline.id=e.baseline_report_id AND baseline.org_id=e.org_id AND baseline.client_id=e.client_id
WHERE k.id IS NULL OR k.selected_bureaus_raw NOT IN ('EX','EQ','TU') OR baseline.id IS NULL
  OR NOT EXISTS (SELECT 1 FROM accounts ac WHERE ac.id=e.requested_account_id AND ac.org_id=e.org_id
    AND ac.client_id=e.client_id AND ac.kind='client')
  OR (e.submitted_at IS NOT NULL AND (NULLIF(btrim(e.submission_reference),'') IS NULL
    OR NOT EXISTS (SELECT 1 FROM documents d JOIN document_versions v
      ON v.id=d.current_version_id AND v.document_id=d.id AND v.org_id=d.org_id
      WHERE d.id=e.receipt_document_id AND d.org_id=e.org_id AND d.client_id=e.client_id
        AND d.kind IN ('inquiry_doc','client_upload') AND d.subtype='inquiry_submission_receipt')))
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(e.baseline_items) item
    WHERE item->>'bureau' IS DISTINCT FROM k.selected_bureaus_raw
      OR NOT EXISTS (SELECT 1 FROM inquiry_log i WHERE i.id::text=item->>'inquiryId'
        AND i.org_id=e.org_id AND i.client_id=e.client_id AND i.bureau=k.selected_bureaus_raw
        AND (i.case_id=e.case_id OR i.inquiry_removal_case_id=e.case_id)))
  OR EXISTS (SELECT 1 FROM inquiry_log i WHERE i.org_id=e.org_id AND i.client_id=e.client_id
    AND (i.case_id=e.case_id OR i.inquiry_removal_case_id=e.case_id) AND i.removal_verified_at IS NOT NULL AND (
      i.is_open OR i.bureau IS DISTINCT FROM k.selected_bureaus_raw
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(e.baseline_items) item
        WHERE item->>'inquiryId'=i.id::text AND item->>'sourceFound'='true'
          AND item->>'bureau'=i.bureau AND NULLIF(item->>'date','') IS NOT NULL)
      OR (i.removal_verified_report_id IS NULL AND i.removal_verified_document_id IS NULL)
      OR (i.removal_verified_report_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crs_results r
        WHERE r.id=i.removal_verified_report_id AND r.org_id=i.org_id AND r.client_id=i.client_id
          AND r.created_at>baseline.created_at AND r.is_demo IS NOT TRUE
          AND r.provider IS DISTINCT FROM 'crs_softview_simulated'
          AND COALESCE(r.result->>'simulated','false') NOT IN ('true','1')
          AND lower(COALESCE(r.result->>'environment','')) NOT IN ('sandbox','simulated')
          AND r.result->'bureauStatus'->>i.bureau='file_returned'
          AND COALESCE(r.result->'bureauErrors'->>i.bureau,'')=''
          AND jsonb_typeof(r.result->'bureaus'->i.bureau->'inquiries')='array'
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(e.baseline_items) item
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.result->'bureaus'->i.bureau->'inquiries')='array'
              THEN r.result->'bureaus'->i.bureau->'inquiries' ELSE '[]'::jsonb END) entry
            WHERE item->>'inquiryId'=i.id::text
              AND regexp_replace(lower(COALESCE(entry->>'creditorName',entry->>'inquiry',entry->>'inquiry_name',entry->>'name',entry->>'furnisher','')),'[^a-z0-9]','','g')
                =regexp_replace(lower(item->>'name'),'[^a-z0-9]','','g')
              AND left(COALESCE(entry->>'inquiryDate',entry->>'date',entry->>'inquiry_date',''),10)=item->>'date')))
      OR (i.removal_verified_document_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM documents d
        JOIN document_versions v ON v.id=d.current_version_id AND v.org_id=d.org_id AND v.document_id=d.id
        WHERE d.id=i.removal_verified_document_id AND d.org_id=i.org_id AND d.client_id=i.client_id
          AND d.kind='bureau_response' AND d.metadata->'bureau_response_validation'->>'status'='accepted'
          AND d.metadata->'bureau_response_validation'->>'document_id'=d.id::text
          AND d.metadata->'bureau_response_validation'->>'version_id'=d.current_version_id::text
          AND d.metadata->'bureau_response_validation'->>'bureau'=i.bureau
          AND d.metadata->'bureau_response_validation'->>'client_match'='match'
          AND d.metadata->'bureau_response_validation'->>'quality'='pass'
          AND d.metadata->'bureau_response_validation'->>'authenticity'='clear'))
  ))`;

export const INQUIRY_CALLS_SQL = `/* blueprint-full:inquiry-calls */
${SCOPE}
SELECT count(*)::int AS n FROM blueprint_inquiry_evidence e
JOIN real_clients c ON c.id=e.client_id AND c.org_id=e.org_id
WHERE e.call_state='unknown'
  OR (e.call_state='claimed' AND (e.call_requested_at IS NULL OR e.call_requested_at<${AT}-interval '15 minutes'))
  OR (e.call_state='sent' AND NOT EXISTS (SELECT 1 FROM outbound_calls oc
    WHERE oc.call_id=e.call_id AND oc.org_id=e.org_id AND oc.client_id=e.client_id
      AND oc.kind='inquiry_bureau'))
  OR (e.call_state='sent' AND EXISTS (SELECT 1 FROM blueprint_inquiry_evidence other
    WHERE other.call_id=e.call_id AND other.case_id<>e.case_id))`;

export const REPAIR_EVIDENCE_SQL = `/* blueprint-full:repair-evidence */
${SCOPE}
SELECT count(*)::int AS n FROM blueprint_repair_submissions s
JOIN real_clients c ON c.id=s.client_id AND c.org_id=s.org_id
LEFT JOIN dispute_letters l ON l.id=s.letter_id AND l.org_id=s.org_id AND l.client_id=s.client_id
WHERE l.id IS NULL OR NOT EXISTS (SELECT 1 FROM dispute_cases k WHERE k.id=l.case_id
    AND k.org_id=l.org_id AND k.client_id=l.client_id AND k.bureau=l.bureau AND k.round=l.round)
  OR NOT EXISTS (SELECT 1 FROM accounts ac WHERE ac.id=s.requested_account_id AND ac.org_id=s.org_id
    AND ac.client_id=s.client_id AND ac.kind='client')
  OR NOT EXISTS (SELECT 1 FROM documents d JOIN document_versions v
    ON v.id=d.current_version_id AND v.document_id=d.id AND v.org_id=d.org_id
    WHERE d.id=s.receipt_document_id AND d.org_id=s.org_id AND d.client_id=s.client_id
      AND d.kind='client_upload' AND d.subtype='repair_submission_receipt')`;

export const REPORT_DELIVERY_SQL = `/* blueprint-full:report-delivery */
${SCOPE}
SELECT count(*)::int AS n FROM soft_pull_requests r
JOIN real_clients c ON c.id=r.client_id AND c.org_id=r.org_id
WHERE r.blueprint_engagement_id IS NOT NULL AND (
  NOT EXISTS (SELECT 1 FROM blueprint_fulfillment_engagements g WHERE g.id=r.blueprint_engagement_id
    AND g.org_id=r.org_id AND g.client_id=r.client_id)
  OR (r.status='queued' AND r.updated_at<${AT}-interval '75 minutes')
  OR (r.status='processing' AND r.updated_at<${AT}-interval '15 minutes')
  OR (r.status='failed' AND r.updated_at>${AT}-interval '7 days')
  OR (r.status='fulfilled' AND NOT EXISTS (SELECT 1 FROM crs_results cr
    WHERE cr.id=r.crs_result_id AND cr.org_id=r.org_id AND cr.client_id=r.client_id AND cr.is_demo IS NOT TRUE
      AND cr.provider IS DISTINCT FROM 'crs_softview_simulated' AND COALESCE(cr.result->>'simulated','false') NOT IN ('true','1')
      AND lower(COALESCE(cr.result->>'environment','')) NOT IN ('sandbox','simulated')))
  OR (r.blueprint_report_kind='included' AND r.status<>'cancelled' AND EXISTS (
    SELECT 1 FROM soft_pull_requests prior WHERE prior.org_id=r.org_id AND prior.client_id=r.client_id
      AND prior.id<>r.id AND prior.blueprint_report_kind='included' AND prior.status<>'cancelled'
      AND (prior.requested_at,prior.id)<(r.requested_at,r.id) AND prior.requested_at>r.requested_at-interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM crs_results cr WHERE cr.id=prior.crs_result_id
        AND (cr.result->>'simulated' IN ('true','1') OR lower(cr.result->>'environment') IN ('sandbox','simulated')))))
  OR (r.blueprint_report_kind='paid' AND NOT EXISTS (SELECT 1 FROM blueprint_client_services s
    JOIN paid_service_requests p ON p.id=s.id AND p.org_id=s.org_id AND p.client_id=s.client_id
    WHERE s.id=r.blueprint_service_request_id AND s.org_id=r.org_id AND s.client_id=r.client_id
      AND s.engagement_id=r.blueprint_engagement_id AND s.service_kind='credit_pull'
      AND s.authorized_at IS NOT NULL AND p.status IN ('paid','staged','fulfilled') AND p.paid_at IS NOT NULL
      AND p.payment_ref IS NOT NULL AND p.amount_paid_cents=p.price_total_cents))
)`;

export const PAID_HELP_SQL = `/* blueprint-full:paid-help */
${SCOPE}
SELECT count(*)::int AS n FROM blueprint_client_services s
JOIN real_clients c ON c.id=s.client_id AND c.org_id=s.org_id
LEFT JOIN paid_service_requests p ON p.id=s.id AND p.org_id=s.org_id AND p.client_id=s.client_id
LEFT JOIN blueprint_fulfillment_engagements g ON g.id=s.engagement_id AND g.org_id=s.org_id AND g.client_id=s.client_id
WHERE p.id IS NULL OR g.id IS NULL
  OR p.service_kind IS DISTINCT FROM CASE WHEN s.service_kind='credit_pull' THEN 'credit_pull' ELSE 'blueprint_help' END
  OR s.state='needs_review'
  OR (s.checkout_provider IS NOT NULL AND (s.accepted_price_cents IS DISTINCT FROM p.price_total_cents
    OR s.checkout_currency IS DISTINCT FROM 'USD'))
  OR (s.checkout_provider='whop' AND (NULLIF(btrim(s.whop_account_id),'') IS NULL
    OR NULLIF(btrim(s.whop_product_id),'') IS NULL
    OR (s.state IN ('awaiting_payment','paid','in_progress','completed') AND
      (NULLIF(btrim(s.whop_checkout_configuration_id),'') IS NULL OR NULLIF(btrim(s.whop_plan_id),'') IS NULL))
    OR (p.status IN ('paid','staged','fulfilled') AND
      (NULLIF(btrim(s.whop_payment_id),'') IS NULL OR s.whop_payment_id IS DISTINCT FROM p.payment_ref))))
  OR (s.state IN ('checkout_pending','awaiting_payment') AND p.status IN ('quoted','awaiting_payment')
    AND s.authorized_at IS NOT NULL AND EXISTS (
      SELECT 1 FROM events paid WHERE paid.org_id=s.org_id AND paid.client_id=s.client_id
        AND paid.name='payment.received' AND paid.is_demo IS NOT TRUE
        AND paid.created_at<${AT}-interval '15 minutes'
        AND paid.payload->>'paidServiceRequestId'=s.id::text
        AND paid.payload->>'ref'=s.id::text
        AND paid.payload->>'productCode'='blueprint-help-'||s.service_kind
        AND paid.payload->>'source'=s.checkout_provider
        AND nullif(paid.payload->>'paymentId','') IS NOT NULL
        AND (s.checkout_provider='commas' OR s.whop_payment_id=paid.payload->>'paymentId')
        AND (paid.payload->'amountCents'=to_jsonb(s.accepted_price_cents) OR
          (NOT (paid.payload ? 'amountCents') AND paid.payload->'amount'=to_jsonb(s.accepted_price_cents/100::numeric)))
        AND NOT EXISTS (SELECT 1 FROM events reversal WHERE reversal.org_id=paid.org_id AND reversal.client_id=paid.client_id
          AND reversal.name IN ('payment.refunded','payment.disputed') AND reversal.is_demo IS NOT TRUE
          AND reversal.payload->>'source'=s.checkout_provider
          AND COALESCE(reversal.payload->>'originalProviderRef',reversal.payload->>'paymentId')=paid.payload->>'paymentId')
    ))
  OR (s.state='checkout_pending' AND (s.checkout_claimed_at IS NULL OR s.checkout_claimed_at<${AT}-interval '15 minutes'))
  OR (s.service_kind IN ('credit_pull','repair_full') AND (s.scope_type<>'client' OR s.target_id<>s.client_id))
  OR (s.service_kind='inquiry_removal' AND (s.scope_type<>'inquiry_case' OR NOT EXISTS (
    SELECT 1 FROM inquiry_removal_cases k WHERE k.id=s.target_id AND k.org_id=s.org_id AND k.client_id=s.client_id)))
  OR (s.service_kind='repair_round' AND (s.scope_type<>'dispute_case' OR NOT EXISTS (
    SELECT 1 FROM dispute_cases k WHERE k.id=s.target_id AND k.org_id=s.org_id AND k.client_id=s.client_id AND k.round=s.round_key)))
  OR (s.service_kind='funding_round' AND NOT ((s.scope_type='engagement' AND s.target_id=g.id)
    OR (s.scope_type='funding_round' AND s.target_id=g.funding_round_id)))
  OR (p.status IN ('paid','staged','fulfilled') AND (p.paid_at IS NULL OR NULLIF(btrim(p.payment_ref),'') IS NULL
    OR p.amount_paid_cents IS DISTINCT FROM p.price_total_cents OR s.authorized_at IS NULL OR NOT EXISTS (
      SELECT 1 FROM accounts ac WHERE ac.id=s.authorized_account_id AND ac.org_id=s.org_id AND ac.client_id=s.client_id AND ac.kind='client')))
  OR (p.status='paid' AND p.paid_at<${AT}-interval '15 minutes' AND s.state NOT IN ('in_progress','completed')
    AND NOT (s.service_kind='credit_pull' AND EXISTS (SELECT 1 FROM soft_pull_requests r
      WHERE r.org_id=s.org_id AND r.client_id=s.client_id AND r.status IN ('queued','processing')
        AND ((r.status='queued' AND r.updated_at>=${AT}-interval '75 minutes')
          OR (r.status='processing' AND r.updated_at>=${AT}-interval '15 minutes')))))
  OR (s.state IN ('in_progress','completed') AND (s.payment_ref IS DISTINCT FROM p.payment_ref
    OR p.status NOT IN ('paid','staged','fulfilled')
    OR (s.service_kind='credit_pull' AND NOT EXISTS (SELECT 1 FROM soft_pull_requests r
      WHERE r.id=s.soft_pull_request_id AND r.org_id=s.org_id AND r.client_id=s.client_id
        AND r.blueprint_service_request_id=s.id AND r.blueprint_engagement_id=s.engagement_id))
    OR (s.service_kind<>'credit_pull' AND NOT EXISTS (SELECT 1 FROM tasks t
      WHERE t.id=s.fulfillment_task_id AND t.org_id=s.org_id AND t.client_id=s.client_id
        AND t.source_workflow='blueprint-paid-help' AND t.body='blueprint-paid-help:'||s.id::text))))
  OR (s.state='completed' AND s.service_kind='credit_pull' AND (p.status<>'fulfilled' OR NOT EXISTS (
    SELECT 1 FROM soft_pull_requests r WHERE r.id=s.soft_pull_request_id AND r.status='fulfilled'
      AND r.crs_result_id=p.produced_ref AND p.produced_kind='crs_result')))`;

export const CHECKS = [
  ["paid-installation", PAID_INSTALLATION_SQL, "paid Blueprint purchases or installed engagements lack their matching saved purchase and grant"],
  ["round-access", ROUND_ACCESS_SQL, "purchased rounds have inconsistent completion or still-open purchase access"],
  ["funding-evidence", FUNDING_EVIDENCE_SQL, "funding handoffs or completed totals lack correctly scoped bank proof"],
  ["inquiry-evidence", INQUIRY_EVIDENCE_SQL, "inquiry cases have wrong-file evidence or unsupported removal verification"],
  ["inquiry-calls", INQUIRY_CALLS_SQL, "inquiry calls have uncertain, stale or incorrectly scoped provider receipts"],
  ["repair-evidence", REPAIR_EVIDENCE_SQL, "repair submissions have wrong-client, wrong-case or invalid saved receipt links"],
  ["report-delivery", REPORT_DELIVERY_SQL, "Blueprint reports are stale, failed, unsupported or outside the saved allowance"],
  ["paid-help", PAID_HELP_SQL, "paid help requests have inconsistent scope, receipts or overdue fulfillment"]
];

async function countCheck(ctx, step, sql, params, description) {
  let raw;
  try { raw=(await ctx.read(sql,params)).rows[0]?.n; }
  catch { throw ctx.fail(step,"Blueprint fulfillment state could not be read."); }
  const n=typeof raw==="number" || (typeof raw==="string" && /^\d+$/.test(raw)) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n<0) throw ctx.fail(step,"Blueprint fulfillment count could not be read.");
  if (n>0) throw ctx.fail(step,`${n} ${description}.`);
}

export async function run(ctx) {
  let orgId;
  for (const [step,sql,description] of CHECKS) {
    await ctx.step(step,async () => {
      if (!orgId) {
        let rows;
        try { rows=(await ctx.read(ORG_SQL)).rows; }
        catch { throw ctx.fail(step,"The Fundhub company could not be read."); }
        orgId=rows?.length===1 ? rows[0]?.id : null;
        if (typeof orgId!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orgId)) {
          throw ctx.fail(step,"The Fundhub company could not be identified.");
        }
      }
      await countCheck(ctx,step,sql,[orgId,ctx.now.toISOString(),TEST_CLIENT_EMAIL_RE],description);
    });
  }
  return ctx.done("No broken paid Blueprint work or saved proof was found. Normal client and bureau waiting is allowed; this is not provider-delivery proof.");
}

export const fixGuide = `Paid Blueprint work or its saved proof needs review before the client can continue.

Likely causes:
- A full purchase is missing its exact grant or engagement, or completed-round access reopened. A Fundhub-operated round needs its managed product and exact authorized paid takeover receipt.
- A receipt or verified result belongs to another client, case, bureau or round.
- A bureau call or report has an uncertain provider outcome, or paid help never reached its saved task.
Steps:
- Run node scripts/pulse/run-beat.mjs blueprint-client-fulfillment and read the first red step.
- Reconcile the original payment, grant, case, report, task and provider receipts through the scoped staff flow.
- Preserve uncertain call and report claims. Review the original provider outcome before any new request.
- Waiting for the client to submit, pay or receive a bureau reply is normal and is not an incident.
- This beat never charges, requests reports, places calls, sends letters or changes customer data.
Files: src/blueprint/client-funding.mjs, src/blueprint/client-inquiries.mjs, src/blueprint/client-repair.mjs, src/blueprint/client-services.mjs, src/blueprint/report-requests.mjs, src/blueprint/bank-evidence.mjs
`;

const world = () => ({ read: [
  { match:/FROM orgs/, rows:[{id:"00000000-0000-4000-8000-000000000001"}] },
  ...steps.map(step => ({match:new RegExp(`blueprint-full:${step}`),rows:[{n:0}]}))
] });
export const selfTest = {pass:world,fail:()=>({read:[world().read[0],{match:/blueprint-full:paid-installation/,rows:[{n:1}]}]})};
