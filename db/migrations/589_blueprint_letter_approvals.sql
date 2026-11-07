-- 589_blueprint_letter_approvals.sql — the client approves each letter and
-- checks its mailing address before mailing (Finance OS unit CYCLE).
--
-- OWNER-SET 2026-11-07 (Chris, the client fulfillment cycle): "letters
-- generated → the client views each letter → approves it → prints it → sees the
-- exact bureau mailing address and double-checks it → mails it (or picks the $97
-- 'we mail it')".
--
-- ONE ROW PER LETTER VERSION. A regenerated letter is a new version and needs a
-- new approval; an approval never carries over to words the client did not read.
-- approved_at is set once. address_checked_at is set once, and only after
-- approved_at (src/blueprint/fulfillment-cycle.mjs saveLetterStep refuses it
-- first; the CHECK below makes the database refuse it too).
--
-- Written only by the client's own account (POST /api/blueprint/letter-mailing,
-- actions approve_letter and check_address). Mails nothing, charges nothing.
--
-- SAFETY. Additive. One new table. RLS forced, same pattern as 559.

CREATE TABLE IF NOT EXISTS public.blueprint_letter_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  document_id uuid NOT NULL REFERENCES public.documents(id),
  document_version_id uuid NOT NULL UNIQUE REFERENCES public.document_versions(id),
  bureau text NOT NULL CHECK (bureau IN ('EX','EQ','TU')),
  approved_at timestamptz NOT NULL,
  approved_by_account_id uuid NOT NULL REFERENCES public.accounts(id),
  address_checked_at timestamptz,
  address_checked_by_account_id uuid REFERENCES public.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blueprint_letter_approvals_address_after_ck
    CHECK (address_checked_at IS NULL OR (address_checked_at >= approved_at AND address_checked_by_account_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS blueprint_letter_approvals_client_idx
  ON public.blueprint_letter_approvals (org_id, client_id);

CREATE OR REPLACE FUNCTION public.check_blueprint_letter_approval_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.documents d
      JOIN public.document_versions v ON v.document_id = d.id AND v.org_id = d.org_id
     WHERE d.id = NEW.document_id AND v.id = NEW.document_version_id
       AND d.org_id = NEW.org_id AND d.client_id = NEW.client_id)
    OR NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = NEW.approved_by_account_id
      AND a.org_id = NEW.org_id AND a.client_id = NEW.client_id AND a.kind = 'client')
    OR (NEW.address_checked_by_account_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.accounts a WHERE a.id = NEW.address_checked_by_account_id
        AND a.org_id = NEW.org_id AND a.client_id = NEW.client_id AND a.kind = 'client')) THEN
    RAISE EXCEPTION 'letter approval identity mismatch' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.org_id, NEW.client_id, NEW.document_id, NEW.document_version_id,
      NEW.bureau, NEW.approved_at, NEW.approved_by_account_id)
      IS DISTINCT FROM (OLD.org_id, OLD.client_id, OLD.document_id, OLD.document_version_id,
      OLD.bureau, OLD.approved_at, OLD.approved_by_account_id) THEN
    RAISE EXCEPTION 'letter approval is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.address_checked_at IS NOT NULL
      AND NEW.address_checked_at IS DISTINCT FROM OLD.address_checked_at THEN
    RAISE EXCEPTION 'address check is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS blueprint_letter_approval_scope ON public.blueprint_letter_approvals;
CREATE TRIGGER blueprint_letter_approval_scope BEFORE INSERT OR UPDATE
  ON public.blueprint_letter_approvals FOR EACH ROW EXECUTE FUNCTION public.check_blueprint_letter_approval_scope();

ALTER TABLE public.blueprint_letter_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_letter_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS blueprint_letter_approvals_app ON public.blueprint_letter_approvals;
CREATE POLICY blueprint_letter_approvals_app ON public.blueprint_letter_approvals
  TO fundhub_app USING (true) WITH CHECK (true);
REVOKE ALL ON public.blueprint_letter_approvals FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON public.blueprint_letter_approvals FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON public.blueprint_letter_approvals FROM authenticated;
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON public.blueprint_letter_approvals TO fundhub_app;
