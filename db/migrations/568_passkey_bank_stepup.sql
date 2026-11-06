-- Passkeys protect bank-connection actions, never ordinary login/session restore.
CREATE TABLE auth_passkey_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  account_id uuid UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  staff_id uuid UNIQUE REFERENCES staff(id) ON DELETE CASCADE,
  user_handle text NOT NULL UNIQUE,
  enrolled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(account_id,staff_id)=1)
);
CREATE TABLE auth_passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES auth_passkey_subjects(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key bytea NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0 CHECK (sign_count>=0),
  transports jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(transports)='array'),
  device_type text NOT NULL CHECK (device_type IN ('singleDevice','multiDevice')),
  backed_up boolean NOT NULL,
  name text NOT NULL DEFAULT 'Passkey' CHECK (length(name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (id,subject_id)
);
CREATE TABLE auth_passkey_challenges (
  token_hash text PRIMARY KEY,
  subject_id uuid NOT NULL REFERENCES auth_passkey_subjects(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('client_bank','affiliate_payout','company_bank')),
  target_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('registration','authentication','recovery','failure')),
  challenge text NOT NULL,
  enrollment_authorization text CHECK (enrollment_authorization IN ('initial','passkey','recovery')),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '5 minutes'),
  used_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_passkey_challenges_subject_time ON auth_passkey_challenges(subject_id,created_at);
CREATE TABLE auth_passkey_assurances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES auth_passkey_subjects(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL,
  session_id uuid NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('client_bank','affiliate_payout','company_bank')),
  target_id uuid NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '15 minutes'),
  revoked_at timestamptz,
  FOREIGN KEY (credential_id,subject_id) REFERENCES auth_passkeys(id,subject_id) ON DELETE CASCADE
);
CREATE INDEX auth_passkey_assurances_session_target ON auth_passkey_assurances(session_id,target_kind,target_id,expires_at);
CREATE TABLE auth_passkey_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES auth_passkey_subjects(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (id,subject_id)
);
ALTER TABLE auth_passkey_challenges ADD COLUMN recovery_code_id uuid;
ALTER TABLE auth_passkey_challenges ADD CONSTRAINT auth_passkey_recovery_code_scope
  FOREIGN KEY (recovery_code_id,subject_id) REFERENCES auth_passkey_recovery_codes(id,subject_id);
-- Server-side principals, orgs, sessions and target ownership must agree even
-- when a future application writer forgets a scope predicate.
CREATE FUNCTION auth_passkey_subject_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.account_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM accounts WHERE id=NEW.account_id AND org_id=NEW.org_id) THEN
    RAISE EXCEPTION 'passkey account org mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.staff_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM staff WHERE id=NEW.staff_id AND org_id=NEW.org_id) THEN
    RAISE EXCEPTION 'passkey staff org mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER auth_passkey_subject_scope BEFORE INSERT OR UPDATE OF org_id,account_id,staff_id
  ON auth_passkey_subjects FOR EACH ROW EXECUTE FUNCTION auth_passkey_subject_scope();
CREATE FUNCTION auth_passkey_session_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s auth_passkey_subjects%ROWTYPE;
BEGIN
  SELECT * INTO STRICT s FROM auth_passkey_subjects WHERE id=NEW.subject_id;
  IF s.account_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM account_sessions WHERE id=NEW.session_id AND account_id=s.account_id AND org_id=s.org_id)
       OR NOT EXISTS (SELECT 1 FROM accounts WHERE id=s.account_id AND org_id=s.org_id AND
         ((kind='client' AND NEW.target_kind='client_bank' AND client_id=NEW.target_id)
          OR (kind IN ('client','affiliate') AND NEW.target_kind='affiliate_payout' AND affiliate_id=NEW.target_id))) THEN
      RAISE EXCEPTION 'passkey account session or target mismatch' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM sessions WHERE id=NEW.session_id AND staff_id=s.staff_id AND org_id=s.org_id)
       OR NOT EXISTS (SELECT 1 FROM staff WHERE id=s.staff_id AND org_id=s.org_id AND role='owner')
       OR NEW.target_kind<>'company_bank' OR NEW.target_id<>s.org_id THEN
      RAISE EXCEPTION 'passkey owner session or target mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER auth_passkey_challenge_scope BEFORE INSERT OR UPDATE OF subject_id,session_id,target_kind,target_id
  ON auth_passkey_challenges FOR EACH ROW EXECUTE FUNCTION auth_passkey_session_scope();
CREATE TRIGGER auth_passkey_assurance_scope BEFORE INSERT OR UPDATE OF subject_id,session_id,target_kind,target_id
  ON auth_passkey_assurances FOR EACH ROW EXECUTE FUNCTION auth_passkey_session_scope();
DO $$ DECLARE t text; r text; BEGIN
  FOREACH t IN ARRAY ARRAY['auth_passkey_subjects','auth_passkeys','auth_passkey_challenges','auth_passkey_assurances','auth_passkey_recovery_codes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
        EXECUTE format('REVOKE ALL ON %I FROM %I',t,r);
      END IF;
    END LOOP;
    EXECUTE format('CREATE POLICY passkey_server_only ON %I TO fundhub_app USING (true) WITH CHECK (true)',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO fundhub_app',t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION auth_passkey_subject_scope(), auth_passkey_session_scope() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_passkey_subject_scope(), auth_passkey_session_scope() TO fundhub_app;
