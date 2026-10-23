-- 504_tier1_banks_2026_10_23.sql — Chris's Tier 1 banks become Fundhub's top picks.
--
-- Owner rule, Chris, 2026-10-23: "these banks are the top picks for Fund Hub ... when we go
-- through a banking sequence, these are the top picks." Full list and source:
-- docs/funding/tier-1-banks.md.
--
-- HOW. lenders.priority_tier already exists (138_lenders.sql, values 1/2/3) and listLenders
-- (src/pulse/beats/lib/lenders-truth.mjs) already orders by priority_tier NULLS LAST, which is
-- the list matchForClient screens. Setting tier 1 puts these banks first in every bank match.
-- No code change.
--
-- Name patterns are anchored at the start of the name so look-alikes stay out:
-- "First Citizens" and "Citizens First Bank" are not Citizens; partner banks that only issue
-- through Elan or FNBO ("Central Pacific Bank (0% - Elan Financial)", "Garden State Community
-- Bank (FNBO)") are not tiered here. bureaus_pulled and eligible_states are not touched.
-- Re-running changes nothing. A bank with no row is reported, never invented.

UPDATE lenders
   SET priority_tier     = 1,
       last_updated_by   = 'tier 1 banks 2026-10-23',
       last_updated_date = DATE '2026-10-23'
 WHERE COALESCE(is_demo, false) = false
   AND priority_tier IS DISTINCT FROM 1
   AND (
         name ~* '^chase'
      OR name ~* '^elan'
      OR name ~* '^(american express|amex)'
      OR name ~* '^wells fargo'
      OR name ~* '^truist'
      OR name ~* '^bank of america'
      OR name ~* '^flagstar'
      OR name ~* '^(fnbo|first national bank of omaha)'
      OR name ~* '^first arkansas bank'
      OR name ~* '^intuit'
      OR name ~* '^barclays'
      OR name ~* '^citizens bank'
      OR name ~* '^wings'
      OR name ~* '^langley'
      OR name ~* '^navy federal'
   );

DO $$
DECLARE
  pat text;
  missing text := '';
BEGIN
  FOREACH pat IN ARRAY ARRAY[
    '^chase', '^elan', '^(american express|amex)', '^wells fargo', '^truist',
    '^bank of america', '^flagstar', '^(fnbo|first national bank of omaha)',
    '^first arkansas bank', '^intuit', '^barclays', '^citizens bank', '^wings',
    '^langley', '^navy federal'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM lenders WHERE COALESCE(is_demo,false)=false AND name ~* pat) THEN
      missing := missing || ' ' || pat;
    END IF;
  END LOOP;
  RAISE NOTICE '504: % lender row(s) now tier 1. No row found for:%',
    (SELECT count(*) FROM lenders WHERE priority_tier = 1 AND COALESCE(is_demo,false)=false),
    CASE WHEN missing = '' THEN ' (none)' ELSE missing END;
END $$;
