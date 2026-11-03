-- Count-only receipts for the monthly retention review and each owner-run purge.
-- No consumer identifiers, payloads, bank accounts, or credentials are stored.
-- The monthly review records what is due; it never removes customer data.
CREATE TABLE IF NOT EXISTS public.retention_run_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  run_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('review', 'apply')),
  actor_staff_id uuid,
  plan_counts jsonb NOT NULL CHECK (jsonb_typeof(plan_counts) = 'array'),
  applied_counts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(applied_counts) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retention_run_receipts_key_uq UNIQUE (org_id, kind, run_key),
  CONSTRAINT retention_run_receipts_actor_ck CHECK (
    (kind = 'review' AND actor_staff_id IS NULL AND applied_counts = '[]'::jsonb)
    OR (kind = 'apply' AND actor_staff_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS retention_run_receipts_org_created_idx
  ON public.retention_run_receipts (org_id, created_at DESC);

COMMENT ON TABLE public.retention_run_receipts IS
  'Append-only, count-only evidence. Monthly review is read-only for customer data; apply is inserted in the same transaction as a manually approved purge.';

ALTER TABLE public.retention_run_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_run_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY retention_run_receipts_app ON public.retention_run_receipts
  TO fundhub_app USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON public.retention_run_receipts TO fundhub_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.retention_run_receipts FROM fundhub_app;
