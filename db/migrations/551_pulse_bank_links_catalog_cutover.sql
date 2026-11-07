-- Preserve prior Apply-link history while starting a new active cohort after
-- the owner-approved 2026-10-24 lender catalog cleanup (migration 504).
-- The cleanup kept 43 lenders active and hid 1,068. Without this cutover,
-- the hourly beat compares 30 current links with 991 historical hashes forever.
ALTER TABLE public.pulse_bank_links
  ADD COLUMN IF NOT EXISTS retired_at timestamptz;

COMMENT ON COLUMN public.pulse_bank_links.retired_at IS
  'Historical Apply URL retired from the active heartbeat cohort; prior check results are preserved.';

WITH approved_catalog AS (
  SELECT org_id
    FROM public.lenders
   WHERE org_id = (SELECT id FROM public.orgs WHERE is_default ORDER BY created_at LIMIT 1)
   GROUP BY org_id
  HAVING count(*) FILTER (WHERE active) = 43
     AND count(*) FILTER (WHERE NOT active) = 1068
)
UPDATE public.pulse_bank_links AS b
   SET retired_at = now()
  FROM approved_catalog AS c
 WHERE b.org_id = c.org_id
   AND b.retired_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.lenders AS l
      WHERE l.org_id = b.org_id
        AND l.active
        AND l.application_url IS NOT NULL
        AND btrim(l.application_url) <> ''
        AND encode(sha256(convert_to(l.application_url, 'UTF8')), 'hex') = b.url_hash
   );
