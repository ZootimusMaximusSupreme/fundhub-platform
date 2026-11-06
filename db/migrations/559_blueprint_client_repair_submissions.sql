CREATE TABLE public.blueprint_repair_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  letter_id uuid NOT NULL UNIQUE REFERENCES public.dispute_letters(id),
  requested_account_id uuid NOT NULL REFERENCES public.accounts(id),
  receipt_document_id uuid NOT NULL REFERENCES public.documents(id),
  submission_reference text NOT NULL CHECK (length(btrim(submission_reference)) > 0),
  channel text NOT NULL CHECK (channel IN ('mail','portal')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.check_blueprint_repair_submission_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.dispute_letters l WHERE l.id = NEW.letter_id
      AND l.org_id = NEW.org_id AND l.client_id = NEW.client_id)
    OR NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = NEW.receipt_document_id
      AND d.org_id = NEW.org_id AND d.client_id = NEW.client_id)
    OR NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = NEW.requested_account_id
      AND a.org_id = NEW.org_id AND a.client_id = NEW.client_id AND a.kind = 'client') THEN
    RAISE EXCEPTION 'repair submission identity mismatch' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'repair submission receipt is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER blueprint_repair_submission_scope BEFORE INSERT OR UPDATE
  ON public.blueprint_repair_submissions FOR EACH ROW EXECUTE FUNCTION public.check_blueprint_repair_submission_scope();
ALTER TABLE public.blueprint_repair_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_repair_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY blueprint_repair_submissions_app ON public.blueprint_repair_submissions
  TO fundhub_app USING (true) WITH CHECK (true);
REVOKE ALL ON public.blueprint_repair_submissions FROM PUBLIC;
GRANT SELECT, INSERT ON public.blueprint_repair_submissions TO fundhub_app;
