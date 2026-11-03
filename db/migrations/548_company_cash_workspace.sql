-- Company treasury stays separate from client FinanceOS. Owner-only API routes
-- supply the org boundary; browser roles have no table privileges.
CREATE TABLE company_plaid_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  plaid_item_id text NOT NULL UNIQUE,
  institution_name text,
  encrypted_access_token text NOT NULL,
  consent_text text NOT NULL,
  consent_granted_at timestamptz NOT NULL,
  linked_by_staff_id uuid NOT NULL REFERENCES staff(id),
  transactions_cursor text,
  last_synced_at timestamptz,
  last_sync_attempt_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,org_id)
);
CREATE TABLE company_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  company_plaid_item_id uuid NOT NULL,
  plaid_account_id text NOT NULL,
  name text,
  mask text,
  account_type text,
  account_subtype text,
  holder_category text,
  currency_code text,
  available_balance_cents bigint,
  current_balance_cents bigint,
  balance_as_of timestamptz,
  selected_for_cash boolean NOT NULL DEFAULT false,
  business_confirmed_by_staff_id uuid REFERENCES staff(id),
  business_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_plaid_item_id,org_id) REFERENCES company_plaid_items(id,org_id) ON DELETE CASCADE,
  UNIQUE(company_plaid_item_id,plaid_account_id),
  UNIQUE(id,org_id),
  CONSTRAINT company_bank_selected_ck CHECK
    (NOT selected_for_cash OR (business_confirmed_at IS NOT NULL AND business_confirmed_by_staff_id IS NOT NULL))
);
CREATE UNIQUE INDEX company_one_selected_bank_per_org ON company_bank_accounts(org_id) WHERE selected_for_cash;
CREATE TABLE company_bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  company_bank_account_id uuid NOT NULL,
  plaid_transaction_id text NOT NULL,
  amount_cents bigint NOT NULL,
  posted_on date,
  authorized_on date,
  merchant_name text,
  category text,
  owner_category text CHECK(owner_category IN ('crs','ad','tech','other')),
  is_pending boolean NOT NULL DEFAULT false,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_bank_account_id,org_id) REFERENCES company_bank_accounts(id,org_id) ON DELETE CASCADE,
  UNIQUE(company_bank_account_id,plaid_transaction_id),
  UNIQUE(id,org_id),
  CONSTRAINT company_bank_posted_ck CHECK(is_pending OR posted_on IS NOT NULL)
);
CREATE TABLE company_cash_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  kind text NOT NULL CHECK(kind IN ('crs','ad','tech')),
  label text NOT NULL CHECK(length(btrim(label)) > 0),
  billing_month date NOT NULL,
  source_ref text,
  invoice_verified_at timestamptz,
  invoice_covers_through_on date,
  amount_cents bigint CHECK(amount_cents IS NULL OR amount_cents >= 0),
  due_on date,
  status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','approved','paid','cancelled')),
  paid_bank_transaction_id uuid,
  created_by_staff_id uuid NOT NULL REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(paid_bank_transaction_id,org_id) REFERENCES company_bank_transactions(id,org_id),
  CONSTRAINT company_cash_paid_ck CHECK(status <> 'paid' OR (amount_cents IS NOT NULL AND paid_bank_transaction_id IS NOT NULL)),
  CONSTRAINT company_cash_verified_invoice_ck CHECK(invoice_verified_at IS NULL OR
    (kind='crs' AND source_ref IS NOT NULL AND amount_cents IS NOT NULL AND invoice_covers_through_on IS NOT NULL)),
  CONSTRAINT company_cash_invoice_cutoff_ck CHECK(invoice_covers_through_on IS NULL OR
    (kind='crs' AND invoice_covers_through_on >= billing_month AND
      (invoice_verified_at IS NULL OR invoice_covers_through_on <=
       (invoice_verified_at AT TIME ZONE 'America/Phoenix')::date))),
  CONSTRAINT company_cash_month_ck CHECK(billing_month= date_trunc('month',billing_month)::date)
);
CREATE UNIQUE INDEX company_one_crs_invoice_per_month ON company_cash_obligations(org_id,billing_month) WHERE kind='crs' AND status<>'cancelled';
CREATE UNIQUE INDEX company_one_obligation_per_bank_txn ON company_cash_obligations(org_id,paid_bank_transaction_id) WHERE paid_bank_transaction_id IS NOT NULL;
CREATE INDEX company_cash_obligations_due_idx ON company_cash_obligations(org_id,due_on) WHERE status IN ('planned','approved');
CREATE INDEX company_bank_transactions_org_date_idx ON company_bank_transactions(org_id,posted_on DESC);

ALTER TABLE company_plaid_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_plaid_items FORCE ROW LEVEL SECURITY;
ALTER TABLE company_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_bank_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE company_bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_bank_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE company_cash_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_cash_obligations FORCE ROW LEVEL SECURITY;
CREATE POLICY company_plaid_items_app ON company_plaid_items TO fundhub_app USING(true) WITH CHECK(true);
CREATE POLICY company_bank_accounts_app ON company_bank_accounts TO fundhub_app USING(true) WITH CHECK(true);
CREATE POLICY company_bank_transactions_app ON company_bank_transactions TO fundhub_app USING(true) WITH CHECK(true);
CREATE POLICY company_cash_obligations_app ON company_cash_obligations TO fundhub_app USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON company_plaid_items,company_bank_accounts,company_bank_transactions,company_cash_obligations TO fundhub_app;
