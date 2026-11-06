BEGIN;

INSERT INTO products (org_id,code,name,category,default_price,min_price,max_price,price_is_variable)
SELECT org_id,'blueprint-self-funding','Capital Blueprint — full implementation','consulting',
       30000,20000,30000,true
FROM products WHERE code='consulting-package'
ON CONFLICT DO NOTHING;

INSERT INTO entitlement_catalog (org_id,code,name,kind)
SELECT org_id,'blueprint-client-fulfillment','Blueprint client fulfillment','service'
FROM products WHERE code='blueprint-self-funding' ON CONFLICT DO NOTHING;

INSERT INTO product_entitlements (org_id,product_code,entitlement_code,duration_days)
SELECT org_id,'blueprint-self-funding',entitlement_code,duration_days
FROM product_entitlements WHERE product_code='consulting-package'
UNION ALL
SELECT org_id,'blueprint-self-funding','blueprint-client-fulfillment',NULL::integer
FROM products WHERE code='blueprint-self-funding'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS blueprint_fulfillment_engagements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL REFERENCES orgs(id),
 client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 source_transaction_id uuid NOT NULL UNIQUE REFERENCES transactions(id),
 source_entitlement_id uuid NOT NULL UNIQUE REFERENCES entitlements(id),
 opens_at timestamptz NOT NULL DEFAULT now(),
 funding_round_id uuid UNIQUE REFERENCES funding_rounds(id),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
 execution_owner text NOT NULL DEFAULT 'client' CHECK (execution_owner IN ('client','fundhub')),
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 CHECK ((status='completed') = (completed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS blueprint_funding_handoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 engagement_id uuid NOT NULL REFERENCES blueprint_fulfillment_engagements(id),
 org_id uuid NOT NULL REFERENCES orgs(id),
 client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 lender_id uuid NOT NULL REFERENCES lenders(id),
 business_id uuid REFERENCES businesses(id),
 application_id uuid UNIQUE NOT NULL REFERENCES applications(id),
 source_credit_report_id uuid NOT NULL REFERENCES crs_results(id),
 opened_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE NULLS NOT DISTINCT (engagement_id,lender_id,business_id)
);

CREATE TABLE IF NOT EXISTS blueprint_funding_operations (
 engagement_id uuid NOT NULL REFERENCES blueprint_fulfillment_engagements(id),
 action text NOT NULL CHECK (action IN ('open_lender','report_application')),
 request_key text NOT NULL,
 input jsonb NOT NULL,
 PRIMARY KEY (engagement_id,action,request_key)
);

CREATE TABLE IF NOT EXISTS blueprint_application_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 handoff_id uuid NOT NULL REFERENCES blueprint_funding_handoffs(id),
 reported_by uuid NOT NULL REFERENCES accounts(id),
 report_status text NOT NULL CHECK (report_status IN ('pending','approved','declined')),
 evidence_document_id uuid REFERENCES documents(id),
 reference text CHECK (length(reference) BETWEEN 1 AND 200),
 approved_amount numeric(14,2) CHECK (approved_amount > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (reference IS NOT NULL OR evidence_document_id IS NOT NULL),
 CHECK (approved_amount IS NULL OR report_status='approved'),
 UNIQUE NULLS NOT DISTINCT(handoff_id,report_status,evidence_document_id,reference,approved_amount)
);

CREATE INDEX IF NOT EXISTS blueprint_fulfillment_owner ON blueprint_fulfillment_engagements(org_id,client_id,created_at);
CREATE INDEX IF NOT EXISTS blueprint_handoff_owner ON blueprint_funding_handoffs(org_id,client_id,engagement_id);
CREATE INDEX IF NOT EXISTS blueprint_report_latest ON blueprint_application_reports(handoff_id,created_at DESC);

-- A grant only activates the product that actually paid for it. A manual or
-- unrelated grant cannot install this package. Grant replay is keyed to the receipt.
CREATE OR REPLACE FUNCTION blueprint_install_paid_engagement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.entitlement_code='blueprint-client-fulfillment' AND NEW.revoked_at IS NULL THEN
   INSERT INTO blueprint_fulfillment_engagements(org_id,client_id,source_transaction_id,source_entitlement_id)
   SELECT NEW.org_id,NEW.client_id,t.id,NEW.id FROM transactions t
   JOIN products p ON p.id=resolve_product_id(t.org_id,t.product_name) AND p.org_id=t.org_id
   WHERE t.id=NEW.source_transaction_id AND t.org_id=NEW.org_id AND t.client_id=NEW.client_id
     AND p.code='blueprint-self-funding' AND lower(btrim(t.status))='succeeded'
   ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS blueprint_paid_engagement_grant ON entitlements;
CREATE TRIGGER blueprint_paid_engagement_grant AFTER INSERT ON entitlements FOR EACH ROW
 EXECUTE FUNCTION blueprint_install_paid_engagement();

-- The purchased round closes this package alone. Existing DFY engagements can
-- still contain several rounds. The authorized record survives for readback.
CREATE OR REPLACE FUNCTION blueprint_finish_purchased_round() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('closed','funded') AND NEW.status IS DISTINCT FROM OLD.status THEN
   UPDATE blueprint_fulfillment_engagements SET status='completed',completed_at=now()
   WHERE funding_round_id=NEW.id AND org_id=NEW.org_id AND client_id=NEW.client_id AND status='active';
   UPDATE entitlements e SET revoked_at=now(),revoke_reason='purchased_round_completed',updated_at=now()
     FROM blueprint_fulfillment_engagements g
    WHERE g.funding_round_id=NEW.id AND g.org_id=NEW.org_id AND g.client_id=NEW.client_id
      AND g.status='completed' AND e.org_id=g.org_id AND e.client_id=g.client_id
      AND e.source_transaction_id=g.source_transaction_id AND e.revoked_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS blueprint_purchased_round_terminal ON funding_rounds;
CREATE TRIGGER blueprint_purchased_round_terminal AFTER UPDATE OF status ON funding_rounds
 FOR EACH ROW EXECUTE FUNCTION blueprint_finish_purchased_round();

-- Replaying the original payment may try to reinstate a revoked grant.
-- A completed purchase cannot start itself again or unlock its child services.
CREATE OR REPLACE FUNCTION blueprint_keep_completed_grants_closed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE finished timestamptz;
BEGIN
 IF NEW.revoked_at IS NULL AND NEW.source_transaction_id IS NOT NULL THEN
   SELECT completed_at INTO finished FROM blueprint_fulfillment_engagements
   WHERE org_id=NEW.org_id AND client_id=NEW.client_id AND source_transaction_id=NEW.source_transaction_id AND status='completed';
   IF finished IS NOT NULL THEN
     NEW.revoked_at=finished;
     NEW.revoke_reason='purchased_round_completed';
   END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS blueprint_completed_grant_guard ON entitlements;
CREATE TRIGGER blueprint_completed_grant_guard BEFORE INSERT OR UPDATE OF revoked_at ON entitlements
 FOR EACH ROW EXECUTE FUNCTION blueprint_keep_completed_grants_closed();

DO $$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['blueprint_fulfillment_engagements','blueprint_funding_handoffs','blueprint_application_reports','blueprint_funding_operations'] LOOP
   EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='fundhub_app') THEN
     EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO fundhub_app',tab);
     EXECUTE format('DROP POLICY IF EXISTS blueprint_backend ON %I',tab);
     EXECUTE format('CREATE POLICY blueprint_backend ON %I TO fundhub_app USING (true) WITH CHECK (true)',tab);
   END IF;
 END LOOP;
END $$;
COMMIT;
