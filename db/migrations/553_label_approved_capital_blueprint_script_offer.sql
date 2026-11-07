-- Capital Blueprint is an approved offer key in src/ads/registry.mjs. The
-- existing Chris script uses it, but its dictionary label was never saved.
-- Add only the display label; do not alter the script, ads, or spend.
-- Both tables force row security. db/migrate.mjs wraps each file in a transaction;
-- the staff actor is local to this file and cannot leak into later migrations.
SELECT set_config('fundhub.actor', 'staff', true);

INSERT INTO public.ad_labels (org_id, kind, key, name, source_ref)
SELECT s.org_id, 'offer', 'capital_blueprint', 'Capital Blueprint',
       'src/ads/registry.mjs OFFERS'
  FROM public.ad_scripts AS s
  JOIN public.orgs AS o ON o.id = s.org_id AND o.is_default
 WHERE s.id = 'bdb9a311-a9ec-4a45-8833-701e16172d65'::uuid
   AND s.org_id = 'fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6'::uuid
   AND s.offer_key = 'capital_blueprint'
   AND s.source = 'chris'
   AND s.version = 1
   AND s.status = 'locked'
   AND s.archived_at IS NULL
   AND (SELECT count(*)
          FROM public.ad_scripts AS x
         WHERE x.org_id = s.org_id
           AND x.offer_key = 'capital_blueprint'
           AND x.source IN ('chris', 'agent')
           AND NOT EXISTS (
             SELECT 1 FROM public.partners AS p
              WHERE p.id = x.partner_id AND p.is_demo
           )) = 1
   AND NOT EXISTS (
     SELECT 1 FROM public.ad_labels AS l
      WHERE l.org_id = s.org_id AND l.kind = 'offer' AND l.key = 'capital_blueprint'
   )
ON CONFLICT (org_id, kind, key) DO NOTHING;
