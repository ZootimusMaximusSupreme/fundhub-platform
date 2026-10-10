-- 431_plaid_transactions_cursor.sql — where a Plaid bank login left off reading
-- charges and deposits.
--
-- Unit A of ops/workflows/finance-os-build-2026-10-06.md. The reader is
-- src/banking/plaid-transactions.mjs, which calls Plaid's /transactions/sync and
-- writes bank_transactions (085).
--
-- ONE COLUMN, NULLABLE, NO DEFAULT.
--
--   plaid_items.transactions_cursor
--     Plaid's opaque next_cursor from the last sync that saved its rows. NULL
--     means "never synced" — the next sync starts from the beginning of the
--     history Plaid holds, which is correct and safe because every row upserts
--     on (bank_account_id, provider_transaction_id) and a re-read is an UPDATE,
--     not a second row.
--
--     It is written in the SAME database transaction as the rows it covers. A
--     cursor saved without its rows would skip those charges for ever; rows saved
--     without the cursor are only re-read next time.
--
--     It is not a credential. Plaid's cursor names a position in a feed and is
--     useless without the access token, which stays encrypted in
--     encrypted_access_token. Still never returned by an API response.
--
--   plaid_items.transactions_synced_at
--     When that cursor was saved. NULL = never synced. A screen can say "bank
--     last read 3 days ago" instead of implying the numbers are live.
--
-- Nothing here reads a bank, schedules anything or changes an existing row.

ALTER TABLE plaid_items
  ADD COLUMN IF NOT EXISTS transactions_cursor text;

ALTER TABLE plaid_items
  ADD COLUMN IF NOT EXISTS transactions_synced_at timestamptz;

COMMENT ON COLUMN plaid_items.transactions_cursor IS
  'Plaid /transactions/sync next_cursor from the last sync whose rows were saved. NULL = never synced (next sync reads full history; upserts make that safe). Saved in the same transaction as the rows. Not a credential, never returned by an API.';

COMMENT ON COLUMN plaid_items.transactions_synced_at IS
  'When transactions_cursor was last saved. NULL = never synced.';
