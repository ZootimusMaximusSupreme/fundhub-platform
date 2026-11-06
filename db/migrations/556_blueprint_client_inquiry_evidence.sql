-- Self-run inquiry work retains submission evidence and real call receipts.
ALTER TABLE public.inquiry_log
  ADD COLUMN IF NOT EXISTS removal_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS removal_verified_report_id uuid REFERENCES public.crs_results(id),
  ADD COLUMN IF NOT EXISTS removal_verified_document_id uuid REFERENCES public.documents(id);

CREATE TABLE IF NOT EXISTS public.blueprint_inquiry_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  case_id uuid NOT NULL UNIQUE REFERENCES public.inquiry_removal_cases(id),
  requested_account_id uuid NOT NULL REFERENCES public.accounts(id),
  baseline_report_id uuid NOT NULL REFERENCES public.crs_results(id),
  baseline_items jsonb NOT NULL CHECK (jsonb_typeof(baseline_items) = 'array'),
  submission_reference text,
  receipt_document_id uuid REFERENCES public.documents(id),
  submitted_at timestamptz,
  next_check_at timestamptz,
  call_state text NOT NULL DEFAULT 'idle' CHECK (call_state IN ('idle','claimed','sent','unknown','failed')),
  call_claim uuid,
  call_id text,
  call_requested_at timestamptz,
  call_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blueprint_inquiry_submission_receipt_ck CHECK (
    (submitted_at IS NULL AND submission_reference IS NULL AND receipt_document_id IS NULL)
    OR (submitted_at IS NOT NULL AND length(btrim(submission_reference)) > 0 AND receipt_document_id IS NOT NULL)
  ),
  CONSTRAINT blueprint_inquiry_sent_call_ck CHECK (call_state <> 'sent' OR call_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS blueprint_inquiry_evidence_client_idx
  ON public.blueprint_inquiry_evidence(org_id, client_id);

CREATE OR REPLACE FUNCTION public.check_blueprint_inquiry_evidence_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.inquiry_removal_cases c WHERE c.id = NEW.case_id
      AND c.org_id = NEW.org_id AND c.client_id = NEW.client_id)
    OR NOT EXISTS (SELECT 1 FROM public.crs_results r WHERE r.id = NEW.baseline_report_id
      AND r.org_id = NEW.org_id AND r.client_id = NEW.client_id)
    OR NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = NEW.requested_account_id
      AND a.org_id = NEW.org_id AND a.client_id = NEW.client_id AND a.kind = 'client')
    OR (NEW.receipt_document_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.documents d WHERE d.id = NEW.receipt_document_id
        AND d.org_id = NEW.org_id AND d.client_id = NEW.client_id)) THEN
    RAISE EXCEPTION 'inquiry evidence identity mismatch' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND
    (NEW.org_id, NEW.client_id, NEW.case_id, NEW.requested_account_id, NEW.baseline_report_id, NEW.baseline_items)
      IS DISTINCT FROM
    (OLD.org_id, OLD.client_id, OLD.case_id, OLD.requested_account_id, OLD.baseline_report_id, OLD.baseline_items) THEN
    RAISE EXCEPTION 'inquiry evidence baseline is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS blueprint_inquiry_evidence_scope ON public.blueprint_inquiry_evidence;
CREATE TRIGGER blueprint_inquiry_evidence_scope BEFORE INSERT OR UPDATE
  ON public.blueprint_inquiry_evidence FOR EACH ROW EXECUTE FUNCTION public.check_blueprint_inquiry_evidence_scope();
ALTER TABLE public.blueprint_inquiry_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_inquiry_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY blueprint_inquiry_evidence_app ON public.blueprint_inquiry_evidence
  TO fundhub_app USING (true) WITH CHECK (true);
REVOKE ALL ON public.blueprint_inquiry_evidence FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON public.blueprint_inquiry_evidence FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON public.blueprint_inquiry_evidence FROM authenticated;
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON public.blueprint_inquiry_evidence TO fundhub_app;
