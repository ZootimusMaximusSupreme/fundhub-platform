-- Server-received, authenticated native iPhone first-open proof for staff.
-- Link clicks or APNs permission never count as an install. No token/IDFA stored.
CREATE TABLE IF NOT EXISTS public.native_client_app_opens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform = 'ios'),
  installation_id uuid NOT NULL,
  first_authenticated_at timestamptz NOT NULL DEFAULT now(),
  last_authenticated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_native_client_app_opens_client_device
    UNIQUE (org_id, client_id, platform, installation_id)
);

CREATE INDEX IF NOT EXISTS ix_native_client_app_opens_client_first
  ON public.native_client_app_opens (org_id, client_id, platform, first_authenticated_at);

ALTER TABLE public.native_client_app_opens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_client_app_opens FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.native_client_app_opens FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.native_client_app_opens FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.native_client_app_opens FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.native_client_app_opens TO fundhub_app;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'native_client_app_opens'
         AND policyname = 'native_client_app_opens_app'
    ) THEN
      CREATE POLICY native_client_app_opens_app ON public.native_client_app_opens
        TO fundhub_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
END $$;

COMMENT ON TABLE public.native_client_app_opens IS
  'Native iPhone first authenticated open. One row per org/client/install; first server time survives retries. Marketing link clicks and push permission are not proof.';