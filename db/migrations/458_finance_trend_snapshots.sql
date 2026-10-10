-- 458_finance_trend_snapshots.sql — FinanceOS keeps a daily history, so the
-- Overview can draw lines over time instead of only today's numbers.
--
-- FinanceOS wave 4, unit H6 (ops/workflows/finance-os-wave4-2026-10-06.md).
-- Owner (2026-10-06): "the whole Finance OS with line graphs … Finance OS
-- tracking."
--
-- TWO TABLES.
--
--   finance_account_daily   one row per bank account per day: the balances the
--                           account carried that day (current, available, credit
--                           limit) and the kind/container it sat in.
--   finance_client_daily    one row per client per day: the rollups the page
--                           draws — cash per kind (personal / business /
--                           not-sure-yet, NEVER added together), debt total and
--                           per kind, and cards used %.
--
-- WHO WRITES. src/workflows/finance-os-trend-snapshots.mjs, once a day, through
-- src/finance/money-trends.mjs. The same module rebuilds past days for checking
-- and savings accounts from bank_transactions (working backward from today's
-- balance). Those rebuilt rows say source = 'backfill' and estimated = true.
--
-- ONE ROW PER (account, day) AND PER (client, day) — the unique keys below. A
-- second run on the same day updates the row instead of adding one. A real
-- snapshot always wins over a rebuilt estimate: the writer's ON CONFLICT only
-- lets a 'backfill' row overwrite another 'backfill' row (the CHECK below makes
-- estimated follow source, so a snapshot row can never be marked estimated).
--
-- MONEY IS INTEGER CENTS. NULL MEANS UNKNOWN AND MUST SURVIVE. A NULL balance is
-- "the bank did not tell us that day", which is not $0. A missing day is no row
-- at all, and the trends read draws it as a gap, never as 0.
--
-- bank_account_id IS a foreign key: the history belongs to the account, so it
-- goes when the account row goes (ON DELETE CASCADE), the same way bank_accounts
-- follows its plaid_items row. A closed account keeps its row and its history.

CREATE TABLE IF NOT EXISTS finance_account_daily (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES orgs(id),
  client_id                uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  bank_account_id          uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  day                      date NOT NULL,
  -- The account's type and kind on that day, so a later re-label does not
  -- rewrite history. kind is the container's kind when it sat in one, else the
  -- account's own entity_kind (src/finance/money-overview.mjs rule).
  account_type             text,
  kind                     text NOT NULL DEFAULT 'unknown'
    CHECK (kind IN ('personal', 'business', 'unknown')),
  entity_id                uuid,
  current_balance_cents    bigint,
  available_balance_cents  bigint,
  credit_limit_cents       bigint,
  -- When the balance was true, as the bank said (bank_accounts.balance_as_of).
  balance_as_of            timestamptz,
  source                   text NOT NULL CHECK (source IN ('snapshot', 'backfill')),
  estimated                boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_account_daily_estimated_ck CHECK (estimated = (source = 'backfill')),
  CONSTRAINT finance_account_daily_one_per_day UNIQUE (bank_account_id, day)
);
CREATE INDEX IF NOT EXISTS finance_account_daily_client_idx
  ON finance_account_daily (org_id, client_id, day);

CREATE TABLE IF NOT EXISTS finance_client_daily (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES orgs(id),
  client_id                uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  day                      date NOT NULL,
  -- Cash, one column set per kind. These three are NEVER added together.
  -- *_floor = true means at least one account of that kind had no balance, so
  -- the number is a floor ("at least"), the same rule as the live tiles.
  cash_personal_cents      bigint,
  cash_personal_floor      boolean NOT NULL DEFAULT false,
  cash_business_cents      bigint,
  cash_business_floor      boolean NOT NULL DEFAULT false,
  cash_unknown_cents       bigint,
  cash_unknown_floor       boolean NOT NULL DEFAULT false,
  -- Debt (cards + loans). Debt MAY add across kinds (owner asked for a global
  -- total); the split stays beside it.
  debt_total_cents         bigint,
  debt_total_floor         boolean NOT NULL DEFAULT false,
  debt_personal_cents      bigint,
  debt_business_cents      bigint,
  debt_unknown_cents       bigint,
  -- Cards used: owed over limit across cards where both are known and the limit
  -- is above 0. NULL when no card had both.
  cards_balance_cents      bigint,
  cards_limit_cents        bigint,
  cards_used_pct           numeric(6,1),
  source                   text NOT NULL CHECK (source IN ('snapshot', 'backfill')),
  estimated                boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_client_daily_estimated_ck CHECK (estimated = (source = 'backfill')),
  CONSTRAINT finance_client_daily_one_per_day UNIQUE (client_id, day)
);
CREATE INDEX IF NOT EXISTS finance_client_daily_client_idx
  ON finance_client_daily (org_id, client_id, day);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'finance_account_daily_updated_at') THEN
    CREATE TRIGGER finance_account_daily_updated_at
      BEFORE UPDATE ON finance_account_daily
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'finance_client_daily_updated_at') THEN
    CREATE TRIGGER finance_client_daily_updated_at
      BEFORE UPDATE ON finance_client_daily
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE public.finance_account_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_account_daily FORCE ROW LEVEL SECURITY;
ALTER TABLE public.finance_client_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_client_daily FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'finance_account_daily' AND policyname = 'finance_account_daily_app_all') THEN
    CREATE POLICY finance_account_daily_app_all ON public.finance_account_daily USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'finance_client_daily' AND policyname = 'finance_client_daily_app_all') THEN
    CREATE POLICY finance_client_daily_app_all ON public.finance_client_daily USING (true) WITH CHECK (true);
  END IF;
END $$;

-- History is never deleted by the app: SELECT, INSERT, UPDATE only.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.finance_account_daily TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON public.finance_client_daily TO fundhub_app;
  END IF;
END $$;
