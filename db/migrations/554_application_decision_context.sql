-- Freeze the evidence references and amounts that existed when a decision was saved.
-- Old rows remain NULL. The writer owns the application-update/audit transaction.
ALTER TABLE public.application_decisions
  ADD COLUMN IF NOT EXISTS decision_context jsonb;

COMMENT ON COLUMN public.application_decisions.decision_context IS
  'Immutable decision-time metadata and amounts; no identity fields, raw credit report or trained-model claim. NULL on historical rows.';

CREATE OR REPLACE FUNCTION public.capture_application_decision_context()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  app record;
  offer record;
  report record;
  captured timestamptz := statement_timestamp();
  cutoff timestamptz := LEAST(NEW.decided_at, statement_timestamp());
  offer_context jsonb := NULL;
  report_context jsonb := NULL;
BEGIN
  SELECT a.id, a.org_id, a.client_id, a.lender_id, a.funding_round_id,
         a.status, a.approval_excluded_at, a.requested_amount, a.approved_amount
    INTO app
    FROM public.applications a
   WHERE a.id = NEW.application_id AND a.org_id = NEW.org_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'application decision must name an application in the same organization';
  END IF;

  SELECT r.id, r.provider_request_id, r.rule_set_id, r.environment, r.status,
         r.created_at, r.finished_at
    INTO offer
    FROM public.offersiq_requests r
   WHERE r.org_id = NEW.org_id AND r.client_id = app.client_id
     AND r.environment = 'production'
     AND r.status IN ('matched', 'not_matched', 'needs_review', 'error')
     AND r.finished_at IS NOT NULL
     AND r.created_at <= cutoff AND r.finished_at <= cutoff
   ORDER BY r.finished_at DESC, r.created_at DESC, r.id DESC
   LIMIT 1;
  IF FOUND THEN
    offer_context := jsonb_build_object(
      'ledger_id', offer.id,
      'provider_request_id', offer.provider_request_id,
      'rule_set_id', offer.rule_set_id,
      'environment', offer.environment,
      'status', offer.status,
      'created_at', offer.created_at,
      'finished_at', offer.finished_at,
      'method', 'latest_completed_production_as_of_decision'
    );
  END IF;

  -- Unknown legacy provenance is not silently called production. Copy no report.
  SELECT r.id, r.created_at
    INTO report
    FROM public.crs_results r
   WHERE r.org_id = NEW.org_id AND r.client_id = app.client_id
     AND r.is_demo = false
     AND r.result->>'environment' = 'production'
     AND r.created_at <= cutoff
   ORDER BY r.created_at DESC, r.id DESC
   LIMIT 1;
  IF FOUND THEN
    report_context := jsonb_build_object(
      'result_id', report.id,
      'created_at', report.created_at,
      'environment', 'production',
      'method', 'latest_explicit_production_non_demo_as_of_decision'
    );
  END IF;

  -- Ignore caller-supplied context. Only the stored same-org application supplies facts.
  NEW.decision_context := jsonb_build_object(
    'schema_version', 1,
    'captured_at', captured,
    'org_id', app.org_id,
    'application_id', app.id,
    'client_id', app.client_id,
    'lender_id', app.lender_id,
    'funding_round_id', app.funding_round_id,
    'application_status', app.status,
    'approval_excluded', app.approval_excluded_at IS NOT NULL,
    'requested_amount', app.requested_amount::text,
    'approved_amount', app.approved_amount::text,
    'offersiq', offer_context,
    'crs_result', report_context
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_application_decision_context()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.decision_context IS DISTINCT FROM OLD.decision_context THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'application decision context is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS application_decisions_capture_context ON public.application_decisions;
CREATE TRIGGER application_decisions_capture_context
  BEFORE INSERT ON public.application_decisions
  FOR EACH ROW EXECUTE FUNCTION public.capture_application_decision_context();

DROP TRIGGER IF EXISTS application_decisions_protect_context ON public.application_decisions;
CREATE TRIGGER application_decisions_protect_context
  BEFORE UPDATE OF decision_context ON public.application_decisions
  FOR EACH ROW EXECUTE FUNCTION public.protect_application_decision_context();
