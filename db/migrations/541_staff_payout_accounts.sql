-- A closer or sales manager links their own payout destination. This stores no
-- payout amount and never sends money. Client, affiliate, and company banks stay separate.
CREATE TABLE IF NOT EXISTS staff_payout_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  staff_id uuid NOT NULL REFERENCES staff(id),
  environment text NOT NULL CHECK (environment IN ('sandbox', 'development', 'production')),
  plaid_item_id text NOT NULL,
  plaid_account_id text NOT NULL,
  encrypted_access_token text NOT NULL,
  institution_name text,
  account_name text,
  account_mask text,
  account_subtype text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'replaced', 'revoked')),
  consent_granted_at timestamptz NOT NULL,
  linked_by_staff_id uuid NOT NULL REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_payout_accounts_one_active
  ON staff_payout_accounts (staff_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS staff_payout_accounts_plaid_uniq
  ON staff_payout_accounts (org_id, plaid_item_id, plaid_account_id);
CREATE INDEX IF NOT EXISTS staff_payout_accounts_org_staff_idx
  ON staff_payout_accounts (org_id, staff_id);

CREATE OR REPLACE FUNCTION staff_payout_accounts_scope_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff s WHERE s.id = NEW.staff_id AND s.org_id = NEW.org_id)
     OR NOT EXISTS (SELECT 1 FROM staff s WHERE s.id = NEW.linked_by_staff_id AND s.org_id = NEW.org_id)
  THEN
    RAISE EXCEPTION 'staff payout bank must stay in its staff org' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_payout_accounts_scope_guard
  BEFORE INSERT OR UPDATE OF org_id, staff_id, linked_by_staff_id ON staff_payout_accounts
  FOR EACH ROW EXECUTE FUNCTION staff_payout_accounts_scope_guard();

ALTER TABLE staff_payout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_payout_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_payout_accounts_app ON staff_payout_accounts
  TO fundhub_app USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON staff_payout_accounts TO fundhub_app;
