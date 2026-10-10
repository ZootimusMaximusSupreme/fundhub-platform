-- 478 — run receipts for event workflows (zero "not checked", Ship 2, 2026-10-09).
--
-- Board: ops/workflows/zero-unchecked-2026-10-09/ (spec.md section 3, critic.md items 3-8, 12).
-- Written by the "Run evidence" add-on on the shared Inngest client (src/pulse/run-evidence.mjs).
-- Read by the morning pulse (src/pulse/workflow-runs.mjs) and the self-audit (src/pulse/self-audit.mjs).
--
--   workflow_runs   one row per attempt of a run of a workflow that an EVENT started (crons keep
--                   writing job_heartbeats). The first request of a run writes a start row. The
--                   last request of an attempt fills in how it ended. Upsert key: (run_id, attempt).
--                   Platform-wide like job_heartbeats (430): no org column. The row says which
--                   events row woke it (bus_event_id, the events.id the bus sends in data.id), so
--                   "an event came and nothing started" is judged from the events table, with no
--                   write on the web path.
--
-- Row rule: the same permissive policy as job_heartbeats (430) and pulse_beats (475); the grants and
-- the public-key REVOKE (409, 415) are the gate. No DELETE grant and no retention job: deleting old
-- rows is a "delete data" decision (CLAUDE.md section 11) that nobody has made. Size: about two
-- statements per event-started run, a few hundred runs a month.
--
-- The no-deploy switch-off: REVOKE INSERT, UPDATE ON public.workflow_runs FROM fundhub_app;
-- Every receipt write then fails in milliseconds with a permission error, which the add-on swallows
-- (its circuit breaker opens), and every workflow keeps running. Undo: the matching GRANT.
--
-- The one marker row below (function_id '_recorder') says when receipts began. An event that came
-- before that moment cannot be judged by receipts, so the pulse never calls it "never started".
-- Real function ids never start with an underscore.

CREATE TABLE IF NOT EXISTS public.workflow_runs (
  run_id        text        NOT NULL
    CONSTRAINT workflow_runs_run_id_ck CHECK (char_length(run_id) BETWEEN 1 AND 100),
  attempt       integer     NOT NULL DEFAULT 0
    CONSTRAINT workflow_runs_attempt_ck CHECK (attempt >= 0),
  function_id   text        NOT NULL
    CONSTRAINT workflow_runs_function_id_ck CHECK (char_length(function_id) BETWEEN 1 AND 120),
  event_name    text
    CONSTRAINT workflow_runs_event_name_ck CHECK (event_name IS NULL OR char_length(event_name) <= 120),
  -- events.id of the row the bus wrote before it handed the event to Inngest (data.id). NULL when the
  -- event did not come from the bus.
  bus_event_id  text
    CONSTRAINT workflow_runs_bus_event_id_ck CHECK (bus_event_id IS NULL OR char_length(bus_event_id) <= 100),
  max_attempts  integer
    CONSTRAINT workflow_runs_max_attempts_ck CHECK (max_attempts IS NULL OR max_attempts >= 1),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  -- NULL until the attempt ended. 'error' = it threw, or it returned ok: false.
  outcome       text
    CONSTRAINT workflow_runs_outcome_ck CHECK (outcome IS NULL OR outcome IN ('ok', 'error')),
  -- true when the run is over for good: it returned, or it threw its last attempt, or it threw a
  -- NonRetriableError, or a step had already used up its retries. A false error is a retry that is coming.
  "final"       boolean     NOT NULL DEFAULT false,
  -- true when the workflow returned { skipped: true }: it ran and did nothing on purpose.
  skipped       boolean     NOT NULL DEFAULT false,
  -- Why it skipped (redacted, 120 characters).
  note          text
    CONSTRAINT workflow_runs_note_ck CHECK (note IS NULL OR char_length(note) <= 120),
  -- What went wrong (redacted, 120 characters).
  error         text
    CONSTRAINT workflow_runs_error_ck CHECK (error IS NULL OR char_length(error) <= 120),
  CONSTRAINT workflow_runs_pk PRIMARY KEY (run_id, attempt),
  -- An attempt that ended says how.
  CONSTRAINT workflow_runs_finish_ck CHECK (finished_at IS NULL OR outcome IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS workflow_runs_function_started_idx
  ON public.workflow_runs (function_id, started_at DESC);
CREATE INDEX IF NOT EXISTS workflow_runs_bus_event_idx
  ON public.workflow_runs (bus_event_id) WHERE bus_event_id IS NOT NULL;

COMMENT ON TABLE public.workflow_runs IS
  'One row per attempt of an event-started Inngest run. Written by the Run evidence add-on (src/pulse/run-evidence.mjs); read by the morning pulse wf: rows and audit:run-recorder. The row with function_id _recorder marks when receipts began.';
COMMENT ON COLUMN public.workflow_runs.bus_event_id IS 'events.id of the row the bus wrote for the event that started this run (data.id). NULL = the event did not come from the bus.';
COMMENT ON COLUMN public.workflow_runs."final" IS 'true = the run is over for good (it returned, or no retry is coming). A false error means a retry is on its way.';
COMMENT ON COLUMN public.workflow_runs.skipped IS 'true = the workflow returned skipped: true. It ran and did nothing on purpose.';

-- The marker: receipts began now. Idempotent. Never shown as a workflow.
INSERT INTO public.workflow_runs (run_id, attempt, function_id, started_at, finished_at, outcome, "final", note)
VALUES ('receipts-began', 0, '_recorder', now(), now(), 'ok', true,
        'Run receipts were switched on. Events before this time have no receipt.')
ON CONFLICT (run_id, attempt) DO NOTHING;

ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'workflow_runs'
       AND policyname = 'workflow_runs_app_all'
  ) THEN
    CREATE POLICY workflow_runs_app_all ON public.workflow_runs
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 104_app_role.sql's default privileges hand fundhub_app full write on every new table. Take back
-- what this must not allow: rows are updated (an attempt that ended), never deleted.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    REVOKE DELETE, TRUNCATE ON public.workflow_runs FROM fundhub_app;
    GRANT  SELECT, INSERT, UPDATE ON public.workflow_runs TO fundhub_app;
  END IF;
END $$;

-- The public web keys (anon, authenticated) must not touch this table. The policy above says true for
-- every role, so the grants are the only gate. Same block as 409, 415 and 475.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.workflow_runs FROM %I', r);
    END IF;
  END LOOP;
END $$;
