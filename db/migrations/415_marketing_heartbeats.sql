-- 415_marketing_heartbeats.sql — when each part of the marketing machine last ran.
--
-- Spec docs/specs/marketing-machine-2026-10-04.md §6 Step 4 (the clock and the
-- worker) and §8.3 (the health card, GET /api/marketing/health). Plan unit U22.
--
-- ONE ROW PER COMPANY PER NAME. A beat overwrites the row; nothing piles up.
--   clock         netlify/functions/marketing-clock.mjs, every 15 minutes
--                 (src/marketing/clock.mjs tick). detail: the weekly-batch switch
--                 and what work was waiting.
--   worker        netlify/functions/marketing-worker-background.mjs, once when a
--                 pass starts and once when it ends (src/marketing/worker.mjs
--                 runPass). detail: what the pass did.
--   page_seen     GET /api/marketing/health, each time a staff member reads the
--                 card. detail: who. Write now uses it to know Chris is on the page.
--   outbox_drain  the worker's repo save to GitHub (src/repo/outbox.mjs
--                 drainOutbox), at most once a minute. detail: the last drain's
--                 result, so the health card can say why saves are held
--                 (no_token / dry_run). A drain that only found another drain
--                 running ('busy') moves last_at and keeps the old detail.
--
-- The clock, the worker and the drain serve every company the machine serves, so
-- they beat the same name on each of those companies' rows. The health card reads
-- its own company's rows only.
--
-- ON DELETE CASCADE on org_id: a beat is a status light, not a record. Because the
-- worker beats on every company it serves, a plain reference would make a company
-- impossible to remove until someone hand-deleted its lights first. Nothing in the
-- app deletes a company; this only keeps a beat from ever being the thing in the way.
--
-- Row security: the 402/403 pattern (org_id → orgs, RLS on and forced, an
-- *_app_all policy, the fundhub_app grant inside the pg_roles check) plus the
-- anon/authenticated REVOKE block from 409.

CREATE TABLE IF NOT EXISTS public.marketing_heartbeats (
  org_id   uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name     text NOT NULL,
  last_at  timestamptz NOT NULL DEFAULT now(),
  detail   jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT marketing_heartbeats_pkey PRIMARY KEY (org_id, name),
  -- The four names the code writes. A new beat is a new migration, not a typo
  -- that silently starts its own row.
  CONSTRAINT marketing_heartbeats_name_ck
    CHECK (name IN ('clock', 'worker', 'page_seen', 'outbox_drain')),
  CONSTRAINT marketing_heartbeats_detail_ck
    CHECK (jsonb_typeof(detail) = 'object')
);

COMMENT ON TABLE public.marketing_heartbeats IS
  'When each part of the marketing machine last ran (spec 2026-10-04 §6 Step 4, §8.3): clock, worker, page_seen, outbox_drain. One row per org per name; read by GET /api/marketing/health.';

ALTER TABLE public.marketing_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_heartbeats FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'marketing_heartbeats'
       AND policyname = 'marketing_heartbeats_app_all'
  ) THEN
    CREATE POLICY marketing_heartbeats_app_all
      ON public.marketing_heartbeats
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_heartbeats TO fundhub_app;
  END IF;
END $$;

-- Supabase's web roles (anon = not logged in, authenticated = any signed-in user of
-- the public API) must never touch this table. The policy above applies to every role
-- and says "true", so the table grants are the only gate: take them away from those
-- two roles. The app does not connect as either one. Skipped where a role is absent.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.marketing_heartbeats FROM %I', r);
    END IF;
  END LOOP;
END $$;
