-- 407_ad_number_from_meta.sql — an ad number for every visitor a Meta ad sent.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT WAS BROKEN (measured on production, 2026-10-05, read only)
--
-- 286 reads the ad number from the LEADING DIGITS of utm_content only
-- ("84-slo-ad-1" → 84). The live Meta ads send utm_content={{ad.name}}, which
-- is "oVid: SLO2", and utm_term={{adset.id}}, which is "120253626444640264".
-- No leading digits, so client_ad_attribution.ad_id was NULL on all 18 rows,
-- and none of the 7 rows in `ads` carried a Fundhub ad number either. No sale
-- could be tied to an ad. (marketing/MACHINE-GAPS.md §4 and §7.)
--
-- OWNER DECISION (2026-10-05, ops/workflows/perfect-machine-2026-10-05.md):
-- resolve the ad by Meta AD SET ID + AD NAME against our own `ads` table, with
-- NO change to the live ads in Meta.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS FILE DOES, IN ORDER
--
--   1. The `slo` lane (added in 406) gets a rule: a campaign name with the word
--      SLO in it, like "oPur: TOF-SLO: $297", is the roadmap lane.
--   2. The four SLO ads that ran get their Fundhub ad number in `ads`.
--   3. fundhub_meta_ad_number(): ad set id + ad name → our ad number, or NULL.
--   4. client_ad_attribution.ad_id stops being a GENERATED column and becomes a
--      column a trigger fills. Same rule as before first (leading digits), the
--      Meta match second. The app still never writes it.
--   5. fundhub_reresolve_ad_numbers(): fills ad numbers that were NULL and can
--      now be found. The daily Meta sync calls it after it saves the ads.
--   6. The backfill: step 5 over every row, and the stale lane recomputed.
--
-- SAFETY. No DELETE anywhere. No row's raw ad tags are changed. An ad number
-- that is already set is never overwritten — not on `ads`, not on a visitor.
-- Re-running the whole file is a no-op.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. THE ROADMAP (SLO) LANE ────────────────────────────────────────────────
--
-- The five exact names from 286 are unchanged and still win first. After them,
-- the word SLO standing on its own anywhere in the campaign name — not inside
-- another word ("slow", "slo2" do not count) — is the roadmap lane. That is
-- what makes "oPur: TOF-SLO: $297" and a later "oPur: TOF-SLO: $147" both read
-- `slo`, and the bare wire value `slo` too.
--
-- IMMUTABLE stays true: the answer depends on the text and nothing else, which
-- is what a GENERATED column (lane, 286) requires. Changing the body does not
-- rewrite stored rows; step 6 below recomputes the ones that are now stale.

CREATE OR REPLACE FUNCTION fundhub_ad_lane(campaign text) RETURNS ad_lane
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE lower(btrim(coalesce(campaign, '')))
    WHEN 'funding600' THEN 'funding600'::ad_lane
    WHEN 'premium'    THEN 'premium'::ad_lane
    WHEN 'sorting'    THEN 'sorting'::ad_lane
    WHEN 'uwiq'       THEN 'uwiq'::ad_lane
    WHEN 'wl'         THEN 'wl'::ad_lane
    ELSE CASE
      WHEN lower(btrim(coalesce(campaign, ''))) ~ '(^|[^a-z0-9])slo([^a-z0-9]|$)'
        THEN 'slo'::ad_lane
      ELSE 'unknown'::ad_lane
    END
  END
$$;


-- ── 2. THE FOUR SLO ADS THAT RAN GET THEIR NUMBER ───────────────────────────
--
-- ads.fundhub_ad_number (377) is "typed by a human". Nobody had typed it. The
-- mapping below is the one the owner pointed at, and it is not a guess:
--
--   Ad numbers 84–90 are SLO Ads 1–7 (ops/workflows/ad-scripts-2026-10-02.md
--   B6, marketing/ads/slo/trigger-maps/84-…90-…).
--   Which Meta ad is which SLO Ad was read from Meta's own record of the video
--   each ad plays — the uploaded file name and its length
--   (ops/workflows/ad-scripts-2026-10-02/w4-findings.md, "How each ad was
--   matched to its script"; marketing/ads/INVENTORY-2026-10-02.md §9):
--
--     oVid: SLO1  Meta ad 120253626444660264  "Ad 1 — Straight offer, full read"      → 84
--     oVid: SLO2  Meta ad 120253626574340264  "SLO Ad 7 — Haynes, the call that …"    → 90
--     oVid: SLO3  Meta ad 120253626579160264  "SLO Ad 6 — Haynes, you already know"   → 89
--     oVid: SLO4  Meta ad 120253626580720264  "SLO Ad 3"                               → 86
--
--   All four sit in ad set 120253626444640264 ("oPur: TOF-SLO: 25-55M: SBOs:
--   2.5M"), campaign "oPur: TOF-SLO: $297".
--
-- The three August ads (oVid: 1, 2, 3) are CONTROLS Ads 4, 2 and 3, which have
-- no Fundhub ad number. They are left NULL on purpose. No number is invented.
--
-- A row is only touched when Meta's ad id, the ad name AND the ad set id all
-- agree, the row has no number yet, and nobody in that company already holds
-- the number. One row per company per number, so a Meta ad mirrored twice can
-- never trip ads_fundhub_number_uq (377). On a database without these ads
-- (every test database) this changes nothing.

DO $$
DECLARE
  n integer;
BEGIN
  WITH want(meta_ad_id, ad_name, adset_id, num) AS (
    VALUES
      ('120253626444660264', 'oVid: SLO1', '120253626444640264', '84'),
      ('120253626574340264', 'oVid: SLO2', '120253626444640264', '90'),
      ('120253626579160264', 'oVid: SLO3', '120253626444640264', '89'),
      ('120253626580720264', 'oVid: SLO4', '120253626444640264', '86')
  ),
  pick AS (
    SELECT DISTINCT ON (a.org_id, w.num) a.id, w.num
      FROM want w
      JOIN ads a      ON a.external_id = w.meta_ad_id AND btrim(a.name) = w.ad_name
      JOIN ad_sets s  ON s.id = a.ad_set_id AND s.external_id = w.adset_id
     WHERE a.fundhub_ad_number IS NULL
       AND NOT EXISTS (
             SELECT 1 FROM ads o
              WHERE o.org_id = a.org_id AND o.fundhub_ad_number = w.num
           )
     ORDER BY a.org_id, w.num, a.created_at, a.id
  )
  UPDATE ads a
     SET fundhub_ad_number = p.num,
         updated_at = now()
    FROM pick p
   WHERE a.id = p.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '407: % Meta ad row(s) given their Fundhub ad number', n;
END $$;


-- ── 3. THE RESOLVER ──────────────────────────────────────────────────────────
--
-- fundhub_meta_ad_number(org, ad set id, ad name) → our ad number, or NULL.
--
-- IT ANSWERS ONLY WHEN THERE IS EXACTLY ONE ANSWER:
--   * the ad set id must be digits (Meta ids are digits; anything else in
--     utm_term — a variant like "sun" — can never match),
--   * the ad name must not be blank, and must equal the ad's name in our table
--     (trimmed; case counts, because {{ad.name}} sends Meta's exact name),
--   * exactly ONE Meta ad (one external_id) in that ad set has that name —
--     two different Meta ads with the same name in one ad set is ambiguous,
--     and ambiguous is NULL, even when one of them has a number,
--   * and exactly one distinct Fundhub number is on it.
-- No match is NULL. Ambiguous is NULL. Never a guess, never a "closest" name.
--
-- SECURITY DEFINER, ON PURPOSE. ads and ad_sets carry FORCEd row-level
-- security (046), scoped to a partner. The visitor row is written by a webhook
-- and by the public checkout, which run with no partner in scope, so a plain
-- read there sees ZERO ads and would quietly answer NULL for everyone — the
-- same trap that stopped the ClickFunnels night job (MACHINE-GAPS.md §7). As
-- the owner it can see the ads. What it can give back is one short number for
-- an ad the caller already names by company, ad set and exact ad name — the
-- number that ad's own link would carry. search_path is pinned, PUBLIC cannot
-- call it, and the app role is granted it below.

CREATE OR REPLACE FUNCTION fundhub_meta_ad_number(p_org uuid, p_adset_id text, p_ad_name text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
           WHEN count(DISTINCT a.external_id) = 1
            AND count(DISTINCT a.fundhub_ad_number) = 1
           THEN max(a.fundhub_ad_number)
         END
    FROM ads a
    JOIN ad_sets s ON s.id = a.ad_set_id
   WHERE a.org_id = p_org
     AND s.org_id = p_org
     AND btrim(coalesce(p_adset_id, '')) ~ '^[0-9]{1,30}$'
     AND s.external_id = btrim(p_adset_id)
     AND btrim(coalesce(p_ad_name, '')) <> ''
     AND btrim(a.name) = btrim(p_ad_name)
$$;

REVOKE ALL ON FUNCTION fundhub_meta_ad_number(uuid, text, text) FROM PUBLIC;

COMMENT ON FUNCTION fundhub_meta_ad_number(uuid, text, text) IS
  'OUR ad number for a Meta ad, found by the ad set id (utm_term={{adset.id}}) and the exact ad name (utm_content={{ad.name}}) in our own ads table. NULL when nothing matches, when two different Meta ads in that ad set share the name, or when the ad has no fundhub_ad_number yet. Never a guess. SECURITY DEFINER because ads/ad_sets are partner-scoped and the visitor row is written with no partner in scope. Owner-set 2026-10-05: match by ad set id + ad name, no change to the live ads.';


-- ── 4. client_ad_attribution.ad_id: FILLED BY A TRIGGER, NOT GENERATED ──────
--
-- A GENERATED column can only read its own row. The Meta match has to read
-- the ads table, so the column becomes a plain one and a BEFORE trigger fills
-- it on every insert and update. What 286 promised still holds: the app only
-- ever stores the raw tags, and the database derives the number, the same way
-- for every row — whatever an INSERT or UPDATE puts in ad_id is replaced.
--
--   1st: the leading digits of utm_content, exactly as before (fundhub_ad_id).
--        "84-slo-ad-1" is still 84. That owner rule (2026-09-06) wins.
--   2nd: the Meta match above.
--   3rd: on an UPDATE that does not change the tags, the number the row
--        already had. A number once found is not lost because an ad was later
--        renamed in Meta and the sync copied the new name.
--
-- DROP EXPRESSION keeps every value already stored. The CHECK
-- (client_ad_attribution_ad_id_ck) and the index (idx_caa_org_ad) stay as they
-- are, and fundhub_ad_number carries the identical CHECK, so a resolved number
-- always fits.
--
-- SECURITY DEFINER on the trigger function so any role that may write a
-- visitor row can, without also being handed the resolver.

ALTER TABLE client_ad_attribution ALTER COLUMN ad_id DROP EXPRESSION IF EXISTS;

CREATE OR REPLACE FUNCTION fundhub_caa_set_ad_id() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  derived text;
BEGIN
  derived := coalesce(
    fundhub_ad_id(NEW.utm_content),
    fundhub_meta_ad_number(NEW.org_id, NEW.utm_term, NEW.utm_content)
  );
  -- OLD is read only inside the UPDATE branch: on an INSERT there is no old row.
  IF derived IS NULL AND TG_OP = 'UPDATE' THEN
    IF NEW.utm_content IS NOT DISTINCT FROM OLD.utm_content
       AND NEW.utm_term IS NOT DISTINCT FROM OLD.utm_term
       AND NEW.org_id   IS NOT DISTINCT FROM OLD.org_id THEN
      derived := OLD.ad_id;
    END IF;
  END IF;
  NEW.ad_id := derived;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION fundhub_caa_set_ad_id() FROM PUBLIC;

DROP TRIGGER IF EXISTS client_ad_attribution_ad_id_trg ON client_ad_attribution;
CREATE TRIGGER client_ad_attribution_ad_id_trg
  BEFORE INSERT OR UPDATE ON client_ad_attribution
  FOR EACH ROW EXECUTE FUNCTION fundhub_caa_set_ad_id();

COMMENT ON COLUMN client_ad_attribution.ad_id IS
  'OUR ad number for the ad that brought this person. Filled by trigger client_ad_attribution_ad_id_trg (407), never by the app: the leading digits of utm_content (286 rule, "84-slo-ad-1" → 84) first, else the Meta match fundhub_meta_ad_number(org, utm_term = ad set id, utm_content = ad name). NULL when the tags name no ad we can match — never a guess. Was a GENERATED column until 407.';


-- ── 5. FILL WHAT CAN NOW BE FOUND ────────────────────────────────────────────
--
-- A visitor can arrive before the daily sync has copied a new ad into our
-- table, or before someone has typed that ad's number. Their row is saved
-- with ad_id NULL, honestly. This fills those rows once the match exists.
-- Only rows whose ad_id IS NULL are touched, so a number is never changed.
-- Called by the daily Meta sync (api/campaigns/sync.mjs) through
-- reresolveAdNumbers() in src/ads/store.mjs, and once below as the backfill.
-- NULL org = every company (the backfill only).

CREATE OR REPLACE FUNCTION fundhub_reresolve_ad_numbers(p_org uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE client_ad_attribution c
     SET ad_id = fundhub_meta_ad_number(c.org_id, c.utm_term, c.utm_content)
   WHERE c.ad_id IS NULL
     AND (p_org IS NULL OR c.org_id = p_org)
     AND c.utm_term IS NOT NULL
     AND c.utm_content IS NOT NULL
     AND fundhub_meta_ad_number(c.org_id, c.utm_term, c.utm_content) IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

REVOKE ALL ON FUNCTION fundhub_reresolve_ad_numbers(uuid) FROM PUBLIC;

COMMENT ON FUNCTION fundhub_reresolve_ad_numbers(uuid) IS
  'Fills client_ad_attribution.ad_id where it is NULL and fundhub_meta_ad_number() now finds the ad. Never changes a number already set, never touches the raw tags, never deletes. Returns how many rows it filled. Run by the daily Meta sync after it saves the ads. 407.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT EXECUTE ON FUNCTION fundhub_meta_ad_number(uuid, text, text) TO fundhub_app;
    GRANT EXECUTE ON FUNCTION fundhub_reresolve_ad_numbers(uuid) TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;


-- ── 6. THE BACKFILL ──────────────────────────────────────────────────────────
--
-- (a) Ad numbers: every visitor row with no number that the match can now
--     resolve. On 2026-10-05 that is the 2 rows tagged "oVid: SLO2" (→ 90).
--     The other 16 of the 18 rows carry no ad tag at all and stay NULL.
-- (b) Lanes: a GENERATED column is only recomputed when its row is written.
--     Rows that read `unknown` but whose campaign now has a lane are written
--     back with their own utm_campaign — the value does not change, the stored
--     lane does. No other column changes; the ad_id trigger keeps the number.
-- UPDATE only. Nothing is deleted.

DO $$
DECLARE
  numbered integer;
  relaned  integer;
BEGIN
  numbered := fundhub_reresolve_ad_numbers(NULL);

  UPDATE client_ad_attribution
     SET utm_campaign = utm_campaign
   WHERE lane = 'unknown'::ad_lane
     AND fundhub_ad_lane(utm_campaign) <> 'unknown'::ad_lane;
  GET DIAGNOSTICS relaned = ROW_COUNT;

  RAISE NOTICE '407 backfill: % visitor row(s) got an ad number, % got their lane', numbered, relaned;
END $$;
