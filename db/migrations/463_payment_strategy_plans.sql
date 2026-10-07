-- 463_payment_strategy_plans.sql — the payment strategy a client chose.
--
-- FinanceOS wave 5, unit W4 (ops/workflows/finance-os-wave5-2026-10-06.md).
-- Owner, 2026-10-06: "real-time feedback on payment strategies; calculations
-- showing how to reduce payments and timelines to achieve goals."
--
-- "Save this plan" on the Strategy section (POST /api/money/strategy,
-- src/finance/payment-strategy.mjs) writes one row here. Its milestones become
-- pins on the FinanceOS timeline (src/finance/plan-sources/payoff.mjs):
-- "Pay Business Amex down to $2,500 by Oct 6, 2027", "Pay off SBA Loan by …",
-- "Card use under 10% overall by …", "Debt-free by …".
--
-- WHY A NEW TABLE. Nothing stores a chosen payoff plan today. The Blueprint
-- waypoint tables (361/362) are a checklist the overdue chaser
-- (waypoint-nudge) TEXTS clients about; a payoff step stored there would start
-- texting people the moment a plan was saved. clients.custom_fields keeps no
-- history and no constraints. So: one table, one active plan per client.
--
-- THE RULES LIVE HERE, NOT IN THE SCREEN (CLAUDE.md §3a):
--   * method is avalanche | utilization | snowball.
--   * monthly_cents is a whole number of cents above zero.
--   * a goal is a kind AND a date, or neither.
--   * cash_check is safe | partial | unknown. There is NO 'over': a plan whose
--     first month is more than the client's cash can cover (src/banking/
--     cashflow.mjs) is refused by the server, and this column refuses it again.
--   * one active plan per client (superseded_at IS NULL). Saving a new plan
--     marks the old one superseded in the same statement. Nothing is deleted:
--     the old plans are the history of what the client chose.
--
-- MONEY IS INTEGER CENTS. inputs keeps the debts the plan was built from
-- (balance, limit, APR, minimum as they were that day) so a pin can always say
-- what it was based on; milestones keeps the dated steps exactly as shown.

CREATE TABLE IF NOT EXISTS payment_strategy_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  method         text NOT NULL
    CHECK (method IN ('avalanche', 'utilization', 'snowball')),
  monthly_cents  bigint NOT NULL CHECK (monthly_cents > 0),
  goal_kind      text
    CHECK (goal_kind IS NULL OR goal_kind IN ('debt_free', 'util30', 'util10')),
  goal_by        date,
  -- The day the plan starts. Month k of the plan ends k months after it.
  as_of          date NOT NULL,
  -- NULL when the plan never pays everything off within 50 years.
  debt_free_on   date,
  inputs         jsonb NOT NULL DEFAULT '[]'::jsonb,
  milestones     jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary        jsonb NOT NULL DEFAULT '{}'::jsonb,
  cash_check     text NOT NULL
    CHECK (cash_check IN ('safe', 'partial', 'unknown')),
  saved_by_kind  text NOT NULL CHECK (saved_by_kind IN ('client', 'staff')),
  -- The staff member who saved it on the client's behalf. NULL for the client.
  saved_by_id    uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  superseded_at  timestamptz,
  CONSTRAINT payment_strategy_plans_goal_pair
    CHECK ((goal_kind IS NULL) = (goal_by IS NULL)),
  CONSTRAINT payment_strategy_plans_inputs_array
    CHECK (jsonb_typeof(inputs) = 'array'),
  CONSTRAINT payment_strategy_plans_milestones_array
    CHECK (jsonb_typeof(milestones) = 'array'),
  CONSTRAINT payment_strategy_plans_summary_object
    CHECK (jsonb_typeof(summary) = 'object'),
  CONSTRAINT payment_strategy_plans_saved_by
    CHECK (saved_by_kind = 'staff' OR saved_by_id IS NULL),
  CONSTRAINT payment_strategy_plans_superseded_after
    CHECK (superseded_at IS NULL OR superseded_at >= created_at)
);

-- One active plan per client. The save is one statement: UPDATE the old row's
-- superseded_at, then INSERT the new one (src/finance/payment-strategy.mjs).
CREATE UNIQUE INDEX IF NOT EXISTS payment_strategy_plans_one_active
  ON payment_strategy_plans (org_id, client_id) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS payment_strategy_plans_client_idx
  ON payment_strategy_plans (org_id, client_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row-level security — the same shape clarity_payments (443) carries.
-- ENABLE + FORCE + one permissive policy; isolation lives in the app layer
-- (every read and write filters on org_id AND client_id from the session).
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_strategy_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_strategy_plans FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'payment_strategy_plans' AND policyname = 'payment_strategy_plans_app_all') THEN
    CREATE POLICY payment_strategy_plans_app_all ON public.payment_strategy_plans USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.payment_strategy_plans TO fundhub_app;
  END IF;
END $$;
