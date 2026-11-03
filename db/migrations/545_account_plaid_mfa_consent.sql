-- A separate authenticator factor and a durable, single-use consent receipt
-- for client and affiliate Plaid Link. Neither a session nor a body boolean
-- alone is sufficient to mint a Link token or exchange a public token.
CREATE TABLE IF NOT EXISTS account_plaid_mfa_credentials (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(id),
  secret_ciphertext text NOT NULL,
  confirmed_at timestamptz,
  last_counter bigint,
  failed_attempts integer NOT NULL DEFAULT 0,
  failed_window_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_plaid_mfa_attempts_check CHECK (failed_attempts BETWEEN 0 AND 5)
);

-- First enrollment needs proof of control of the account's existing email.
-- Only a hash of the short-lived code is stored; each challenge is session-bound.
CREATE TABLE IF NOT EXISTS account_plaid_mfa_email_challenges (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(id),
  account_session_id uuid NOT NULL REFERENCES account_sessions(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  verified_at timestamptz,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_plaid_link_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  org_id uuid NOT NULL REFERENCES orgs(id),
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  account_session_id uuid REFERENCES account_sessions(id) ON DELETE SET NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('client_bank', 'affiliate_payout')),
  target_id uuid NOT NULL,
  consent_scope jsonb NOT NULL,
  consent_version text NOT NULL,
  consent_text text NOT NULL,
  privacy_url text NOT NULL,
  consent_granted_at timestamptz NOT NULL DEFAULT now(),
  mfa_verified_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  link_opened_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_plaid_link_grants_session_idx
  ON account_plaid_link_grants (account_session_id, expires_at DESC);

CREATE OR REPLACE FUNCTION account_plaid_scope_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id=NEW.account_id AND org_id=NEW.org_id) THEN
    RAISE EXCEPTION 'account Plaid MFA must stay in account org' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME IN ('account_plaid_link_grants', 'account_plaid_mfa_email_challenges')
     AND NEW.account_id IS NOT NULL AND NEW.account_session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM account_sessions
     WHERE id=NEW.account_session_id AND account_id=NEW.account_id AND org_id=NEW.org_id
  ) THEN
    RAISE EXCEPTION 'Plaid Link consent must stay in its account session' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS account_plaid_mfa_scope_guard ON account_plaid_mfa_credentials;
CREATE TRIGGER account_plaid_mfa_scope_guard
  BEFORE INSERT OR UPDATE OF org_id, account_id ON account_plaid_mfa_credentials
  FOR EACH ROW EXECUTE FUNCTION account_plaid_scope_guard();
DROP TRIGGER IF EXISTS account_plaid_email_scope_guard ON account_plaid_mfa_email_challenges;
CREATE TRIGGER account_plaid_email_scope_guard
  BEFORE INSERT OR UPDATE OF org_id, account_id ON account_plaid_mfa_email_challenges
  FOR EACH ROW EXECUTE FUNCTION account_plaid_scope_guard();
DROP TRIGGER IF EXISTS account_plaid_grant_scope_guard ON account_plaid_link_grants;
CREATE TRIGGER account_plaid_grant_scope_guard
  BEFORE INSERT OR UPDATE OF org_id, account_id ON account_plaid_link_grants
  FOR EACH ROW EXECUTE FUNCTION account_plaid_scope_guard();

ALTER TABLE account_plaid_mfa_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_plaid_mfa_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY account_plaid_mfa_app ON account_plaid_mfa_credentials
  TO fundhub_app USING (true) WITH CHECK (true);
ALTER TABLE account_plaid_mfa_email_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_plaid_mfa_email_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY account_plaid_email_app ON account_plaid_mfa_email_challenges
  TO fundhub_app USING (true) WITH CHECK (true);
ALTER TABLE account_plaid_link_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_plaid_link_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY account_plaid_link_grants_app ON account_plaid_link_grants
  TO fundhub_app USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON account_plaid_mfa_credentials TO fundhub_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON account_plaid_mfa_email_challenges TO fundhub_app;
REVOKE UPDATE, DELETE, TRUNCATE ON account_plaid_link_grants FROM fundhub_app;
GRANT SELECT, INSERT ON account_plaid_link_grants TO fundhub_app;
GRANT UPDATE (link_opened_at, consumed_at) ON account_plaid_link_grants TO fundhub_app;
