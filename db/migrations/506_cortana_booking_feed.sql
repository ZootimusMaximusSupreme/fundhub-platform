-- One delivery receipt per confirmed ClickFunnels booking sent to Cortana.
CREATE TABLE IF NOT EXISTS cortana_booking_sends (
  booking_id uuid PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(id),
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cortana_booking_sends_retry_idx
  ON cortana_booking_sends (status, claimed_at)
  WHERE status IN ('sending', 'failed');

ALTER TABLE cortana_booking_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE cortana_booking_sends FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'cortana_booking_sends' AND policyname = 'cortana_booking_sends_app_all') THEN
    CREATE POLICY cortana_booking_sends_app_all ON cortana_booking_sends USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    REVOKE DELETE, TRUNCATE ON cortana_booking_sends FROM fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON cortana_booking_sends TO fundhub_app;
  END IF;
END $$;
REVOKE ALL ON cortana_booking_sends FROM PUBLIC;
DO $$ DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON cortana_booking_sends FROM %I', r);
    END IF;
  END LOOP;
END $$;
