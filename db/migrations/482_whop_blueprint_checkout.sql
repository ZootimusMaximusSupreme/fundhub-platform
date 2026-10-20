-- Fundhub's own Blueprint billing rail; client merchant connections stay separate.
ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS whop_checkout_configuration_id text,
  ADD COLUMN IF NOT EXISTS whop_plan_id text,
  ADD COLUMN IF NOT EXISTS whop_payment_id text;

CREATE UNIQUE INDEX IF NOT EXISTS payment_links_whop_checkout_uniq
  ON payment_links (provider, whop_checkout_configuration_id)
  WHERE whop_checkout_configuration_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_links_whop_payment_uniq
  ON payment_links (provider, whop_payment_id)
  WHERE whop_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_links_whop_plan_idx
  ON payment_links (whop_plan_id) WHERE provider = 'whop';

CREATE TABLE IF NOT EXISTS whop_billing_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  account_id text NOT NULL,
  webhook_id text NOT NULL,
  event_type text NOT NULL,
  payment_id text,
  raw_body text NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'webhook' CHECK (source IN ('webhook', 'reconcile')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed', 'ignored')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  processed_at timestamptz,
  retry_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, webhook_id)
);
CREATE INDEX IF NOT EXISTS whop_billing_inbox_work_idx
  ON whop_billing_inbox (retry_at, received_at)
  WHERE status IN ('pending', 'failed', 'processing');
CREATE INDEX IF NOT EXISTS whop_billing_inbox_org_payment_idx
  ON whop_billing_inbox (org_id, payment_id);
ALTER TABLE whop_billing_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE whop_billing_inbox FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'whop_billing_inbox' AND policyname = 'whop_billing_inbox_app_all') THEN
    CREATE POLICY whop_billing_inbox_app_all ON whop_billing_inbox USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    REVOKE DELETE, TRUNCATE ON whop_billing_inbox FROM fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON whop_billing_inbox TO fundhub_app;
  END IF;
END $$;

-- This is a server-only cross-company worker queue, not a public Data API.
-- The app role uses the signed adapter and staff-scoped readers; public web
-- roles must not read raw receipts or enqueue their own payment events.
REVOKE ALL ON whop_billing_inbox FROM PUBLIC;
DO $$ DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON whop_billing_inbox FROM %I', r);
    END IF;
  END LOOP;
END $$;
