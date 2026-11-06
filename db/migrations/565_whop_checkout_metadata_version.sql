BEGIN;

-- Existing/outstanding reservations use their original schema. New Whop writers
-- select version 2 explicitly, before paying or transmitting anything.
ALTER TABLE public.payment_links ADD COLUMN whop_metadata_version smallint NOT NULL DEFAULT 1
  CHECK (whop_metadata_version IN (1,2) AND (whop_metadata_version=1 OR provider='whop'));
ALTER TABLE public.blueprint_client_services ADD COLUMN whop_metadata_version smallint NOT NULL DEFAULT 1
  CHECK (whop_metadata_version IN (1,2) AND (whop_metadata_version=1 OR checkout_provider IS NOT DISTINCT FROM 'whop'));

CREATE FUNCTION public.whop_checkout_metadata_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Whop reserved checkout identity is immutable' USING ERRCODE='23514';
END $$;

CREATE TRIGGER whop_link_metadata_immutable BEFORE UPDATE ON public.payment_links
FOR EACH ROW WHEN (
  OLD.whop_metadata_version IS DISTINCT FROM NEW.whop_metadata_version
  OR (OLD.provider='whop' AND OLD.provider IS DISTINCT FROM NEW.provider)
  OR (OLD.whop_metadata_version=2 AND (
    (OLD.id,OLD.org_id,OLD.client_id,OLD.product_id,OLD.amount_cents,OLD.currency,OLD.link_ref)
      IS DISTINCT FROM (NEW.id,NEW.org_id,NEW.client_id,NEW.product_id,NEW.amount_cents,NEW.currency,NEW.link_ref)
    OR (OLD.whop_checkout_configuration_id IS NOT NULL AND OLD.whop_checkout_configuration_id IS DISTINCT FROM NEW.whop_checkout_configuration_id)
    OR (OLD.whop_plan_id IS NOT NULL AND OLD.whop_plan_id IS DISTINCT FROM NEW.whop_plan_id)
    OR (OLD.whop_payment_id IS NOT NULL AND OLD.whop_payment_id IS DISTINCT FROM NEW.whop_payment_id)
  ))
) EXECUTE FUNCTION public.whop_checkout_metadata_immutable();
CREATE TRIGGER whop_service_metadata_immutable BEFORE UPDATE OF whop_metadata_version ON public.blueprint_client_services
FOR EACH ROW WHEN (OLD.checkout_provider IS NOT NULL AND OLD.whop_metadata_version IS DISTINCT FROM NEW.whop_metadata_version)
EXECUTE FUNCTION public.whop_checkout_metadata_immutable();

COMMIT;
