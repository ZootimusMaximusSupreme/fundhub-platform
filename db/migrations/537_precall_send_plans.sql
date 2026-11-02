-- One durable row for each planned pre-call lesson. No customer content is
-- stored here; template approval is checked again when the row becomes due.
CREATE TABLE IF NOT EXISTS precall_send_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  source_event_id text NOT NULL,
  booking_event_id text,
  booking_uid text,
  phase text NOT NULL CHECK (phase IN ('prebooking', 'booked')),
  slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 16),
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'push')),
  deck_slug text NOT NULL,
  due_at timestamptz NOT NULL,
  call_start_at timestamptz,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'claimed', 'queued', 'skipped', 'blocked', 'cancelled')),
  claimed_at timestamptz,
  retry_after timestamptz,
  queued_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, client_id, source_event_id, slot)
);

CREATE INDEX IF NOT EXISTS precall_send_plans_due_idx
  ON precall_send_plans (due_at, id) WHERE status IN ('planned', 'claimed', 'blocked');
CREATE INDEX IF NOT EXISTS precall_send_plans_client_idx
  ON precall_send_plans (org_id, client_id, status);

ALTER TABLE precall_send_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE precall_send_plans FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'precall_send_plans' AND policyname = 'precall_send_plans_app_all') THEN
    CREATE POLICY precall_send_plans_app_all ON precall_send_plans USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    REVOKE DELETE, TRUNCATE ON precall_send_plans FROM fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON precall_send_plans TO fundhub_app;
  END IF;
END $$;

-- Push has no provider-side idempotency key. Claim once before outbound and
-- leave an uncertain attempt visible instead of risking a duplicate alert.
CREATE TABLE IF NOT EXISTS precall_push_receipts (
  plan_id uuid PRIMARY KEY REFERENCES precall_send_plans(id),
  org_id uuid NOT NULL REFERENCES orgs(id),
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error text
);
ALTER TABLE precall_push_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE precall_push_receipts FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'precall_push_receipts' AND policyname = 'precall_push_receipts_app_all') THEN
    CREATE POLICY precall_push_receipts_app_all ON precall_push_receipts USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    REVOKE DELETE, TRUNCATE ON precall_push_receipts FROM fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON precall_push_receipts TO fundhub_app;
  END IF;
END $$;
REVOKE ALL ON precall_push_receipts FROM PUBLIC;
DO $$ DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON precall_push_receipts FROM %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON precall_send_plans FROM PUBLIC;
DO $$ DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON precall_send_plans FROM %I', r);
    END IF;
  END LOOP;
END $$;
