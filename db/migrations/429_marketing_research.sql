-- 429_marketing_research.sql — the two research buttons on the server:
-- "Research the market" (flywheel step 2, J2) and "Research it" (deep research, J20).
--
-- Design: docs/specs/command-center-design-2026-10-05.md §6 "Slice 10" and §5 safety
-- rules 13, 14, 17 and 18. Unit X2 of ops/workflows/marketing-machine-2026-10-extras.json.
--
-- NO NEW TABLE. Both jobs are rows in marketing_jobs (409), run in saved steps by the
-- marketing worker (src/marketing/worker.mjs). This file adds only what the database
-- has to guard:
--
--   marketing_jobs
--     * approved_by / approved_at — who approved a research report and when (a
--       person's tap only; nothing else writes them).
--     * one deep research run in flight per company (a double tap cannot pay twice);
--     * one flywheel_stage run in flight per company, campaign and stage (the shared
--       index the design asks for; stages 4 and 5 use the same kind);
--     * a flywheel_stage row always names its campaign and stage;
--     * a finished deep research row always holds a report with words in it.
--   marketing_settings
--     * max_research_cost_usd — "Research: stop at $__ a run". NULL until Chris types a
--       number; no default is invented (design §5 rule 13). The card asks per run
--       until then.
--     * research_shares_month_cap — "Research counts against the $300 month cap",
--       yes by default (design §7 question 5, recommended Shared).
--   marketing_model_usage
--     * web_search_requests / web_fetch_requests — so a search is priced at $10 per
--       1,000 (a failed search is not billed) and a fetch is counted (fetches cost only
--       tokens);
--     * step — which saved step made the call ("sweep-r2-competitor-funnels").
--
-- NUMBER: 429. Free in the lane pools on 2026-10-06 (417 U28, 424 U33 and 425 X4 are
-- taken; X1 takes the lowest free number, so this unit takes the highest).
-- Safe to re-run: IF NOT EXISTS everywhere, constraints and indexes dropped first.
-- Another unit adding the same columns with IF NOT EXISTS changes nothing here.

-- ── marketing_jobs ───────────────────────────────────────────────────────────

ALTER TABLE public.marketing_jobs
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- A "who approved" always has a "when". (approved_by alone may go NULL later when that
-- staff row is removed — ON DELETE SET NULL — so the reverse is not required.)
ALTER TABLE public.marketing_jobs DROP CONSTRAINT IF EXISTS marketing_jobs_approved_pair_ck;
ALTER TABLE public.marketing_jobs ADD CONSTRAINT marketing_jobs_approved_pair_ck
  CHECK (approved_by IS NULL OR approved_at IS NOT NULL);

-- Only a finished job can be approved.
ALTER TABLE public.marketing_jobs DROP CONSTRAINT IF EXISTS marketing_jobs_approved_done_ck;
ALTER TABLE public.marketing_jobs ADD CONSTRAINT marketing_jobs_approved_done_ck
  CHECK (approved_at IS NULL OR status = 'done');

-- A flywheel stage run says which campaign and which stage it is for.
ALTER TABLE public.marketing_jobs DROP CONSTRAINT IF EXISTS marketing_jobs_flywheel_stage_payload_ck;
ALTER TABLE public.marketing_jobs ADD CONSTRAINT marketing_jobs_flywheel_stage_payload_ck
  CHECK (
    kind <> 'flywheel_stage'
    OR (
      jsonb_typeof(payload -> 'campaign') = 'string'
      AND btrim(payload ->> 'campaign') <> ''
      AND jsonb_typeof(payload -> 'stage') = 'number'
    )
  );

-- A finished deep research run holds a report with words in it (the write-up, or the
-- report built by code when the write-up failed twice). "Done" with nothing to read
-- is the silent empty result.
ALTER TABLE public.marketing_jobs DROP CONSTRAINT IF EXISTS marketing_jobs_research_report_ck;
ALTER TABLE public.marketing_jobs ADD CONSTRAINT marketing_jobs_research_report_ck
  CHECK (
    kind <> 'deep_research'
    OR status <> 'done'
    OR (
      jsonb_typeof(result -> 'report') = 'object'
      AND jsonb_typeof(result -> 'report' -> 'markdown') = 'string'
      AND btrim(result -> 'report' ->> 'markdown') <> ''
    )
  );

-- One deep research run in flight per company. POST marketing/research inserts with
-- ON CONFLICT against exactly this predicate and hands back the running row.
DROP INDEX IF EXISTS public.marketing_jobs_one_research_in_flight_uq;
CREATE UNIQUE INDEX marketing_jobs_one_research_in_flight_uq
  ON public.marketing_jobs (org_id)
  WHERE kind = 'deep_research' AND status IN ('queued', 'running');

-- One run of each flywheel stage in flight per company and campaign.
DROP INDEX IF EXISTS public.marketing_jobs_one_flywheel_stage_in_flight_uq;
CREATE UNIQUE INDEX marketing_jobs_one_flywheel_stage_in_flight_uq
  ON public.marketing_jobs (org_id, (payload ->> 'campaign'), (payload ->> 'stage'))
  WHERE kind = 'flywheel_stage' AND status IN ('queued', 'running');

COMMENT ON COLUMN public.marketing_jobs.approved_by IS
  'The staff member who tapped Approve on a research report (migration 429). NULL until approved.';
COMMENT ON COLUMN public.marketing_jobs.approved_at IS
  'When Approve was tapped (migration 429). Only a done job can be approved.';

-- ── marketing_settings ───────────────────────────────────────────────────────

ALTER TABLE public.marketing_settings
  ADD COLUMN IF NOT EXISTS max_research_cost_usd numeric(10,2),
  ADD COLUMN IF NOT EXISTS research_shares_month_cap boolean NOT NULL DEFAULT true;

ALTER TABLE public.marketing_settings DROP CONSTRAINT IF EXISTS marketing_settings_research_cap_ck;
ALTER TABLE public.marketing_settings ADD CONSTRAINT marketing_settings_research_cap_ck
  CHECK (max_research_cost_usd IS NULL OR (max_research_cost_usd > 0 AND max_research_cost_usd <= 1000));

COMMENT ON COLUMN public.marketing_settings.max_research_cost_usd IS
  'Deep research stop amount per run, in dollars of model spend (migration 429). NULL = not set; the card asks per run.';
COMMENT ON COLUMN public.marketing_settings.research_shares_month_cap IS
  'true = research spend counts against max_month_cost_usd (migration 429, default yes).';

-- ── marketing_model_usage ────────────────────────────────────────────────────

ALTER TABLE public.marketing_model_usage
  ADD COLUMN IF NOT EXISTS web_search_requests integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS web_fetch_requests integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS step text;

ALTER TABLE public.marketing_model_usage DROP CONSTRAINT IF EXISTS marketing_model_usage_server_tools_ck;
ALTER TABLE public.marketing_model_usage ADD CONSTRAINT marketing_model_usage_server_tools_ck
  CHECK (web_search_requests >= 0 AND web_fetch_requests >= 0);

-- The spend so far of one job (the per-run cap check before every step).
DROP INDEX IF EXISTS public.marketing_model_usage_job_idx;
CREATE INDEX marketing_model_usage_job_idx
  ON public.marketing_model_usage (job_id)
  WHERE job_id IS NOT NULL;

COMMENT ON COLUMN public.marketing_model_usage.web_search_requests IS
  'Anthropic web searches this call made (usage.server_tool_use). Priced at $10 per 1,000 inside cost_usd (migration 429).';
COMMENT ON COLUMN public.marketing_model_usage.web_fetch_requests IS
  'Anthropic web fetches this call made. No fee beyond tokens (migration 429).';
COMMENT ON COLUMN public.marketing_model_usage.step IS
  'The saved step that made the call, for example sweep-r2-competitor-funnels (migration 429).';
