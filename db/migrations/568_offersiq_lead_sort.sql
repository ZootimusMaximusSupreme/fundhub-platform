-- Internal ranking is separate from the original paid receipt and setter cache.
-- A free CRS reevaluation may replace the ranking receipt without changing the
-- existing screening outcome, identity claim, or customer-facing workflow.
ALTER TABLE public.offersiq_requests
  ADD COLUMN lead_sort_bucket text,
  ADD COLUMN lead_sort_points smallint,
  ADD COLUMN lead_sort_version text,
  ADD COLUMN lead_sort_reasons jsonb,
  ADD COLUMN lead_sort_result jsonb,
  ADD COLUMN lead_sort_receipt jsonb,
  ADD COLUMN lead_sort_updated_at timestamptz,
  ADD CONSTRAINT offersiq_lead_sort_bucket_valid CHECK (
    lead_sort_bucket IS NULL OR lead_sort_bucket IN
      ('can_not_tell', 'super_prime', 'prime', 'blueprint', 'not_fit_yet')),
  ADD CONSTRAINT offersiq_lead_sort_points_valid CHECK (
    lead_sort_points IS NULL OR lead_sort_points BETWEEN 0 AND 100),
  ADD CONSTRAINT offersiq_lead_sort_complete CHECK (
    (lead_sort_bucket IS NULL AND lead_sort_points IS NULL
      AND lead_sort_version IS NULL AND lead_sort_reasons IS NULL
      AND lead_sort_result IS NULL AND lead_sort_updated_at IS NULL)
    OR
    (status <> 'in_flight' AND lead_sort_bucket IS NOT NULL
      AND lead_sort_points IS NOT NULL AND NULLIF(btrim(lead_sort_version), '') IS NOT NULL
      AND lead_sort_reasons IS NOT NULL AND jsonb_typeof(lead_sort_reasons) = 'array'
      AND lead_sort_result IS NOT NULL AND jsonb_typeof(lead_sort_result) = 'object'
      AND lead_sort_result ?& ARRAY['bucket','version','points','reasons']
      AND jsonb_typeof(lead_sort_result->'bucket') = 'string'
      AND jsonb_typeof(lead_sort_result->'version') = 'string'
      AND jsonb_typeof(lead_sort_result->'points') = 'number'
      AND jsonb_typeof(lead_sort_result->'reasons') = 'array'
      AND lead_sort_result->>'bucket' = lead_sort_bucket
      AND lead_sort_result->>'version' = lead_sort_version
      AND lead_sort_result->'points' = to_jsonb(lead_sort_points)
      AND lead_sort_result->'reasons' = lead_sort_reasons
      AND lead_sort_updated_at IS NOT NULL)),
  ADD CONSTRAINT offersiq_lead_sort_receipt_object CHECK (
    lead_sort_receipt IS NULL OR jsonb_typeof(lead_sort_receipt) = 'object');

CREATE INDEX ix_offersiq_requests_lead_sort
  ON public.offersiq_requests (org_id, lead_sort_bucket, lead_sort_points DESC)
  WHERE status <> 'in_flight';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT UPDATE (lead_sort_bucket, lead_sort_points, lead_sort_version,
      lead_sort_reasons, lead_sort_result, lead_sort_receipt, lead_sort_updated_at)
      ON public.offersiq_requests TO fundhub_app;
  END IF;
END $$;
