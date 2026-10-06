-- 411_marketing_buzzes_usage_shoots.sql — the marketing machine's supporting
-- tables (spec docs/specs/marketing-machine-2026-10-04.md §6 Step 3) and the
-- index the job worker claims by (§6 Step 4).
--
--   * marketing_buzzes       — texts to Chris's phone, waiting through quiet hours
--   * marketing_model_usage  — what each model call cost (a model bill, not client money)
--   * marketing_shoots       — one filming session (Shoot Day, spec §8.2)
--   * marketing_jobs_claim_idx — (status, run_after) on the EXISTING marketing_jobs
--
-- MARKETING_JOBS IS NOT CREATED HERE. 409_marketing_jobs.sql made it and it is
-- live. A CREATE TABLE IF NOT EXISTS here would silently do nothing, so this file
-- only adds the claim index and leaves 409's columns, checks and the one-offer-
-- in-flight index exactly as they are.
--
-- NUMBER. 411 is this unit's number in ops/workflows/marketing-machine-2026-10-plan.json.
--
-- THE RULES LIVE HERE, NOT IN THE SCREEN (CLAUDE.md §3a):
--   * one WAITING buzz per (org, kind, group_key): a second "scripts ready" for the
--     same batch refreshes the words of the one that waits, it never adds a text;
--   * a buzz is sent or given up, never both, and a given-up buzz says why;
--   * a model call with an unknown price is NULL, never 0 (src/marketing/model-usage.mjs
--     prices NULL rows at the highest known rate for the cost cap, never as free);
--   * a shoot is planned | filming | uploaded | done, and a done shoot has an end time.
--
-- Row security: the 403 pattern for every new table (org_id → orgs, RLS enabled AND
-- forced, an *_app_all policy, the fundhub_app grant inside the pg_roles check), plus
-- the anon/authenticated REVOKE block from 409.

-- ── marketing_jobs: the claim index ──────────────────────────────────────────
-- src/marketing/jobs.mjs claimJobs() picks `status = 'queued' AND run_after <= now()`
-- with FOR UPDATE SKIP LOCKED, oldest run_after first. nextRunAfter() reads the
-- earliest queued run_after. Both walk this index.
DROP INDEX IF EXISTS public.marketing_jobs_claim_idx;
CREATE INDEX marketing_jobs_claim_idx
  ON public.marketing_jobs (status, run_after);

-- ── marketing_buzzes ─────────────────────────────────────────────────────────
-- Spec §2 item 4: Chris gets a buzz only when he has something to do. §6 Step 4:
-- the worker sends through notify-fanout send() once quiet hours end, at most one
-- of each kind every 10 minutes. Each one is a paid text to his own phone.
--
-- attempts / last_error / failed_at: notify-fanout's send() does NOT throw when both
-- channels fail — it resolves {ok:false}. So a row is marked sent only on
-- {ok:true, status:'sent'}; anything else counts an attempt and keeps the reason,
-- and after 5 attempts the row is given up (failed_at) and never tried again.
CREATE TABLE IF NOT EXISTS public.marketing_buzzes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  kind        text NOT NULL,
  body        text NOT NULL,
  -- What makes two buzzes "the same one" inside a kind (a batch id, a shoot id).
  -- '' means the kind alone. NOT NULL so the one-waiting index below can see it:
  -- a NULL would never collide and two texts would wait side by side.
  group_key   text NOT NULL DEFAULT '',
  send_after  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  failed_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT marketing_buzzes_kind_ck CHECK (btrim(kind) <> ''),
  CONSTRAINT marketing_buzzes_body_ck CHECK (btrim(body) <> ''),
  CONSTRAINT marketing_buzzes_attempts_ck CHECK (attempts >= 0),
  -- Sent and given up are two different endings. A row cannot have both.
  CONSTRAINT marketing_buzzes_one_ending_ck CHECK (sent_at IS NULL OR failed_at IS NULL),
  -- "It never went" with no reason is the silent failure nobody can act on.
  CONSTRAINT marketing_buzzes_failed_reason_ck
    CHECK (failed_at IS NULL OR (last_error IS NOT NULL AND btrim(last_error) <> ''))
);

-- One waiting buzz per (org, kind, group_key). queueBuzz() inserts with ON CONFLICT
-- against exactly this predicate.
DROP INDEX IF EXISTS public.marketing_buzzes_one_waiting_uq;
CREATE UNIQUE INDEX marketing_buzzes_one_waiting_uq
  ON public.marketing_buzzes (org_id, kind, group_key)
  WHERE sent_at IS NULL AND failed_at IS NULL;

-- sendDueBuzzes(): the rows that are due.
DROP INDEX IF EXISTS public.marketing_buzzes_due_idx;
CREATE INDEX marketing_buzzes_due_idx
  ON public.marketing_buzzes (send_after)
  WHERE sent_at IS NULL AND failed_at IS NULL;

-- sendDueBuzzes(): "was one of this kind sent in the last 10 minutes?"
DROP INDEX IF EXISTS public.marketing_buzzes_kind_sent_idx;
CREATE INDEX marketing_buzzes_kind_sent_idx
  ON public.marketing_buzzes (org_id, kind, sent_at DESC)
  WHERE sent_at IS NOT NULL;

COMMENT ON TABLE public.marketing_buzzes IS
  'Marketing machine buzzes to Chris (spec 2026-10-04 §6 Step 3-4). Wait through quiet hours (send_after); sent only on send() {ok:true, status:sent}; given up after 5 attempts (failed_at, last_error).';

-- ── marketing_model_usage ────────────────────────────────────────────────────
-- One row per model call the machine makes (spec §7.6 Cost). NOT partner_ai_usage /
-- recordUsage: its purpose CHECK (172_wl_marketing.sql:39) refuses new values and it
-- charges the token cap Social Studio shares.
--
-- `model` is the model that actually SERVED the call (callModel's servedModel), which
-- can differ from the one asked for when a refusal fallback ran.
-- `cost_usd` is NULL when the price of that model is not known. Never 0.
-- batch_id has no foreign key yet: marketing_batches arrives in migration 414.
CREATE TABLE IF NOT EXISTS public.marketing_model_usage (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  batch_id            uuid,
  job_id              uuid REFERENCES public.marketing_jobs(id) ON DELETE SET NULL,
  model               text NOT NULL,
  input_tokens        integer NOT NULL DEFAULT 0,
  output_tokens       integer NOT NULL DEFAULT 0,
  cache_read_tokens   integer NOT NULL DEFAULT 0,
  cache_write_tokens  integer NOT NULL DEFAULT 0,
  cost_usd            numeric(12,6),
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT marketing_model_usage_model_ck CHECK (btrim(model) <> ''),
  CONSTRAINT marketing_model_usage_tokens_ck CHECK (
    input_tokens >= 0 AND output_tokens >= 0
    AND cache_read_tokens >= 0 AND cache_write_tokens >= 0
  ),
  CONSTRAINT marketing_model_usage_cost_ck CHECK (cost_usd IS NULL OR cost_usd >= 0)
);

-- costStatus(): this month's spend for one org (Arizona calendar month).
DROP INDEX IF EXISTS public.marketing_model_usage_org_created_idx;
CREATE INDEX marketing_model_usage_org_created_idx
  ON public.marketing_model_usage (org_id, created_at);

-- costStatus(): one batch's spend.
DROP INDEX IF EXISTS public.marketing_model_usage_batch_idx;
CREATE INDEX marketing_model_usage_batch_idx
  ON public.marketing_model_usage (org_id, batch_id)
  WHERE batch_id IS NOT NULL;

COMMENT ON TABLE public.marketing_model_usage IS
  'Marketing machine model calls and their cost (spec 2026-10-04 §7.6). model = the model that served the call; cost_usd NULL = price unknown, never 0.';

-- ── marketing_shoots ─────────────────────────────────────────────────────────
-- Spec §6 Step 3 / §8.2 Shoot Day. root_script_ids is in film order; each id is read
-- as that script's live version, so an edit never breaks the list. marks is
-- {<root_script_id>: {takes, got_it}}. A shoot is done when every script marked
-- Got it has a matched take, or when Chris closes it.
CREATE TABLE IF NOT EXISTS public.marketing_shoots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),
  shoot_date       date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Phoenix')::date),
  root_script_ids  uuid[] NOT NULL DEFAULT '{}'::uuid[],
  marks            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'planned',
  started_at       timestamptz,
  finished_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT marketing_shoots_status_ck
    CHECK (status IN ('planned', 'filming', 'uploaded', 'done')),
  CONSTRAINT marketing_shoots_marks_ck CHECK (jsonb_typeof(marks) = 'object'),
  -- A finished shoot says when it finished.
  CONSTRAINT marketing_shoots_done_time_ck CHECK (status <> 'done' OR finished_at IS NOT NULL),
  CONSTRAINT marketing_shoots_times_ck
    CHECK (started_at IS NULL OR finished_at IS NULL OR finished_at >= started_at)
);

DROP INDEX IF EXISTS public.marketing_shoots_org_date_idx;
CREATE INDEX marketing_shoots_org_date_idx
  ON public.marketing_shoots (org_id, shoot_date DESC);

COMMENT ON TABLE public.marketing_shoots IS
  'Shoot Day sessions (spec 2026-10-04 §6 Step 3, §8.2). root_script_ids in film order; marks = {root_script_id: {takes, got_it}}.';

-- ── Row security, the 403 pattern, for all three new tables ───────────────────
ALTER TABLE public.marketing_buzzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_buzzes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_model_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_model_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_shoots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_shoots FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'marketing_buzzes'
       AND policyname = 'marketing_buzzes_app_all'
  ) THEN
    CREATE POLICY marketing_buzzes_app_all
      ON public.marketing_buzzes
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'marketing_model_usage'
       AND policyname = 'marketing_model_usage_app_all'
  ) THEN
    CREATE POLICY marketing_model_usage_app_all
      ON public.marketing_model_usage
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'marketing_shoots'
       AND policyname = 'marketing_shoots_app_all'
  ) THEN
    CREATE POLICY marketing_shoots_app_all
      ON public.marketing_shoots
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_marketing_shoots_updated_at') THEN
    CREATE TRIGGER trg_marketing_shoots_updated_at
      BEFORE UPDATE ON public.marketing_shoots
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_buzzes TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_model_usage TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_shoots TO fundhub_app;
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
      FOREACH t IN ARRAY ARRAY['marketing_buzzes', 'marketing_model_usage', 'marketing_shoots'] LOOP
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;
