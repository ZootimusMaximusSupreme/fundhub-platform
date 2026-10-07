-- 430 — the daily systems check keeps its own record (MB2, 2026-10-05).
--
-- Board: ops/workflows/morning-brief-2026-10-05.md. Spec:
-- docs/specs/morning-brief-2026-10-05.md, "What it misses" gaps 2 and 10.
--
-- job_heartbeats is platform-wide (no org column): a scheduled job belongs to
-- the whole platform. pulse_scorecards carries the company it was run for,
-- because its queue, dead-letter, payment and tracking checks read that
-- company's rows, and the read endpoint scopes to the caller's company like
-- every other read (src/http/read-endpoints-org-scope.test.mjs).
--
--   job_heartbeats    one row each time a scheduled job finishes. Written by the
--                     Inngest heartbeat add-on (src/workflows/client.mjs) and by
--                     each Netlify scheduled function. The daily pulse reads the
--                     newest row per job and goes red when a job has not run
--                     within 3x its schedule (src/pulse/heartbeats.mjs).
--                     Written once, never changed: INSERT and SELECT only.
--
--   pulse_scorecards  one row per company per morning (America/Phoenix date). The scorecard
--                     contract on the board, stored where the server can keep
--                     it. Before this the scorecard was a markdown file in /tmp
--                     on the server, wiped on every cold start. A re-run on the
--                     same morning replaces that morning's row, so UPDATE is
--                     granted. DELETE is not.
--
-- Nothing deletes old rows. Retention is a "delete data" decision (CLAUDE.md
-- §11) and nobody has made it.

CREATE TABLE IF NOT EXISTS job_heartbeats (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job          text        NOT NULL CHECK (length(job) BETWEEN 1 AND 120),
  runner       text        NOT NULL CHECK (runner IN ('inngest', 'netlify')),
  started_at   timestamptz,
  finished_at  timestamptz NOT NULL DEFAULT now(),
  outcome      text        NOT NULL CHECK (outcome IN ('ok', 'error')),
  -- How many things the pass handled, when the job says. NULL = it did not say.
  -- Never defaulted to 0: "did nothing" and "did not report" are different.
  item_count   integer     CHECK (item_count IS NULL OR item_count >= 0),
  error        text        CHECK (error IS NULL OR length(error) <= 300),
  CONSTRAINT job_heartbeats_order_ck
    CHECK (started_at IS NULL OR started_at <= finished_at)
);

CREATE INDEX IF NOT EXISTS job_heartbeats_job_finished_idx
  ON job_heartbeats (job, finished_at DESC);

CREATE TABLE IF NOT EXISTS pulse_scorecards (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL REFERENCES orgs(id),
  scorecard_date     date        NOT NULL,
  ran_at             timestamptz NOT NULL DEFAULT now(),
  checks             jsonb       NOT NULL CHECK (jsonb_typeof(checks) = 'array'),
  green_count        integer     NOT NULL CHECK (green_count >= 0),
  red_count          integer     NOT NULL CHECK (red_count >= 0),
  not_checked_count  integer     NOT NULL CHECK (not_checked_count >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pulse_scorecards_one_per_day UNIQUE (org_id, scorecard_date),
  -- The counts are the checks array, counted, status by status. A row whose
  -- headline disagrees with its own list is the "8 passed" that hid 2 skipped
  -- (gap 11). Every check must carry one of the three statuses.
  CONSTRAINT pulse_scorecards_counts_match CHECK (
    green_count = jsonb_array_length(jsonb_path_query_array(checks, '$[*] ? (@.status == "green")'))
    AND red_count = jsonb_array_length(jsonb_path_query_array(checks, '$[*] ? (@.status == "red")'))
    AND not_checked_count = jsonb_array_length(jsonb_path_query_array(checks, '$[*] ? (@.status == "not_checked")'))
    AND green_count + red_count + not_checked_count = jsonb_array_length(checks)
  )
);

-- Row-level security: the same shape as 374. These tables carry no client or
-- partner data, so the policy admits the application; the grants below are
-- what limit it, and the read endpoint binds the caller's org_id.
ALTER TABLE public.job_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_heartbeats FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_scorecards FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'job_heartbeats'
       AND policyname = 'job_heartbeats_app_all'
  ) THEN
    CREATE POLICY job_heartbeats_app_all ON public.job_heartbeats
      USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'pulse_scorecards'
       AND policyname = 'pulse_scorecards_app_all'
  ) THEN
    CREATE POLICY pulse_scorecards_app_all ON public.pulse_scorecards
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 104_app_role.sql's default privileges hand every new table full write to
-- fundhub_app. The REVOKE is what makes "written once" and "never deleted" true.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON public.job_heartbeats FROM fundhub_app;
    GRANT SELECT, INSERT ON public.job_heartbeats TO fundhub_app;
    REVOKE DELETE, TRUNCATE ON public.pulse_scorecards FROM fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON public.pulse_scorecards TO fundhub_app;
  END IF;
END $$;

COMMENT ON TABLE job_heartbeats IS
  'One row per finished scheduled-job run (Inngest cron or Netlify scheduled function). Read by the daily pulse (Recon AG-07). Insert-only.';
COMMENT ON TABLE pulse_scorecards IS
  'One row per company per morning (America/Phoenix date): the daily systems check scorecard, board contract shape. Written by src/pulse/daily-pulse.mjs, read by GET /api/read/systems-check.';
