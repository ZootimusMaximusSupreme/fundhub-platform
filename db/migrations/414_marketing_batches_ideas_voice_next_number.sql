-- 414_marketing_batches_ideas_voice_next_number.sql — the script machine's
-- batches, its ideas inbox, Chris's voice pairs, and the one place that hands
-- out ad numbers.
--
-- Spec: docs/specs/marketing-machine-2026-10-04.md §7.4 (marketing_batches,
-- ad_ideas, next_ad_number) and §7.2 (voice_pairs). Plan unit U11.
-- 413 added ad_scripts.batch_id and ad_scripts.idea_id; their foreign keys are
-- added here, once the tables they point at exist.
--
-- Row security: the 402/403 pattern for every new table (org_id → orgs, RLS
-- enabled AND forced, a *_app_all policy, the fundhub_app grant inside the
-- pg_roles check) plus 409's REVOKE block for Supabase's web roles.
--
-- NOTHING HERE IS DELETED BY CODE. The foreign keys below are RESTRICT where a
-- row explains where another came from (a script's batch, a script's idea), and
-- SET NULL where the child is still worth keeping on its own (a voice pair is
-- a before/after the voice file learns from, with or without its script).


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1 — marketing_batches: one row per batch of scripts
-- ═══════════════════════════════════════════════════════════════════════════
--
-- kind weekly    = the scheduled drop (owner decision 1: every 7 days, at the
--                  day and time Chris sets).
-- kind on_command = Write now.
-- week_key       = the ISO week of release_at in the settings time zone, written
--                  YYYY-Www (e.g. 2026-W41). ONE weekly batch per org per week:
--                  this is what stops a clock that fires twice from writing two
--                  batches (spec 7.7 / M1 Done 2).

CREATE TABLE IF NOT EXISTS public.marketing_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  kind         text NOT NULL,
  week_key     text,
  status       text NOT NULL DEFAULT 'planned',
  plan         jsonb,
  rules_sha    text,
  release_at   timestamptz,
  released_at  timestamptz,
  total        integer NOT NULL DEFAULT 0,
  ready        integer NOT NULL DEFAULT 0,
  flagged      integer NOT NULL DEFAULT 0,
  failed       integer NOT NULL DEFAULT 0,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT marketing_batches_kind_ck
    CHECK (kind IN ('weekly', 'on_command')),
  CONSTRAINT marketing_batches_status_ck
    CHECK (status IN ('planned', 'writing', 'ready', 'released', 'failed')),
  CONSTRAINT marketing_batches_week_key_ck
    CHECK (week_key IS NULL OR week_key ~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$'),
  -- A weekly batch with no week would slip past the one-per-week index below,
  -- because NULLs never collide.
  CONSTRAINT marketing_batches_weekly_has_week_ck
    CHECK (kind <> 'weekly' OR week_key IS NOT NULL),
  CONSTRAINT marketing_batches_counts_ck
    CHECK (total >= 0 AND ready >= 0 AND flagged >= 0 AND failed >= 0),
  -- A released batch says when; a failed one says why (the 409 rule: "it
  -- failed" with no reason is an empty result nobody can act on).
  CONSTRAINT marketing_batches_released_at_ck
    CHECK (status <> 'released' OR released_at IS NOT NULL),
  CONSTRAINT marketing_batches_failed_reason_ck
    CHECK (status <> 'failed' OR (error IS NOT NULL AND btrim(error) <> ''))
);

DROP INDEX IF EXISTS marketing_batches_one_weekly_uq;
CREATE UNIQUE INDEX marketing_batches_one_weekly_uq
  ON public.marketing_batches (org_id, week_key)
  WHERE kind = 'weekly';

CREATE INDEX IF NOT EXISTS marketing_batches_org_created_idx
  ON public.marketing_batches (org_id, created_at DESC);

COMMENT ON TABLE public.marketing_batches IS
  'One batch of machine-written scripts (spec 7.4). kind weekly = the scheduled drop, one per org per ISO week (marketing_batches_one_weekly_uq); kind on_command = Write now. Drafts become visible when release_at <= now() and status = released.';
COMMENT ON COLUMN public.marketing_batches.week_key IS
  'ISO week of release_at in the settings time zone, YYYY-Www. Required for weekly batches.';
COMMENT ON COLUMN public.marketing_batches.plan IS
  'The planner''s plan (spec 7.5): every slot with its reason, plus 3 angle suggestions with numbers.';
COMMENT ON COLUMN public.marketing_batches.rules_sha IS
  'The commit of the rules the writer read for this batch, so every script in it was written to one set of rules.';


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2 — ad_ideas: the ideas inbox
-- ═══════════════════════════════════════════════════════════════════════════
--
-- source: chris (dropped from the app), machine (the planner), suggestion (one
-- of the plan's 3 angle suggestions, accepted). kind script = write a new
-- script; kind opening = 3 new first lines for an existing script whose ad is
-- dying before 25% (spec 7.5, the one exception to rule 34), held in options.

CREATE TABLE IF NOT EXISTS public.ad_ideas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES orgs(id),
  partner_id        uuid REFERENCES partners(id) ON DELETE RESTRICT,
  batch_id          uuid REFERENCES public.marketing_batches(id) ON DELETE RESTRICT,
  source            text NOT NULL DEFAULT 'chris',
  kind              text NOT NULL DEFAULT 'script',
  raw_points        text,
  topic             text,
  script_format     text,
  funnel_key        text,
  angle_key         text,
  offer_key         text,
  lane              ad_lane,
  target_script_id  uuid REFERENCES ad_scripts(id) ON DELETE RESTRICT,
  options           jsonb,
  status            text NOT NULL DEFAULT 'new',
  attempts          integer NOT NULL DEFAULT 0,
  failure_reason    text,
  script_id         uuid REFERENCES ad_scripts(id) ON DELETE SET NULL,
  created_by        uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ad_ideas_source_ck
    CHECK (source IN ('chris', 'machine', 'suggestion')),
  CONSTRAINT ad_ideas_kind_ck
    CHECK (kind IN ('script', 'opening')),
  CONSTRAINT ad_ideas_status_ck
    CHECK (status IN ('new', 'writing', 'written', 'failed', 'dropped')),
  CONSTRAINT ad_ideas_attempts_ck CHECK (attempts >= 0),
  -- An opening is new first lines for ONE script; without it there is nothing
  -- to put them on.
  CONSTRAINT ad_ideas_opening_target_ck
    CHECK (kind <> 'opening' OR target_script_id IS NOT NULL),
  CONSTRAINT ad_ideas_options_ck
    CHECK (options IS NULL OR jsonb_typeof(options) = 'array'),
  CONSTRAINT ad_ideas_failed_reason_ck
    CHECK (status <> 'failed' OR (failure_reason IS NOT NULL AND btrim(failure_reason) <> '')),
  -- Same shape as the ad_scripts label keys (377:197-204, 413), so an idea's
  -- keys can be copied onto the script it becomes without a second rule.
  CONSTRAINT ad_ideas_script_format_ck
    CHECK (script_format IS NULL OR script_format ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT ad_ideas_funnel_key_ck
    CHECK (funnel_key IS NULL OR funnel_key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT ad_ideas_angle_ck
    CHECK (angle_key IS NULL OR angle_key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT ad_ideas_offer_ck
    CHECK (offer_key IS NULL OR offer_key ~ '^[a-z][a-z0-9_]{1,48}$')
);

CREATE INDEX IF NOT EXISTS ad_ideas_org_status_idx
  ON public.ad_ideas (org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS ad_ideas_batch_idx
  ON public.ad_ideas (batch_id) WHERE batch_id IS NOT NULL;

COMMENT ON TABLE public.ad_ideas IS
  'The ideas inbox (spec 7.4, 7.8). One row per idea: Chris''s points, a planner idea, or an accepted angle suggestion. kind=opening carries 3 new first lines (options) for target_script_id. script_id is the script the idea became.';
COMMENT ON COLUMN public.ad_ideas.raw_points IS
  'Chris''s points, word for word. The writer passes them on unchanged.';


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 3 — voice_pairs: what the machine wrote, next to what Chris made it
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Spec 7.2: every edit Chris makes to a machine line saves one pair. A weekly
-- worker job adds the new pairs (exported_at IS NULL) to VOICE.md through the
-- repo outbox, then stamps exported_at.

CREATE TABLE IF NOT EXISTS public.voice_pairs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  script_id    uuid REFERENCES ad_scripts(id) ON DELETE SET NULL,
  "before"     text NOT NULL,
  "after"      text NOT NULL,
  kind         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  exported_at  timestamptz,

  -- A pair where nothing changed teaches the voice file nothing.
  CONSTRAINT voice_pairs_changed_ck CHECK ("before" <> "after"),
  CONSTRAINT voice_pairs_before_ck  CHECK (btrim("before") <> ''),
  CONSTRAINT voice_pairs_kind_ck
    CHECK (kind IS NULL OR kind ~ '^[a-z][a-z0-9_]{1,48}$')
);

CREATE INDEX IF NOT EXISTS voice_pairs_unexported_idx
  ON public.voice_pairs (org_id, created_at)
  WHERE exported_at IS NULL;

COMMENT ON TABLE public.voice_pairs IS
  'One edit Chris made to a machine-written line: the machine''s words (before) and his (after). The weekly voice export appends unexported pairs to marketing/ads/VOICE.md and stamps exported_at (spec 7.2).';
COMMENT ON COLUMN public.voice_pairs.kind IS
  'What part of the script the edit was in (e.g. hook, line2, cue, cta), same shape as a label key. NULL = not said.';


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 4 — the two foreign keys 413 left for this file
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE ad_scripts DROP CONSTRAINT IF EXISTS ad_scripts_batch_id_fkey;
ALTER TABLE ad_scripts ADD CONSTRAINT ad_scripts_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES public.marketing_batches(id) ON DELETE RESTRICT;

ALTER TABLE ad_scripts DROP CONSTRAINT IF EXISTS ad_scripts_idea_id_fkey;
ALTER TABLE ad_scripts ADD CONSTRAINT ad_scripts_idea_id_fkey
  FOREIGN KEY (idea_id) REFERENCES public.ad_ideas(id) ON DELETE RESTRICT;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 5 — ROW SECURITY, updated_at, GRANTS (402/403 pattern + 409 REVOKE)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketing_batches', 'ad_ideas', 'voice_pairs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_app_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I USING (true) WITH CHECK (true)',
        t || '_app_all', t);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    FOREACH t IN ARRAY ARRAY['marketing_batches', 'ad_ideas'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_updated_at') THEN
        EXECUTE format(
          'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
          'trg_' || t || '_updated_at', t);
      END IF;
    END LOOP;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_batches TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_ideas          TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_pairs       TO fundhub_app;
  END IF;
END $$;

-- Supabase's web roles (anon = not logged in, authenticated = any signed-in user
-- of the public API) must never touch these tables. The policies above say
-- "true", so the table grants are the only gate: take them away. The app does
-- not connect as either one. Skipped where a role is absent (CI, a laptop).
DO $$
DECLARE r text; t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['marketing_batches', 'ad_ideas', 'voice_pairs'] LOOP
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 6 — next_ad_number(org): the one place an ad number comes from
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Returns 1 + the highest of:
--   * every ads.fundhub_ad_number      (Meta-side rows; 377 Part 4c)
--   * every ad_scripts.ad_id           (archived versions too: never reused)
--   * every ad_videos.ad_id            (takes; 389)
--   * marketing_settings.ad_number_floor − 1, when that table and column exist
--     and the org has a row; otherwise 90 (so the first number is 91, the next
--     free one after the locked SLO ads 84-90 — spec §3).
-- Measured on production 2026-10-05: ads max 90, ad_scripts max 90, ad_videos
-- max 86, no marketing_settings yet → 91.
--
-- WHY EACH PIECE IS THERE
--   * The three columns are text, so only values that are all digits, 1-9 of
--     them, are cast. Nine is the cap every one of them already carries
--     (377 ads_fundhub_ad_number_ck, 389 ad_videos_ad_id_ck, 393
--     ad_scripts_ad_id_ck) and the cap fundhub_ad_id() reads utm_content with
--     (286:81-84). Anything else is not one of our numbers and is ignored
--     rather than breaking the cast. It also keeps the answer inside an int.
--   * plpgsql, not sql: a plpgsql body is planned when it RUNS, so this function
--     can be created before marketing_settings exists (410 may land after 414),
--     and it looks the table and column up with to_regclass at run time.
--   * pg_advisory_xact_lock on a per-org key: a second caller in the same org
--     waits until the first one's transaction ends, so two transactions can
--     never be handed the same number. Transaction-scoped, so it is safe on the
--     Supabase pooler (a session lock would leak onto the next borrower).
--     The caller writes the number (ad_scripts.ad_id) in the SAME transaction
--     (spec 7.4); the lock is what makes "max + 1" safe.
--   * VOLATILE (the default, said out loud): each query below then reads a
--     fresh snapshot AFTER the lock is held, so it sees the number the previous
--     holder just committed. A STABLE function would read the caller's older
--     snapshot and hand out the same number twice.
--   * READ COMMITTED only. Under REPEATABLE READ or SERIALIZABLE the whole
--     transaction keeps one snapshot, so even after waiting for the lock it
--     cannot see the previous holder's number. It refuses rather than guess.
--   * SECURITY DEFINER with a fixed search_path: it must see every partner's
--     numbers, and ads / ad_scripts / ad_videos force partner row security. The
--     owner bypasses it on production (postgres has BYPASSRLS, measured
--     2026-10-05) and in CI (superuser). For any other owner the staff actor is
--     set for the length of the call and put back as it was before returning,
--     so the caller's own scope is unchanged afterwards. It returns one integer
--     and nothing else.
--   * EXECUTE: fundhub_app only. Taken from PUBLIC and from Supabase's anon,
--     authenticated and service_role, where they exist.

CREATE OR REPLACE FUNCTION public.next_ad_number(p_org uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  top        bigint := 0;
  v          bigint;
  floor_n    bigint;
  prev_actor text;
BEGIN
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'next_ad_number: an org id is required (414)';
  END IF;

  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION
      'next_ad_number: call it in a READ COMMITTED transaction, not %, or two callers can get the same number (414)',
      current_setting('transaction_isolation');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('fundhub.next_ad_number:' || p_org::text, 0));

  prev_actor := current_setting('fundhub.actor', true);
  PERFORM set_config('fundhub.actor', 'staff', true);

  SELECT max(fundhub_ad_number::bigint) INTO v
    FROM ads
   WHERE org_id = p_org AND fundhub_ad_number ~ '^[0-9]{1,9}$';
  top := greatest(top, coalesce(v, 0));

  SELECT max(ad_id::bigint) INTO v
    FROM ad_scripts
   WHERE org_id = p_org AND ad_id ~ '^[0-9]{1,9}$';
  top := greatest(top, coalesce(v, 0));

  SELECT max(ad_id::bigint) INTO v
    FROM ad_videos
   WHERE org_id = p_org AND ad_id ~ '^[0-9]{1,9}$';
  top := greatest(top, coalesce(v, 0));

  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = to_regclass('public.marketing_settings')
       AND attname = 'ad_number_floor'
       AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT ad_number_floor::bigint FROM public.marketing_settings WHERE org_id = $1'
      INTO floor_n USING p_org;
  END IF;

  PERFORM set_config('fundhub.actor', coalesce(prev_actor, ''), true);

  RETURN greatest(top + 1, coalesce(floor_n, 91))::integer;
END $$;

REVOKE ALL ON FUNCTION public.next_ad_number(uuid) FROM PUBLIC;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.next_ad_number(uuid) FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT EXECUTE ON FUNCTION public.next_ad_number(uuid) TO fundhub_app;
  END IF;
END $$;

COMMENT ON FUNCTION public.next_ad_number(uuid) IS
  'The next free ad number for an org (414, spec 7.4): 1 + the highest all-digit (1-9 digits) value in ads.fundhub_ad_number, ad_scripts.ad_id and ad_videos.ad_id, never below marketing_settings.ad_number_floor (91 when that is not set). Holds a per-org advisory transaction lock, so call it and write the number in ONE READ COMMITTED transaction. Numbers are never reused. EXECUTE: fundhub_app only.';
