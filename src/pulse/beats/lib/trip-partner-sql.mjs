export const ROW_CAP = 200;

const AFFILIATE_WHERE = `
   WHERE a.org_id = $1::uuid
     AND COALESCE(a.is_demo, false) = false
     AND a.created_at >= $2::timestamptz
     AND COALESCE(a.name, '') !~* $4::text
     AND EXISTS (
       SELECT 1 FROM accounts ac
        WHERE ac.org_id = a.org_id AND ac.affiliate_id = a.id
          AND COALESCE(btrim(ac.email), '') <> '' AND ac.email !~* $3::text
     )
`;

const PARTNER_WHERE = `
   WHERE p.org_id = $1::uuid
     AND COALESCE(p.is_demo, false) = false
     AND p.created_at >= $2::timestamptz
     AND COALESCE(p.name, '') !~* $4::text
     AND COALESCE(p.brand_name, '') !~* $4::text
     AND COALESCE(btrim(p.contact_email), '') <> ''
     AND p.contact_email !~* $3::text
`;

export const AFFILIATE_SQL = `
  /* gap:trip-partner-affiliate */
  SELECT a.id::text AS payee_id, a.name, a.tracking_id, a.status, a.created_at AS applied_at,
         a.activated_at, (a.partner_license_signed_at IS NOT NULL) AS license_ok,
         (a.tax_form_received_at IS NOT NULL) AS tax_ok, k.credited_n, k.first_click_at,
         ku.uncredited_n, rf.converted_n, rf.converted_at, rf.rated_n, rf.unrated_n,
         rf.unconverted_paid_n, rf.payable_usd, po.paid_n, po.paid_at, po.held_n, po.stuck_n, po.waiting_n
    FROM affiliates a
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS credited_n, min(c.occurred_at) AS first_click_at
        FROM affiliate_link_clicks c
       WHERE c.org_id = $1::uuid AND c.affiliate_id = a.id
    ) k ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS uncredited_n
        FROM affiliate_link_clicks c
       WHERE c.org_id = $1::uuid AND c.affiliate_id IS NULL
         AND c.occurred_at >= $11::timestamptz AND c.occurred_at >= a.created_at
         AND upper(c.tracking_id_used) = upper(a.tracking_id)
    ) ku ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE r.status IN ('converted', 'paid'))::int AS converted_n,
             min(r.converted_at) FILTER (WHERE r.status IN ('converted', 'paid')) AS converted_at,
             count(*) FILTER (WHERE r.status IN ('converted', 'paid') AND r.commission_due IS NOT NULL)::int AS rated_n,
             count(*) FILTER (WHERE r.status IN ('converted', 'paid') AND r.commission_due IS NULL)::int AS unrated_n,
             count(*) FILTER (
               WHERE r.status = 'attributed'
                 AND (r.tier = 'direct' OR a.tier_level = 'tier2')
                 AND EXISTS (
                   SELECT 1 FROM sales sl
                     JOIN products pr ON pr.id = sl.product_id
                     JOIN sale_payments sp ON sp.sale_id = sl.id AND sp.org_id = sl.org_id
                    WHERE sl.org_id = r.org_id AND sl.client_id = r.client_id AND sl.status = 'active'
                      AND COALESCE(sl.is_demo, false) = false
                      AND sp.kind <> 'refund' AND sp.created_at < $7::timestamptz
                      AND (
                        lower(btrim(pr.code)) = ANY($6::text[])
                        OR (lower(btrim(pr.code)) = ANY($5::text[]) AND EXISTS (
                              SELECT 1 FROM funding_rounds fr
                               WHERE fr.client_id = sl.client_id AND COALESCE(fr.funded_amount, 0) > 0))
                        OR (lower(btrim(pr.code)) = 'diagnostic' AND EXISTS (
                              SELECT 1 FROM payment_links pl
                               WHERE pl.org_id = sl.org_id AND pl.client_id = sl.client_id
                                 AND pl.link_ref LIKE 'slo_%' AND pl.status = 'paid'
                                 AND COALESCE(pl.is_demo, false) = false))
                      )
                 ))::int AS unconverted_paid_n,
             COALESCE(sum(r.commission_due) FILTER (
               WHERE r.status = 'converted' AND r.commission_due > 0 AND r.converted_at < $8::timestamptz
                 AND NOT EXISTS (
                   SELECT 1 FROM affiliate_payout_lines l JOIN affiliate_payouts p ON p.id = l.payout_id
                    WHERE l.referral_id = r.id AND l.kind = 'commission'
                      AND p.status IN ('pending', 'processing', 'paid'))), 0)::float8 AS payable_usd
        FROM affiliate_referrals r
       WHERE r.org_id = $1::uuid AND r.affiliate_id = a.id
    ) rf ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE p.status = 'paid')::int AS paid_n,
             min(p.paid_at) FILTER (WHERE p.status = 'paid') AS paid_at,
             count(*) FILTER (WHERE p.status = 'held' AND p.created_at < $10::timestamptz)::int AS held_n,
             count(*) FILTER (WHERE p.status = 'processing' AND COALESCE(p.initiated_at, p.created_at) < $9::timestamptz)::int AS stuck_n,
             count(*) FILTER (WHERE p.status = 'pending' AND p.created_at < $10::timestamptz)::int AS waiting_n
        FROM affiliate_payouts p
       WHERE p.org_id = $1::uuid AND p.affiliate_id = a.id
    ) po ON true
${AFFILIATE_WHERE}   ORDER BY a.created_at ASC
   LIMIT ${ROW_CAP}
`;

export const PARTNER_SQL = `
  /* gap:trip-partner-white-label */
  SELECT p.id::text AS payee_id, COALESCE(NULLIF(btrim(p.brand_name), ''), p.name) AS name,
         p.slug, p.status, p.created_at AS applied_at, COALESCE(p.activated_at, p.updated_at) AS approved_at,
         (p.agreement_signed_at IS NOT NULL) AS agreement_signed, p.revenue_share_pct::float8 AS share_pct,
         pg.slug AS page_slug, pg.published_at AS page_published_at, oc.owned_n, oc.first_lead_at,
         pd.paid_in_n, pd.first_paid_at, pd.unaccrued_n, rv.revenue_n, rv.first_revenue_at,
         po.paid_n, po.paid_at, po.held_n, po.stuck_n
    FROM partners p
    LEFT JOIN LATERAL (
      SELECT g.slug, g.published_at FROM partner_pages g
       WHERE g.org_id = $1::uuid AND g.partner_id = p.id AND g.status = 'published'
       ORDER BY g.published_at DESC NULLS LAST LIMIT 1
    ) pg ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS owned_n, min(c.created_at) AS first_lead_at
        FROM clients c
       WHERE c.org_id = $1::uuid AND c.partner_id = p.id AND COALESCE(c.is_demo, false) = false
    ) oc ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE shared.ok)::int AS paid_in_n,
             min(shared.at) FILTER (WHERE shared.ok) AS first_paid_at,
             count(*) FILTER (
               WHERE shared.ok AND shared.created_at < $7::timestamptz AND p.revenue_share_pct > 0
                 AND NOT EXISTS (
                   SELECT 1 FROM partner_revenue rv2
                    WHERE rv2.org_id = shared.org_id AND rv2.partner_id = p.id
                      AND ((rv2.transaction_id IS NOT NULL AND rv2.transaction_id = shared.transaction_id)
                        OR (rv2.source_event_id IS NOT NULL AND rv2.source_event_id = shared.source_event_id))
                 ))::int AS unaccrued_n
        FROM (
          SELECT sp.org_id, sp.transaction_id, sp.source_event_id, sp.created_at,
                 COALESCE(sp.paid_at, sp.created_at) AS at,
                 (sp.kind = ANY($6::text[]) AND sp.amount > 0
                  AND lower(btrim(COALESCE(pr.code, ''))) = ANY($5::text[])) AS ok
            FROM sale_payments sp
            JOIN sales sl ON sl.id = sp.sale_id AND sl.org_id = sp.org_id
            JOIN clients c ON c.id = sl.client_id AND c.org_id = sl.org_id
            LEFT JOIN products pr ON pr.id = sp.product_id
           WHERE sp.org_id = $1::uuid AND c.partner_id = p.id
             AND COALESCE(sp.is_demo, false) = false AND COALESCE(sl.is_demo, false) = false
             AND sp.kind <> 'refund'
        ) shared
    ) pd ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS revenue_n, min(rv.created_at) AS first_revenue_at
        FROM partner_revenue rv
       WHERE rv.org_id = $1::uuid AND rv.partner_id = p.id AND rv.status <> 'void'
    ) rv ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE x.status = 'paid')::int AS paid_n,
             min(x.paid_at) FILTER (WHERE x.status = 'paid') AS paid_at,
             count(*) FILTER (WHERE x.status = 'held' AND x.created_at < $9::timestamptz)::int AS held_n,
             count(*) FILTER (WHERE x.status = 'processing' AND COALESCE(x.initiated_at, x.created_at) < $8::timestamptz)::int AS stuck_n
        FROM partner_payouts x
       WHERE x.org_id = $1::uuid AND x.partner_id = p.id
    ) po ON true
${PARTNER_WHERE}   ORDER BY p.created_at ASC
   LIMIT ${ROW_CAP}
`;
