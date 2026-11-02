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
    -- Migration104 grants default write privileges to future tables. Remove
    -- those inherited privileges before installing this table's narrow API.
    REVOKE ALL ON public.staff_role_assignments FROM fundhub_app;
    GRANT SELECT ON public.staff_role_assignments TO fundhub_app;
    CREATE POLICY staff_role_assignments_app_read ON public.staff_role_assignments
      FOR SELECT TO fundhub_app USING (true);
  END IF;
END $$;

-- Only this operation can write assignments. A client-supplied staff id or role
-- claim is never authority: resolve and lock the live session's primary actor.
-- fundhub_app retains SELECT only on the table; no broad write policy/grant.
CREATE OR REPLACE FUNCTION public.set_staff_role_assignments(
  p_session_hash text, p_staff_id uuid, p_primary_role text, p_roles text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor public.staff%ROWTYPE;
  target public.staff%ROWTYPE;
  requested text[];
  answer jsonb;
BEGIN
  SELECT s.* INTO actor
    FROM public.sessions sess
    JOIN public.staff s ON s.id = sess.staff_id AND s.org_id = sess.org_id
   WHERE sess.token_hash = p_session_hash
     AND sess.revoked_at IS NULL AND sess.expires_at > now()
     AND s.status = 'active' AND s.removed_at IS NULL
     AND coalesce(to_jsonb(s)->>'active', 'true') <> 'false'
     AND s.role IN ('owner', 'admin')
   FOR UPDATE OF s, sess;
  IF actor.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', 'forbidden');
  END IF;
  SELECT target_staff.* INTO target FROM public.staff target_staff
   WHERE id = p_staff_id AND org_id = actor.org_id
     AND status = 'active' AND removed_at IS NULL
     AND coalesce(to_jsonb(target_staff)->>'active', 'true') <> 'false'
   FOR UPDATE;
  IF target.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', 'staff_not_found');
  END IF;
  -- A catalog job not rendered by this editor must not disappear on save.
  -- Refuse this limited operation rather than silently clearing other duties.
  IF EXISTS (SELECT 1 FROM public.staff_role_assignments a
    JOIN public.staff_roles sr ON sr.id = a.role_id AND sr.org_id = a.org_id
    WHERE a.staff_id = target.id AND a.org_id = actor.org_id
      AND sr.key <> ALL(ARRAY['owner','admin','sales_manager','setter','closer',
        'outbound_rep','inquiry_specialist','funding_advisor','csm']::text[])) THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'unsupported_existing_roles');
  END IF;
  IF p_roles IS NULL OR cardinality(p_roles) > 12 OR p_primary_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'invalid_roles');
  END IF;
  IF (target.role = 'owner' AND p_primary_role <> 'owner')
     OR (target.role <> 'owner' AND p_primary_role = 'owner') THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'cannot_change_owner');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff_roles
    WHERE org_id = actor.org_id AND key = p_primary_role AND active) THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'unknown_role');
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_roles) AS role_key
    WHERE role_key IS NULL OR role_key <> ALL(ARRAY[
      'sales_manager','setter','closer','outbound_rep',
      'inquiry_specialist','funding_advisor','csm'
    ]::text[]) OR NOT EXISTS (SELECT 1 FROM public.staff_roles sr
      WHERE sr.org_id = actor.org_id AND sr.key = role_key AND sr.active)) THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'unknown_additional_role');
  END IF;
  IF p_primary_role IN ('partner','client','affiliate','outbound_rep') AND cardinality(p_roles) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', 'role_cannot_stack');
  END IF;
  SELECT coalesce(array_agg(DISTINCT k ORDER BY k), ARRAY[]::text[])
    INTO requested FROM unnest(p_roles) AS k WHERE k <> p_primary_role;
  UPDATE public.staff SET role = p_primary_role
    WHERE id = target.id AND org_id = actor.org_id;
  DELETE FROM public.staff_role_assignments
    WHERE staff_id = target.id AND org_id = actor.org_id;
  INSERT INTO public.staff_role_assignments (org_id, staff_id, role_id)
    SELECT actor.org_id, target.id, sr.id FROM public.staff_roles sr
     WHERE sr.org_id = actor.org_id AND sr.key = ANY(requested) AND sr.active;
  SELECT jsonb_build_object('id',s.id,'email',s.email,'name',s.name,
    'role',s.role,'status',s.status,'roles',ARRAY[s.role] || requested)
    INTO answer FROM public.staff s WHERE s.id = target.id AND s.org_id = actor.org_id;
  RETURN jsonb_build_object('ok', true, 'staff', answer);
END;
$$;
REVOKE ALL ON FUNCTION public.set_staff_role_assignments(text,uuid,text,text[]) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.set_staff_role_assignments(text,uuid,text,text[]) FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT EXECUTE ON FUNCTION public.set_staff_role_assignments(text,uuid,text,text[]) TO fundhub_app;
  END IF;
END $$;
