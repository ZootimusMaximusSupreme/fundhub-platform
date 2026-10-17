-- Native Fundhub iPhone notifications. APNs tokens are app-specific addresses,
-- separate from the browser subscriptions in migration 352.
CREATE TABLE IF NOT EXISTS public.client_apns_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.account_sessions(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  encrypted_token text NOT NULL,
  apns_environment text NOT NULL CHECK (apns_environment IN ('development', 'production')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  expired_at timestamptz,
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_apns_devices_live
  ON public.client_apns_devices (token_hash, apns_environment)
  WHERE expired_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_apns_devices_installation_live
  ON public.client_apns_devices (installation_id)
  WHERE expired_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_client_apns_devices_live_by_client
  ON public.client_apns_devices (org_id, client_id)
  WHERE expired_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_client_apns_devices_account
  ON public.client_apns_devices (account_id)
  WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_client_apns_devices_session
  ON public.client_apns_devices (session_id);

ALTER TABLE public.client_apns_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_apns_devices FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_apns_devices FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.client_apns_devices FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.client_apns_devices FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.client_apns_devices TO fundhub_app;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'client_apns_devices'
         AND policyname = 'client_apns_devices_app'
    ) THEN
      CREATE POLICY client_apns_devices_app ON public.client_apns_devices
        TO fundhub_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
END $$;

COMMENT ON TABLE public.client_apns_devices IS
  'Native iPhone APNs tokens, encrypted with PUSH_SUB_ENC_KEY and bound to one account session. A revoked or expired session cannot receive alerts. Web push subscriptions live separately in client_push_subscriptions.';
