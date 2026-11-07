-- 590_finance_tradeline_entries.sql — accounts a client adds by hand to their
-- tradeline inventory. Finance OS wave 4, unit TL
-- (ops/workflows/finance-os-wave4-brief.txt).
--
-- Owner, Chris 2026-11-07: "when we scan their credit, we look at what trade
-- lines are already on their reports... those are the easiest banks we can
-- always monetize... no overlap with credit cards they already have...
-- tradeline tracking for business and personal... they can also input their
-- own... so we know what they have at all times". This is IN ADDITION to
-- UnderwriteIQ, which this table never feeds.
--
-- WHY A NEW TABLE, AND NOT tradelines OR bank_accounts.
--   * tradelines feeds UnderwriteIQ: src/tradelines/index.mjs linesForEngine()
--     says "STORED ROWS WIN". One typed row there would make the engine set
--     aside every line on the credit pull and move a funding number. A typed
--     account must never do that, so it never goes there.
--   * bank_accounts feeds balances, trends, card use and phone alerts. An
--     account listed so we know the client has it carries no balance and is
--     not money we track. (The Accounts page's "Add account by hand" stays the
--     way to track a balance; those rows are read into the inventory too.)
-- Only src/finance/tradeline-inventory.mjs reads this table: the inventory on
-- the Accounts screen, and the bank plan's "Existing relationship" and "You
-- already have this".
--
-- WHOSE IT IS. scope 'personal', or scope 'business' with the business named
-- exactly one way:
--   entity_id      a Finance OS business container (106). Containers are
--                  never deleted, only archived, so the link holds.
--   business_name  a saved business that has no container. The $297 form
--                  replaces its businesses rows on every save, so the row id
--                  is not stable; the name is, and it is matched with the same
--                  loose compare the business credit lines use
--                  (src/finance/credit-history.mjs companyKey).
--
-- NULL MEANS UNKNOWN. No limit typed is NULL, never 0. Opened is a month,
-- YYYY-MM: people remember the month, and a made-up day would be a guess.
-- There is no account number column and none may be added (081's header).
--
-- Nothing in this feature deletes or changes a row. The app gets SELECT and
-- INSERT only.

CREATE TABLE IF NOT EXISTS public.finance_tradeline_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The bank or lender, as the client typed it ("Chase").
  creditor       text NOT NULL
                 CONSTRAINT finance_tradeline_entries_creditor_ck
                 CHECK (char_length(btrim(creditor)) BETWEEN 1 AND 120),

  -- The card or account name, when the client knows it ("Ink Business Cash").
  -- It is what lets the bank plan say "You already have this".
  product        text
                 CONSTRAINT finance_tradeline_entries_product_ck
                 CHECK (product IS NULL OR char_length(btrim(product)) BETWEEN 1 AND 120),

  account_type   text NOT NULL
                 CONSTRAINT finance_tradeline_entries_type_ck
                 CHECK (account_type IN ('credit_card', 'line_of_credit', 'loan', 'checking', 'savings')),

  -- Integer cents. A limit only rides on a card or a line of credit.
  limit_cents    bigint
                 CONSTRAINT finance_tradeline_entries_limit_ck
                 CHECK (limit_cents IS NULL OR limit_cents > 0),

  opened_month   text
                 CONSTRAINT finance_tradeline_entries_opened_ck
                 CHECK (opened_month IS NULL OR opened_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

  scope          text NOT NULL
                 CONSTRAINT finance_tradeline_entries_scope_ck
                 CHECK (scope IN ('personal', 'business')),
  entity_id      uuid REFERENCES entities(id),
  business_name  text
                 CONSTRAINT finance_tradeline_entries_business_name_ck
                 CHECK (business_name IS NULL OR char_length(btrim(business_name)) BETWEEN 1 AND 120),

  entered_by     text NOT NULL
                 CONSTRAINT finance_tradeline_entries_entered_by_ck
                 CHECK (entered_by IN ('client', 'staff')),
  entered_by_id  uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT finance_tradeline_entries_limit_type_ck
    CHECK (limit_cents IS NULL OR account_type IN ('credit_card', 'line_of_credit')),
  CONSTRAINT finance_tradeline_entries_owner_ck
    CHECK (
      (scope = 'personal' AND entity_id IS NULL AND business_name IS NULL)
      OR (scope = 'business' AND ((entity_id IS NOT NULL) <> (business_name IS NOT NULL)))
    )
);

CREATE INDEX IF NOT EXISTS finance_tradeline_entries_client_idx
  ON public.finance_tradeline_entries (org_id, client_id, created_at);

DROP TRIGGER IF EXISTS finance_tradeline_entries_set_updated_at ON public.finance_tradeline_entries;
CREATE TRIGGER finance_tradeline_entries_set_updated_at
  BEFORE UPDATE ON public.finance_tradeline_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE public.finance_tradeline_entries IS
  'Finance OS tradeline inventory: accounts a client added by hand so Fundhub knows what they hold. Never read by UnderwriteIQ, never a balance. Read by src/finance/tradeline-inventory.mjs.';
COMMENT ON COLUMN public.finance_tradeline_entries.limit_cents IS
  'Credit limit, integer cents. NULL = not told (never 0). Cards and lines of credit only.';
COMMENT ON COLUMN public.finance_tradeline_entries.opened_month IS
  'Month opened, YYYY-MM. NULL = not told. No day is stored, because none was given.';

-- Row-level security — the same shape 461 gives bank_relationship_deposits.
ALTER TABLE public.finance_tradeline_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_tradeline_entries FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'finance_tradeline_entries'
       AND policyname = 'finance_tradeline_entries_app_all'
  ) THEN
    CREATE POLICY finance_tradeline_entries_app_all
      ON public.finance_tradeline_entries
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Read and add. Never change or remove.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT ON public.finance_tradeline_entries TO fundhub_app;
  END IF;
END $$;
