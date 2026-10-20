-- 482_ad_watch_diagnosis_read_indexes.sql
--
-- The ad detail screen reads one company's saved watch-curve diagnoses by
-- joining diagnoses -> daily metrics -> ads. Without tenant-first indexes,
-- Postgres can merge two primary-key indexes and walk all daily metric rows.
-- Keep both the filtered diagnosis side and the joined metric side bounded to
-- the company before following their ids.

CREATE INDEX IF NOT EXISTS ad_watch_curve_diagnoses_org_metrics_idx
  ON public.ad_watch_curve_diagnoses (org_id, ad_metrics_daily_id);

CREATE INDEX IF NOT EXISTS ad_metrics_daily_org_id_idx
  ON public.ad_metrics_daily (org_id, id);
