-- Explicit $97 selected-letter mailing batches; separate from fresh dispute rounds.
ALTER TABLE public.paid_service_requests DROP CONSTRAINT paid_service_requests_kind_ck;
ALTER TABLE public.paid_service_requests ADD CONSTRAINT paid_service_requests_kind_ck
  CHECK (service_kind IN ('dispute_round','credit_pull','funding_application','letter_mailing'));

ALTER TABLE public.paid_service_requests DROP CONSTRAINT paid_service_requests_produced_kind_ck;
ALTER TABLE public.paid_service_requests ADD CONSTRAINT paid_service_requests_produced_kind_ck
  CHECK (produced_kind IS NULL OR produced_kind IN ('dispute_case','crs_result','funding_application','letter_mailing_batch'));

CREATE TABLE public.blueprint_letter_mailing_orders (
  id uuid PRIMARY KEY REFERENCES public.paid_service_requests(id),
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  quote_version text NOT NULL CHECK (quote_version ~ '^[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object' AND jsonb_typeof(snapshot->'files')='array'
    AND jsonb_array_length(snapshot->'files') BETWEEN 1 AND 6),
  state text NOT NULL DEFAULT 'quoted' CHECK (state IN ('quoted','payment_pending','awaiting_payment','mail_pending','mailing','mailed','needs_review','cancelled')),
  payment_state text NOT NULL DEFAULT 'none' CHECK (payment_state IN ('none','charging','creating_checkout','awaiting_payment','paid')),
  payment_option_id text,
  authorized_at timestamptz,
  authorized_account_id uuid REFERENCES public.accounts(id),
  authorization_text text,
  confirmation_key text,
  attempt_started_at timestamptz,
  checkout_url text,
  checkout_session_id text,
  checkout_product_id text,
  provider_payment_ref text,
  paid_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (payment_state='none' OR (authorized_at IS NOT NULL AND authorized_account_id IS NOT NULL
    AND authorization_text IS NOT NULL AND confirmation_key IS NOT NULL AND attempt_started_at IS NOT NULL)),
  CHECK (payment_state<>'paid' OR (provider_payment_ref IS NOT NULL AND paid_at IS NOT NULL)),
  CHECK (state NOT IN ('mail_pending','mailing','mailed') OR payment_state='paid')
);
CREATE UNIQUE INDEX blueprint_letter_mailing_payment_ref ON public.blueprint_letter_mailing_orders(provider_payment_ref) WHERE provider_payment_ref IS NOT NULL;
CREATE INDEX blueprint_letter_mailing_pending ON public.blueprint_letter_mailing_orders(updated_at) WHERE state IN ('payment_pending','awaiting_payment','mail_pending','mailing');
CREATE INDEX blueprint_letter_mailing_client ON public.blueprint_letter_mailing_orders(org_id,client_id,created_at DESC);

CREATE TABLE public.blueprint_letter_mailing_envelopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.blueprint_letter_mailing_orders(id),
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  document_id uuid NOT NULL REFERENCES public.documents(id),
  document_version_id uuid NOT NULL REFERENCES public.document_versions(id),
  checksum text NOT NULL CHECK (checksum ~ '^sha256:[0-9a-f]{64}$'),
  bureau text NOT NULL CHECK (bureau IN ('EX','EQ','TU')),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  state text NOT NULL DEFAULT 'ready' CHECK (state IN ('ready','sending','accepted','needs_review')),
  claim_token uuid,
  claimed_at timestamptz,
  provider_id text,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id,document_id),
  CHECK (state='ready' OR (claim_token IS NOT NULL AND claimed_at IS NOT NULL)),
  CHECK (state<>'accepted' OR (provider_id IS NOT NULL AND accepted_at IS NOT NULL))
);
-- A lost response keeps its sending/needs_review claim, even after ten minutes.
CREATE UNIQUE INDEX blueprint_letter_mailing_one_content_send
  ON public.blueprint_letter_mailing_envelopes(org_id,client_id,checksum,bureau)
  WHERE state IN ('sending','accepted','needs_review');

CREATE FUNCTION public.blueprint_letter_mailing_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='blueprint_letter_mailing_orders' THEN
    IF NOT EXISTS(SELECT 1 FROM public.paid_service_requests p WHERE p.id=NEW.id AND p.org_id=NEW.org_id
      AND p.client_id=NEW.client_id AND p.service_kind='letter_mailing' AND p.price_total_cents=9700 AND p.currency='USD') THEN
      RAISE EXCEPTION 'mailing order must match its exact scoped paid-service request' USING ERRCODE='23514';
    END IF;
    IF NEW.authorized_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.accounts a
      WHERE a.id=NEW.authorized_account_id AND a.org_id=NEW.org_id AND a.client_id=NEW.client_id AND a.kind='client' AND a.status='active') THEN
      RAISE EXCEPTION 'mailing authorization must belong to its client account' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.id,NEW.org_id,NEW.client_id,NEW.quote_version,NEW.snapshot)
      IS DISTINCT FROM (OLD.id,OLD.org_id,OLD.client_id,OLD.quote_version,OLD.snapshot) THEN
      RAISE EXCEPTION 'mailing quote and content are immutable' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND OLD.authorized_at IS NOT NULL AND (NEW.authorized_at,NEW.authorized_account_id,NEW.authorization_text,NEW.confirmation_key)
      IS DISTINCT FROM (OLD.authorized_at,OLD.authorized_account_id,OLD.authorization_text,OLD.confirmation_key) THEN
      RAISE EXCEPTION 'mailing authorization is immutable' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.blueprint_letter_mailing_orders o
      JOIN public.documents d ON d.id=NEW.document_id AND d.org_id=o.org_id AND d.client_id=o.client_id
      JOIN public.document_versions v ON v.id=NEW.document_version_id AND v.document_id=d.id AND v.org_id=d.org_id
      WHERE o.id=NEW.order_id AND o.org_id=NEW.org_id AND o.client_id=NEW.client_id AND d.kind='deliverable'
      AND d.subtype IN ('funding_inquiry_removal','funding_personal_info') AND NEW.snapshot->>'subtype'=d.subtype
      AND d.metadata->>'bureau'=NEW.bureau AND v.mime_type='application/pdf'
      AND v.checksum=NEW.checksum AND v.storage_key=NEW.snapshot->>'storageKey'
      AND NEW.snapshot->>'checksum'=NEW.checksum AND NEW.snapshot->>'versionId'=v.id::text
      AND NEW.snapshot->>'documentId'=d.id::text AND NEW.snapshot->>'bureau'=NEW.bureau) THEN
      RAISE EXCEPTION 'mailing envelope must match its exact owned document version' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.id,NEW.order_id,NEW.org_id,NEW.client_id,NEW.document_id,NEW.document_version_id,NEW.checksum,NEW.bureau,NEW.snapshot)
      IS DISTINCT FROM (OLD.id,OLD.order_id,OLD.org_id,OLD.client_id,OLD.document_id,OLD.document_version_id,OLD.checksum,OLD.bureau,OLD.snapshot) THEN
      RAISE EXCEPTION 'mailing envelope content is immutable' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND OLD.claimed_at IS NOT NULL AND (NEW.claimed_at,NEW.claim_token)
      IS DISTINCT FROM (OLD.claimed_at,OLD.claim_token) THEN
      RAISE EXCEPTION 'mailing send claim may not be cleared or replaced' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND OLD.state='accepted' AND (NEW.state,NEW.provider_id,NEW.accepted_at)
      IS DISTINCT FROM (OLD.state,OLD.provider_id,OLD.accepted_at) THEN
      RAISE EXCEPTION 'accepted mailing is irreversible' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER blueprint_letter_mailing_order_guard BEFORE INSERT OR UPDATE ON public.blueprint_letter_mailing_orders
  FOR EACH ROW EXECUTE FUNCTION public.blueprint_letter_mailing_scope_guard();
CREATE TRIGGER blueprint_letter_mailing_envelope_guard BEFORE INSERT OR UPDATE ON public.blueprint_letter_mailing_envelopes
  FOR EACH ROW EXECUTE FUNCTION public.blueprint_letter_mailing_scope_guard();
ALTER TABLE public.blueprint_letter_mailing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_letter_mailing_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_letter_mailing_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_letter_mailing_envelopes FORCE ROW LEVEL SECURITY;
CREATE POLICY blueprint_letter_mailing_orders_app ON public.blueprint_letter_mailing_orders TO fundhub_app USING (true) WITH CHECK (true);
CREATE POLICY blueprint_letter_mailing_envelopes_app ON public.blueprint_letter_mailing_envelopes TO fundhub_app USING (true) WITH CHECK (true);
REVOKE ALL ON public.blueprint_letter_mailing_orders,public.blueprint_letter_mailing_envelopes FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON public.blueprint_letter_mailing_orders,public.blueprint_letter_mailing_envelopes FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON public.blueprint_letter_mailing_orders,public.blueprint_letter_mailing_envelopes TO fundhub_app;
