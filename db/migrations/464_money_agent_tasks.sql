-- 464_money_agent_tasks.sql — FinanceOS "Do task": the money agent's queue,
-- money that moves only as a proposal the client approves, and the log words
-- for "Ready to get funded".
--
-- FinanceOS wave 5, unit W5 (ops/workflows/finance-os-wave5-2026-10-06.md).
-- Owner (2026-10-06): "AI tells you exactly what to do; press 'Do task' to
-- assign actions to AI agents." Contract for the money agent (W6) and the
-- transfer engine (W7): docs/finance/money-agent-tasks.md.
--
-- 1. money_agent_tasks — one row per "Do task" press (src/finance/money-tasks.mjs).
--
--    assignee 'agent'   the FinanceOS money agent works it (W6 claims the row).
--    assignee 'person'  a CSM task was opened for it (staff_task_id).
--
--    A ROW THAT MOVES MONEY IS A PROPOSAL. It names the exact amount and where
--    the money goes (to_kind / to_account_id), and it starts at
--    'needs_approval'. The client approving THAT amount from an exact account
--    (from_account_id + approved_at) is the only way past it. The database
--    refuses, so no screen or agent can skip it:
--      * a money row with no amount or no destination;
--      * a money row that is 'queued' (handed straight to the agent);
--      * a money row that is 'approved', 'claimed' or 'done' without the
--        client's yes on an exact account;
--      * a money row handed to a person;
--      * an approval on a row that moves no money.
--
--    STATES
--      agent, no money   queued -> claimed -> done | failed      (queued -> cancelled)
--      agent, money      needs_approval -> approved -> claimed -> done | failed
--                        (needs_approval -> cancelled | failed)
--      person            queued -> done (its CSM task is done)   (queued -> cancelled)
--
--    ONE OPEN ROW PER TASK PER CLIENT. The partial unique index below: a second
--    press while one is open writes nothing.
--
-- 2. money_agent_log (443, 455) — four action words for the agent and the
--    "Do task" press, one for "Ready to get funded", and one item kind.
--    ANY LATER MIGRATION THAT REBUILDS EITHER CHECK MUST START FROM THE LISTS
--    BELOW, or it silently drops these words and every insert using them fails.
--
-- Additive. Re-running it is a no-op.

-- ---------------------------------------------------------------------------
-- money_agent_tasks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS money_agent_tasks (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES orgs(id),
  client_id               uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- The task's id on GET /api/money/tasks ('clarity:<installment>',
  -- 'due:<account>:<date>', 'waypoint:<id>', 'uwiq:<hash>', or a plan pin id).
  task_key                text NOT NULL
    CHECK (task_key ~ '^[a-z][a-z0-9_-]{0,40}:[A-Za-z0-9:._-]{1,200}$'),
  kind                    text NOT NULL
    CHECK (kind IN ('due', 'pay_down', 'deposit', 'open_account', 'apply', 'checkpoint', 'other')),
  title                   text NOT NULL CHECK (title ~ '[^[:space:]]'),
  why                     text,
  due_on                  date,
  -- Which reader the task came from: clarity | dues | waypoints | underwriteiq | a plan source.
  source                  text NOT NULL CHECK (source ~ '^[a-z][a-z0-9_-]{0,40}$'),
  assignee                text NOT NULL CHECK (assignee IN ('agent', 'person')),
  status                  text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'needs_approval', 'approved', 'claimed', 'done', 'failed', 'cancelled')),

  -- The proposal. Integer cents; a money row always knows its amount.
  moves_money             boolean NOT NULL DEFAULT false,
  amount_cents            bigint CHECK (amount_cents IS NULL OR amount_cents > 0),
  to_kind                 text CHECK (to_kind IS NULL OR to_kind IN ('bank_account', 'card', 'loan', 'fundhub')),
  to_account_id           uuid REFERENCES bank_accounts(id),
  -- NULL until the client picks it when they approve (W7).
  from_account_id         uuid REFERENCES bank_accounts(id),
  approved_at             timestamptz,
  approved_by_account_id  uuid REFERENCES accounts(id) ON DELETE SET NULL,

  -- assignee 'person': the CSM task this press opened.
  staff_task_id           uuid REFERENCES tasks(id) ON DELETE SET NULL,

  requested_by_kind       text NOT NULL CHECK (requested_by_kind IN ('client', 'staff')),
  requested_by_staff_id   uuid REFERENCES staff(id) ON DELETE SET NULL,

  -- The agent side (W6): which brain took it, when, and what came of it.
  claimed_by              text,
  claimed_at              timestamptz,
  done_at                 timestamptz,
  result                  jsonb,
  -- The facts the task was built from, frozen at the press (source, cite, dates).
  detail                  jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT money_agent_tasks_money_shape_ck
    CHECK (NOT moves_money OR (amount_cents IS NOT NULL AND to_kind IS NOT NULL)),
  CONSTRAINT money_agent_tasks_money_never_queued_ck
    CHECK (NOT moves_money OR status <> 'queued'),
  CONSTRAINT money_agent_tasks_money_needs_ok_ck
    CHECK (NOT moves_money
           OR status IN ('needs_approval', 'cancelled', 'failed')
           OR (approved_at IS NOT NULL AND from_account_id IS NOT NULL)),
  CONSTRAINT money_agent_tasks_approval_is_money_ck
    CHECK (moves_money OR (status NOT IN ('needs_approval', 'approved') AND approved_at IS NULL)),
  CONSTRAINT money_agent_tasks_person_no_money_ck
    CHECK (assignee = 'agent' OR NOT moves_money),
  CONSTRAINT money_agent_tasks_destination_ck
    CHECK (to_kind IS NULL OR ((to_kind = 'fundhub') = (to_account_id IS NULL))),
  CONSTRAINT money_agent_tasks_done_at_ck
    CHECK (status <> 'done' OR done_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS money_agent_tasks_one_open
  ON money_agent_tasks (org_id, client_id, task_key)
  WHERE status IN ('queued', 'needs_approval', 'approved', 'claimed');
-- The agent's queue: what it may pick up next.
CREATE INDEX IF NOT EXISTS money_agent_tasks_queue_idx
  ON money_agent_tasks (status, created_at)
  WHERE assignee = 'agent' AND status IN ('queued', 'approved');
CREATE INDEX IF NOT EXISTS money_agent_tasks_client_idx
  ON money_agent_tasks (org_id, client_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'money_agent_tasks_updated_at') THEN
    CREATE TRIGGER money_agent_tasks_updated_at
      BEFORE UPDATE ON money_agent_tasks
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Row-level security — the same shape money_agent_log carries (443):
-- ENABLE + FORCE + one permissive policy; isolation lives in the app layer,
-- which binds org_id and client_id into every read and write.
ALTER TABLE public.money_agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_agent_tasks FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'money_agent_tasks' AND policyname = 'money_agent_tasks_app_all') THEN
    CREATE POLICY money_agent_tasks_app_all ON public.money_agent_tasks USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.money_agent_tasks TO fundhub_app;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- money_agent_log — the new words. 443's and 455's lists are kept, in order.
-- ---------------------------------------------------------------------------
ALTER TABLE money_agent_log DROP CONSTRAINT IF EXISTS money_agent_log_action_check;
ALTER TABLE money_agent_log ADD CONSTRAINT money_agent_log_action_check
  CHECK (action IN ('reminder', 'late_check_in', 'second_check_in', 'csm_task', 'held',
                    'plan_added', 'payment_recorded', 'plan_settled', 'asked_for_person',
                    'payment_unmatched',
                    'task_assigned', 'task_done', 'task_failed', 'task_cancelled',
                    'ready_to_fund'));

ALTER TABLE money_agent_log DROP CONSTRAINT IF EXISTS money_agent_log_item_kind_check;
ALTER TABLE money_agent_log ADD CONSTRAINT money_agent_log_item_kind_check
  CHECK (item_kind IN ('clarity_installment', 'clarity_payment', 'card_due', 'client',
                       'money_task'));
