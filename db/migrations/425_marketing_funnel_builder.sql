-- 425_marketing_funnel_builder.sql — funnels the dashboard builds, their pages,
-- and the rules that keep a live page from ever changing.
--
-- Owner order 2026-10-05 (build unit X4): "every time a funnel is made we tag
-- it", "a url system so I don't have to name them, or allow me to name them in
-- the dash", "we can push a funnel live, /blueprint or similar". The test offer
-- is the Capital Blueprint book-a-call funnel.
--
-- WHAT THIS ADDS
--   marketing_funnels (410)  eight columns for a BUILT funnel. A funnel Chris
--                            maps by hand in Settings keeps kind NULL and is
--                            untouched by every rule below.
--     kind          NULL = mapped by hand; 'book_a_call' = built by the dashboard
--     path          the first page's address, '/blueprint'. Unique per company.
--     tag           'fnl-blueprint'. Unique per company and NEVER changes, so
--                   every event, lead and booking stays tied to it.
--     utm_campaign  the lane word every ad for this funnel carries. Must be a
--                   lane fundhub_ad_lane() (286, 407) knows, and equal `lane`,
--                   or the lead's lane would read "unknown".
--     campaign      the flywheel folder the pages were written from (or NULL)
--     status        'draft' or 'live'. Existing rows are 'live' (they point at
--                   pages that already exist).
--     created_by    who pressed the button
--     live_at       when the push was proven
--   marketing_funnel_pages   one row per page of a built funnel, in order:
--                            1 landing, 2 booking, 3 thank_you.
--
-- THE RULES LIVE HERE, NOT IN THE SCREEN (CLAUDE.md §3a):
--   * a page's address is unique in the company;
--   * a saved page carries the funnel tag and the tracking scripts in its HTML,
--     or the save is refused (trigger below);
--   * cf_page_id is only ever a ClickFunnels page THIS machine created, and once
--     it is set the page's address, HTML and id never change again;
--   * a live funnel keeps its address and stays live; a tag never changes;
--   * one build or push in flight per funnel (marketing_jobs index).
--
-- NUMBER. Lane A/D pool: U22 owns 415 and U33 owns 424, so this unit takes 425.
-- Safe to re-run: IF NOT EXISTS everywhere, constraints dropped before re-adding.
-- Row security: the 403/409/410 pattern.

-- ── marketing_funnels: the builder's columns ─────────────────────────────────

ALTER TABLE public.marketing_funnels
  ADD COLUMN IF NOT EXISTS kind         text,
  ADD COLUMN IF NOT EXISTS path         text,
  ADD COLUMN IF NOT EXISTS tag          text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS campaign     text,
  ADD COLUMN IF NOT EXISTS status       text NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS created_by   uuid REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS live_at      timestamptz;

ALTER TABLE public.marketing_funnels DROP CONSTRAINT IF EXISTS marketing_funnels_kind_ck;
ALTER TABLE public.marketing_funnels ADD CONSTRAINT marketing_funnels_kind_ck
  CHECK (kind IS NULL OR kind = 'book_a_call');

ALTER TABLE public.marketing_funnels DROP CONSTRAINT IF EXISTS marketing_funnels_status_ck;
ALTER TABLE public.marketing_funnels ADD CONSTRAINT marketing_funnels_status_ck
  CHECK (status IN ('draft', 'live'));

-- An address is "/" then lower-case words joined by single hyphens, 48 at most.
ALTER TABLE public.marketing_funnels DROP CONSTRAINT IF EXISTS marketing_funnels_path_ck;
ALTER TABLE public.marketing_funnels ADD CONSTRAINT marketing_funnels_path_ck
  CHECK (path IS NULL OR (path ~ '^/[a-z0-9]+(-[a-z0-9]+)*$' AND length(path) <= 48));

ALTER TABLE public.marketing_funnels DROP CONSTRAINT IF EXISTS marketing_funnels_tag_ck;
ALTER TABLE public.marketing_funnels ADD CONSTRAINT marketing_funnels_tag_ck
  CHECK (tag IS NULL OR (tag ~ '^fnl-[a-z0-9]+(-[a-z0-9]+)*$' AND length(tag) <= 64));

-- The UTM rule (286, 407): utm_campaign must be a lane the database maps to
-- itself, never one it would file as "unknown".
ALTER TABLE public.marketing_funnels DROP CONSTRAINT IF EXISTS marketing_funnels_utm_ck;
ALTER TABLE public.marketing_funnels ADD CONSTRAINT marketing_funnels_utm_ck
  CHECK (utm_campaign IS NULL
         OR (utm_campaign ~ '^[a-z0-9]+$' AND fundhub_ad_lane(utm_campaign)::text = utm_campaign));

ALTER TABLE public.marketing_funnels DROP CONSTRAINT IF EXISTS marketing_funnels_campaign_ck;
ALTER TABLE public.marketing_funnels ADD CONSTRAINT marketing_funnels_campaign_ck
  CHECK (campaign IS NULL OR campaign ~ '^[a-z0-9][a-z0-9-]{0,40}$');

-- A built funnel has its address, tag and UTM word; its landing_url is that
-- address; its lane is its UTM word; a live one says when it went live.
ALTER TABLE public.marketing_funnels DROP CONSTRAINT IF EXISTS marketing_funnels_built_ck;
ALTER TABLE public.marketing_funnels ADD CONSTRAINT marketing_funnels_built_ck
  CHECK (kind IS NULL OR (
    path IS NOT NULL AND tag IS NOT NULL AND utm_campaign IS NOT NULL
    AND substring(landing_url from '^https://[^/?#]+(/[^?#]*)$') = path
    AND lane::text = utm_campaign
    AND book_call
    AND (status <> 'live' OR live_at IS NOT NULL)
  ));

DROP INDEX IF EXISTS public.marketing_funnels_org_tag_uq;
CREATE UNIQUE INDEX marketing_funnels_org_tag_uq
  ON public.marketing_funnels (org_id, tag) WHERE tag IS NOT NULL;

DROP INDEX IF EXISTS public.marketing_funnels_org_path_uq;
CREATE UNIQUE INDEX marketing_funnels_org_path_uq
  ON public.marketing_funnels (org_id, path) WHERE path IS NOT NULL;

-- So a page can name its funnel AND its company in one foreign key. Added only
-- when missing: the pages' foreign key below depends on it, so it is never
-- dropped and re-added the way the checks above are.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'marketing_funnels_id_org_uq'
       AND conrelid = 'public.marketing_funnels'::regclass
  ) THEN
    ALTER TABLE public.marketing_funnels ADD CONSTRAINT marketing_funnels_id_org_uq UNIQUE (id, org_id);
  END IF;
END $$;

-- A tag never changes. A built funnel stays built. A live one keeps its address
-- and stays live (a live page is never moved or taken down from here).
CREATE OR REPLACE FUNCTION public.marketing_funnels_builder_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tag IS NOT NULL AND NEW.tag IS DISTINCT FROM OLD.tag THEN
    RAISE EXCEPTION 'marketing_funnels: a funnel tag never changes (% stays %)', OLD.key, OLD.tag
      USING ERRCODE = '23514';
  END IF;
  IF OLD.kind IS NOT NULL AND NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'marketing_funnels: a built funnel stays built' USING ERRCODE = '23514';
  END IF;
  IF OLD.kind IS NOT NULL AND OLD.status = 'live'
     AND (NEW.path IS DISTINCT FROM OLD.path OR NEW.status <> 'live') THEN
    RAISE EXCEPTION 'marketing_funnels: % is live, so its address % never changes', OLD.key, OLD.path
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_marketing_funnels_builder_guard ON public.marketing_funnels;
CREATE TRIGGER trg_marketing_funnels_builder_guard
  BEFORE UPDATE ON public.marketing_funnels
  FOR EACH ROW EXECUTE FUNCTION public.marketing_funnels_builder_guard();

-- ── marketing_funnel_pages ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.marketing_funnel_pages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  funnel_id      uuid NOT NULL,
  position       integer NOT NULL,
  role           text NOT NULL,
  path           text NOT NULL,
  page_copy      jsonb,                 -- the words the model wrote (checked), NULL until built
  html           text,                  -- the whole page, NULL until built
  html_sha256    text,
  built_at       timestamptz,
  build_job_id   uuid REFERENCES public.marketing_jobs(id) ON DELETE SET NULL,
  cf_page_id     text,                  -- a ClickFunnels page THIS machine created; NULL until pushed
  cf_public_id   text,
  live_url       text,
  pushed_at      timestamptz,
  sent_sha256    text,                  -- the HTML (with the page token) last sent to OUR page
  proved_at      timestamptz,
  proof          jsonb,
  events_seen    integer NOT NULL DEFAULT 0,
  last_event_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT marketing_funnel_pages_funnel_fk
    FOREIGN KEY (funnel_id, org_id) REFERENCES public.marketing_funnels (id, org_id) ON DELETE CASCADE,
  CONSTRAINT marketing_funnel_pages_role_uq UNIQUE (funnel_id, role),
  CONSTRAINT marketing_funnel_pages_position_uq UNIQUE (funnel_id, position)
);

ALTER TABLE public.marketing_funnel_pages DROP CONSTRAINT IF EXISTS marketing_funnel_pages_role_ck;
ALTER TABLE public.marketing_funnel_pages ADD CONSTRAINT marketing_funnel_pages_role_ck
  CHECK ((role = 'landing' AND position = 1)
      OR (role = 'booking' AND position = 2)
      OR (role = 'thank_you' AND position = 3));

ALTER TABLE public.marketing_funnel_pages DROP CONSTRAINT IF EXISTS marketing_funnel_pages_path_ck;
ALTER TABLE public.marketing_funnel_pages ADD CONSTRAINT marketing_funnel_pages_path_ck
  CHECK (path ~ '^/[a-z0-9]+(-[a-z0-9]+)*$' AND length(path) <= 60);

-- Built means words, a page and its fingerprint, all together.
ALTER TABLE public.marketing_funnel_pages DROP CONSTRAINT IF EXISTS marketing_funnel_pages_built_ck;
ALTER TABLE public.marketing_funnel_pages ADD CONSTRAINT marketing_funnel_pages_built_ck
  CHECK ((html IS NULL) = (built_at IS NULL)
     AND (html IS NULL) = (html_sha256 IS NULL)
     AND (html IS NULL OR (btrim(html) <> '' AND page_copy IS NOT NULL AND jsonb_typeof(page_copy) = 'object'))
     AND (html_sha256 IS NULL OR html_sha256 ~ '^[0-9a-f]{64}$')
     AND (sent_sha256 IS NULL OR sent_sha256 ~ '^[0-9a-f]{64}$'));

-- Pushed means a page id, a time and an https address, all together; proof
-- only comes after a push; nothing is pushed before it is built.
ALTER TABLE public.marketing_funnel_pages DROP CONSTRAINT IF EXISTS marketing_funnel_pages_pushed_ck;
ALTER TABLE public.marketing_funnel_pages ADD CONSTRAINT marketing_funnel_pages_pushed_ck
  CHECK ((cf_page_id IS NULL) = (pushed_at IS NULL)
     AND (cf_page_id IS NULL) = (live_url IS NULL)
     AND (cf_page_id IS NULL OR (btrim(cf_page_id) <> '' AND html IS NOT NULL))
     AND (live_url IS NULL OR live_url ~ '^https://')
     AND (proved_at IS NULL OR cf_page_id IS NOT NULL)
     AND (sent_sha256 IS NULL OR cf_page_id IS NOT NULL)
     AND events_seen >= 0);

-- An address is used once in the company, across every built funnel.
DROP INDEX IF EXISTS public.marketing_funnel_pages_org_path_uq;
CREATE UNIQUE INDEX marketing_funnel_pages_org_path_uq
  ON public.marketing_funnel_pages (org_id, path);

DROP INDEX IF EXISTS public.marketing_funnel_pages_cf_page_uq;
CREATE UNIQUE INDEX marketing_funnel_pages_cf_page_uq
  ON public.marketing_funnel_pages (org_id, cf_page_id) WHERE cf_page_id IS NOT NULL;

-- A page belongs to a built funnel; a saved page carries the funnel tag and the
-- tracking scripts; a page live on ClickFunnels never changes its address, its
-- HTML or its page id.
CREATE OR REPLACE FUNCTION public.marketing_funnel_pages_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  f record;
BEGIN
  SELECT kind, tag INTO f FROM public.marketing_funnels WHERE id = NEW.funnel_id;
  IF f.kind IS NULL OR f.tag IS NULL THEN
    RAISE EXCEPTION 'marketing_funnel_pages: pages belong to a funnel the dashboard built'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.html IS NOT NULL THEN
    IF strpos(NEW.html, '<meta name="fh-funnel-tag" content="' || f.tag || '">') = 0 THEN
      RAISE EXCEPTION 'marketing_funnel_pages: the % page does not carry the funnel tag %', NEW.role, f.tag
        USING ERRCODE = '23514';
    END IF;
    IF strpos(NEW.html, 'src="https://fundhub.ai/funnel/fh-events.js"') = 0
       OR strpos(NEW.html, 'src="https://fundhub.ai/funnel/fh-attribution.js"') = 0
       OR strpos(NEW.html, 'fbq(''init''') = 0 THEN
      RAISE EXCEPTION 'marketing_funnel_pages: the % page is missing the tracking scripts', NEW.role
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.cf_page_id IS NOT NULL THEN
    IF NEW.cf_page_id IS DISTINCT FROM OLD.cf_page_id
       OR NEW.path IS DISTINCT FROM OLD.path
       OR NEW.html IS DISTINCT FROM OLD.html
       OR NEW.funnel_id IS DISTINCT FROM OLD.funnel_id THEN
      RAISE EXCEPTION 'marketing_funnel_pages: % is on ClickFunnels, so its address, page and id never change', OLD.path
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_marketing_funnel_pages_guard ON public.marketing_funnel_pages;
CREATE TRIGGER trg_marketing_funnel_pages_guard
  BEFORE INSERT OR UPDATE ON public.marketing_funnel_pages
  FOR EACH ROW EXECUTE FUNCTION public.marketing_funnel_pages_guard();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_marketing_funnel_pages_updated_at') THEN
    CREATE TRIGGER trg_marketing_funnel_pages_updated_at
      BEFORE UPDATE ON public.marketing_funnel_pages
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.marketing_funnel_pages IS
  'Pages of a funnel the dashboard built (build unit X4, 2026-10-06): 1 landing, 2 booking, 3 thank_you. Each saved page carries the funnel tag and the tracking scripts; cf_page_id is only a ClickFunnels page this machine created, and once set the page never changes.';

-- ── marketing_jobs: one build or push in flight per funnel ───────────────────
-- kind 'funnel' writes the pages, kind 'funnel_push' puts them on ClickFunnels.
-- They share one slot, so a push never starts while the pages are being written.
DROP INDEX IF EXISTS public.marketing_jobs_one_funnel_job_uq;
CREATE UNIQUE INDEX marketing_jobs_one_funnel_job_uq
  ON public.marketing_jobs ((payload->>'funnel_id'))
  WHERE kind IN ('funnel', 'funnel_push') AND status IN ('queued', 'running');

-- ── row security, grants (the 403/409/410 pattern) ───────────────────────────

ALTER TABLE public.marketing_funnel_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_funnel_pages FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'marketing_funnel_pages'
       AND policyname = 'marketing_funnel_pages_app_all'
  ) THEN
    CREATE POLICY marketing_funnel_pages_app_all
      ON public.marketing_funnel_pages
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_funnel_pages TO fundhub_app;
  END IF;
END $$;

-- Supabase's web roles (anon = not logged in, authenticated = any signed-in user of
-- the public API) must never touch this table. The policy above says "true" for
-- every role, so the table grants are the only gate. Skipped where a role is absent.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.marketing_funnel_pages FROM %I', r);
    END IF;
  END LOOP;
END $$;
