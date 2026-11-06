-- Optional paid help retains its exact work and accepted quote across payment rails.
ALTER TABLE public.blueprint_client_services
  ADD COLUMN checkout_provider text CHECK (checkout_provider IN ('commas','whop')),
  ADD COLUMN accepted_price_cents bigint CHECK (accepted_price_cents > 0),
  ADD COLUMN checkout_currency text CHECK (checkout_currency = 'USD'),
  ADD COLUMN whop_account_id text,
  ADD COLUMN whop_product_id text,
  ADD COLUMN whop_checkout_configuration_id text UNIQUE,
  ADD COLUMN whop_plan_id text UNIQUE,
  ADD COLUMN whop_payment_id text UNIQUE;
UPDATE public.blueprint_client_services s SET checkout_provider='commas',
  accepted_price_cents=p.price_total_cents,checkout_currency='USD'
  FROM public.paid_service_requests p WHERE p.id=s.id AND s.authorized_at IS NOT NULL;
ALTER TABLE public.blueprint_client_services ADD CONSTRAINT blueprint_service_checkout_identity_ck CHECK (
  (checkout_provider IS NULL AND accepted_price_cents IS NULL AND checkout_currency IS NULL)
  OR (checkout_provider IS NOT NULL AND accepted_price_cents IS NOT NULL AND checkout_currency='USD'
    AND authorized_at IS NOT NULL AND authorized_account_id IS NOT NULL
    AND (checkout_provider='commas' OR (whop_account_id~'^biz_[A-Za-z0-9]+$' AND whop_account_id IS NOT NULL
      AND whop_product_id~'^prod_[A-Za-z0-9]+$' AND whop_product_id IS NOT NULL)))
);
ALTER TABLE public.blueprint_client_services ADD CONSTRAINT blueprint_service_whop_ids_ck CHECK (
  (whop_checkout_configuration_id IS NULL AND whop_plan_id IS NULL)
  OR (checkout_provider='whop' AND whop_checkout_configuration_id~'^ch_[A-Za-z0-9]+$'
    AND whop_plan_id~'^plan_[A-Za-z0-9]+$' AND whop_checkout_configuration_id IS NOT NULL AND whop_plan_id IS NOT NULL)
);
ALTER TABLE public.blueprint_client_services ADD CONSTRAINT blueprint_service_whop_payment_ck CHECK (
  whop_payment_id IS NULL OR (checkout_provider='whop' AND whop_checkout_configuration_id IS NOT NULL
    AND whop_plan_id IS NOT NULL AND whop_payment_id~'^pay_[A-Za-z0-9]+$')
);
CREATE FUNCTION public.blueprint_service_checkout_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.checkout_provider IS NOT NULL AND
    (NEW.checkout_provider,NEW.accepted_price_cents,NEW.checkout_currency,NEW.authorized_at,NEW.authorized_account_id,NEW.whop_account_id,NEW.whop_product_id)
    IS DISTINCT FROM
    (OLD.checkout_provider,OLD.accepted_price_cents,OLD.checkout_currency,OLD.authorized_at,OLD.authorized_account_id,OLD.whop_account_id,OLD.whop_product_id) THEN
    RAISE EXCEPTION 'Blueprint accepted checkout identity is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND ((OLD.whop_checkout_configuration_id IS NOT NULL AND
      (NEW.whop_checkout_configuration_id,NEW.whop_plan_id) IS DISTINCT FROM (OLD.whop_checkout_configuration_id,OLD.whop_plan_id))
    OR (OLD.whop_payment_id IS NOT NULL AND NEW.whop_payment_id IS DISTINCT FROM OLD.whop_payment_id)) THEN
    RAISE EXCEPTION 'Blueprint Whop checkout and receipt identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.checkout_provider IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.paid_service_requests p
    WHERE p.id=NEW.id AND p.org_id=NEW.org_id AND p.client_id=NEW.client_id AND p.price_total_cents=NEW.accepted_price_cents) THEN
    RAISE EXCEPTION 'Blueprint checkout requires the exact accepted quote' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER blueprint_service_checkout_identity BEFORE INSERT OR UPDATE ON public.blueprint_client_services
  FOR EACH ROW EXECUTE FUNCTION public.blueprint_service_checkout_guard();
CREATE FUNCTION public.blueprint_service_price_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.blueprint_client_services s WHERE s.id=OLD.id AND s.checkout_provider IS NOT NULL)
    AND ((NEW.price_total_cents,NEW.price_components) IS DISTINCT FROM (OLD.price_total_cents,OLD.price_components)
      OR (OLD.checkout_url IS NOT NULL AND NEW.checkout_url IS DISTINCT FROM OLD.checkout_url)) THEN
    RAISE EXCEPTION 'Blueprint accepted quote and checkout URL are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER blueprint_service_price_identity BEFORE UPDATE ON public.paid_service_requests
  FOR EACH ROW EXECUTE FUNCTION public.blueprint_service_price_guard();
