-- Paid help remains attached to the engagement and the exact existing work.
ALTER TABLE public.paid_service_requests DROP CONSTRAINT paid_service_requests_kind_ck;
ALTER TABLE public.paid_service_requests ADD CONSTRAINT paid_service_requests_kind_ck
  CHECK (service_kind IN ('dispute_round','credit_pull','funding_application','letter_mailing','blueprint_help'));
-- Blueprint help has the narrower case/round guard below. Other services keep
-- their existing one-open-request rule.
DROP INDEX public.uq_paid_service_requests_one_open;
CREATE UNIQUE INDEX uq_paid_service_requests_one_open ON public.paid_service_requests(client_id,service_kind)
  WHERE status IN ('quoted','awaiting_payment','paid','staged') AND service_kind<>'blueprint_help';

CREATE TABLE public.blueprint_client_services (
  id uuid PRIMARY KEY REFERENCES public.paid_service_requests(id),
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  engagement_id uuid NOT NULL REFERENCES public.blueprint_fulfillment_engagements(id),
  service_kind text NOT NULL CHECK (service_kind IN ('inquiry_removal','repair_round','repair_full','funding_round','credit_pull')),
  scope_type text NOT NULL CHECK (scope_type IN ('inquiry_case','dispute_case','client','funding_round','engagement')),
  target_id uuid NOT NULL,
  round_key text CHECK (round_key IS NULL OR round_key~'^R[1-6]$'),
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','quoted','checkout_pending','awaiting_payment','paid','in_progress','completed','needs_review','failed','cancelled','refunded')),
  note text,
  quote_staff_id uuid REFERENCES public.staff(id),
  quoted_at timestamptz,
  checkout_claimed_at timestamptz,
  authorized_account_id uuid REFERENCES public.accounts(id),
  authorized_at timestamptz,
  payment_ref text UNIQUE,
  fulfillment_task_id uuid REFERENCES public.tasks(id),
  soft_pull_request_id uuid REFERENCES public.soft_pull_requests(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX blueprint_client_services_client ON public.blueprint_client_services(org_id,client_id,engagement_id,created_at DESC);
CREATE UNIQUE INDEX blueprint_client_services_open_work ON public.blueprint_client_services(engagement_id,service_kind,scope_type,target_id)
  WHERE state IN ('requested','quoted','checkout_pending','awaiting_payment','paid','in_progress','needs_review') AND service_kind <> 'credit_pull';
CREATE UNIQUE INDEX blueprint_client_services_one_repair_round ON public.blueprint_client_services(engagement_id,round_key)
  WHERE service_kind='repair_round' AND state IN ('requested','quoted','checkout_pending','awaiting_payment','paid','in_progress','needs_review');

CREATE FUNCTION public.blueprint_client_service_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.blueprint_fulfillment_engagements e
    JOIN public.paid_service_requests p ON p.id=NEW.id AND p.org_id=e.org_id AND p.client_id=e.client_id
    WHERE e.id=NEW.engagement_id AND e.org_id=NEW.org_id AND e.client_id=NEW.client_id
      AND p.service_kind=CASE WHEN NEW.service_kind='credit_pull' THEN 'credit_pull' ELSE 'blueprint_help' END) THEN
    RAISE EXCEPTION 'Blueprint service must belong to its exact paid request and engagement' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.id,NEW.org_id,NEW.client_id,NEW.engagement_id,NEW.service_kind,NEW.scope_type,NEW.target_id,NEW.round_key)
    IS DISTINCT FROM (OLD.id,OLD.org_id,OLD.client_id,OLD.engagement_id,OLD.service_kind,OLD.scope_type,OLD.target_id,OLD.round_key) THEN
    RAISE EXCEPTION 'Blueprint service work identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.authorized_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.accounts a
    WHERE a.id=NEW.authorized_account_id AND a.org_id=NEW.org_id AND a.client_id=NEW.client_id AND a.kind='client' AND a.status='active') THEN
    RAISE EXCEPTION 'Blueprint service authorization must belong to its active client account' USING ERRCODE='23514';
  END IF;
  IF NEW.quote_staff_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.staff s
    WHERE s.id=NEW.quote_staff_id AND s.org_id=NEW.org_id AND s.role IN ('csm','owner','admin')) THEN
    RAISE EXCEPTION 'Blueprint service quote requires the scoped client-success role' USING ERRCODE='23514';
  END IF;
  IF (NEW.service_kind IN ('credit_pull','repair_full') AND (NEW.scope_type<>'client' OR NEW.target_id<>NEW.client_id))
    OR (NEW.service_kind='inquiry_removal' AND (NEW.scope_type<>'inquiry_case' OR NOT EXISTS (SELECT 1 FROM public.inquiry_removal_cases c
      WHERE c.id=NEW.target_id AND c.org_id=NEW.org_id AND c.client_id=NEW.client_id)))
    OR (NEW.service_kind='repair_round' AND (NEW.scope_type<>'dispute_case' OR NOT EXISTS (SELECT 1 FROM public.dispute_cases c
      WHERE c.id=NEW.target_id AND c.org_id=NEW.org_id AND c.client_id=NEW.client_id AND c.round=NEW.round_key)))
    OR (NEW.service_kind='funding_round' AND NOT EXISTS (SELECT 1 FROM public.blueprint_fulfillment_engagements e
      WHERE e.id=NEW.engagement_id AND ((NEW.scope_type='engagement' AND NEW.target_id=e.id)
        OR (NEW.scope_type='funding_round' AND NEW.target_id=e.funding_round_id)))) THEN
    RAISE EXCEPTION 'Blueprint service target must be the same owned case or round' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD.payment_ref IS NOT NULL AND NEW.payment_ref IS DISTINCT FROM OLD.payment_ref THEN
    RAISE EXCEPTION 'Blueprint service payment receipt is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER blueprint_client_service_scope BEFORE INSERT OR UPDATE ON public.blueprint_client_services
  FOR EACH ROW EXECUTE FUNCTION public.blueprint_client_service_scope_guard();
ALTER TABLE public.blueprint_client_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_client_services FORCE ROW LEVEL SECURITY;
CREATE POLICY blueprint_client_services_app ON public.blueprint_client_services TO fundhub_app USING (true) WITH CHECK (true);
REVOKE ALL ON public.blueprint_client_services FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON public.blueprint_client_services TO fundhub_app;

ALTER TABLE public.soft_pull_requests
  ADD COLUMN blueprint_engagement_id uuid REFERENCES public.blueprint_fulfillment_engagements(id),
  ADD COLUMN blueprint_service_request_id uuid REFERENCES public.blueprint_client_services(id),
  ADD COLUMN blueprint_report_kind text CHECK (blueprint_report_kind IN ('included','paid','diagnostic','paid_round'));
CREATE UNIQUE INDEX blueprint_one_report_per_paid_service ON public.soft_pull_requests(blueprint_service_request_id)
  WHERE blueprint_service_request_id IS NOT NULL;

-- The engagement lock serializes staff, client and scheduled requests alike.
CREATE FUNCTION public.blueprint_report_allowance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE engagement public.blueprint_fulfillment_engagements; service public.blueprint_client_services; last_request timestamptz; service_id uuid;
BEGIN
  SELECT * INTO engagement FROM public.blueprint_fulfillment_engagements
    WHERE org_id=NEW.org_id AND client_id=NEW.client_id ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.idempotency_key IS NOT NULL AND EXISTS (SELECT 1 FROM public.soft_pull_requests r
    WHERE r.org_id=NEW.org_id AND r.client_id=NEW.client_id AND r.idempotency_key=NEW.idempotency_key) THEN RETURN NEW; END IF;
  -- Existing one-open-request uniqueness handles a concurrent duplicate. Let
  -- the normal INSERT conflict path return that original outstanding request.
  IF EXISTS (SELECT 1 FROM public.soft_pull_requests r WHERE r.org_id=NEW.org_id AND r.client_id=NEW.client_id
    AND r.status IN ('queued','processing')) THEN RETURN NEW; END IF;
  IF NEW.idempotency_key ~ '^blueprint-service:[0-9a-f-]{36}:real$' THEN
    service_id := split_part(NEW.idempotency_key,':',2)::uuid;
    SELECT s.* INTO service FROM public.blueprint_client_services s JOIN public.paid_service_requests p ON p.id=s.id
      WHERE s.id=service_id AND s.org_id=NEW.org_id AND s.client_id=NEW.client_id AND s.service_kind='credit_pull'
        AND p.status IN ('paid','staged') AND p.paid_at IS NOT NULL AND p.payment_ref IS NOT NULL
        AND p.amount_paid_cents=p.price_total_cents AND s.authorized_at IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'blueprint_report_payment_required' USING ERRCODE='P0001'; END IF;
    NEW.blueprint_engagement_id := service.engagement_id;
    NEW.blueprint_service_request_id := service.id;
    NEW.blueprint_report_kind := 'paid';
    RETURN NEW;
  END IF;
  IF NEW.idempotency_key ~ '^diagnostic-paid:[0-9a-f-]{36}$' AND EXISTS (SELECT 1 FROM public.events ev
    WHERE ev.id::text=split_part(NEW.idempotency_key,':',2) AND ev.org_id=NEW.org_id AND ev.client_id=NEW.client_id AND ev.name='diagnostic.paid') THEN
    NEW.blueprint_engagement_id := engagement.id;
    NEW.blueprint_report_kind := 'diagnostic';
    RETURN NEW;
  END IF;
  IF NEW.idempotency_key ~ '^paid_round_pull:[0-9a-f-]{36}$' AND EXISTS (SELECT 1 FROM public.paid_service_requests p
    WHERE p.id::text=split_part(NEW.idempotency_key,':',2) AND p.org_id=NEW.org_id AND p.client_id=NEW.client_id
      AND p.service_kind='dispute_round' AND p.status IN ('paid','staged') AND p.paid_at IS NOT NULL
      AND p.payment_ref IS NOT NULL AND p.amount_paid_cents>=p.price_total_cents) THEN
    NEW.blueprint_engagement_id := engagement.id;
    NEW.blueprint_report_kind := 'paid_round';
    RETURN NEW;
  END IF;
  IF engagement.status <> 'active' OR NOT EXISTS (SELECT 1 FROM public.entitlements ent
    JOIN public.transactions t ON t.id=engagement.source_transaction_id AND t.org_id=engagement.org_id AND t.client_id=engagement.client_id
    WHERE ent.id=engagement.source_entitlement_id AND ent.org_id=engagement.org_id AND ent.client_id=engagement.client_id
      AND ent.revoked_at IS NULL AND (ent.expires_at IS NULL OR ent.expires_at>now()) AND lower(btrim(t.status))='succeeded') THEN
    -- An independently purchased FinanceOS subscription has its own access.
    IF EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.org_id=NEW.org_id AND s.client_id=NEW.client_id
      AND s.tier='finance-os' AND s.status='active' AND s.effective_from<=now()
      AND (s.effective_to IS NULL OR s.effective_to>now())
      AND (s.current_period_end IS NULL OR s.current_period_end>now())) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'blueprint_engagement_completed' USING ERRCODE='P0001';
  END IF;
  SELECT max(r.requested_at) INTO last_request FROM public.soft_pull_requests r
    WHERE r.org_id=NEW.org_id AND r.client_id=NEW.client_id AND r.blueprint_report_kind='included' AND r.status<>'cancelled'
      AND NOT EXISTS (SELECT 1 FROM public.crs_results cr WHERE cr.id=r.crs_result_id
        AND (cr.result->>'simulated'='true' OR cr.result->>'environment' IN ('sandbox','simulated')));
  IF last_request IS NOT NULL AND last_request > NEW.requested_at-interval '30 days' THEN
    RAISE EXCEPTION 'blueprint_report_payment_required' USING ERRCODE='P0001';
  END IF;
  NEW.blueprint_engagement_id := engagement.id;
  NEW.blueprint_report_kind := 'included';
  RETURN NEW;
END $$;
CREATE TRIGGER blueprint_report_allowance BEFORE INSERT ON public.soft_pull_requests
  FOR EACH ROW EXECUTE FUNCTION public.blueprint_report_allowance_guard();
