-- 576_finance_applications.sql — Finance OS application and approval tracker.
--
-- Finance OS wave 3, unit O (ops/workflows/finance-os-wave3-brief.txt). Owner,
-- 2026-11-07: "track every account the client applies for and whether it is
-- approved; an approved account is added to the dashboard (it joins accounts,
-- trends, card use and alerts)."
--
-- WHAT ALREADY EXISTS, AND STAYS THE ONLY STORE FOR IT.
--   applications (schema 001, 138, 272, 381, 382) holds every application
--   Fundhub sends or tracks inside a funding round. Its status and approved
--   amount are what the BANK said, and they feed the success fee
--   (docs/finance/CLOSEOUT-FEE-BASIS.md). A client never writes that table:
--   "Approval, denial and dollars belong to the canonical evidence/decision
--   path" (src/blueprint/client-funding.mjs). This file does not touch it.
--
-- WHAT IS MISSING, AND IS ADDED HERE.
--   finance_applications — the accounts a client applies for ON THEIR OWN,
--   outside a Fundhub round. One row per application. It is the client's own
--   record and it is never a billing source: no funding round, no fee, no
--   application_decisions row. The tracker screen shows these rows next to the
--   applications rows, each marked with where it came from.
--
-- THE RULES LIVE HERE, NOT IN THE SCREEN.
--   * Money is integer cents. NULL is unknown and survives (CLAUDE.md §12):
--     an amount is never 0. "The bank approved nothing" is a denial.
--   * An approved limit only rides on an approval.
--   * A decision day only rides on an answer (approved or denied) and never
--     comes before the day the client applied.
--   * Last 4 is 2 to 4 digits. There is no full account number column and none
--     may be added (081's header).
--
-- THE ACCOUNT AN APPROVAL ADDS. An approved card or line of credit joins the
-- client's Finance OS accounts as a bank_accounts row (src/finance/
-- applications-tracker.mjs). The link lives on that account, in
-- raw->'fundhub_application' = { kind: 'fundhub' | 'self', id }, so it survives
-- when Plaid later claims the same row (the Plaid upsert merges raw). The index
-- below keeps it to ONE account per application, even under a double click.
--
-- Nothing in this feature deletes a row. The app gets SELECT, INSERT, UPDATE.

CREATE TABLE IF NOT EXISTS public.finance_applications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  bank             text NOT NULL
                   CONSTRAINT finance_applications_bank_ck
                   CHECK (char_length(btrim(bank)) BETWEEN 1 AND 120),
  product          text
                   CONSTRAINT finance_applications_product_ck
                   CHECK (product IS NULL OR char_length(btrim(product)) BETWEEN 1 AND 160),
  kind             text NOT NULL
                   CONSTRAINT finance_applications_kind_ck
                   CHECK (kind IN ('card', 'line', 'loan')),
  owner_kind       text
                   CONSTRAINT finance_applications_owner_kind_ck
                   CHECK (owner_kind IS NULL OR owner_kind IN ('personal', 'business')),
  applied_on       date NOT NULL,
  requested_cents  bigint
                   CONSTRAINT finance_applications_requested_ck
                   CHECK (requested_cents IS NULL OR requested_cents > 0),
  status           text NOT NULL DEFAULT 'applied'
                   CONSTRAINT finance_applications_status_ck
                   CHECK (status IN ('applied', 'pending', 'approved', 'denied')),
  approved_cents   bigint
                   CONSTRAINT finance_applications_approved_ck
                   CHECK (approved_cents IS NULL OR approved_cents > 0),
  decided_on       date,
  last4            text
                   CONSTRAINT finance_applications_last4_ck
                   CHECK (last4 IS NULL OR last4 ~ '^[0-9]{2,4}$'),
  entered_by       text NOT NULL
                   CONSTRAINT finance_applications_entered_by_ck
                   CHECK (entered_by IN ('client', 'staff')),
  entered_by_id    uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_applications_amount_only_approved_ck
    CHECK (approved_cents IS NULL OR status = 'approved'),
  CONSTRAINT finance_applications_decided_only_answered_ck
    CHECK (decided_on IS NULL OR status IN ('approved', 'denied')),
  CONSTRAINT finance_applications_decided_after_applied_ck
    CHECK (decided_on IS NULL OR decided_on >= applied_on)
);

CREATE INDEX IF NOT EXISTS finance_applications_client_idx
  ON public.finance_applications (org_id, client_id, applied_on DESC);

DROP TRIGGER IF EXISTS finance_applications_set_updated_at ON public.finance_applications;
CREATE TRIGGER finance_applications_set_updated_at
  BEFORE UPDATE ON public.finance_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE public.finance_applications IS
  'Finance OS tracker: accounts a client applied for on their own, outside a Fundhub funding round. Never a billing source. Fundhub round applications stay in applications.';
COMMENT ON COLUMN public.finance_applications.approved_cents IS
  'The approved limit or amount, integer cents. NULL = not told (never 0). Only on an approval.';
COMMENT ON COLUMN public.finance_applications.requested_cents IS
  'The amount the client asked for, integer cents. NULL = not told (never 0).';

-- One account per application. The link is on the account (see the header).
CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_fundhub_application_uq
  ON public.bank_accounts (org_id, (raw->'fundhub_application'->>'kind'), (raw->'fundhub_application'->>'id'))
  WHERE raw ? 'fundhub_application';

-- Row-level security — the same shape 461 gives bank_relationship_deposits.
ALTER TABLE public.finance_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_applications FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'finance_applications'
       AND policyname = 'finance_applications_app_all'
  ) THEN
    CREATE POLICY finance_applications_app_all
      ON public.finance_applications
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Read, add and change. Never remove.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.finance_applications TO fundhub_app;
  END IF;
END $$;
