-- A dial log is reversible without erasing the original action or another call.
CREATE TABLE IF NOT EXISTS public.setter_dial_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_order bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  setter_staff_id uuid NOT NULL REFERENCES public.staff(id),
  operation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  phoenix_day date NOT NULL,
  attempt_before integer NOT NULL CHECK (attempt_before >= 0),
  attempt_after integer NOT NULL CHECK (attempt_after = attempt_before + 1),
  day_before integer NOT NULL CHECK (day_before >= 0),
  day_after integer NOT NULL CHECK (day_after = day_before + 1),
  prior_dialed_at timestamptz,
  undo_until timestamptz NOT NULL,
  undo_blocked_at timestamptz,
  reversed_at timestamptz,
  reversed_by_staff_id uuid REFERENCES public.staff(id),
  UNIQUE (org_id, setter_staff_id, operation_id)
);
CREATE INDEX IF NOT EXISTS ix_setter_dial_events_latest
  ON public.setter_dial_events (org_id, setter_staff_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_setter_dial_events_client
  ON public.setter_dial_events (org_id, client_id, event_order DESC);

CREATE TABLE IF NOT EXISTS public.setter_dial_reversals (
  event_id uuid PRIMARY KEY REFERENCES public.setter_dial_events(event_id),
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  actor_staff_id uuid NOT NULL REFERENCES public.staff(id),
  reversed_at timestamptz NOT NULL
);

ALTER TABLE public.setter_dial_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setter_dial_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.setter_dial_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setter_dial_reversals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.setter_dial_events, public.setter_dial_reversals FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    -- Override104's default broad table grants: original events stay immutable
    -- except the three explicit reversal fields; audit reversals are append-only.
    REVOKE ALL ON public.setter_dial_events, public.setter_dial_reversals FROM fundhub_app;
    GRANT SELECT, INSERT ON public.setter_dial_events TO fundhub_app;
    GRANT UPDATE (undo_blocked_at, reversed_at, reversed_by_staff_id) ON public.setter_dial_events TO fundhub_app;
    GRANT SELECT, INSERT ON public.setter_dial_reversals TO fundhub_app;
    CREATE POLICY setter_dial_events_app ON public.setter_dial_events
      TO fundhub_app USING (true) WITH CHECK (true);
    CREATE POLICY setter_dial_reversals_app ON public.setter_dial_reversals
      TO fundhub_app USING (true) WITH CHECK (true);
  END IF;
END $$;
