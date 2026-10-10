-- 475_pulse_beats_incidents.sql — the hourly pulse keeps its own record.
--
-- Contract: ops/workflows/pulse-layer-2026-10-09-contract.md section 4.1, cut by
-- ops/workflows/pulse-layer-2026-10-09-v1.md. Runner: netlify/functions/pulse-hourly.mjs.
-- Reads and writes go through src/pulse/records.mjs and nothing else.
--
--   pulse_beats       one row per beat per hourly run: ok or not, where it stopped, how long. Insert-only.
--                     Written by the runner with a plain single statement. A beat never holds a write handle.
--   pulse_incidents   one row per break. At most one OPEN row per beat (partial unique index). Counts texts,
--                     holds the GitHub issue and Claude session columns (they stay NULL while v1 sends text
--                     only), and, once closed, records the cause and the guard that now prevents it.
--   pulse_bank_links  one row per distinct bank Apply URL (sha-256 of the URL, never the URL itself):
--                     the last result, so only a URL that WAS good and is now dead goes red.
--
-- Row rule: permissive policy like job_heartbeats (430); the grants and the public-key REVOKE (409, 415)
-- are the gate. No DELETE grant and no retention job: deleting old rows is a "delete data" decision
-- (CLAUDE.md section 11) that nobody has made. Size without deletes: about 10 beats x 24 = 240 rows a
-- day for pulse_beats.

CREATE TABLE IF NOT EXISTS public.pulse_beats (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  run_id       uuid        NOT NULL,
  beat_id      text        NOT NULL
    CONSTRAINT pulse_beats_beat_id_ck CHECK (beat_id ~ '^[a-z0-9][a-z0-9-]{0,43}$'),
  ran_at       timestamptz NOT NULL DEFAULT now(),
  ok           boolean     NOT NULL,
  step         text
    CONSTRAINT pulse_beats_step_ck CHECK (step IS NULL OR char_length(step) BETWEEN 1 AND 120),
  detail       text
    CONSTRAINT pulse_beats_detail_ck CHECK (detail IS NULL OR char_length(detail) <= 2000),
  -- NULL = not measured (a beat cut by the time budget). Never defaulted to 0.
  duration_ms  integer
    CONSTRAINT pulse_beats_duration_ck CHECK (duration_ms IS NULL OR duration_ms >= 0),
  -- [{"name":"inbox-write","ms":91,"ok":true}, ...] so a slow step shows before it fails.
  steps        jsonb
    CONSTRAINT pulse_beats_steps_ck CHECK (steps IS NULL OR (jsonb_typeof(steps) = 'array' AND pg_column_size(steps) <= 8000)),
  -- A red beat always says where and why.
  CONSTRAINT pulse_beats_red_says_where_ck CHECK (ok OR (step IS NOT NULL AND detail IS NOT NULL)),
  -- A retried invocation of the same run cannot double-insert a beat.
  CONSTRAINT pulse_beats_one_per_run UNIQUE (run_id, beat_id)
);
CREATE INDEX IF NOT EXISTS pulse_beats_beat_ran_idx ON public.pulse_beats (org_id, beat_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS pulse_beats_ran_at_idx   ON public.pulse_beats (ran_at);

CREATE TABLE IF NOT EXISTS public.pulse_incidents (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid        NOT NULL REFERENCES orgs(id),
  beat_id              text        NOT NULL
    CONSTRAINT pulse_incidents_beat_id_ck CHECK (beat_id ~ '^[a-z0-9][a-z0-9-]{0,43}$'),
  opened_at            timestamptz NOT NULL DEFAULT now(),
  opened_run_id        uuid        NOT NULL,
  first_step           text        NOT NULL
    CONSTRAINT pulse_incidents_first_step_ck CHECK (char_length(first_step) BETWEEN 1 AND 120),
  first_detail         text        NOT NULL
    CONSTRAINT pulse_incidents_first_detail_ck CHECK (char_length(first_detail) BETWEEN 1 AND 2000),
  -- NULL until a text about this break actually went out.
  last_alert_at        timestamptz,
  alerts_sent          integer     NOT NULL DEFAULT 0
    CONSTRAINT pulse_incidents_alerts_ck CHECK (alerts_sent >= 0),
  closed_at            timestamptz,
  github_issue_number  integer
    CONSTRAINT pulse_incidents_issue_number_ck CHECK (github_issue_number IS NULL OR github_issue_number > 0),
  github_issue_url     text
    CONSTRAINT pulse_incidents_issue_url_ck CHECK (github_issue_url IS NULL OR
      github_issue_url ~ '^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/issues/[0-9]+$'),
  -- Where the Claude fixer stands. Filled from the GitHub issue comments, never from an Anthropic call.
  fixer_status         text        NOT NULL DEFAULT 'not_set_up'
    CONSTRAINT pulse_incidents_fixer_status_ck CHECK (fixer_status IN
      ('not_set_up', 'no_issue', 'dispatched', 'session_started', 'capped', 'fire_failed')),
  claude_session_url   text
    CONSTRAINT pulse_incidents_session_url_ck CHECK (claude_session_url IS NULL OR
      (char_length(claude_session_url) <= 500 AND claude_session_url ~ '^https://claude\.ai/[^[:space:]]+$')),

  -- LEARNING. Filled when the incident closes, from the fixer's pulse-lesson block or by Chris.
  cause_category       text
    CONSTRAINT pulse_incidents_cause_category_ck CHECK (cause_category IS NULL OR cause_category IN (
      'code_bug', 'missing_route', 'config_or_env', 'migration_not_applied', 'schema_or_data',
      'deploy_or_bundle', 'vendor_down', 'vendor_changed', 'bank_site_changed',
      'timeout_or_capacity', 'pulse_false_alarm', 'unknown')),
  cause_note           text
    CONSTRAINT pulse_incidents_cause_note_ck CHECK (cause_note IS NULL OR char_length(cause_note) <= 2000),
  fix_summary          text
    CONSTRAINT pulse_incidents_fix_summary_ck CHECK (fix_summary IS NULL OR char_length(fix_summary) <= 2000),
  -- The test, check, beat or rule that now prevents it. 'none: <reason>' is allowed, empty is not.
  guard_added          text
    CONSTRAINT pulse_incidents_guard_added_ck CHECK (guard_added IS NULL OR char_length(guard_added) <= 2000),
  closed_by            text
    CONSTRAINT pulse_incidents_closed_by_ck CHECK (closed_by IS NULL OR closed_by IN ('auto', 'claude', 'chris')),

  CONSTRAINT pulse_incidents_closed_pair_ck       CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
  CONSTRAINT pulse_incidents_closed_after_open_ck CHECK (closed_at IS NULL OR closed_at >= opened_at),
  CONSTRAINT pulse_incidents_issue_pair_ck        CHECK ((github_issue_number IS NULL) = (github_issue_url IS NULL)),
  CONSTRAINT pulse_incidents_alert_pair_ck        CHECK ((alerts_sent = 0) = (last_alert_at IS NULL)),
  -- 'auto' = the beat went green and the runner closed it; it cannot know the cause yet.
  -- Closed by Claude or Chris, the four learning fields are required.
  CONSTRAINT pulse_incidents_learned_ck CHECK (
    closed_by IS NULL OR closed_by = 'auto'
    OR (cause_category IS NOT NULL
        AND btrim(coalesce(cause_note, ''))  <> ''
        AND btrim(coalesce(fix_summary, '')) <> ''
        AND btrim(coalesce(guard_added, '')) <> '')
  )
);
-- At most one open incident per beat. A second run that finds the beat still broken updates this row.
CREATE UNIQUE INDEX IF NOT EXISTS pulse_incidents_one_open
  ON public.pulse_incidents (org_id, beat_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS pulse_incidents_beat_idx
  ON public.pulse_incidents (org_id, beat_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS public.pulse_bank_links (
  org_id           uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  url_hash         text        NOT NULL
    CONSTRAINT pulse_bank_links_hash_ck CHECK (url_hash ~ '^[0-9a-f]{64}$'),
  host             text        NOT NULL
    CONSTRAINT pulse_bank_links_host_ck CHECK (char_length(host) BETWEEN 1 AND 255),
  lender_ids       uuid[]      NOT NULL DEFAULT '{}',
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_checked_at  timestamptz,
  last_class       text
    CONSTRAINT pulse_bank_links_class_ck CHECK (last_class IS NULL OR last_class IN ('OK', 'WALL', 'HARD', 'SLOW', 'BAD_URL')),
  last_status      integer
    CONSTRAINT pulse_bank_links_status_ck CHECK (last_status IS NULL OR last_status BETWEEN 0 AND 999),
  last_detail      text
    CONSTRAINT pulse_bank_links_detail_ck CHECK (last_detail IS NULL OR char_length(last_detail) <= 300),
  last_good_at     timestamptz,
  fail_streak      integer     NOT NULL DEFAULT 0
    CONSTRAINT pulse_bank_links_streak_ck CHECK (fail_streak >= 0),
  final_host       text
    CONSTRAINT pulse_bank_links_final_host_ck CHECK (final_host IS NULL OR char_length(final_host) <= 255),
  PRIMARY KEY (org_id, url_hash)
);
CREATE INDEX IF NOT EXISTS pulse_bank_links_due_idx ON public.pulse_bank_links (org_id, last_checked_at NULLS FIRST);

COMMENT ON TABLE public.pulse_beats IS
  'One row per beat per hourly pulse run (netlify/functions/pulse-hourly.mjs): did the signal come back, where it stopped, how long. Insert-only.';
COMMENT ON TABLE public.pulse_incidents IS
  'One row per break the hourly pulse found; at most one open per beat. Counts alerts, links the GitHub issue and Claude session, and records cause and guard when closed.';
COMMENT ON TABLE public.pulse_bank_links IS
  'Last pulse result per distinct bank Apply URL (sha-256, never the URL). Written by the apply-links beat through the runner. A URL goes red only after it was OK before.';
COMMENT ON COLUMN public.pulse_beats.duration_ms IS 'Milliseconds the beat took. NULL = not measured (never 0).';
COMMENT ON COLUMN public.pulse_beats.steps IS 'JSON array of {name, ms, ok} for each step the beat ran, so a slow step shows before it fails.';
COMMENT ON COLUMN public.pulse_incidents.opened_run_id IS 'The pulse run that found the break first.';
COMMENT ON COLUMN public.pulse_incidents.last_alert_at IS 'When the last text about this break went out. NULL = none yet.';
COMMENT ON COLUMN public.pulse_incidents.github_issue_number IS 'NULL while v1 sends text only (no GitHub issue). Number and URL are set together or not at all.';
COMMENT ON COLUMN public.pulse_incidents.fixer_status IS 'Where the Claude fixer stands. not_set_up = no fixer exists yet (the v1 value).';
COMMENT ON COLUMN public.pulse_incidents.cause_category IS 'Closed list so lessons can be counted. Required when closed_by is claude or chris.';
COMMENT ON COLUMN public.pulse_incidents.guard_added IS 'The test, check, beat or rule that now prevents this break. "none: <reason>" is allowed; empty is not.';
COMMENT ON COLUMN public.pulse_incidents.closed_by IS 'auto = the beat went green on its own; claude = the pulse fixer; chris = Chris. Auto-closed rows with no cause are the lessons backlog.';
COMMENT ON COLUMN public.pulse_bank_links.url_hash IS 'sha-256 (hex) of the Apply URL. The URL itself is never stored: it can carry partner campaign codes.';
COMMENT ON COLUMN public.pulse_bank_links.last_good_at IS 'When this URL last answered OK. NULL = never seen good, so it cannot go red.';
COMMENT ON COLUMN public.pulse_bank_links.fail_streak IS 'Checks in a row that were not OK. Reset to 0 by an OK check.';

ALTER TABLE public.pulse_beats      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_beats      FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.pulse_incidents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_incidents  FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.pulse_bank_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_bank_links FORCE  ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pulse_beats', 'pulse_incidents', 'pulse_bank_links'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_app_all') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I USING (true) WITH CHECK (true)', t || '_app_all', t);
    END IF;
  END LOOP;
END $$;

-- 104_app_role.sql's default privileges hand fundhub_app full write on every new table. Take back what
-- these must not allow. pulse_beats: written once. The other two: updated, never deleted.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON public.pulse_beats FROM fundhub_app;
    GRANT  SELECT, INSERT          ON public.pulse_beats TO fundhub_app;
    REVOKE DELETE, TRUNCATE        ON public.pulse_incidents FROM fundhub_app;
    GRANT  SELECT, INSERT, UPDATE  ON public.pulse_incidents TO fundhub_app;
    REVOKE DELETE, TRUNCATE        ON public.pulse_bank_links FROM fundhub_app;
    GRANT  SELECT, INSERT, UPDATE  ON public.pulse_bank_links TO fundhub_app;
    -- Cleanup of old beats is NOT granted. If Chris says yes, a NEW migration adds the delete grant on pulse_beats.
  END IF;
END $$;

-- The public web keys (anon, authenticated) must not touch these tables. The policy above says true
-- for every role, so the grants are the only gate. Same block as 409 and 415.
DO $$
DECLARE r text; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pulse_beats', 'pulse_incidents', 'pulse_bank_links'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;
