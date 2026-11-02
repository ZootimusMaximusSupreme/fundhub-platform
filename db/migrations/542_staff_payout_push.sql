-- Let the existing staff iPhone alert receipt record one payout notice per
-- paid commission. No payout amount or bank detail is put on the lock screen.
ALTER TABLE public.staff_apns_alerts
  DROP CONSTRAINT IF EXISTS staff_apns_alerts_kind_check;

ALTER TABLE public.staff_apns_alerts
  ADD CONSTRAINT staff_apns_alerts_kind_check
  CHECK (kind IN ('lead', 'set', 'upcoming', 'payout'));
