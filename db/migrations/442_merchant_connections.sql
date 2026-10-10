-- 442_merchant_connections.sql — a client's OWN merchant processor, wired into
-- their Finance OS.
--
-- Unit P3 of ops/workflows/finance-os-pages-2026-10-06.md. Owner direction
-- (docs/finance/finance-os-direction-2026-10-06.md): "Merchant integrations:
-- Commas, Whop, and an open API so any other merchant processor can send sales
-- and payouts in."
--
-- THIS IS NOT FUNDHUB'S OWN BILLING. Fundhub's own Commas checkout keeps its own
-- path (src/adapters/commas.mjs → commas_inbox). These two tables hold a
-- CLIENT'S sales, refunds, fees and payouts from the client's own merchant
-- account, so their Finance OS can show revenue month over month, per business
-- container. Nothing here moves money. Finance OS tracks; it never pays.
--
-- TWO TABLES, NOTHING ELSE.
--
--   merchant_connections — one row per (client, container, processor) hook-up.
--     provider 'api'    → the client's own system posts to POST /api/merchant/events
--                         with a Bearer key. Only sha256(key) is stored; the key
--                         is shown ONCE at create time.
--     provider 'whop'   → Whop posts to /api/webhooks/merchant-whop/<id>, signed
--     provider 'commas' → Commas posts to /api/webhooks/merchant-commas/<id>, signed
--                         with the signing secret the processor gave the client.
--                         That secret is stored AES-256-GCM encrypted, bound to
--                         the row id (src/merchant/secrets.mjs), never plaintext.
--     status 'waiting'  → a webhook connection with no signing secret yet
--            'active'   → takes events
--            'disabled' → refuses events; the row and its history stay.
--
--   merchant_events — one row per money fact from that processor.
--     kind sale | refund | payout | fee. amount_cents is SIGNED and in the
--     currency's minor units: a sale is >= 0, a refund or fee is <= 0, a payout
--     is usually negative (money left the processor for the bank) and positive
--     only when a payout was reversed back to the balance.
--     UNIQUE (connection_id, provider_event_id) is the idempotency anchor: a
--     redelivered webhook or a retried API call is a no-op, never a second sale.
--
-- Nothing here reads a processor, schedules anything or changes an existing row.

CREATE TABLE IF NOT EXISTS merchant_connections (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES orgs(id),
  client_id                uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  entity_id                uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  provider                 text NOT NULL CHECK (provider IN ('commas', 'whop', 'api')),
  status                   text NOT NULL DEFAULT 'waiting'
                             CHECK (status IN ('waiting', 'active', 'disabled')),
  api_key_hash             text,
  api_key_hint             text,
  encrypted_webhook_secret text,
  created_by_kind          text CHECK (created_by_kind IN ('client', 'staff')),
  created_by               uuid,
  last_event_at            timestamptz,
  disabled_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- An open-API connection always has a key hash and never a webhook secret.
  -- A webhook connection never has a key hash.
  CONSTRAINT merchant_connections_api_has_key
    CHECK ((provider = 'api') = (api_key_hash IS NOT NULL)),
  CONSTRAINT merchant_connections_api_no_secret
    CHECK (provider <> 'api' OR encrypted_webhook_secret IS NULL),
  -- A webhook connection cannot take events until it can check a signature.
  CONSTRAINT merchant_connections_active_needs_secret
    CHECK (provider = 'api' OR status <> 'active' OR encrypted_webhook_secret IS NOT NULL),
  CONSTRAINT merchant_connections_disabled_stamp
    CHECK ((status = 'disabled') = (disabled_at IS NOT NULL)),
  CONSTRAINT merchant_connections_key_hash_shape
    CHECK (api_key_hash IS NULL OR api_key_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_connections_key_hash_uq
  ON merchant_connections (api_key_hash) WHERE api_key_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS merchant_connections_client_idx
  ON merchant_connections (org_id, client_id);

-- THE CONTAINER MUST BE THIS CLIENT'S. A foreign key proves the entity exists;
-- it cannot prove the entity belongs to the same client and org. Without this a
-- bad write could pour one client's sales into another client's business.
CREATE OR REPLACE FUNCTION merchant_connections_entity_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM entities e
     WHERE e.id = NEW.entity_id
       AND e.client_id = NEW.client_id
       AND e.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'merchant_connections: entity % does not belong to client %', NEW.entity_id, NEW.client_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
     WHERE event_object_table = 'merchant_connections'
       AND trigger_name = 'merchant_connections_entity_guard'
  ) THEN
    CREATE TRIGGER merchant_connections_entity_guard
      BEFORE INSERT OR UPDATE OF entity_id, client_id, org_id ON merchant_connections
      FOR EACH ROW EXECUTE FUNCTION merchant_connections_entity_guard();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
     WHERE event_object_table = 'merchant_connections'
       AND trigger_name = 'merchant_connections_set_updated_at'
  ) THEN
    CREATE TRIGGER merchant_connections_set_updated_at
      BEFORE UPDATE ON merchant_connections
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS merchant_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     uuid NOT NULL REFERENCES merchant_connections(id) ON DELETE CASCADE,
  provider_event_id text NOT NULL CHECK (length(provider_event_id) BETWEEN 1 AND 200),
  kind              text NOT NULL CHECK (kind IN ('sale', 'refund', 'payout', 'fee')),
  amount_cents      bigint NOT NULL,
  currency          text NOT NULL DEFAULT 'usd' CHECK (currency ~ '^[a-z]{3}$'),
  occurred_at       timestamptz NOT NULL,
  description       text CHECK (description IS NULL OR length(description) <= 500),
  raw               jsonb,
  received_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT merchant_events_once UNIQUE (connection_id, provider_event_id),
  CONSTRAINT merchant_events_sale_sign   CHECK (kind <> 'sale' OR amount_cents >= 0),
  CONSTRAINT merchant_events_refund_sign CHECK (kind NOT IN ('refund', 'fee') OR amount_cents <= 0)
);

CREATE INDEX IF NOT EXISTS merchant_events_connection_time_idx
  ON merchant_events (connection_id, occurred_at);

-- ── row security, grants (same shape as 425) ─────────────────────────────────

ALTER TABLE public.merchant_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_events FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'merchant_connections'
       AND policyname = 'merchant_connections_app_all'
  ) THEN
    CREATE POLICY merchant_connections_app_all ON public.merchant_connections
      USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'merchant_events'
       AND policyname = 'merchant_events_app_all'
  ) THEN
    CREATE POLICY merchant_events_app_all ON public.merchant_events
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.merchant_connections TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.merchant_events TO fundhub_app;
  END IF;
END $$;

COMMENT ON TABLE merchant_connections IS
  'A client''s OWN merchant processor hook-up (Commas, Whop, or open API), per business container. Not Fundhub billing. api_key_hash = sha256 of a key shown once; encrypted_webhook_secret = AES-256-GCM bound to the row id. Neither is ever returned by an API.';
COMMENT ON TABLE merchant_events IS
  'Money facts from a client''s merchant processor. Signed minor units: sale >= 0, refund/fee <= 0, payout usually < 0. UNIQUE (connection_id, provider_event_id) makes redelivery a no-op.';
