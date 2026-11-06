BEGIN;
ALTER TABLE blueprint_client_services ADD COLUMN IF NOT EXISTS completion_checked_at timestamptz;
CREATE INDEX IF NOT EXISTS blueprint_paid_service_completion_due ON blueprint_client_services(completion_checked_at NULLS FIRST,id)
 WHERE state='in_progress' AND service_kind<>'credit_pull';
ALTER TABLE paid_service_requests DROP CONSTRAINT IF EXISTS paid_service_requests_produced_kind_ck;
ALTER TABLE paid_service_requests ADD CONSTRAINT paid_service_requests_produced_kind_ck CHECK
 (produced_kind IS NULL OR produced_kind IN ('dispute_case','crs_result','funding_application','letter_mailing_batch',
   'inquiry_case','dispute_response','repair_program','funding_round'));
COMMIT;
