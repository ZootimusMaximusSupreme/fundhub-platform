-- 409_marketing_jobs.sql — the marketing machine's job table. First user: the
-- dashboard's "Write offer" button (POST /api/marketing/offer/generate).
--
-- WHY A NEW TABLE. Read before adding, 2026-10-05:
--   * generation_jobs (045) is claimed by the creative-job-runner cron every two
--     minutes (src/creative/generate.mjs claim: any queued row for a partner).
--     An offer row there would be grabbed by the ad-image runner and failed with
--     "no active provider configured". It also has no column for a result.
--   * creative_assets (045) only takes kind static | video | copy and requires an
--     ad aspect ratio (format 1x1 | 4x5 | 9x16 | 16x9). An offer is neither.
--   * marketing_content_queue (172) is social captions; partner_ai_usage (172)
--     is token metering; agent_runs (177) is per-client agent turns.
-- None fits, so this is the table the owner-approved spec already names:
-- docs/specs/marketing-machine-2026-10-04.md §6 Step 3, "marketing_jobs: id,
-- org_id, kind, payload, status (queued | running | done | failed), attempts,
-- run_after, claimed_at, finished_at, error, result". Those columns exactly,
-- plus requested_by (who pressed the button) and the two timestamps.
--
-- NUMBER. M1 of ops/workflows/perfect-machine-2026-10-05.md holds 406-408.
-- This is the next free one.
--
-- THE RULES LIVE HERE, NOT IN THE SCREEN (CLAUDE.md §3a):
--   * a failed job must say why; a done job must hold its result;
--   * one offer in flight per company — a double press cannot pay for two runs.
--
-- Row security: the 403 pattern (org_id → orgs, RLS on and forced, an
-- *_app_all policy, the fundhub_app grant inside the pg_roles check).

CREATE TABLE IF NOT EXISTS public.marketing_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  kind          text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'queued',
  attempts      integer NOT NULL DEFAULT 0,
  run_after     timestamptz NOT NULL DEFAULT now(),
  claimed_at    timestamptz,
  finished_at   timestamptz,
  error         text,
  result        jsonb,
  requested_by  uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT marketing_jobs_kind_ck CHECK (btrim(kind) <> ''),
  CONSTRAINT marketing_jobs_status_ck
    CHECK (status IN ('queued', 'running', 'done', 'failed')),
  CONSTRAINT marketing_jobs_attempts_ck CHECK (attempts >= 0),
  -- "It failed" with no reason is the silent empty result nobody can act on.
  CONSTRAINT marketing_jobs_failed_reason_ck
    CHECK (status <> 'failed' OR (error IS NOT NULL AND btrim(error) <> '')),
  -- A finished job with nothing in it would show the dashboard an empty offer.
  CONSTRAINT marketing_jobs_done_result_ck
    CHECK (status <> 'done' OR result IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS marketing_jobs_org_kind_created_idx
  ON public.marketing_jobs (org_id, kind, created_at DESC);

-- One offer being written at a time, per company. The endpoint inserts with
-- ON CONFLICT against exactly this predicate and hands back the running row.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_jobs_one_offer_in_flight_uq
  ON public.marketing_jobs (org_id)
  WHERE kind = 'offer' AND status IN ('queued', 'running');

COMMENT ON TABLE public.marketing_jobs IS
  'Marketing machine jobs (spec 2026-10-04 §6 Step 3). kind=offer: one press of Write offer; payload = inputs, result = the winning offer and its review card.';

ALTER TABLE public.marketing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_jobs FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'marketing_jobs'
       AND policyname = 'marketing_jobs_app_all'
  ) THEN
    CREATE POLICY marketing_jobs_app_all
      ON public.marketing_jobs
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_marketing_jobs_updated_at') THEN
    CREATE TRIGGER trg_marketing_jobs_updated_at
      BEFORE UPDATE ON public.marketing_jobs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_jobs TO fundhub_app;
  END IF;
END $$;
