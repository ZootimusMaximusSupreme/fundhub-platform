-- The client's own permission for a property report (ticked on the soft-pull
-- authorization form) is a separate consent kind. It is never the credit
-- authorization, it changes no price, and nothing orders a report from it:
-- an owner, admin or funding advisor still clicks Run property report.
--
-- Three stored effects:
--   1. client_consents.kind gains 'property_report_consent' (same closed-set
--      pattern as 167 and 291; the live constraint name is client_consents_kind_check).
--   2. crs_property_consents binds each such consent to the exact saved identity
--      version the client submitted with it, so a changed identity needs a fresh tick.
--   3. crs_property_requests records which permission an order relied on:
--      'staff' (confirmed on the workspace, the only path before this file) or
--      'client' (the saved client permission), and which consent row that was.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY (con.conkey)
     WHERE rel.relname = 'client_consents'
       AND con.contype = 'c'
       AND att.attname = 'kind'
       AND array_length(con.conkey, 1) = 1
  LOOP
    EXECUTE format('ALTER TABLE client_consents DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_consents_kind_check'
  ) THEN
    ALTER TABLE client_consents
      ADD CONSTRAINT client_consents_kind_check
      CHECK (kind IN ('soft_pull_consent',
                      'dispute_authorization',
                      'call_recording',
                      'marketing_use',
                      'property_report_consent'));
  END IF;
END $$;

COMMENT ON CONSTRAINT client_consents_kind_check ON client_consents IS
  'Closed set: soft_pull_consent (credit-report pull), dispute_authorization (prepare letters and complaint drafts), call_recording (record this conversation), marketing_use (use my words, voice and likeness in advertising) and property_report_consent (obtain my CRS/PitchPoint property ownership report; separate from credit, never ordered by itself). New kinds need a migration.';

CREATE TABLE IF NOT EXISTS public.crs_property_consents (
  consent_id uuid PRIMARY KEY REFERENCES public.client_consents(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  identity_version_fingerprint char(64) NOT NULL CHECK (identity_version_fingerprint ~ '^[a-f0-9]{64}$')
);
CREATE OR REPLACE FUNCTION public.crs_property_consent_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.client_consents c WHERE c.id=NEW.consent_id
    AND c.org_id=NEW.org_id AND c.client_id=NEW.client_id AND c.kind='property_report_consent'
    AND c.granted_by_kind='client') THEN
    RAISE EXCEPTION 'property consent scope mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crs_property_consent_scope ON public.crs_property_consents;
CREATE TRIGGER crs_property_consent_scope BEFORE INSERT ON public.crs_property_consents
  FOR EACH ROW EXECUTE FUNCTION public.crs_property_consent_scope();
ALTER TABLE public.crs_property_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crs_property_consents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.crs_property_consents FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='fundhub_app') THEN
    REVOKE ALL ON public.crs_property_consents FROM fundhub_app;
    GRANT SELECT, INSERT ON public.crs_property_consents TO fundhub_app;
    DROP POLICY IF EXISTS crs_property_consents_app ON public.crs_property_consents;
    CREATE POLICY crs_property_consents_app ON public.crs_property_consents TO fundhub_app
      USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.crs_property_requests
  ADD COLUMN IF NOT EXISTS consent_source text NOT NULL DEFAULT 'staff' CHECK (consent_source IN ('staff','client')),
  ADD COLUMN IF NOT EXISTS client_consent_id uuid REFERENCES public.client_consents(id);
ALTER TABLE public.crs_property_requests DROP CONSTRAINT IF EXISTS crs_property_request_consent_source_ck;
ALTER TABLE public.crs_property_requests ADD CONSTRAINT crs_property_request_consent_source_ck CHECK (
    (consent_source='staff' AND client_consent_id IS NULL) OR
    (consent_source='client' AND client_consent_id IS NOT NULL));
CREATE OR REPLACE FUNCTION public.crs_property_request_client_consent_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.consent_source,NEW.client_consent_id) IS DISTINCT FROM (OLD.consent_source,OLD.client_consent_id) THEN
    RAISE EXCEPTION 'property consent source is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND NEW.consent_source='client' AND NOT EXISTS (
    SELECT 1 FROM public.client_consents c JOIN public.crs_property_consents p ON p.consent_id=c.id
    WHERE c.id=NEW.client_consent_id AND c.org_id=NEW.org_id AND c.client_id=NEW.client_id
      AND c.kind='property_report_consent' AND c.granted_by_kind='client'
      AND p.identity_version_fingerprint=NEW.identity_version_fingerprint
      AND c.consent_version=NEW.consent_version AND c.consent_text=NEW.consent_text
      AND c.revoked_at IS NULL AND c.granted_at<=now() AND (c.expires_at IS NULL OR c.expires_at>now())
  ) THEN RAISE EXCEPTION 'property client consent invalid' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crs_property_request_client_consent_scope ON public.crs_property_requests;
CREATE TRIGGER crs_property_request_client_consent_scope BEFORE INSERT OR UPDATE ON public.crs_property_requests
  FOR EACH ROW EXECUTE FUNCTION public.crs_property_request_client_consent_scope();
