-- Authenticator MFA for staff sign-in. Secrets are AES-GCM ciphertext under a
-- dedicated environment key; challenge and recovery tokens are stored hashed.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mfa_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS staff_mfa_credentials (
  staff_id uuid PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(id),
  secret_ciphertext text NOT NULL,
  confirmed_at timestamptz,
  last_counter bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_mfa_challenges (
  token_hash text PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES orgs(id),
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  used_at timestamptz,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_mfa_challenges_staff_idx
  ON staff_mfa_challenges (staff_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS staff_mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_mfa_recovery_staff_idx
  ON staff_mfa_recovery_codes (staff_id) WHERE used_at IS NULL;

CREATE OR REPLACE FUNCTION staff_mfa_scope_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff WHERE id=NEW.staff_id AND org_id=NEW.org_id) THEN
    RAISE EXCEPTION 'staff MFA must stay in its staff org' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS staff_mfa_credentials_scope_guard ON staff_mfa_credentials;
CREATE TRIGGER staff_mfa_credentials_scope_guard
  BEFORE INSERT OR UPDATE OF org_id, staff_id ON staff_mfa_credentials
  FOR EACH ROW EXECUTE FUNCTION staff_mfa_scope_guard();
DROP TRIGGER IF EXISTS staff_mfa_challenges_scope_guard ON staff_mfa_challenges;
CREATE TRIGGER staff_mfa_challenges_scope_guard
  BEFORE INSERT OR UPDATE OF org_id, staff_id ON staff_mfa_challenges
  FOR EACH ROW EXECUTE FUNCTION staff_mfa_scope_guard();
DROP TRIGGER IF EXISTS staff_mfa_recovery_scope_guard ON staff_mfa_recovery_codes;
CREATE TRIGGER staff_mfa_recovery_scope_guard
  BEFORE INSERT OR UPDATE OF org_id, staff_id ON staff_mfa_recovery_codes
  FOR EACH ROW EXECUTE FUNCTION staff_mfa_scope_guard();

ALTER TABLE staff_mfa_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_mfa_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_mfa_credentials_app ON staff_mfa_credentials
  TO fundhub_app USING (true) WITH CHECK (true);
ALTER TABLE staff_mfa_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_mfa_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_mfa_challenges_app ON staff_mfa_challenges
  TO fundhub_app USING (true) WITH CHECK (true);
ALTER TABLE staff_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_mfa_recovery_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_mfa_recovery_app ON staff_mfa_recovery_codes
  TO fundhub_app USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON staff_mfa_credentials TO fundhub_app;
GRANT SELECT, INSERT, UPDATE ON staff_mfa_challenges TO fundhub_app;
GRANT SELECT, INSERT, UPDATE ON staff_mfa_recovery_codes TO fundhub_app;
