-- 418_marketing_avatar_runs.sql — "Build the avatar" runs on the server (flywheel step 1).
--
-- Design docs/specs/command-center-design-2026-10-05.md §6 "Slice 5a: Who we sell to
-- runs on the server" and the slice 1 additions it depends on. Unit X1.
--
-- NUMBER. 418: the next free number in the 418-423 / 426-429 pool on main and on every
-- mm-* branch when this was written (409-417 and 425 were taken; production holds 430-433).
--
-- WHAT THIS ADDS, AND WHY HERE (CLAUDE.md §3a: the rules live in the database):
--   1. marketing_jobs: one avatar run in flight per company and campaign (a partial
--      unique index — a double tap cannot pay for two runs), and a CHECK that an
--      avatar row always names its campaign and the step it is on (payload.campaign,
--      payload.step; a finished run keeps payload.step = 'done').
--   2. marketing_settings.run_caps: the per-run stop amounts for the jobs Chris taps,
--      {"avatar": 20} by default (design §5 rule 13; owner question §7.4 recommended
--      default). Whole dollars of model spend.
--   3. marketing_model_usage: web_search_requests and web_fetch_requests per call (a
--      search is billed $10 per 1,000 on top of tokens), and `step` (which saved step
--      of a run made the call). GET marketing/costs reads these for "last run" lines.
--      cost_usd already includes the search fee for rows the avatar run writes.
--   4. An index for "what did this job spend so far" (the run cap check before every
--      step) and "the last run of this kind" (GET marketing/costs).
--
-- Every ALTER uses IF NOT EXISTS / DROP ... IF EXISTS, so a sibling unit that adds the
-- same column (the research jobs share these columns) does not collide.
-- No data is changed or deleted.

-- ── 1. marketing_jobs: avatar rows ──────────────────────────────────────────

ALTER TABLE public.marketing_jobs DROP CONSTRAINT IF EXISTS marketing_jobs_avatar_payload_ck;
-- Every part is COALESCEd: a missing key reads as NULL, and a CHECK that comes out
-- NULL passes. Without the COALESCE a row with no campaign at all would be let in.
ALTER TABLE public.marketing_jobs ADD CONSTRAINT marketing_jobs_avatar_payload_ck
  CHECK (
    kind <> 'avatar'
    OR (
      COALESCE(jsonb_typeof(payload), '') = 'object'
      AND COALESCE(jsonb_typeof(payload -> 'campaign'), '') = 'string'
      AND btrim(COALESCE(payload ->> 'campaign', '')) <> ''
      AND COALESCE(jsonb_typeof(payload -> 'step'), '') = 'string'
      AND btrim(COALESCE(payload ->> 'step', '')) <> ''
    )
  );

-- One avatar run being built at a time per company and campaign. The run route
-- inserts with ON CONFLICT against exactly this predicate and hands back the
-- running row ("The avatar is already being built. This is that run.").
DROP INDEX IF EXISTS public.marketing_jobs_one_avatar_in_flight_uq;
CREATE UNIQUE INDEX marketing_jobs_one_avatar_in_flight_uq
  ON public.marketing_jobs (org_id, (payload ->> 'campaign'))
  WHERE kind = 'avatar' AND status IN ('queued', 'running');

-- ── 2. marketing_settings.run_caps ──────────────────────────────────────────

ALTER TABLE public.marketing_settings
  ADD COLUMN IF NOT EXISTS run_caps jsonb NOT NULL DEFAULT '{"avatar": 20}'::jsonb;

ALTER TABLE public.marketing_settings DROP CONSTRAINT IF EXISTS marketing_settings_run_caps_ck;
ALTER TABLE public.marketing_settings ADD CONSTRAINT marketing_settings_run_caps_ck
  CHECK (jsonb_typeof(run_caps) = 'object');

COMMENT ON COLUMN public.marketing_settings.run_caps IS
  'Per-run stop amounts for tapped research jobs, whole dollars of model spend: {"avatar": 20}. A kind not named here has no per-run cap of its own; the month cap still holds.';

-- ── 3. marketing_model_usage: server tools and the step ─────────────────────

ALTER TABLE public.marketing_model_usage
  ADD COLUMN IF NOT EXISTS web_search_requests integer NOT NULL DEFAULT 0;
ALTER TABLE public.marketing_model_usage
  ADD COLUMN IF NOT EXISTS web_fetch_requests integer NOT NULL DEFAULT 0;
ALTER TABLE public.marketing_model_usage
  ADD COLUMN IF NOT EXISTS step text;

ALTER TABLE public.marketing_model_usage DROP CONSTRAINT IF EXISTS marketing_model_usage_server_tools_ck;
ALTER TABLE public.marketing_model_usage ADD CONSTRAINT marketing_model_usage_server_tools_ck
  CHECK (web_search_requests >= 0 AND web_fetch_requests >= 0);

COMMENT ON COLUMN public.marketing_model_usage.web_search_requests IS
  'Web searches this call made (Anthropic bills $10 per 1,000). Included in cost_usd when the row was written by a research job.';

-- ── 4. indexes for the cost reads ───────────────────────────────────────────

DROP INDEX IF EXISTS public.marketing_model_usage_job_idx;
CREATE INDEX marketing_model_usage_job_idx
  ON public.marketing_model_usage (job_id)
  WHERE job_id IS NOT NULL;

DROP INDEX IF EXISTS public.marketing_jobs_org_kind_finished_idx;
CREATE INDEX marketing_jobs_org_kind_finished_idx
  ON public.marketing_jobs (org_id, kind, finished_at DESC)
  WHERE status = 'done';
