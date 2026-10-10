-- 443_clarity_payments.sql — money a client owes Fundhub, paid over time, and
-- the log of what the money helper did about it.
--
-- Owner-set 2026-10-06 (docs/finance/finance-os-direction-2026-10-06.md): a
-- CLARITY PAYMENT is any debt a client owes to Fundhub LLC or one of its
-- subsidiaries, including buy now, pay later (BNPL) plans. Track each one; when
-- a payment is late, the money helper checks in first, then a person (the CSM)
-- takes over.
--
-- WHY NEW TABLES AND NOT `invoices`. invoices (017, grown by 031) is the AR
-- model for money owed to Fundhub, but it is one amount with one due date and
-- its own text ladder (src/workflows/ar-collections.mjs, success fees only). A
-- Clarity Payment is a SCHEDULE: several installments, each with its own due
-- date and its own paid amount, owed to a named Fundhub company. So the plan
-- gets its own table and LINKS to an invoice when one exists
-- (clarity_payments.invoice_id). A linked plan is never texted by the money
-- helper — the AR ladder already owns that invoice (src/finance/money-agent.mjs).
--
-- MONEY IS INTEGER CENTS. NULL is never used for an amount here: every amount
-- on a plan is known at the moment it is written.
--
-- THE RULES LIVE HERE, NOT IN THE SCREEN:
--   * kind is clarity | bnpl | other.
--   * status is open | settled | cancelled; settled has a settled_at.
--   * an installment never records more paid than it is for, and a fully paid
--     one carries paid_at.
--   * the installments of a plan add up to the plan's original amount, exactly.
--     A deferred constraint trigger checks it at commit, so a plan and its
--     schedule are written in ONE statement (src/finance/clarity-payments.mjs).

-- ---------------------------------------------------------------------------
-- clarity_payments — one plan
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clarity_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- Fundhub LLC, or the named subsidiary the money is owed to.
  owed_to         text NOT NULL DEFAULT 'Fundhub LLC'
    CHECK (length(btrim(owed_to)) BETWEEN 1 AND 120),
  kind            text NOT NULL
    CHECK (kind IN ('clarity', 'bnpl', 'other')),
  -- What the client calls it, e.g. "Funding program balance".
  label           text CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 120),
  original_cents  bigint NOT NULL CHECK (original_cents > 0),
  status          text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'settled', 'cancelled')),
  settled_at      timestamptz,
  invoice_id      uuid REFERENCES invoices(id),
  external_ref    text,
  notes           text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clarity_payments_settled_ck
    CHECK ((status = 'settled') = (settled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS clarity_payments_client_idx ON clarity_payments (org_id, client_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS clarity_payments_org_external_ref_uniq
  ON clarity_payments (org_id, external_ref) WHERE external_ref IS NOT NULL;

-- ---------------------------------------------------------------------------
-- clarity_payment_installments — the schedule
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clarity_payment_installments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  clarity_payment_id  uuid NOT NULL REFERENCES clarity_payments(id) ON DELETE CASCADE,
  seq                 integer NOT NULL CHECK (seq >= 1),
  due_on              date NOT NULL,
  amount_cents        bigint NOT NULL CHECK (amount_cents > 0),
  paid_cents          bigint NOT NULL DEFAULT 0
    CHECK (paid_cents >= 0),
  paid_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clarity_installments_seq_uniq UNIQUE (clarity_payment_id, seq),
  CONSTRAINT clarity_installments_not_overpaid_ck CHECK (paid_cents <= amount_cents),
  CONSTRAINT clarity_installments_paid_at_ck
    CHECK (paid_cents < amount_cents OR paid_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS clarity_installments_plan_idx
  ON clarity_payment_installments (clarity_payment_id, seq);
CREATE INDEX IF NOT EXISTS clarity_installments_open_due_idx
  ON clarity_payment_installments (org_id, due_on) WHERE paid_cents < amount_cents;

-- The schedule adds up to the plan. Checked at COMMIT (deferred), so the plan
-- row and its installments can be written together in one statement.
CREATE OR REPLACE FUNCTION clarity_payment_schedule_matches() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  pid   uuid;
  orig  bigint;
  total bigint;
  n     integer;
BEGIN
  IF TG_TABLE_NAME = 'clarity_payments' THEN
    pid := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    pid := OLD.clarity_payment_id;
  ELSE
    pid := NEW.clarity_payment_id;
  END IF;

  SELECT original_cents INTO orig FROM clarity_payments WHERE id = pid;
  IF NOT FOUND THEN
    RETURN NULL; -- the plan itself is gone (cascade); nothing left to check
  END IF;

  SELECT COALESCE(sum(amount_cents), 0), count(*)
    INTO total, n
    FROM clarity_payment_installments
   WHERE clarity_payment_id = pid;

  IF n = 0 OR total <> orig THEN
    RAISE EXCEPTION 'clarity payment % schedule adds up to % cents, plan is % cents', pid, total, orig
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'clarity_payments_schedule_ck') THEN
    CREATE CONSTRAINT TRIGGER clarity_payments_schedule_ck
      AFTER INSERT OR UPDATE OF original_cents ON clarity_payments
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION clarity_payment_schedule_matches();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'clarity_installments_schedule_ck') THEN
    CREATE CONSTRAINT TRIGGER clarity_installments_schedule_ck
      AFTER INSERT OR UPDATE OF amount_cents, clarity_payment_id OR DELETE ON clarity_payment_installments
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION clarity_payment_schedule_matches();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'clarity_payments_updated_at') THEN
    CREATE TRIGGER clarity_payments_updated_at
      BEFORE UPDATE ON clarity_payments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'clarity_installments_updated_at') THEN
    CREATE TRIGGER clarity_installments_updated_at
      BEFORE UPDATE ON clarity_payment_installments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- money_agent_log — every step the money helper (or a person) took
-- ---------------------------------------------------------------------------
-- The page's "What your money helper did" reads this. It is also the CLAIM:
-- the row is written BEFORE any text is queued (the order src/nudge/run.mjs
-- uses), and two unique indexes make the caps impossible to break:
--   * one row per idempotency_key — each rung of each item happens once, ever;
--   * one client text per client per day — texts_client rows are unique on
--     (client_id, decided_on). A second late item waits for tomorrow.
CREATE TABLE IF NOT EXISTS money_agent_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  item_kind        text NOT NULL
    CHECK (item_kind IN ('clarity_installment', 'clarity_payment', 'card_due', 'client')),
  item_id          uuid,
  item_label       text,
  decided_on       date NOT NULL,
  action           text NOT NULL
    CHECK (action IN ('reminder', 'late_check_in', 'second_check_in', 'csm_task', 'held',
                      'plan_added', 'payment_recorded', 'plan_settled', 'asked_for_person')),
  actor            text NOT NULL DEFAULT 'agent'
    CHECK (actor IN ('agent', 'staff', 'client')),
  -- Which brain decided: 'rules' today; an AI brain later names itself here.
  brain            text,
  reason           text,
  texts_client     boolean NOT NULL DEFAULT false,
  template_key     text,
  message_status   text,
  task_id          uuid,
  amount_cents     bigint CHECK (amount_cents IS NULL OR amount_cents >= 0),
  idempotency_key  text,
  detail           jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT money_agent_log_brain_ck CHECK ((actor = 'agent') = (brain IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS money_agent_log_idem_uniq
  ON money_agent_log (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS money_agent_log_one_text_per_day
  ON money_agent_log (client_id, decided_on) WHERE texts_client;
CREATE INDEX IF NOT EXISTS money_agent_log_client_idx
  ON money_agent_log (org_id, client_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row-level security — the same shape waypoint_nudges (371) carries.
-- ENABLE + FORCE + one permissive policy; isolation lives in the app layer.
-- ---------------------------------------------------------------------------
ALTER TABLE public.clarity_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clarity_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.clarity_payment_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clarity_payment_installments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.money_agent_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_agent_log FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'clarity_payments' AND policyname = 'clarity_payments_app_all') THEN
    CREATE POLICY clarity_payments_app_all ON public.clarity_payments USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'clarity_payment_installments' AND policyname = 'clarity_payment_installments_app_all') THEN
    CREATE POLICY clarity_payment_installments_app_all ON public.clarity_payment_installments USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'money_agent_log' AND policyname = 'money_agent_log_app_all') THEN
    CREATE POLICY money_agent_log_app_all ON public.money_agent_log USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.clarity_payments TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON public.clarity_payment_installments TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON public.money_agent_log TO fundhub_app;
  END IF;
END $$;
