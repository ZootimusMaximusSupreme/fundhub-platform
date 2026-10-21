-- 494: every bank decision and every "Doesn't count / Count again" names the exact staff member.
--
-- Owner ask (2026-10-20, Set A items 18-20): the record of a Bank yes, Bank no, Doesn't count or
-- Count again must name the exact application and the staff member who pressed it, and the
-- Doesn't count / Count again record must keep the reason the person typed.
--
-- created_by already holds a typed name (name, else email). A name can repeat and can change, so
-- the decision now also keeps the staff row's id. The rules live here, in the database:
--   * bank_decision, approval_excluded and approval_reinstated rows need a staff id and a name;
--   * approval_excluded and approval_reinstated rows need a reason (notes).
-- NOT VALID: rows saved before today are left as they are (production holds none, measured
-- 2026-10-20 read-only). Every new row is checked.

ALTER TABLE public.application_decisions
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff(id);

COMMENT ON COLUMN public.application_decisions.staff_id IS
  'The staff member who pressed the button. Required for bank_decision, approval_excluded and approval_reinstated rows.';

CREATE INDEX IF NOT EXISTS application_decisions_staff_idx
  ON public.application_decisions (org_id, staff_id)
  WHERE staff_id IS NOT NULL;

ALTER TABLE public.application_decisions
  DROP CONSTRAINT IF EXISTS application_decisions_actor_ck,
  DROP CONSTRAINT IF EXISTS application_decisions_reason_ck;

ALTER TABLE public.application_decisions
  ADD CONSTRAINT application_decisions_actor_ck CHECK (
    event_type NOT IN ('bank_decision', 'approval_excluded', 'approval_reinstated')
    OR (staff_id IS NOT NULL AND NULLIF(btrim(COALESCE(created_by, '')), '') IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT application_decisions_reason_ck CHECK (
    event_type NOT IN ('approval_excluded', 'approval_reinstated')
    OR NULLIF(btrim(COALESCE(notes, '')), '') IS NOT NULL
  ) NOT VALID;
