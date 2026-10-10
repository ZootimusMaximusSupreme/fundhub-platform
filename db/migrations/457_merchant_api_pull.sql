-- 457_merchant_api_pull.sql — pull a client's merchant processing by API key.
--
-- Unit H5 of ops/workflows/finance-os-wave4-2026-10-06.md. Owner direction
-- (2026-10-06): "we use API to track merchant processing — for any merchant."
--
-- 442 gave a connection two ways in: the processor PUSHES (a signed webhook, or
-- the open API). This adds the third: Fundhub PULLS, with the client's own
-- processor API key, on a daily clock and on "Sync now".
--
--   mode 'push' → every row that exists today (webhook or open API). Default,
--                 so nothing already stored changes meaning.
--   mode 'pull' → provider commas or whop. The client pasted their processor
--                 API key. It is stored AES-256-GCM encrypted with
--                 MERCHANT_SECRET_ENC_KEY, bound to the row id
--                 (src/merchant/secrets.mjs encryptProcessorApiKey), never
--                 plaintext and never returned by an API. api_key_hint keeps
--                 the last four characters so a screen can say which key.
--
-- ONE MODE PER CONNECTION, ON PURPOSE. Commas webhooks name a payment by its
-- order id (ORD-…); the Commas transactions list names the same payment by a
-- numeric id. Nothing ties the two together, so one row taking both would
-- count every sale twice. A pull connection never holds a webhook secret, and
-- a push connection never holds a processor key.
--
-- Sync bookkeeping, all written by src/merchant/sync.mjs:
--   sync_cursor     the provider's resume point when a pull stopped partway
--                   (page budget). NULL = the last pull finished.
--   synced_through  when the last COMPLETE pull started. The next pull asks
--                   the processor for activity from a little before this.
--   last_synced_at  the last time a pull call succeeded.
--   last_sync_error the last failure in plain words (never a key), or NULL.
--
-- Nothing here moves money, calls a processor, or changes an existing row.

ALTER TABLE merchant_connections
  ADD COLUMN IF NOT EXISTS mode              text NOT NULL DEFAULT 'push',
  ADD COLUMN IF NOT EXISTS encrypted_api_key text,
  ADD COLUMN IF NOT EXISTS sync_cursor       text,
  ADD COLUMN IF NOT EXISTS synced_through    timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at    timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_error   text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merchant_connections_mode_kind') THEN
    ALTER TABLE merchant_connections ADD CONSTRAINT merchant_connections_mode_kind
      CHECK (mode IN ('push', 'pull'));
  END IF;
  -- Only processors with a provider module under src/merchant/providers/ pull.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merchant_connections_pull_provider') THEN
    ALTER TABLE merchant_connections ADD CONSTRAINT merchant_connections_pull_provider
      CHECK (mode <> 'pull' OR provider IN ('commas', 'whop'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merchant_connections_pull_no_secret') THEN
    ALTER TABLE merchant_connections ADD CONSTRAINT merchant_connections_pull_no_secret
      CHECK (mode <> 'pull' OR encrypted_webhook_secret IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merchant_connections_push_no_api_key') THEN
    ALTER TABLE merchant_connections ADD CONSTRAINT merchant_connections_push_no_api_key
      CHECK (mode = 'pull' OR encrypted_api_key IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merchant_connections_sync_error_len') THEN
    ALTER TABLE merchant_connections ADD CONSTRAINT merchant_connections_sync_error_len
      CHECK (last_sync_error IS NULL OR length(last_sync_error) <= 300);
  END IF;

  -- 442's "a webhook connection cannot take events until it can check a
  -- signature" becomes: a push connection needs its secret, a pull connection
  -- needs its key. The open API is unchanged (its key hash is required by
  -- merchant_connections_api_has_key).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merchant_connections_active_needs_credential') THEN
    ALTER TABLE merchant_connections DROP CONSTRAINT IF EXISTS merchant_connections_active_needs_secret;
    ALTER TABLE merchant_connections ADD CONSTRAINT merchant_connections_active_needs_credential
      CHECK (
        provider = 'api'
        OR status <> 'active'
        OR (mode = 'push' AND encrypted_webhook_secret IS NOT NULL)
        OR (mode = 'pull' AND encrypted_api_key IS NOT NULL)
      );
  END IF;
END $$;

-- The daily pull reads only live pull connections.
CREATE INDEX IF NOT EXISTS merchant_connections_pull_idx
  ON merchant_connections (last_synced_at)
  WHERE mode = 'pull' AND status = 'active';

COMMENT ON COLUMN merchant_connections.mode IS
  'push = the processor sends to us (webhook or open API). pull = we read the processor with the client''s own API key.';
COMMENT ON COLUMN merchant_connections.encrypted_api_key IS
  'pull only. The client''s processor API key, AES-256-GCM with MERCHANT_SECRET_ENC_KEY, additional data "<id>:api-key". Never returned by an API.';
