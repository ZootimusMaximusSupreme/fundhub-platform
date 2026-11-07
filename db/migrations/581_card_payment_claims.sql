-- 581_card_payment_claims.sql — "I paid" on a credit card's due row (FinanceOS unit I6).
--
-- OWNER ASK (Chris, 2026-11-07): one-tap "pay this card now" through Plaid.
--
-- WHY THIS IS NOT A TRANSFER. Plaid's own docs, read 2026-11-07:
--   * Auth: "Credit-type accounts, including credit cards, cannot receive
--     payments directly via electronic interbank transfers" and "Auth data
--     cannot be used to set up credit card payments."
--     https://plaid.com/docs/auth/
--   * Transfer: "Supported account types are debitable checking, savings, or
--     cash management accounts." and "Plaid Transfer does not support peer to
--     peer transfers or transfers between two accounts held by the same person."
--     https://plaid.com/docs/transfer/creating-transfers/
--   * Liabilities sends no payee or payment link for a card, only
--     last_payment_date / last_payment_amount / next_payment_due_date.
--     https://plaid.com/docs/api/products/liabilities/
-- So Plaid cannot pay a third-party card issuer. FinanceOS sends the client to
-- the card company's own website ("Pay now") and keeps this row when the client
-- says "I paid". Plaid later CONFIRMS it: src/finance/card-pay-now.mjs looks for
-- the payment in the card's Plaid data (liabilities last_payment_date, or a
-- posted payment on the card's own transactions). Nothing here moves money.
--
-- ONE ROW = one "I paid" for one card's one due date. Saying it again for the
-- same due date updates the same row (the partial unique index below). "Undo"
-- sets withdrawn_at; the row is kept, so a later "I paid" starts a new one.
--
-- NULL MEANS UNKNOWN. amount_cents is what the client typed, or NULL when they
-- did not say. It is never filled in with 0 or with the minimum due.

CREATE TABLE IF NOT EXISTS public.card_payment_claims (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  bank_account_id  uuid NOT NULL,
  -- The due date the row showed when the client tapped "I paid".
  due_on           date NOT NULL,
  -- The day the client says they paid. Never in the future (checked in code,
  -- where "today" is known); never more than a year from the due date here.
  paid_on          date NOT NULL,
  amount_cents     bigint CHECK (amount_cents IS NULL OR (amount_cents > 0 AND amount_cents <= 100000000000)),
  created_by_kind  text NOT NULL CHECK (created_by_kind IN ('client', 'staff')),
  created_by_staff_id uuid,
  withdrawn_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT card_payment_claims_paid_near_due_ck
    CHECK (paid_on BETWEEN due_on - 366 AND due_on + 366),
  CONSTRAINT card_payment_claims_staff_ck
    CHECK (created_by_kind = 'staff' OR created_by_staff_id IS NULL),
  -- The card must be this client's own account (466's composite key).
  CONSTRAINT card_payment_claims_account_fk FOREIGN KEY (bank_account_id, client_id)
    REFERENCES public.bank_accounts (id, client_id) ON DELETE CASCADE
);

-- One live "I paid" per card per due date.
CREATE UNIQUE INDEX IF NOT EXISTS card_payment_claims_one_live_uq
  ON public.card_payment_claims (org_id, client_id, bank_account_id, due_on)
  WHERE withdrawn_at IS NULL;

CREATE INDEX IF NOT EXISTS card_payment_claims_client_idx
  ON public.card_payment_claims (org_id, client_id, paid_on DESC);

-- Row-level security: the same shape as 443 (clarity_payments).
-- ENABLE + FORCE + one permissive policy; isolation lives in the app layer,
-- where every read and write names org_id AND client_id.
ALTER TABLE public.card_payment_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_payment_claims FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'card_payment_claims' AND policyname = 'card_payment_claims_app_all') THEN
    CREATE POLICY card_payment_claims_app_all ON public.card_payment_claims USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.card_payment_claims TO fundhub_app;
  END IF;
END $$;

COMMENT ON TABLE public.card_payment_claims IS
  'A client (or staff for them) said they paid a credit card on its due row. Plaid confirms it later; nothing here moves money (unit I6, 2026-11-07).';
