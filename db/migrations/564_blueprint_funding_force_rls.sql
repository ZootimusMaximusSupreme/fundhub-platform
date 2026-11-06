BEGIN;

ALTER TABLE public.blueprint_fulfillment_engagements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_funding_handoffs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_application_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_funding_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_bank_evidence FORCE ROW LEVEL SECURITY;

COMMIT;
