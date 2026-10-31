-- Native iPhone work alerts belong to a staff session, never a client file.
CREATE TABLE IF NOT EXISTS public.staff_apns_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_apns_devices_live_token
  ON public.staff_apns_devices (token_hash, apns_environment)
  WHERE expired_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_apns_devices_live_installation
  ON public.staff_apns_devices (installation_id)
  WHERE expired_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_staff_apns_devices_live_by_staff
  ON public.staff_apns_devices (org_id, staff_id)
  WHERE expired_at IS NULL AND revoked_at IS NULL;

-- One claim per staff alert. A retry after an uncertain Apple result must not
-- make the same work alert buzz twice.
CREATE TABLE IF NOT EXISTS public.staff_apns_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('lead', 'set', 'upcoming')),
  alert_key text NOT NULL CHECK (length(alert_key) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'attempted' CHECK (status IN ('attempted', 'sent', 'failed')),
  attempted integer NOT NULL DEFAULT 0,
  sent integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, staff_id, client_id, kind, alert_key)
);

ALTER TABLE public.staff_apns_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_apns_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.staff_apns_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_apns_alerts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_apns_devices, public.staff_apns_alerts FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.staff_apns_devices, public.staff_apns_alerts FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.staff_apns_devices, public.staff_apns_alerts FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.staff_apns_devices, public.staff_apns_alerts TO fundhub_app;
    CREATE POLICY staff_apns_devices_app ON public.staff_apns_devices
      TO fundhub_app USING (true) WITH CHECK (true);
    CREATE POLICY staff_apns_alerts_app ON public.staff_apns_alerts
      TO fundhub_app USING (true) WITH CHECK (true);
  END IF;
END $$;
