-- 416_ads_number_index_and_source.sql — one Fundhub ad number may run on
-- several Meta ads, and every number on `ads` says where it came from.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY (owner-approved spec docs/specs/marketing-machine-2026-10-04.md §10.4)
--
-- 377 made ads.fundhub_ad_number unique per company (ads_fundhub_number_uq,
-- 377:575-576). That allowed ONE Meta ad per number. The marketing machine
-- loads one finished video into Meta once per ad set, and a v2 of the same ad
-- keeps its number (spec §1 "One number per ad"; §7.4 "Editing a locked script
-- keeps its number"). So the same number has to be allowed on several Meta ads.
-- The unique index becomes a plain index on the same columns, so every lookup
-- by (company, number) is still fast.
--
-- WHAT STILL HOLDS. The number's shape is unchanged: ads_fundhub_ad_number_ck
-- (377:569) still allows 1-9 digits only. Numbers are still handed out by one
-- counter (spec §7.4 next_ad_number) and never reused, so sharing a number now
-- means "the same ad in two places", never "two different ads".
--
-- WHAT A READER MUST NOW KNOW (recorded for M5, spec §11). One number may now
-- have several `ads` rows. A report per number must count leads per NUMBER
-- (client_ad_attribution.ad_id), not per ads row, or a lead is counted once for
-- every ads row that carries its number. api/read/ad-spine.mjs already counts
-- count(DISTINCT client_id) per label group.
--
-- CHECKED BEFORE WRITING (production, read only, 2026-10-05):
--   * no constraint is built on ads_fundhub_number_uq (pg_constraint.conindid)
--     and nothing in pg_depend points at it but the table itself;
--   * no database function uses ON CONFLICT on the number. The only function
--     that reads the column is fundhub_meta_ad_number (407), which counts
--     DISTINCT numbers and does not need uniqueness;
--   * 407's numbering of the four SLO ads uses NOT EXISTS, not ON CONFLICT;
--   * in the code, the only writer of the number is api/campaigns/link-asset.mjs,
--     whose 23505 "ad_number_taken" branch existed only for this index and is
--     removed in the same change.
--   * production holds 4 numbered ads rows (84, 86, 89, 90 — set by 407 on the
--     owner's decision) out of 7.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- fundhub_ad_number_source — WHO SET THE NUMBER
--
--   manual  a person typed it (the Campaign Manager link box,
--           api/campaigns/link-asset.mjs) or the owner decided it (407)
--   loader  the machine set it when it loaded the ad into Meta (spec §10.4)
--   utm     the daily Meta sync read it from the leading digits of the ad's
--           utm_content in url_tags (spec §10.5)
--   name    the daily Meta sync read it from the ad name, "Ad 91 — …"
--           (spec §10.5)
--
-- NULL means nobody has said, which is the honest state of a row with no
-- number. The sync never overwrites a 'manual' number (spec §10.5).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SAFETY. No DELETE. The only UPDATE fills the new column on rows that already
-- carry a number and have no source yet. Re-running the whole file changes
-- nothing. `ads` has FORCEd row-level security (046); like 407 this runs as the
-- owner (MIGRATION_DATABASE_URL), which sees every row. No CONCURRENTLY: each
-- file runs inside one transaction in db/migrate.mjs.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. THE UNIQUE INDEX BECOMES A PLAIN INDEX ───────────────────────────────

DROP INDEX IF EXISTS ads_fundhub_number_uq;

CREATE INDEX IF NOT EXISTS ads_fundhub_number_idx
  ON ads (org_id, fundhub_ad_number) WHERE fundhub_ad_number IS NOT NULL;


-- ── 2. WHERE THE NUMBER CAME FROM ───────────────────────────────────────────

ALTER TABLE ads
  ADD COLUMN IF NOT EXISTS fundhub_ad_number_source text;

ALTER TABLE ads DROP CONSTRAINT IF EXISTS ads_fundhub_ad_number_source_ck;
ALTER TABLE ads
  ADD CONSTRAINT ads_fundhub_ad_number_source_ck
  CHECK (fundhub_ad_number_source IS NULL
         OR fundhub_ad_number_source IN ('manual', 'loader', 'utm', 'name'));


-- ── 3. THE NUMBERS THAT ALREADY EXIST WERE SET BY A PERSON ──────────────────
--
-- Before this file the only ways a number reached `ads` were a person typing it
-- (link-asset) and 407, which wrote 84, 86, 89 and 90 on the owner's decision.
-- Both are 'manual', so the sync will never overwrite them.

DO $$
DECLARE
  n integer;
BEGIN
  UPDATE ads
     SET fundhub_ad_number_source = 'manual'
   WHERE fundhub_ad_number IS NOT NULL
     AND fundhub_ad_number_source IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '416: % numbered ads row(s) marked manual', n;
END $$;


COMMENT ON COLUMN ads.fundhub_ad_number_source IS
  'Who set fundhub_ad_number: manual (a person, or the owner via 407), loader (the machine, when it loaded the ad into Meta), utm (the daily sync, from the leading digits of utm_content in the ad''s url_tags) or name (the daily sync, from "Ad <n>" in the ad name). NULL = not said; normal when there is no number. The sync never overwrites manual. 416.';

-- 377's comment on the number said "UNIQUE PER ORG". That stopped being true
-- above, so the comment is rewritten to match; everything else in it stands.
COMMENT ON COLUMN ads.fundhub_ad_number IS
  'OURS. The number in the ad''s link — the leading digits of utm_content, so "42" in utm_content=42-ringlights. NULL = nobody has set it yet, and that is normal, not a defect. text and not integer so it joins client_ad_attribution.ad_id with no cast; the CHECK is the same regex as client_ad_attribution_ad_id_ck. NOT the same thing as external_id, which is Meta''s id. ONE POOL PER COMPANY, NOT PER PARTNER (377), but NOT UNIQUE since 416: one number may run on several Meta ads (one per ad set, or a v2 that keeps its number). fundhub_ad_number_source says who set it.';

COMMENT ON INDEX ads_fundhub_number_idx IS
  'Plain, not unique (416): one Fundhub ad number may run on several Meta ads (one per ad set, or a v2 that keeps its number). Replaced ads_fundhub_number_uq from 377. Per-number reports must count leads per number, not per ads row.';
