-- 410_marketing_settings_funnels.sql — the marketing machine's settings, its
-- funnels, and the table that makes a repeated write safe.
--
-- Spec: docs/specs/marketing-machine-2026-10-04.md §6 Step 3 (the column tables
-- below are copied from it) and §7.8 (every write sends a request_id; a repeated
-- request_id returns the saved response). Defaults from §17 (Monday 7:00 am
-- Arizona, ad numbers from 91, 3 scripts a day in total).
--
-- THREE TABLES, all org-level, all the 402/403/409 pattern: org_id → orgs, row
-- security on AND forced, one *_app_all policy, the fundhub_app grant inside the
-- pg_roles check, and the anon/authenticated REVOKE block from 409.
--
--   marketing_settings  one row per company. The row is made on the first read
--                       (src/marketing/settings-store.mjs getOrCreateSettings),
--                       so the defaults live HERE, not in the screen.
--                       enabled starts false. Only Chris's tap in Settings turns
--                       it on; no migration or seed ever does.
--   marketing_funnels   where an ad sends people. Unique per company by key.
--                       lane is the ad_lane enum (286, + 'slo' from 406).
--                       meta_campaign_ids starts empty: Chris maps campaigns in
--                       Settings. Nothing guesses them.
--   marketing_requests  one row per finished write, keyed by the request_id the
--                       screen sends. src/marketing/http.mjs withRequest writes
--                       it as the LAST statement of the same transaction as the
--                       change, so a change and its saved answer land together
--                       or not at all.
--
-- updated_at IS SET BY CODE, NOT A TRIGGER. A settings or funnel write sends the
-- updated_at it read; a different one means somebody saved in between (409).
-- The code moves updated_at forward by at least one millisecond on every save
-- (the screen sees milliseconds), so set_updated_at() is NOT attached here: it
-- would write now() with microseconds the screen can never send back.
--
-- NUMBER: lane A's 406–415 range; the build plan grants 410 to unit U03.
-- Safe to re-run: IF NOT EXISTS everywhere, constraints dropped before re-adding.

-- ── marketing_settings ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.marketing_settings (
  org_id              uuid PRIMARY KEY REFERENCES orgs(id),
  enabled             boolean NOT NULL DEFAULT false,
  batch_weekday       integer NOT NULL DEFAULT 1,          -- 0 = Sunday
  batch_time          time    NOT NULL DEFAULT '07:00',
  timezone            text    NOT NULL DEFAULT 'America/Phoenix',
  scripts_per_day     integer NOT NULL DEFAULT 3,
  days_per_batch      integer NOT NULL DEFAULT 7,
  size_rule           text    NOT NULL DEFAULT 'total',
  format_style        jsonb   NOT NULL DEFAULT
    '{"standard":"bullets","sorting":"words","long":"words","notes":"bullets","greenscreen":"bullets","vsl":"bullets"}'::jsonb,
  draft_expiry_days   integer NOT NULL DEFAULT 14,
  winner_rule         jsonb,                               -- NULL = not set yet
  ad_number_floor     integer NOT NULL DEFAULT 91,
  next_overrides      jsonb,
  max_batch_cost_usd  integer NOT NULL DEFAULT 40,         -- whole dollars, model bills only
  max_month_cost_usd  integer NOT NULL DEFAULT 300,        -- whole dollars, model bills only
  submagic_template   text    NOT NULL DEFAULT 'Hormozi 2',
  caption_position_y  integer,                             -- NULL until a test export sets it
  magic_zooms         boolean NOT NULL DEFAULT false,
  clean_audio         boolean NOT NULL DEFAULT true,
  caption_dictionary  text[]  NOT NULL DEFAULT '{}',
  animation_mode      text    NOT NULL DEFAULT 'fullframe',
  flip_horizontal     boolean NOT NULL DEFAULT false,
  settle_minutes      integer NOT NULL DEFAULT 10,
  quiet_start         time    NOT NULL DEFAULT '21:00',
  quiet_end           time    NOT NULL DEFAULT '07:00',
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES staff(id) ON DELETE SET NULL
);

ALTER TABLE public.marketing_settings DROP CONSTRAINT IF EXISTS marketing_settings_weekday_ck;
ALTER TABLE public.marketing_settings ADD CONSTRAINT marketing_settings_weekday_ck
  CHECK (batch_weekday BETWEEN 0 AND 6);

ALTER TABLE public.marketing_settings DROP CONSTRAINT IF EXISTS marketing_settings_size_rule_ck;
ALTER TABLE public.marketing_settings ADD CONSTRAINT marketing_settings_size_rule_ck
  CHECK (size_rule IN ('total', 'per_funnel'));

ALTER TABLE public.marketing_settings DROP CONSTRAINT IF EXISTS marketing_settings_animation_mode_ck;
ALTER TABLE public.marketing_settings ADD CONSTRAINT marketing_settings_animation_mode_ck
  CHECK (animation_mode IN ('fullframe', 'overlay'));

ALTER TABLE public.marketing_settings DROP CONSTRAINT IF EXISTS marketing_settings_positive_ck;
ALTER TABLE public.marketing_settings ADD CONSTRAINT marketing_settings_positive_ck
  CHECK (scripts_per_day > 0 AND days_per_batch > 0 AND draft_expiry_days > 0
         AND ad_number_floor > 0 AND max_batch_cost_usd > 0 AND max_month_cost_usd > 0
         AND settle_minutes > 0);

ALTER TABLE public.marketing_settings DROP CONSTRAINT IF EXISTS marketing_settings_text_ck;
ALTER TABLE public.marketing_settings ADD CONSTRAINT marketing_settings_text_ck
  CHECK (btrim(timezone) <> '' AND btrim(submagic_template) <> '');

ALTER TABLE public.marketing_settings DROP CONSTRAINT IF EXISTS marketing_settings_json_ck;
ALTER TABLE public.marketing_settings ADD CONSTRAINT marketing_settings_json_ck
  CHECK (jsonb_typeof(format_style) = 'object'
         AND (winner_rule IS NULL OR jsonb_typeof(winner_rule) = 'object')
         AND (next_overrides IS NULL OR jsonb_typeof(next_overrides) = 'object'));

ALTER TABLE public.marketing_settings DROP CONSTRAINT IF EXISTS marketing_settings_caption_y_ck;
ALTER TABLE public.marketing_settings ADD CONSTRAINT marketing_settings_caption_y_ck
  CHECK (caption_position_y IS NULL OR caption_position_y >= 0);

COMMENT ON TABLE public.marketing_settings IS
  'Marketing machine settings, one row per org (spec 2026-10-04 §6 Step 3). Made on first read with these defaults. enabled is turned on only by Chris in Settings.';

-- ── marketing_funnels ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.marketing_funnels (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      uuid NOT NULL REFERENCES orgs(id),
  key                         text NOT NULL,
  name                        text NOT NULL,
  landing_url                 text NOT NULL,
  offer_key                   text,                        -- src/marketing/offer-facts.mjs; NULL = not set
  lane                        ad_lane NOT NULL,
  book_call                   boolean NOT NULL DEFAULT false,
  format_mix                  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- ratios, e.g. {"standard":2,"sorting":1}
  cta_type                    text NOT NULL DEFAULT 'LEARN_MORE',
  meta_campaign_ids           text[] NOT NULL DEFAULT '{}',
  default_ad_set_external_id  text,
  weight                      numeric NOT NULL DEFAULT 1,
  active                      boolean NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  -- One funnel per key per company. The seed and upsertFunnel both land on this.
  CONSTRAINT marketing_funnels_org_key_uq UNIQUE (org_id, key)
);

ALTER TABLE public.marketing_funnels DROP CONSTRAINT IF EXISTS marketing_funnels_key_ck;
ALTER TABLE public.marketing_funnels ADD CONSTRAINT marketing_funnels_key_ck
  CHECK (key ~ '^[a-z0-9][a-z0-9_]{0,62}$');

ALTER TABLE public.marketing_funnels DROP CONSTRAINT IF EXISTS marketing_funnels_text_ck;
ALTER TABLE public.marketing_funnels ADD CONSTRAINT marketing_funnels_text_ck
  CHECK (btrim(name) <> ''
         AND landing_url ~ '^https://'
         AND (offer_key IS NULL OR btrim(offer_key) <> '')
         AND btrim(cta_type) <> '');

ALTER TABLE public.marketing_funnels DROP CONSTRAINT IF EXISTS marketing_funnels_mix_ck;
ALTER TABLE public.marketing_funnels ADD CONSTRAINT marketing_funnels_mix_ck
  CHECK (jsonb_typeof(format_mix) = 'object');

ALTER TABLE public.marketing_funnels DROP CONSTRAINT IF EXISTS marketing_funnels_weight_ck;
ALTER TABLE public.marketing_funnels ADD CONSTRAINT marketing_funnels_weight_ck
  CHECK (weight >= 0);

COMMENT ON TABLE public.marketing_funnels IS
  'Marketing machine funnels (spec 2026-10-04 §6 Step 3). Unique per org by key. meta_campaign_ids are set by Chris in Settings, never guessed.';

-- ── marketing_requests ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.marketing_requests (
  request_id  text PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES orgs(id),
  route       text NOT NULL,
  response    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_requests DROP CONSTRAINT IF EXISTS marketing_requests_text_ck;
ALTER TABLE public.marketing_requests ADD CONSTRAINT marketing_requests_text_ck
  CHECK (btrim(request_id) <> '' AND length(request_id) <= 200 AND btrim(route) <> '');

CREATE INDEX IF NOT EXISTS marketing_requests_org_created_idx
  ON public.marketing_requests (org_id, created_at DESC);

COMMENT ON TABLE public.marketing_requests IS
  'One row per finished marketing write, keyed by the screen''s request_id (spec 2026-10-04 §7.8). A repeat from the same org and route gets this saved response back.';

-- ── row security, grants (the 402/403/409 pattern) ──────────────────────────

ALTER TABLE public.marketing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_funnels  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_funnels  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_requests FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'marketing_settings'
       AND policyname = 'marketing_settings_app_all'
  ) THEN
    CREATE POLICY marketing_settings_app_all
      ON public.marketing_settings
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'marketing_funnels'
       AND policyname = 'marketing_funnels_app_all'
  ) THEN
    CREATE POLICY marketing_funnels_app_all
      ON public.marketing_funnels
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'marketing_requests'
       AND policyname = 'marketing_requests_app_all'
  ) THEN
    CREATE POLICY marketing_requests_app_all
      ON public.marketing_requests
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_settings TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_funnels  TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_requests TO fundhub_app;
  END IF;
END $$;

-- Supabase's web roles (anon = not logged in, authenticated = any signed-in user of
-- the public API) must never touch these tables. The policies above say "true" for
-- every role, so the table grants are the only gate: take them away from those two
-- roles. The app does not connect as either one. Skipped where a role is absent.
DO $$
DECLARE r text; t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['marketing_settings', 'marketing_funnels', 'marketing_requests'] LOOP
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;
