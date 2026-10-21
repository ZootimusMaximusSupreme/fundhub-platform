-- Cortana payment feed: one row per (payment, Cortana bucket) the server sent.
--
-- Owner ask 2026-10-20: Cortana must weigh the funnel, not count one flat
-- "payment". src/workflows/cortana-payment-feed.mjs reads paid rows in
-- transactions (Commas and Whop both land there) and posts each to the
-- Cortana webhook source for its bucket:
--   soft_pull       the $32 soft-pull assessment
--   first_purchase  a client's first paid purchase that is not the soft pull
--   all_payments    every paid payment (Cortana's LTV column)
-- Cortana's webhook has no event id field, so this table is the only thing
-- that stops a payment being counted twice. The UNIQUE key is the guard.

CREATE TABLE IF NOT EXISTS cortana_feed_sends (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  transaction_id  uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  bucket          text NOT NULL
    CHECK (bucket IN ('soft_pull', 'first_purchase', 'all_payments')),
  -- sending: claimed by a sweep, POST not yet answered.
  -- sent:    Cortana answered 2xx.
  -- failed:  Cortana refused or the call broke; retried by the next sweep.
  -- skipped: never sent on purpose (company or test email, no contact); final.
  status          text NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending', 'sent', 'failed', 'skipped')),
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  last_error      text,
  claimed_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, bucket)
);

CREATE INDEX IF NOT EXISTS cortana_feed_sends_retry_idx
  ON cortana_feed_sends (status, claimed_at)
  WHERE status IN ('sending', 'failed');

ALTER TABLE cortana_feed_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE cortana_feed_sends FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'cortana_feed_sends' AND policyname = 'cortana_feed_sends_app_all') THEN
    CREATE POLICY cortana_feed_sends_app_all ON cortana_feed_sends USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    REVOKE DELETE, TRUNCATE ON cortana_feed_sends FROM fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON cortana_feed_sends TO fundhub_app;
  END IF;
END $$;

-- Server-only worker ledger. Public web roles never read or write it.
REVOKE ALL ON cortana_feed_sends FROM PUBLIC;
DO $$ DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON cortana_feed_sends FROM %I', r);
    END IF;
  END LOOP;
END $$;
