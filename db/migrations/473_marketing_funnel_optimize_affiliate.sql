-- 473_marketing_funnel_optimize_affiliate.sql
--
-- Credit repair door at https://fundhub.ai/optimize — affiliate portal offer
-- links come from live marketing_funnels rows (src/affiliates/share-link.mjs).

SELECT set_config('fundhub.actor', 'staff', true);

INSERT INTO marketing_funnels (org_id, key, name, landing_url, offer_key, lane, book_call, format_mix, active, status)
SELECT p.org_id,
       'optimize',
       'Credit repair',
       'https://fundhub.ai/optimize',
       NULL,
       'unknown'::ad_lane,
       false,
       '{}'::jsonb,
       true,
       'live'
  FROM partners p
  JOIN orgs o ON o.id = p.org_id AND o.is_default
 WHERE p.slug = 'fundhub-house'
ON CONFLICT (org_id, key) DO NOTHING;
