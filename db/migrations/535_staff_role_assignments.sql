-- A staff member keeps staff.role as the primary role. Additional roles are
-- explicit, org-bound assignments; none are inferred from a client or partner.
-- The catalog's active flag is checked when a session is resolved.

CREATE UNIQUE INDEX IF NOT EXISTS staff_org_id_uniq
  ON public.staff (org_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS staff_roles_org_id_uniq
  ON public.staff_roles (org_id, id);

CREATE TABLE IF NOT EXISTS public.staff_role_assignments (
  org_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, role_id),
  CONSTRAINT staff_role_assignments_staff_fk
    FOREIGN KEY (org_id, staff_id) REFERENCES public.staff (org_id, id) ON DELETE CASCADE,
  CONSTRAINT staff_role_assignments_role_fk
    FOREIGN KEY (org_id, role_id) REFERENCES public.staff_roles (org_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS staff_role_assignments_org_staff_idx
  ON public.staff_role_assignments (org_id, staff_id);

DROP TRIGGER IF EXISTS staff_role_assignments_updated_at ON public.staff_role_assignments;
CREATE TRIGGER staff_role_assignments_updated_at
  BEFORE UPDATE ON public.staff_role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.staff_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_role_assignments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_role_assignments FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.staff_role_assignments FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.staff_role_assignments FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT ON public.staff_role_assignments TO fundhub_app;
    CREATE POLICY staff_role_assignments_app_read ON public.staff_role_assignments
      FOR SELECT TO fundhub_app USING (true);
  END IF;
END $$;
