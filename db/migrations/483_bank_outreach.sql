-- Internal banker relationship workspace. No browser/Data API grants.
CREATE TABLE IF NOT EXISTS outreach_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  key text NOT NULL DEFAULT 'bank_relationships' CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  states text[] NOT NULL DEFAULT ARRAY['AZ','SC','FL','CA'],
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, key), UNIQUE (org_id, id)
);
CREATE TABLE IF NOT EXISTS outreach_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  program_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('fdic','ncua')),
  external_id text NOT NULL CHECK (btrim(external_id) <> ''),
  institution_key text NOT NULL CHECK (btrim(institution_key) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  state text NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  city text,
  website text,
  assigned_staff_id uuid REFERENCES staff(id),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','researching','contacted','engaged','product_pending','verified_partner','paused','closed')),
  next_action text,
  next_due_at timestamptz,
  partner_activity text NOT NULL DEFAULT 'active' CHECK (partner_activity IN ('active','quiet')),
  last_touch_at timestamptz,
  last_partner_checkin_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, program_id) REFERENCES outreach_programs(org_id, id),
  UNIQUE (org_id, program_id, source, external_id, state),
  UNIQUE (org_id, id),
  CHECK (institution_key = source || ':' || external_id)
);
CREATE INDEX IF NOT EXISTS outreach_accounts_queue_idx ON outreach_accounts(org_id, assigned_staff_id, next_due_at);
CREATE INDEX IF NOT EXISTS outreach_accounts_program_idx ON outreach_accounts(org_id, program_id, state, status);
CREATE TABLE IF NOT EXISTS outreach_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  account_id uuid NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  title text, linkedin_url text, email text, phone text,
  created_by uuid REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, account_id) REFERENCES outreach_accounts(org_id, id),
  UNIQUE (org_id, account_id, id)
);
CREATE INDEX IF NOT EXISTS outreach_contacts_account_idx ON outreach_contacts(org_id, account_id);
CREATE TABLE IF NOT EXISTS outreach_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  account_id uuid NOT NULL,
  contact_id uuid,
  staff_id uuid NOT NULL REFERENCES staff(id),
  channel text NOT NULL CHECK (channel IN ('linkedin','email','call','note')),
  outcome text NOT NULL CHECK (btrim(outcome) <> ''),
  note text,
  next_action text NOT NULL CHECK (btrim(next_action) <> ''),
  next_due_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, account_id) REFERENCES outreach_accounts(org_id, id),
  FOREIGN KEY (org_id, account_id, contact_id) REFERENCES outreach_contacts(org_id, account_id, id)
);
CREATE INDEX IF NOT EXISTS outreach_activities_account_idx ON outreach_activities(org_id, account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outreach_activities_contact_idx ON outreach_activities(org_id, account_id, contact_id);
CREATE TABLE IF NOT EXISTS outreach_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  account_id uuid NOT NULL,
  product_name text NOT NULL CHECK (btrim(product_name) <> ''),
  lender_table lender_table NOT NULL,
  facts jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(facts) = 'object'),
  evidence text NOT NULL DEFAULT '',
  lender_id uuid REFERENCES lenders(id),
  draft jsonb CHECK (draft IS NULL OR jsonb_typeof(draft) = 'object'),
  first_verified_at timestamptz,
  verified_at timestamptz,
  verified_by uuid REFERENCES staff(id),
  created_by uuid NOT NULL REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, account_id) REFERENCES outreach_accounts(org_id, id),
  CHECK ((verified_at IS NULL) = (verified_by IS NULL)),
  CHECK (verified_at IS NULL OR first_verified_at IS NOT NULL),
  CHECK (verified_at IS NULL OR (lender_id IS NOT NULL AND btrim(evidence) <> ''))
);
CREATE INDEX IF NOT EXISTS outreach_products_account_idx ON outreach_products(org_id, account_id);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_products_lender_idx ON outreach_products(lender_id) WHERE lender_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS outreach_products_verified_idx ON outreach_products(org_id, verified_at) WHERE verified_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS outreach_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  account_id uuid NOT NULL,
  previous_staff_id uuid REFERENCES staff(id),
  assigned_staff_id uuid REFERENCES staff(id),
  assigned_by uuid NOT NULL REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, account_id) REFERENCES outreach_accounts(org_id, id)
);
CREATE INDEX IF NOT EXISTS outreach_assignments_account_idx ON outreach_assignments(org_id, account_id, created_at DESC);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['outreach_programs','outreach_accounts','outreach_contacts','outreach_activities','outreach_products','outreach_assignments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON %I FROM authenticated', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
      EXECUTE format('GRANT SELECT, INSERT ON %I TO fundhub_app', t);
      IF t IN ('outreach_programs','outreach_accounts','outreach_contacts','outreach_products') THEN
        EXECUTE format('GRANT UPDATE ON %I TO fundhub_app', t);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = t AND policyname = t || '_app') THEN
        EXECUTE format('CREATE POLICY %I ON %I TO fundhub_app USING (true) WITH CHECK (true)', t || '_app', t);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Ordinary expandable staff seats. Foreign catalog shapes remain untouched.
DO $$
DECLARE catalog regclass := to_regclass('staff_roles');
BEGIN
  IF catalog IS NOT NULL AND (SELECT count(*)=3 FROM pg_attribute WHERE attrelid=catalog AND NOT attisdropped AND attname IN ('org_id','key','name')) THEN
    EXECUTE $seed$
      INSERT INTO staff_roles(org_id,key,name)
      SELECT o.id,'outbound_rep','Outbound Rep' FROM orgs o
      WHERE NOT EXISTS(SELECT 1 FROM staff_roles r WHERE r.org_id=o.id AND lower(r.key)='outbound_rep')
    $seed$;
  END IF;
END $$;
