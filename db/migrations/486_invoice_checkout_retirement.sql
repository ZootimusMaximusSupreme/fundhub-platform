-- A GET-confirmed Commas checkout can return 404 after a successful DELETE
-- whose local completion was interrupted. Keep proof of that GET for safe retry.
ALTER TABLE payment_links
  ADD COLUMN provider_retire_verified_at timestamptz,
  ADD COLUMN provider_retire_last_error text;

-- The recovery clock only scans expired Commas invoice links, oldest first.
CREATE INDEX payment_links_commas_invoice_retire_due
  ON payment_links (updated_at, id)
  WHERE provider = 'commas' AND status = 'expired' AND invoice_id IS NOT NULL;

-- Retried invoice.sent events cannot leave two payable Fundhub links for one
-- invoice. The invoice-row lock serializes concurrent mints before the provider
-- POST; a transport-unknown provider response can still leave an orphan hosted
-- session because the provider may have accepted a request without returning its ID.
CREATE UNIQUE INDEX payment_links_one_open_commas_invoice
  ON payment_links (invoice_id)
  WHERE provider = 'commas' AND invoice_id IS NOT NULL
    AND status IN ('created', 'sent');
