// Shared read-only truth for the six W1 money checks.
// This file deliberately has no imports: both the daily lane and the hourly beat can use it
// without pulling product writers, network clients, filesystem code, or environment readers
// into the beat runtime.

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
export const DAY_MS = 24 * HOUR_MS;

export const CHECK_IDS = Object.freeze([
  "funding:funded-no-bill",
  "funding:approved-no-amount",
  "partners:payout-held",
  "commissions:ledger",
  "commissions:slo-map",
  "books:sample-rows"
]);

export const CARD_STACKING = "card_stacking";
export const CARD_BOARD_KEY = "funding_card_stacking";
export const FUNDED_STAGE_KEY = "funded";
export const FUNDED_BILL_WAIT_MS = 30 * MIN_MS;
export const APPROVED_NO_AMOUNT_AFTER_MS = DAY_MS;
export const PAYOUT_HELD_AFTER_MS = DAY_MS;
export const APPROVED_UNPAID_AFTER_MS = 35 * DAY_MS;
export const LOOKBACK_MS = 60 * DAY_MS;
export const SEED_CLIENT_EMAIL_RE = "^sample\\+[0-9]+@fundhub\\.demo$";
export const SEED_PAYMENT_REF_RE = "^seed_(t32|tdep)_[0-9]+$";
export const SLO_SALE_NOTE = "source:slo.clickfunnels";
export const SLO_SALE_REF_LIKE = "clickfunnels:order:%";

export const SHOWN = 3;

const CONFIRMED_APPROVAL_SQL = `a.status = 'Approved'
   AND a.approval_excluded_at IS NULL
   AND a.approved_amount IS NOT NULL
   AND a.approved_amount > 0`;

const UNPRICED_APPROVAL_SQL = `a.status = 'Approved'
   AND a.approval_excluded_at IS NULL
   AND (a.approved_amount IS NULL OR a.approved_amount <= 0)`;

export const FUNDED_ROUNDS_SQL = `
  /* gap:money-funded-rounds */
  SELECT fr.id::text                               AS round_id,
         fr.client_id::text                        AS client_id,
         c.client_code                             AS client_code,
         fr.round_number::int                      AS round_number,
         (COALESCE(fr.product, '') = $4::text)     AS card_stacking,
         EXISTS (
           SELECT 1 FROM funding_closeout fc
            WHERE fc.funding_round_id = fr.id AND fc.org_id = fr.org_id
         )                                         AS has_closeout,
         (SELECT count(*)::int FROM invoices i
           WHERE i.funding_round_id = fr.id AND i.org_id = fr.org_id
             AND (i.source = 'funding_success_fee' OR i.invoice_type = 'success_fee')
             AND i.status NOT IN ('void', 'written_off'))   AS bills,
         (SELECT count(*)::int FROM funding_round_sales frs
           WHERE frs.funding_round_id = fr.id AND frs.org_id = fr.org_id) AS linked_sales,
         (SELECT count(*)::int FROM funding_round_sales frs
            JOIN sale_attributions sa
              ON sa.sale_id = frs.sale_id AND sa.org_id = frs.org_id AND sa.basis = 'back_end'
           WHERE frs.funding_round_id = fr.id AND frs.org_id = fr.org_id)  AS back_end_staff,
         (SELECT count(*)::int FROM commission_ledger l
           WHERE l.funding_round_id = fr.id AND l.org_id = fr.org_id
             AND l.basis = 'back_end' AND l.reverses_ledger_id IS NULL
             AND l.status <> 'void')               AS commission_rows,
         (SELECT count(*)::int FROM applications a
           WHERE a.funding_round_id = fr.id AND a.org_id = fr.org_id
             AND ${CONFIRMED_APPROVAL_SQL})        AS confirmed_approvals,
         (SELECT count(*)::int FROM applications a
           WHERE a.funding_round_id = fr.id AND a.org_id = fr.org_id
             AND a.status = 'Approved' AND a.approval_excluded_at IS NOT NULL) AS excluded_approvals,
         (SELECT s.agreed_success_fee_percent::float8
            FROM funding_round_sales frs
            JOIN sales s ON s.id = frs.sale_id AND s.org_id = frs.org_id
           WHERE frs.funding_round_id = fr.id AND frs.org_id = fr.org_id
           LIMIT 1)                                AS fee_percent,
         count(*) OVER ()::int                     AS total
    FROM funding_rounds fr
    JOIN clients c ON c.id = fr.client_id AND c.org_id = fr.org_id
   WHERE fr.org_id = $1::uuid
     AND lower(fr.status) IN ('funded', 'closed')
     AND COALESCE(fr.funded_amount, 0) > 0
     AND COALESCE(fr.is_demo, false) = false
     AND COALESCE(c.is_demo, false) = false
     AND fr.updated_at < $2::timestamptz
     AND fr.updated_at >= $3::timestamptz
   ORDER BY fr.updated_at ASC
   LIMIT 100
`;

export const FUNDED_CARDS_SQL = `
  /* gap:money-funded-cards */
  SELECT c.id::text                                AS card_id,
         c.client_id::text                         AS client_id,
         cl.client_code                            AS client_code,
         COALESCE(c.entered_at, c.updated_at)      AS entered_at,
         count(*) OVER ()::int                     AS total
    FROM cards c
    JOIN pipelines p
      ON p.id = c.pipeline_id AND p.org_id = c.org_id AND p.key = '${CARD_BOARD_KEY}'
    JOIN pipeline_stages ps
      ON ps.id = c.stage_id AND ps.pipeline_id = p.id AND ps.key = '${FUNDED_STAGE_KEY}'
    JOIN clients cl ON cl.id = c.client_id AND cl.org_id = c.org_id
   WHERE c.org_id = $1::uuid
     AND COALESCE(c.is_demo, false) = false
     AND COALESCE(cl.is_demo, false) = false
     AND COALESCE(c.entered_at, c.updated_at) < $2::timestamptz
     AND COALESCE(c.entered_at, c.updated_at) >= $3::timestamptz
     AND NOT EXISTS (
       SELECT 1 FROM funding_rounds fr
        WHERE fr.client_id = c.client_id AND fr.org_id = c.org_id
          AND lower(fr.status) IN ('funded', 'closed')
          AND COALESCE(fr.funded_amount, 0) > 0
     )
   ORDER BY COALESCE(c.entered_at, c.updated_at) ASC
   LIMIT 100
`;

export const APPROVED_NO_AMOUNT_SQL = `
  /* gap:money-approved-no-amount */
  SELECT a.id::text                                AS application_id,
         COALESCE(NULLIF(btrim(a.lender_name), ''), NULLIF(btrim(a.bank), ''), 'Unnamed bank') AS bank,
         c.client_code                             AS client_code,
         COALESCE(a.status_updated_date, a.updated_at, a.created_at) AS since,
         count(*) OVER ()::int                     AS total
    FROM applications a
    LEFT JOIN funding_rounds fr ON fr.id = a.funding_round_id AND fr.org_id = a.org_id
    LEFT JOIN clients c ON c.id = COALESCE(a.client_id, fr.client_id) AND c.org_id = a.org_id
   WHERE a.org_id = $1::uuid
     AND COALESCE(a.is_demo, false) = false
     AND COALESCE(fr.is_demo, false) = false
     AND COALESCE(c.is_demo, false) = false
     AND ${UNPRICED_APPROVAL_SQL}
     AND COALESCE(a.status_updated_date, a.updated_at, a.created_at) < $2::timestamptz
     AND COALESCE(a.status_updated_date, a.updated_at, a.created_at) >= $3::timestamptz
   ORDER BY COALESCE(a.status_updated_date, a.updated_at, a.created_at) ASC
   LIMIT 100
`;

export const HELD_PAYOUTS_SQL = `
  /* gap:money-payout-held */
  SELECT q.kind, q.payout_id, q.who, q.amount, q.hold_reason, q.created_at,
         q.license_missing, q.tax_missing,
         count(*) OVER ()::int AS total
    FROM (
      SELECT 'affiliate'::text                     AS kind,
             p.id::text                            AS payout_id,
             a.name                                AS who,
             p.amount::float8                      AS amount,
             p.hold_reason                         AS hold_reason,
             p.created_at                          AS created_at,
             (a.partner_license_signed_at IS NULL) AS license_missing,
             (a.tax_form_received_at IS NULL)      AS tax_missing
        FROM affiliate_payouts p
        JOIN affiliates a ON a.id = p.affiliate_id AND a.org_id = p.org_id
       WHERE p.org_id = $1::uuid
         AND p.status = 'held'
         AND COALESCE(a.is_demo, false) = false
         AND p.created_at < $2::timestamptz
      UNION ALL
      SELECT 'partner'::text,
             p.id::text,
             pt.name,
             p.amount::float8,
             p.hold_reason,
             p.created_at,
             (pt.agreement_signed_at IS NULL),
             false
        FROM partner_payouts p
        JOIN partners pt ON pt.id = p.partner_id AND pt.org_id = p.org_id
       WHERE p.org_id = $1::uuid
         AND p.status = 'held'
         AND COALESCE(pt.is_demo, false) = false
         AND p.created_at < $2::timestamptz
    ) q
   ORDER BY q.created_at ASC
   LIMIT 50
`;

export const APPROVED_UNPAID_SQL = `
  /* gap:commissions-approved-unpaid */
  SELECT count(*)::int                             AS n,
         COALESCE(sum(l.amount), 0)::float8        AS dollars,
         min(l.approved_at)                        AS oldest
    FROM commission_ledger l
   WHERE l.org_id = $1::uuid
     AND l.status = 'approved'
     AND l.paid_at IS NULL
     AND COALESCE(l.is_demo, false) = false
     AND l.approved_at < $2::timestamptz
`;

export const LEDGER_RULE_SQL = `
  /* gap:commissions-ledger-rule */
  SELECT count(*)::int                                              AS read_rows,
         count(*) FILTER (WHERE l.rule_id IS NULL)::int             AS no_rule,
         count(*) FILTER (
           WHERE l.rule_id IS NOT NULL
             AND (
               r.id IS NULL
               OR r.org_id <> l.org_id
               OR r.basis <> l.basis
               OR r.effective_from > COALESCE(s.sold_at, l.earned_at)
               OR (r.effective_to IS NOT NULL AND r.effective_to <= COALESCE(s.sold_at, l.earned_at))
             )
         )::int                                                     AS wrong_version
    FROM commission_ledger l
    LEFT JOIN commission_rules r ON r.id = l.rule_id
    LEFT JOIN sales s ON s.id = l.sale_id AND s.org_id = l.org_id
   WHERE l.org_id = $1::uuid
     AND l.status IN ('earned', 'approved')
     AND l.reverses_ledger_id IS NULL
     AND COALESCE(l.is_demo, false) = false
`;

export const OPEN_VERSIONS_SQL = `
  /* gap:commissions-open-versions */
  SELECT count(*)::int AS scopes
    FROM (
      SELECT 1
        FROM commission_rules r
       WHERE r.org_id = $1::uuid
         AND r.active
         AND r.stacking = 'base'
         AND r.effective_to IS NULL
       GROUP BY r.basis,
                COALESCE(r.product_id, '00000000-0000-0000-0000-000000000000'::uuid),
                COALESCE(lower(r.role), '*'),
                COALESCE(r.staff_id, '00000000-0000-0000-0000-000000000000'::uuid),
                COALESCE(r.sale_motion, '*')
      HAVING count(*) > 1
    ) q
`;

export const SLO_PRODUCTS_SQL = `
  /* gap:commissions-slo-map */
  SELECT s.product_id::text                        AS product_id,
         COALESCE(p.code, p.name, s.product_id::text) AS product,
         count(DISTINCT s.id)::int                 AS sales,
         EXISTS (
           SELECT 1 FROM slo_connections sc
            WHERE sc.org_id = s.org_id AND sc.product_id = s.product_id AND sc.active
         )                                         AS mapped,
         EXISTS (
           SELECT 1 FROM commission_rules r
            WHERE r.org_id = s.org_id
              AND r.basis = 'front_end'
              AND r.active
              AND r.effective_from <= $2::timestamptz
              AND (r.effective_to IS NULL OR r.effective_to > $2::timestamptz)
              AND (r.product_id IS NULL OR r.product_id = s.product_id)
              AND (r.sale_motion IS NULL OR r.sale_motion = s.sale_motion)
         )                                         AS ruled
    FROM sales s
    LEFT JOIN products p ON p.id = s.product_id AND p.org_id = s.org_id
   WHERE s.org_id = $1::uuid
     AND s.status = 'active'
     AND COALESCE(s.is_demo, false) = false
     AND s.sold_at >= $3::timestamptz
     AND (s.notes = '${SLO_SALE_NOTE}' OR s.external_ref LIKE '${SLO_SALE_REF_LIKE}')
   GROUP BY s.org_id, s.product_id, s.sale_motion, p.code, p.name
   ORDER BY count(DISTINCT s.id) DESC
   LIMIT 50
`;

export const SAMPLE_ROWS_SQL = `
  /* gap:books-sample-rows */
  WITH sample_clients AS (
    SELECT c.id
      FROM clients c
     WHERE c.org_id = $1::uuid
       AND COALESCE(c.is_demo, false) = false
       AND lower(c.email) ~ $2::text
    UNION
    SELECT t.client_id
      FROM transactions t
     WHERE t.org_id = $1::uuid
       AND COALESCE(t.is_demo, false) = false
       AND t.client_id IS NOT NULL
       AND t.provider_ref ~ $3::text
  )
  SELECT (SELECT count(*)::int FROM sample_clients)                          AS clients,
         (SELECT count(*)::int FROM transactions t
           WHERE t.org_id = $1::uuid AND COALESCE(t.is_demo, false) = false
             AND t.provider_ref ~ $3::text)                                  AS payments,
         (SELECT COALESCE(sum(t.amount_paid), 0)::float8 FROM transactions t
           WHERE t.org_id = $1::uuid AND COALESCE(t.is_demo, false) = false
             AND t.provider_ref ~ $3::text)                                  AS payment_dollars,
         (SELECT count(*)::int FROM sales s
           WHERE s.org_id = $1::uuid AND COALESCE(s.is_demo, false) = false
             AND (s.client_id IN (SELECT id FROM sample_clients) OR s.external_ref ~ $3::text)) AS sales,
         (SELECT COALESCE(sum(s.agreed_price), 0)::float8 FROM sales s
           WHERE s.org_id = $1::uuid AND COALESCE(s.is_demo, false) = false
             AND (s.client_id IN (SELECT id FROM sample_clients) OR s.external_ref ~ $3::text)) AS sale_dollars,
         (SELECT count(*)::int FROM commission_ledger l
           WHERE l.org_id = $1::uuid AND COALESCE(l.is_demo, false) = false
             AND l.client_id IN (SELECT id FROM sample_clients))             AS commission_rows,
         (SELECT count(*)::int FROM invoices i
           WHERE i.org_id = $1::uuid AND COALESCE(i.is_demo, false) = false
             AND i.client_id IN (SELECT id FROM sample_clients))             AS invoices,
         (SELECT count(*)::int FROM messages m
           WHERE m.org_id = $1::uuid AND COALESCE(m.is_demo, false) = false
             AND m.client_id IN (SELECT id FROM sample_clients))             AS messages
`;
