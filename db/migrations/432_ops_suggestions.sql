-- 432_ops_suggestions.sql — the AI ops suggestions in the morning brief.
--
-- Chris, 2026-10-05: "hey, this thing is breaking" or "we need to fix this."
-- He does not have to take them. Nothing changes by itself.
--
-- The rules that pick a suggestion are the change-cadence law
-- (.claude/rules/change-cadence.md, owner-set 2026-10-05, starting defaults).
-- The builder is src/ops/suggestions.mjs (buildSuggestions). The read is
-- GET /api/read/ops-suggestions?date=.
--
-- One row per suggestion per morning:
--   * rule        — which cadence rule it comes from
--   * subject_key — what it is about ('failed_events', 'ad:<uuid>', 'daily_spend'),
--                   so the same thing on the next morning can be matched to a
--                   suggestion Chris already passed on
--   * numbers     — the plain database reads behind it. Always there, with or
--                   without a model
--   * headline    — one sentence built from the numbers only, no model
--   * write_up    — the model's short write-up, grounded in the numbers only.
--                   NULL when the model was down or not set up
--   * dollar_impact_cents — integer cents. NULL means unknown, never 0
--
-- Status moves open -> taken or open -> passed, and only a person moves it.
-- A passed suggestion carries quiet_until (7 days on by default); the builder
-- keeps it quiet until then unless its numbers get worse.
--
-- Nothing deletes a suggestion. "What did the agent tell Chris on the 5th" is a
-- question that gets asked later.

CREATE TABLE IF NOT EXISTS public.ops_suggestions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES orgs(id),
  brief_date           date NOT NULL,

  rule                 text NOT NULL,
  subject_key          text NOT NULL,
  headline             text NOT NULL,
  numbers              jsonb NOT NULL DEFAULT '{}'::jsonb,
  dollar_impact_cents  bigint,

  write_up             text,
  model_used           boolean NOT NULL DEFAULT false,

  status               text NOT NULL DEFAULT 'open',
  quiet_until          date,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ops_suggestions_rule_ck
    CHECK (rule IN ('fix_broken_same_day', 'new_ad_verdict', 'raise_spend_ramp',
                    'budget_moves_small', 'page_change_weekly', 'offer_holds_20_sales')),
  CONSTRAINT ops_suggestions_status_ck
    CHECK (status IN ('open', 'taken', 'passed')),
  -- A passed suggestion must say how long it stays quiet; nothing else may.
  CONSTRAINT ops_suggestions_quiet_ck
    CHECK ((status = 'passed') = (quiet_until IS NOT NULL)),
  CONSTRAINT ops_suggestions_dollar_ck
    CHECK (dollar_impact_cents IS NULL OR dollar_impact_cents >= 0),
  CONSTRAINT ops_suggestions_subject_ck
    CHECK (char_length(btrim(subject_key)) >= 1),
  CONSTRAINT ops_suggestions_headline_ck
    CHECK (char_length(btrim(headline)) >= 1 AND char_length(headline) <= 1000),
  CONSTRAINT ops_suggestions_numbers_ck
    CHECK (jsonb_typeof(numbers) = 'object')
);

-- Re-running the same morning updates the row instead of adding a second one.
CREATE UNIQUE INDEX IF NOT EXISTS ops_suggestions_day_uniq
  ON public.ops_suggestions (org_id, brief_date, rule, subject_key);

-- The quiet check: the last time this rule said this thing.
CREATE INDEX IF NOT EXISTS ops_suggestions_subject_idx
  ON public.ops_suggestions (org_id, rule, subject_key, brief_date DESC);

COMMENT ON TABLE public.ops_suggestions IS
  'AI ops suggestions for the morning brief: at most 3 a morning, biggest dollar impact first, each naming its cadence rule and the numbers behind it. Nothing changes by itself. Built by src/ops/suggestions.mjs (432).';
COMMENT ON COLUMN public.ops_suggestions.dollar_impact_cents IS
  'Integer cents of money in play. NULL = unknown, never 0 (CLAUDE.md §12).';
COMMENT ON COLUMN public.ops_suggestions.quiet_until IS
  'Set only when Chris passes. The builder keeps this rule + subject quiet until this date unless the numbers get worse.';

ALTER TABLE public.ops_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_suggestions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'ops_suggestions'
       AND policyname = 'ops_suggestions_app_all'
  ) THEN
    CREATE POLICY ops_suggestions_app_all ON public.ops_suggestions
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ops_suggestions_updated_at') THEN
    CREATE TRIGGER trg_ops_suggestions_updated_at
      BEFORE UPDATE ON public.ops_suggestions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Read, write, update. No delete: 104's default privileges hand DELETE to every
-- new table, so the REVOKE is what makes "nothing deletes a suggestion" true
-- (same shape as 374).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    REVOKE DELETE, TRUNCATE ON public.ops_suggestions FROM fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON public.ops_suggestions TO fundhub_app;
  END IF;
END $$;
