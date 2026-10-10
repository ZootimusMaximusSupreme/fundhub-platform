-- 431_morning_briefs.sql — one row per morning: the "Good morning, Chris" text
-- and the full report it summarises (MB3, ops/workflows/morning-brief-2026-10-05.md).
--
-- Built by src/ops/morning-brief.mjs as step 2 of the 6:00 a.m. Arizona pulse
-- job (src/workflows/daily-pulse.mjs). Read by GET /api/read/morning-brief.
--
-- Each section is jsonb because each section's shape is owned by its source
-- (MB2's scorecard, the marketing machine's numbers, Finance OS). A section
-- with no source today stores {"status":"waiting", "line": "..."} — never a
-- made-up number.
--
-- The phone number is never stored. sent_to_last4 is enough to tell which
-- phone got it; the full number lives only in PULSE_SMS_TO.
--
-- 430 is reserved for MB2 (scorecard / job heartbeats); 406–429 are reserved
-- for the marketing machine.

CREATE TABLE IF NOT EXISTS morning_briefs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  brief_date          date NOT NULL,                  -- America/Phoenix
  systems             jsonb NOT NULL DEFAULT '{}'::jsonb,
  marketing           jsonb NOT NULL DEFAULT '{}'::jsonb,
  money               jsonb NOT NULL DEFAULT '{}'::jsonb,
  team                jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggestions         jsonb NOT NULL DEFAULT '[]'::jsonb,
  today               jsonb NOT NULL DEFAULT '{}'::jsonb,
  text_body           text NOT NULL,
  report_url          text,
  sent_to_last4       text,
  dry_run             boolean NOT NULL DEFAULT true,
  delivery_status     text NOT NULL DEFAULT 'dry_run',
  delivery_error      text,
  provider_message_id text,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT morning_briefs_one_per_day UNIQUE (org_id, brief_date),
  CONSTRAINT morning_briefs_delivery_status_ck
    CHECK (delivery_status IN ('dry_run', 'sent', 'failed', 'no_number')),
  CONSTRAINT morning_briefs_last4_ck
    CHECK (sent_to_last4 IS NULL OR sent_to_last4 ~ '^[0-9]{4}$'),
  CONSTRAINT morning_briefs_sent_at_ck
    CHECK ((delivery_status = 'sent') = (sent_at IS NOT NULL)),
  CONSTRAINT morning_briefs_text_starts_ck
    CHECK (text_body LIKE 'Good morning, Chris.%')
);

COMMENT ON TABLE morning_briefs IS
  'One row per morning (America/Phoenix): the Good morning, Chris text and its full report. Written by src/ops/morning-brief.mjs. Audit only.';

ALTER TABLE public.morning_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.morning_briefs FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'morning_briefs'
       AND policyname = 'morning_briefs_app_all'
  ) THEN
    CREATE POLICY morning_briefs_app_all ON public.morning_briefs
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.morning_briefs TO fundhub_app;
  END IF;
END $$;
