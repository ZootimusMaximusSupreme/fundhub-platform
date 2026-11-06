BEGIN;
ALTER TABLE blueprint_fulfillment_engagements ADD COLUMN IF NOT EXISTS submissions_closed_at timestamptz;
ALTER TABLE blueprint_funding_operations DROP CONSTRAINT IF EXISTS blueprint_funding_operations_action_check;
ALTER TABLE blueprint_funding_operations ADD CONSTRAINT blueprint_funding_operations_action_check
 CHECK (action IN ('open_lender','report_application','finish_submissions'));

CREATE TABLE IF NOT EXISTS blueprint_bank_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 handoff_id uuid NOT NULL REFERENCES blueprint_funding_handoffs(id),
 source_kind text NOT NULL CHECK(source_kind IN ('bank_mail','posted_transaction','reviewed_document')),
 source_id uuid NOT NULL,
 source_version integer,
 reviewed_by uuid REFERENCES staff(id),
 note text NOT NULL,
 decision text NOT NULL CHECK (decision IN ('approved','declined','funded')),
 approved_amount numeric(14,2) CHECK(approved_amount>0),
 funded_amount numeric(14,2) CHECK(funded_amount>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (source_kind,source_id),
 CHECK ((funded_amount IS NOT NULL)=(decision='funded')),
 CHECK (decision<>'declined' OR approved_amount IS NULL),
 CHECK ((reviewed_by IS NOT NULL AND source_version IS NOT NULL)=(source_kind='reviewed_document'))
);
CREATE INDEX IF NOT EXISTS blueprint_evidence_handoff ON blueprint_bank_evidence(handoff_id);
ALTER TABLE blueprint_bank_evidence ENABLE ROW LEVEL SECURITY;
DO $$BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='fundhub_app') THEN
   GRANT SELECT,INSERT ON blueprint_bank_evidence TO fundhub_app;
   DROP POLICY IF EXISTS blueprint_evidence_backend ON blueprint_bank_evidence;
   CREATE POLICY blueprint_evidence_backend ON blueprint_bank_evidence TO fundhub_app USING (true) WITH CHECK (true);
 END IF;
END $$;
-- One source for app totals: separate posted disbursements can accumulate.
-- A card issuance and a statement describing that same facility cannot double
-- the amount. Only a verified approval with independently identified usable
-- funds, or a verified denial, finishes this application's part of the round.
CREATE OR REPLACE VIEW blueprint_application_proof WITH (security_invoker=true) AS
 SELECT h.id AS handoff_id,h.engagement_id,h.org_id,h.client_id,a.funding_round_id,
   a.status,a.approved_amount,
   bool_or(e.decision='declined') AS denial_confirmed,
   greatest(max(e.funded_amount),sum(e.funded_amount) FILTER(WHERE e.source_kind='posted_transaction')) AS actual_funded_amount
 FROM blueprint_funding_handoffs h JOIN applications a ON a.id=h.application_id AND a.org_id=h.org_id AND a.client_id=h.client_id
 LEFT JOIN blueprint_bank_evidence e ON e.handoff_id=h.id
 GROUP BY h.id,h.engagement_id,h.org_id,h.client_id,a.funding_round_id,a.status,a.approved_amount;

CREATE OR REPLACE FUNCTION blueprint_verified_round_totals(engagement uuid,org uuid,client uuid,round_id uuid)
RETURNS TABLE(total integer,final integer,funded numeric) LANGUAGE sql STABLE AS $$
 SELECT count(*)::integer,count(*) FILTER(WHERE (status='Denied' AND denial_confirmed) OR
        (status='Approved' AND approved_amount>0 AND actual_funded_amount>0))::integer,
        sum(actual_funded_amount) FILTER(WHERE status='Approved')
 FROM blueprint_application_proof WHERE engagement_id=engagement AND org_id=org AND client_id=client AND funding_round_id=round_id
$$;

CREATE OR REPLACE FUNCTION blueprint_guard_round_finish() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g blueprint_fulfillment_engagements%ROWTYPE; facts record;
BEGIN
 IF NEW.product='blueprint_self_funding' AND NEW.status IN ('funded','closed') AND
      (OLD.status,OLD.funded_amount) IS DISTINCT FROM (NEW.status,NEW.funded_amount) THEN
   SELECT * INTO g FROM blueprint_fulfillment_engagements WHERE funding_round_id=NEW.id AND client_id=NEW.client_id AND org_id=NEW.org_id;
   IF NOT FOUND OR g.execution_owner<>'client' THEN RETURN NEW; END IF;
   SELECT * INTO facts FROM blueprint_verified_round_totals(g.id,g.org_id,g.client_id,NEW.id);
   IF g.submissions_closed_at IS NULL OR facts.total=0 OR facts.total<>facts.final OR
      (facts.funded IS DISTINCT FROM NEW.funded_amount) OR
      (NEW.status='funded') IS DISTINCT FROM (facts.funded IS NOT NULL) THEN
     RAISE EXCEPTION 'Purchased round requires its submitted batch and verified bank outcomes';
   END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS blueprint_verified_round_finish ON funding_rounds;
CREATE TRIGGER blueprint_verified_round_finish BEFORE UPDATE OF status,funded_amount ON funding_rounds
 FOR EACH ROW EXECUTE FUNCTION blueprint_guard_round_finish();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='fundhub_app') THEN GRANT SELECT ON blueprint_application_proof TO fundhub_app; END IF;
END $$;
-- All these tables and helpers are server-owned. Supabase may have default
-- grants for generated client roles; the only app access here is fundhub_app.
DO $$
DECLARE target text; role_name text;
BEGIN
 FOREACH target IN ARRAY ARRAY['blueprint_fulfillment_engagements','blueprint_funding_handoffs',
    'blueprint_application_reports','blueprint_funding_operations','blueprint_bank_evidence','blueprint_application_proof'] LOOP
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',target);
   FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
     IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
       EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',target,role_name);
     END IF;
   END LOOP;
 END LOOP;
 FOREACH target IN ARRAY ARRAY['blueprint_guard_round_finish()','blueprint_verified_round_totals(uuid,uuid,uuid,uuid)',
  'blueprint_install_paid_engagement()','blueprint_finish_purchased_round()','blueprint_keep_completed_grants_closed()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC',target);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM %I',target,role_name);
      END IF;
    END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='fundhub_app') THEN
   REVOKE UPDATE,DELETE ON blueprint_application_reports,blueprint_funding_handoffs,blueprint_bank_evidence FROM fundhub_app;
   GRANT EXECUTE ON FUNCTION blueprint_verified_round_totals(uuid,uuid,uuid,uuid) TO fundhub_app;
 END IF;
END $$;
COMMIT;
