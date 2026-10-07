-- 461_bank_relationship_tracker.sql — FinanceOS bank strategy: the bank
-- relationship tracker gets dates, a plan, and deposits.
--
-- FinanceOS wave 5, unit W2 (ops/workflows/finance-os-wave5-2026-10-06.md).
-- Owner, 2026-10-06 (docs/finance/finance-os-direction-2026-10-06.md, last
-- section): which accounts to open based on location, banking relationships
-- built on purpose, pins like "Oct 20: open an account and deposit $10,000 to
-- build banking history".
--
-- ONE STORE, NOT TWO. Migration 403 already made the bank relationship store:
-- blueprint_bank_relationship_todos, one row per client + bank + account kind
-- (src/blueprint/bank-relationship.mjs). FinanceOS writes the same rows
-- (src/finance/bank-strategy.mjs). This file only adds what a row could not say:
--
--   bank_name              the bank as people write it ("US Bank"). bank_key
--                          stays the lowercase key the unique index uses.
--   lender_id              the bank book row (lenders, 138) the plan came from,
--                          when it came from one.
--   entity_id              the container (entities, 106) the account belongs to.
--   planned_open_on        STAFF-SET: the day the client plans to open it.
--   planned_deposit_cents  STAFF-SET: how much they plan to put in. NULL = not
--                          set — the screen then shows the bank book's own
--                          minimum deposit, or "not set".
--   opened_on              the day it was really opened. NULL = not opened yet.
--
-- DEPOSITS ARE WRITTEN DOWN, NEVER GUESSED. bank_relationship_deposits holds one
-- row per deposit a staff member saw land. Build spec §4.10
-- (docs/finance/capital-blueprint-build-spec-2026-09-29.md): "Tracking deposits
-- needs bank data or staff attestation. Do not invent deposit amounts."
-- Integer cents, always more than zero. Nothing in this feature deletes a row.

ALTER TABLE public.blueprint_bank_relationship_todos
  ADD COLUMN IF NOT EXISTS bank_name             text,
  ADD COLUMN IF NOT EXISTS lender_id             uuid REFERENCES public.lenders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entity_id             uuid REFERENCES public.entities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS planned_open_on       date,
  ADD COLUMN IF NOT EXISTS planned_deposit_cents bigint,
  ADD COLUMN IF NOT EXISTS opened_on             date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blueprint_bank_relationship_todos_planned_deposit_ck') THEN
    ALTER TABLE public.blueprint_bank_relationship_todos
      ADD CONSTRAINT blueprint_bank_relationship_todos_planned_deposit_ck
      CHECK (planned_deposit_cents IS NULL OR planned_deposit_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blueprint_bank_relationship_todos_bank_name_ck') THEN
    ALTER TABLE public.blueprint_bank_relationship_todos
      ADD CONSTRAINT blueprint_bank_relationship_todos_bank_name_ck
      CHECK (bank_name IS NULL OR char_length(btrim(bank_name)) BETWEEN 1 AND 120);
  END IF;
END $$;

COMMENT ON COLUMN public.blueprint_bank_relationship_todos.planned_deposit_cents IS
  'Staff-set planned deposit in cents. NULL = not set (never defaulted to 0).';
COMMENT ON COLUMN public.blueprint_bank_relationship_todos.opened_on IS
  'Day the account was really opened (staff-recorded). NULL = not opened yet.';

-- ---------------------------------------------------------------------------
-- bank_relationship_deposits — one row per deposit staff saw land
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_relationship_deposits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  relationship_id  uuid NOT NULL
                   REFERENCES public.blueprint_bank_relationship_todos(id) ON DELETE CASCADE,
  amount_cents     bigint NOT NULL
                   CONSTRAINT bank_relationship_deposits_amount_ck CHECK (amount_cents > 0),
  deposited_on     date NOT NULL,
  note             text
                   CONSTRAINT bank_relationship_deposits_note_ck
                   CHECK (note IS NULL OR char_length(note) <= 500),
  recorded_by      uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bank_relationship_deposits_rel_idx
  ON public.bank_relationship_deposits (relationship_id, deposited_on);
CREATE INDEX IF NOT EXISTS bank_relationship_deposits_client_idx
  ON public.bank_relationship_deposits (org_id, client_id);

COMMENT ON TABLE public.bank_relationship_deposits IS
  'FinanceOS bank relationship tracker — deposits staff saw land, in integer cents. Append only.';

-- Row-level security — the same shape 403 gives the relationship rows.
ALTER TABLE public.bank_relationship_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_relationship_deposits FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'bank_relationship_deposits'
       AND policyname = 'bank_relationship_deposits_app_all'
  ) THEN
    CREATE POLICY bank_relationship_deposits_app_all
      ON public.bank_relationship_deposits
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Append only: the app may read and add a deposit, never change or remove one.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT ON public.bank_relationship_deposits TO fundhub_app;
  END IF;
END $$;
