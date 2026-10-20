-- One Commas payment can arrive in several distinct webhook envelopes.
-- The event ID is not the payment ID, so the existing source-event uniqueness
-- does not prevent one provider payment from settling an invoice twice.
-- Production preflight on 2026-10-20 found zero duplicate groups among
-- existing Commas payment receipts with a non-null provider reference.
CREATE UNIQUE INDEX invoice_payments_commas_provider_payment_uniq
  ON invoice_payments (org_id, external_ref)
  WHERE kind = 'payment' AND method = 'commas' AND external_ref IS NOT NULL;
