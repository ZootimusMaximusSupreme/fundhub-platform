-- A property report is separate from consumer-credit reports and allowances.
-- Commit one claim before transmission; uncertain calls never silently retry.
CREATE TABLE IF NOT EXISTS public.crs_property_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  requester_staff_id uuid NOT NULL REFERENCES public.staff(id),
  operation_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox','production')),
  identity_fingerprint char(64) NOT NULL CHECK (identity_fingerprint ~ '^[a-f0-9]{64}$'),
  identity_version_fingerprint char(64) NOT NULL CHECK (identity_version_fingerprint ~ '^[a-f0-9]{64}$'),
  consent_text text NOT NULL CHECK (length(btrim(consent_text)) > 0),
  consent_version text NOT NULL CHECK (consent_version = 'property-report-2026-11-06'),
  consent_accepted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('in_flight','completed','needs_review','error')),
  provider_request_id uuid,
  normalized_response jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id,operation_id),
  UNIQUE (org_id,client_id,environment,identity_fingerprint),
  CHECK (status <> 'completed' OR (provider_request_id IS NOT NULL AND normalized_response IS NOT NULL AND finished_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_crs_property_one_in_flight
  ON public.crs_property_requests(org_id,client_id) WHERE status='in_flight';
CREATE INDEX IF NOT EXISTS ix_crs_property_client_latest
  ON public.crs_property_requests(org_id,client_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.crs_property_request_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id=NEW.client_id AND org_id=NEW.org_id)
    OR NOT EXISTS (SELECT 1 FROM public.staff WHERE id=NEW.requester_staff_id AND org_id=NEW.org_id) THEN
    RAISE EXCEPTION 'property request scope mismatch' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.org_id,NEW.client_id,NEW.requester_staff_id,NEW.operation_id,
      NEW.environment,NEW.identity_fingerprint,NEW.consent_text,NEW.consent_version,NEW.consent_accepted_at,NEW.created_at)
    IS DISTINCT FROM (OLD.org_id,OLD.client_id,OLD.requester_staff_id,OLD.operation_id,
      OLD.environment,OLD.identity_fingerprint,OLD.consent_text,OLD.consent_version,OLD.consent_accepted_at,OLD.created_at) THEN
    RAISE EXCEPTION 'property request attribution is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crs_property_request_scope BEFORE INSERT OR UPDATE ON public.crs_property_requests
  FOR EACH ROW EXECUTE FUNCTION public.crs_property_request_scope();
ALTER TABLE public.crs_property_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crs_property_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.crs_property_requests FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='fundhub_app') THEN
    REVOKE ALL ON public.crs_property_requests FROM fundhub_app;
    GRANT SELECT,INSERT ON public.crs_property_requests TO fundhub_app;
    GRANT UPDATE(status,provider_request_id,normalized_response,error_code,finished_at,updated_at,identity_version_fingerprint)
      ON public.crs_property_requests TO fundhub_app;
    CREATE POLICY crs_property_requests_app ON public.crs_property_requests TO fundhub_app
      USING (true) WITH CHECK (true);
  END IF;
END $$;
