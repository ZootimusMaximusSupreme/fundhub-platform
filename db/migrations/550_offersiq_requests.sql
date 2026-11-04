-- One durable claim per lead, ruleset, environment and exact submitted identity.
-- A timed-out request may have reached CRS, so a claim is never silently retried.
CREATE TABLE IF NOT EXISTS public.offersiq_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  requester_staff_id uuid NOT NULL REFERENCES public.staff(id),
  operation_id uuid NOT NULL,
  rule_set_id bigint NOT NULL CHECK (rule_set_id > 0),
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  identity_fingerprint char(64) NOT NULL CHECK (identity_fingerprint ~ '^[0-9a-f]{64}$'),
  identity_source text NOT NULL CHECK (identity_source = 'setter_confirmed'),
  address_confirmed_at timestamptz NOT NULL,
  consent_terms_url text NOT NULL,
  consent_version text NOT NULL,
  consent_accepted_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('in_flight', 'matched', 'not_matched', 'needs_review', 'error')),
  provider_request_id text,
  normalized_response jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, operation_id),
  UNIQUE (org_id, client_id, rule_set_id, environment, identity_fingerprint)
);

CREATE INDEX IF NOT EXISTS ix_offersiq_requests_client_latest
  ON public.offersiq_requests (org_id, client_id, created_at DESC);

-- An address correction cannot open a second paid wire while the first is pending.
CREATE UNIQUE INDEX IF NOT EXISTS ux_offersiq_requests_one_in_flight_per_client
  ON public.offersiq_requests (org_id, client_id) WHERE status = 'in_flight';

ALTER TABLE public.offersiq_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offersiq_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.offersiq_requests FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    REVOKE ALL ON public.offersiq_requests FROM fundhub_app;
    GRANT SELECT, INSERT ON public.offersiq_requests TO fundhub_app;
    GRANT UPDATE (status, provider_request_id, normalized_response, error_code, finished_at, updated_at)
      ON public.offersiq_requests TO fundhub_app;
    CREATE POLICY offersiq_requests_app ON public.offersiq_requests
      TO fundhub_app USING (true) WITH CHECK (true);
  END IF;
END $$;
