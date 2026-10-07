-- 466_money_transfers.sql — FinanceOS money moves: someone proposes, the
-- client says yes to that exact move, Plaid Transfer moves it, and every step
-- lands in an append-only ledger.
--
-- FinanceOS wave 5, unit W7 (ops/workflows/finance-os-wave5-2026-10-06.md).
-- Owner, 2026-10-06: "Really build the code, really build the ability to do
-- it… so we can role-play and see it work simulated." Example pin: "Oct 20:
-- open an account and deposit $20,000 to build banking history."
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE HARD RULE THIS SCHEMA CARRIES
--
-- Nothing moves without the CLIENT approving that exact transfer: the account
-- it comes from, where it goes, the amount and the date. The AI money agent,
-- the rules helper and staff can only PROPOSE. The database refuses:
--
--   * a row born past 'proposed' (money_transfers_guard, on INSERT). Approval
--     is a separate act on an existing row.
--   * a row past 'proposed' with no approval on it (money_transfers_approval_ck).
--     The approver is the transfer's own client (approved_by_client_id must
--     equal client_id, with the login that pressed it). The one other approver
--     is 'sandbox_role_play', and only on a sandbox row — a production row can
--     never carry one.
--   * a jump in the state machine — proposed straight to submitted, a settled
--     move back to approved (money_transfers_guard, on UPDATE).
--   * any change to the amount, the date, the destination or the approval once
--     the client has said yes. The one change allowed is an account going away
--     (a revoked bank login, 081's cascade, or an erasure deletes the
--     bank_accounts row): the reference goes NULL through the foreign key, the
--     row keeps its two account labels, and the ledger says so.
--   * a from account equal to the to account (money_transfers_from_ne_to), or
--     either one belonging to anybody but this client (the composite foreign
--     keys onto bank_accounts (id, client_id)).
--   * an amount of zero or less. The per-transfer and per-day caps are env
--     settings — FINANCE_OS_TRANSFER_MAX_CENTS and
--     FINANCE_OS_TRANSFER_DAILY_MAX_CENTS — checked in
--     src/finance/money-transfers.mjs. Unset means nothing can be proposed,
--     approved or sent.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE APPEND-ONLY LEDGER
--
-- money_transfer_events gets one row for every state change, and THE DATABASE
-- writes it (money_transfers_ledger, an AFTER trigger) in the same statement as
-- the change. No code path can move a status, a leg, or an account without
-- leaving a row. Who did it and why ride on the row being changed
-- (last_actor_kind, last_actor_id, last_event_type, last_event_detail,
-- last_provider_event_id) and the trigger copies them across.
--
-- Ledger rows are never changed or removed: a trigger refuses UPDATE, DELETE
-- and TRUNCATE for every role, owner included, and fundhub_app's UPDATE /
-- DELETE / TRUNCATE grants are revoked. 104_app_role.sql's default privileges
-- hand every new table to fundhub_app with all four rights, so the REVOKE is
-- the load-bearing half (363 learned that the hard way). money_transfers rows
-- are never deleted either.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY TWO LEGS
--
-- Plaid Transfer moves money between ONE linked account and Fundhub's Plaid
-- Ledger balance: a debit pulls money in, a credit pays money out
-- (https://plaid.com/docs/transfer/flow-of-funds/). So "from A to B" is a debit
-- from A into the Ledger and — once those funds are available — a credit from
-- the Ledger out to B. Each leg keeps its own Plaid ids and Plaid status
-- (debit_* / credit_*); `status` is the move as a whole. A move to Fundhub
-- itself (to_kind 'fundhub', e.g. a Clarity Payment) is the debit alone.
--
-- PLAID'S OWN LIMIT ON THIS USE (read before turning production on):
-- https://plaid.com/docs/transfer/creating-transfers/#peer-to-peer-transfers —
-- "Plaid Transfer does not support peer to peer transfers or transfers between
-- two accounts held by the same person." Sandbox runs it; production needs
-- Plaid's say-so or another rail.

-- ---------------------------------------------------------------------------
-- 1. A pair key on bank_accounts, so a transfer can prove BOTH of its accounts
--    belong to its client. id is already unique; this only lets a foreign key
--    name (id, client_id) together.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_id_client_uq
  ON public.bank_accounts (id, client_id);

-- ---------------------------------------------------------------------------
-- 2. money_transfers — one row per move the client is asked to approve
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.money_transfers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES orgs(id),
  -- NO cascade: a money record outlives a client delete (erasure de-identifies,
  -- it does not delete — src/privacy/erasure.mjs).
  client_id              uuid NOT NULL REFERENCES clients(id),

  -- Where the proposal came from. task_key is the "Do task" id from
  -- GET /api/money/tasks (docs/finance/money-agent-tasks.md, unit W5).
  -- agent_task_id is that unit's money_agent_tasks row (migration 464); there is
  -- no foreign key here because 464 is a sibling unit's file — the orchestrator
  -- adds one when both are on main.
  task_key               text CHECK (task_key IS NULL OR char_length(task_key) BETWEEN 1 AND 200),
  agent_task_id          uuid,
  kind                   text NOT NULL DEFAULT 'other'
                         CHECK (kind IN ('due', 'pay_down', 'deposit', 'open_account', 'apply', 'checkpoint', 'other')),
  purpose                text NOT NULL CHECK (char_length(btrim(purpose)) BETWEEN 1 AND 200),
  why                    text CHECK (why IS NULL OR char_length(why) <= 500),
  source                 text CHECK (source IS NULL OR char_length(source) <= 80),

  -- The move. to_kind 'fundhub' has no to account (the money stops in Fundhub's
  -- Plaid Ledger). Card and loan payments are not here: Plaid Transfer reaches
  -- only debitable checking, savings and cash management accounts
  -- (https://plaid.com/docs/transfer/creating-transfers/#account-linking).
  to_kind                text NOT NULL CHECK (to_kind IN ('bank_account', 'fundhub')),
  from_bank_account_id   uuid,
  to_bank_account_id     uuid,
  -- What the client read, kept even if the account is later removed.
  from_account_label     text CHECK (from_account_label IS NULL OR char_length(from_account_label) BETWEEN 1 AND 160),
  to_account_label       text NOT NULL CHECK (char_length(to_account_label) BETWEEN 1 AND 160),
  amount_cents           bigint NOT NULL CONSTRAINT money_transfers_amount_ck CHECK (amount_cents > 0),
  scheduled_for          date NOT NULL,

  -- Which Plaid host this row may ever reach. Fixed at proposal. A sandbox row
  -- never runs against production and the other way round.
  environment            text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  provider               text NOT NULL DEFAULT 'plaid_transfer' CHECK (provider IN ('plaid_transfer')),
  network                text NOT NULL DEFAULT 'ach' CHECK (network IN ('ach', 'same-day-ach')),

  status                 text NOT NULL DEFAULT 'proposed'
                         CHECK (status IN ('proposed', 'approved', 'authorized', 'submitted',
                                           'settled', 'failed', 'cancelled', 'declined')),
  status_reason          text CHECK (status_reason IS NULL OR char_length(status_reason) <= 300),

  proposed_by_kind       text NOT NULL CHECK (proposed_by_kind IN ('agent', 'rules', 'staff', 'client')),
  proposed_by_id         text CHECK (proposed_by_id IS NULL OR char_length(proposed_by_id) <= 120),

  -- The approval. approval_terms is the exact move the client said yes to
  -- (accounts, labels, amount, date, and the sentence on the button).
  approved_by_kind       text CHECK (approved_by_kind IS NULL OR approved_by_kind IN ('client', 'sandbox_role_play')),
  approved_by_account_id uuid,
  approved_by_client_id  uuid,
  approved_at            timestamptz,
  approval_terms         jsonb,

  -- When the debit was started. Counts the move against the per-day cap.
  started_at             timestamptz,

  -- The two Plaid legs. Status words are Plaid's TransferStatus
  -- (https://plaid.com/docs/api/products/transfer/reading-transfers/#transferget).
  debit_authorization_id    text,
  debit_authorization_decision text CHECK (debit_authorization_decision IS NULL OR
                            debit_authorization_decision IN ('approved', 'declined', 'user_action_required')),
  debit_transfer_id      text,
  debit_status           text CHECK (debit_status IS NULL OR debit_status IN
                            ('pending', 'posted', 'settled', 'funds_available', 'cancelled', 'failed', 'returned')),
  credit_authorization_id   text,
  credit_authorization_decision text CHECK (credit_authorization_decision IS NULL OR
                            credit_authorization_decision IN ('approved', 'declined', 'user_action_required')),
  credit_transfer_id     text,
  credit_status          text CHECK (credit_status IS NULL OR credit_status IN
                            ('pending', 'posted', 'settled', 'funds_available', 'cancelled', 'failed', 'returned')),

  cancelled_by_kind      text CHECK (cancelled_by_kind IS NULL OR cancelled_by_kind IN ('client', 'staff', 'system')),
  cancelled_by_id        text,
  cancelled_at           timestamptz,
  settled_at             timestamptz,

  idempotency_key        text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 100),

  -- Copied into money_transfer_events by the ledger trigger.
  last_actor_kind        text NOT NULL DEFAULT 'system'
                         CHECK (last_actor_kind IN ('client', 'staff', 'agent', 'rules', 'system', 'provider', 'sandbox_role_play')),
  last_actor_id          text,
  last_event_type        text NOT NULL DEFAULT 'proposed' CHECK (char_length(last_event_type) BETWEEN 1 AND 60),
  last_event_detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_provider_event_id bigint,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT money_transfers_idempotency_key_uq UNIQUE (idempotency_key),
  CONSTRAINT money_transfers_from_ne_to CHECK (from_bank_account_id <> to_bank_account_id),
  CONSTRAINT money_transfers_fundhub_no_account_ck CHECK (to_kind <> 'fundhub' OR to_bank_account_id IS NULL),
  CONSTRAINT money_transfers_approver_is_client_ck CHECK (approved_by_client_id IS NULL OR approved_by_client_id = client_id),
  CONSTRAINT money_transfers_approval_ck CHECK (
    status IN ('proposed', 'cancelled')
    OR (approved_at IS NOT NULL AND approval_terms IS NOT NULL AND (
          (approved_by_kind = 'client' AND approved_by_account_id IS NOT NULL AND approved_by_client_id = client_id)
       OR (approved_by_kind = 'sandbox_role_play' AND environment = 'sandbox')
    ))
  ),
  CONSTRAINT money_transfers_authorized_ck CHECK (status <> 'authorized' OR debit_authorization_id IS NOT NULL),
  CONSTRAINT money_transfers_submitted_ck CHECK (status <> 'submitted' OR debit_transfer_id IS NOT NULL),
  CONSTRAINT money_transfers_settled_ck CHECK (
    status <> 'settled' OR (settled_at IS NOT NULL AND debit_transfer_id IS NOT NULL
                            AND (to_kind = 'fundhub' OR credit_transfer_id IS NOT NULL))
  ),
  CONSTRAINT money_transfers_cancelled_ck CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  -- Both accounts must be this client's. SET NULL on just the account column
  -- (Postgres 15+) so a revoked login or an erasure can still delete the
  -- account; the transfer and its ledger stay.
  CONSTRAINT money_transfers_from_account_fk FOREIGN KEY (from_bank_account_id, client_id)
    REFERENCES public.bank_accounts (id, client_id) ON DELETE SET NULL (from_bank_account_id),
  CONSTRAINT money_transfers_to_account_fk FOREIGN KEY (to_bank_account_id, client_id)
    REFERENCES public.bank_accounts (id, client_id) ON DELETE SET NULL (to_bank_account_id)
);

CREATE INDEX IF NOT EXISTS money_transfers_client_idx
  ON public.money_transfers (org_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS money_transfers_due_idx
  ON public.money_transfers (scheduled_for) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS money_transfers_open_idx
  ON public.money_transfers (environment, status) WHERE status IN ('authorized', 'submitted');
CREATE UNIQUE INDEX IF NOT EXISTS money_transfers_debit_transfer_uq
  ON public.money_transfers (debit_transfer_id) WHERE debit_transfer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS money_transfers_credit_transfer_uq
  ON public.money_transfers (credit_transfer_id) WHERE credit_transfer_id IS NOT NULL;
-- One open move per "Do task" per client. A second press answers with the open one.
CREATE UNIQUE INDEX IF NOT EXISTS money_transfers_one_open_task_uq
  ON public.money_transfers (client_id, task_key)
  WHERE task_key IS NOT NULL AND status IN ('proposed', 'approved', 'authorized', 'submitted');

COMMENT ON TABLE public.money_transfers IS
  'FinanceOS money moves (466). Proposed by agent/rules/staff, approved only by the client (or sandbox role-play on a sandbox row), sent by Plaid Transfer as a debit leg and a credit leg. Never deleted.';
COMMENT ON COLUMN public.money_transfers.approval_terms IS
  'The exact move the client said yes to: accounts, labels, amount_cents, scheduled_for and the sentence on the button. Immutable once set.';

-- ---------------------------------------------------------------------------
-- 3. money_transfer_events — the append-only ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.money_transfer_events (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transfer_id        uuid NOT NULL REFERENCES public.money_transfers(id),
  org_id             uuid NOT NULL,
  client_id          uuid NOT NULL,
  event_type         text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 60),
  from_status        text,
  to_status          text,
  debit_status       text,
  credit_status      text,
  leg                text CHECK (leg IS NULL OR leg IN ('debit', 'credit')),
  -- Plaid's transfer event_id (https://plaid.com/docs/api/products/transfer/reading-transfers/#transfereventsync).
  provider_event_id  bigint,
  actor_kind         text NOT NULL
                     CHECK (actor_kind IN ('client', 'staff', 'agent', 'rules', 'system', 'provider', 'sandbox_role_play')),
  actor_id           text,
  detail             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS money_transfer_events_transfer_idx
  ON public.money_transfer_events (transfer_id, id);
CREATE INDEX IF NOT EXISTS money_transfer_events_client_idx
  ON public.money_transfer_events (org_id, client_id, created_at DESC);
-- A Plaid event is written once per transfer, however many times sync reads it.
CREATE UNIQUE INDEX IF NOT EXISTS money_transfer_events_provider_uq
  ON public.money_transfer_events (transfer_id, provider_event_id) WHERE provider_event_id IS NOT NULL;

COMMENT ON TABLE public.money_transfer_events IS
  'Append-only ledger of every FinanceOS money move state change (466). Written by the money_transfers_ledger trigger and by sync for Plaid events that change no status. Never updated, never deleted.';

-- ---------------------------------------------------------------------------
-- 4. money_transfer_sync_cursors — where /transfer/event/sync left off
--    Plaid's event ids are account-wide and per environment, so one cursor per
--    environment. The cursor moves in the same transaction as the events it
--    covers, so a crash re-reads rather than skips.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.money_transfer_sync_cursors (
  environment  text PRIMARY KEY CHECK (environment IN ('sandbox', 'production')),
  after_id     bigint NOT NULL DEFAULT 0 CHECK (after_id >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. The guard: what may be inserted, which status may follow which, and what
--    may never change once the client has said yes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.money_transfers_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposed' THEN
      RAISE EXCEPTION 'money_transfers: a move starts as proposed; approval is a separate step (got %)', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.approved_at IS NOT NULL OR NEW.approved_by_kind IS NOT NULL OR NEW.approval_terms IS NOT NULL
       OR NEW.started_at IS NOT NULL
       OR NEW.debit_authorization_id IS NOT NULL OR NEW.debit_transfer_id IS NOT NULL OR NEW.debit_status IS NOT NULL
       OR NEW.credit_authorization_id IS NOT NULL OR NEW.credit_transfer_id IS NOT NULL OR NEW.credit_status IS NOT NULL THEN
      RAISE EXCEPTION 'money_transfers: a new proposal carries no approval and no Plaid legs'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.to_kind = 'bank_account' AND NEW.to_bank_account_id IS NULL THEN
      RAISE EXCEPTION 'money_transfers: a move to a bank account names that account'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.last_provider_event_id := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE ------------------------------------------------------------------
  IF NEW.id <> OLD.id OR NEW.org_id <> OLD.org_id OR NEW.client_id <> OLD.client_id
     OR NEW.environment <> OLD.environment OR NEW.provider <> OLD.provider
     OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.created_at <> OLD.created_at
     OR NEW.proposed_by_kind <> OLD.proposed_by_kind OR NEW.proposed_by_id IS DISTINCT FROM OLD.proposed_by_id
     OR NEW.amount_cents <> OLD.amount_cents OR NEW.scheduled_for <> OLD.scheduled_for
     OR NEW.to_kind <> OLD.to_kind OR NEW.network <> OLD.network THEN
    RAISE EXCEPTION 'money_transfers %: who, how much, when and where never change — cancel it and propose a new one', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- An account may go away (NULL through the foreign key); it may never be
  -- swapped for another one. Before approval the from account may be picked.
  IF NEW.to_bank_account_id IS DISTINCT FROM OLD.to_bank_account_id AND NEW.to_bank_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'money_transfers %: the to account never changes', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.approved_at IS NOT NULL THEN
    IF NEW.from_bank_account_id IS DISTINCT FROM OLD.from_bank_account_id AND NEW.from_bank_account_id IS NOT NULL THEN
      RAISE EXCEPTION 'money_transfers %: the from account was approved and never changes', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.approved_by_kind IS DISTINCT FROM OLD.approved_by_kind
       OR NEW.approved_by_account_id IS DISTINCT FROM OLD.approved_by_account_id
       OR NEW.approved_by_client_id IS DISTINCT FROM OLD.approved_by_client_id
       OR NEW.approval_terms IS DISTINCT FROM OLD.approval_terms THEN
      RAISE EXCEPTION 'money_transfers %: an approval is never changed or removed', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Plaid ids, once known, are fixed. A finished leg stays finished.
  IF (OLD.debit_authorization_id IS NOT NULL AND NEW.debit_authorization_id IS DISTINCT FROM OLD.debit_authorization_id)
     OR (OLD.debit_transfer_id IS NOT NULL AND NEW.debit_transfer_id IS DISTINCT FROM OLD.debit_transfer_id)
     OR (OLD.credit_authorization_id IS NOT NULL AND NEW.credit_authorization_id IS DISTINCT FROM OLD.credit_authorization_id)
     OR (OLD.credit_transfer_id IS NOT NULL AND NEW.credit_transfer_id IS DISTINCT FROM OLD.credit_transfer_id) THEN
    RAISE EXCEPTION 'money_transfers %: a Plaid id never changes once recorded', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.debit_status IN ('failed', 'cancelled', 'returned') AND NEW.debit_status IS DISTINCT FROM OLD.debit_status)
     OR (OLD.credit_status IN ('failed', 'cancelled', 'returned') AND NEW.credit_status IS DISTINCT FROM OLD.credit_status) THEN
    RAISE EXCEPTION 'money_transfers %: a failed, cancelled or returned leg is final', OLD.id USING ERRCODE = 'check_violation';
  END IF;

  -- The state machine.
  IF NEW.status <> OLD.status THEN
    IF NOT (
         (OLD.status = 'proposed'   AND NEW.status IN ('approved', 'cancelled'))
      OR (OLD.status = 'approved'   AND NEW.status IN ('authorized', 'declined', 'failed', 'cancelled'))
      OR (OLD.status = 'authorized' AND NEW.status IN ('submitted', 'failed', 'cancelled'))
      OR (OLD.status = 'submitted'  AND NEW.status IN ('settled', 'failed', 'cancelled'))
      OR (OLD.status = 'settled'    AND NEW.status = 'failed')
    ) THEN
      RAISE EXCEPTION 'money_transfers %: % cannot become %', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'proposed' AND NEW.status = 'approved' AND NEW.from_bank_account_id IS NULL THEN
      RAISE EXCEPTION 'money_transfers %: an approval names the account the money comes from', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- A provider event id that was not set by THIS statement is stale, and would
  -- otherwise be copied into the ledger twice.
  IF NEW.last_provider_event_id IS NOT DISTINCT FROM OLD.last_provider_event_id THEN
    NEW.last_provider_event_id := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS money_transfers_guard_trg ON public.money_transfers;
CREATE TRIGGER money_transfers_guard_trg
  BEFORE INSERT OR UPDATE ON public.money_transfers
  FOR EACH ROW EXECUTE FUNCTION public.money_transfers_guard();

CREATE OR REPLACE FUNCTION public.money_transfers_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'money_transfers %: money moves are kept — cancel a move, never delete it', OLD.id
    USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS money_transfers_no_delete_trg ON public.money_transfers;
CREATE TRIGGER money_transfers_no_delete_trg
  BEFORE DELETE ON public.money_transfers
  FOR EACH ROW EXECUTE FUNCTION public.money_transfers_no_delete();

-- ---------------------------------------------------------------------------
-- 6. The ledger writer: every insert, every status or leg change, and every
--    account that goes away becomes one money_transfer_events row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.money_transfers_ledger() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_type   text;
  v_kind   text;
  v_actor  text;
  v_detail jsonb;
  v_event  bigint;
  v_leg    text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_type := NEW.last_event_type; v_kind := NEW.last_actor_kind; v_actor := NEW.last_actor_id;
    v_detail := NEW.last_event_detail; v_event := NULL;
  ELSIF OLD.status IS DISTINCT FROM NEW.status
     OR OLD.debit_status IS DISTINCT FROM NEW.debit_status
     OR OLD.credit_status IS DISTINCT FROM NEW.credit_status THEN
    v_type := NEW.last_event_type; v_kind := NEW.last_actor_kind; v_actor := NEW.last_actor_id;
    v_detail := NEW.last_event_detail; v_event := NEW.last_provider_event_id;
  ELSIF (OLD.from_bank_account_id IS NOT NULL AND NEW.from_bank_account_id IS NULL)
     OR (OLD.to_bank_account_id IS NOT NULL AND NEW.to_bank_account_id IS NULL) THEN
    v_type := 'account_removed'; v_kind := 'system'; v_actor := NULL; v_event := NULL;
    v_detail := jsonb_build_object(
      'from_removed', (OLD.from_bank_account_id IS NOT NULL AND NEW.from_bank_account_id IS NULL),
      'to_removed', (OLD.to_bank_account_id IS NOT NULL AND NEW.to_bank_account_id IS NULL));
  ELSE
    RETURN NEW;
  END IF;

  v_leg := NULLIF(v_detail ->> 'leg', '');
  INSERT INTO public.money_transfer_events
    (transfer_id, org_id, client_id, event_type, from_status, to_status, debit_status, credit_status,
     leg, provider_event_id, actor_kind, actor_id, detail)
  VALUES
    (NEW.id, NEW.org_id, NEW.client_id, v_type,
     CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status,
     NEW.debit_status, NEW.credit_status, v_leg, v_event, v_kind, v_actor, COALESCE(v_detail, '{}'::jsonb));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS money_transfers_ledger_trg ON public.money_transfers;
CREATE TRIGGER money_transfers_ledger_trg
  AFTER INSERT OR UPDATE ON public.money_transfers
  FOR EACH ROW EXECUTE FUNCTION public.money_transfers_ledger();

-- Ledger rows are final, for every role.
CREATE OR REPLACE FUNCTION public.money_transfer_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'money_transfer_events: the ledger is append-only — add a row, never change or remove one'
    USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS money_transfer_events_append_only_trg ON public.money_transfer_events;
CREATE TRIGGER money_transfer_events_append_only_trg
  BEFORE UPDATE OR DELETE ON public.money_transfer_events
  FOR EACH ROW EXECUTE FUNCTION public.money_transfer_events_append_only();

DROP TRIGGER IF EXISTS money_transfer_events_no_truncate_trg ON public.money_transfer_events;
CREATE TRIGGER money_transfer_events_no_truncate_trg
  BEFORE TRUNCATE ON public.money_transfer_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.money_transfer_events_append_only();

-- ---------------------------------------------------------------------------
-- 7. Row security and grants — the 403/412 shape
-- ---------------------------------------------------------------------------
ALTER TABLE public.money_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_transfers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.money_transfer_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_transfer_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.money_transfer_sync_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_transfer_sync_cursors FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'money_transfers' AND policyname = 'money_transfers_app_all') THEN
    CREATE POLICY money_transfers_app_all ON public.money_transfers USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'money_transfer_events' AND policyname = 'money_transfer_events_app_all') THEN
    CREATE POLICY money_transfer_events_app_all ON public.money_transfer_events USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'money_transfer_sync_cursors' AND policyname = 'money_transfer_sync_cursors_app_all') THEN
    CREATE POLICY money_transfer_sync_cursors_app_all ON public.money_transfer_sync_cursors USING (true) WITH CHECK (true);
  END IF;
END $$;

-- The app reads and writes moves but never deletes one; it reads and adds
-- ledger rows and nothing else. REVOKE first: 104's default privileges already
-- handed fundhub_app all four rights on every new table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    REVOKE DELETE, TRUNCATE ON public.money_transfers FROM fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON public.money_transfers TO fundhub_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON public.money_transfer_events FROM fundhub_app;
    GRANT SELECT, INSERT ON public.money_transfer_events TO fundhub_app;
    REVOKE DELETE, TRUNCATE ON public.money_transfer_sync_cursors FROM fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON public.money_transfer_sync_cursors TO fundhub_app;
  END IF;
END $$;

-- Supabase's web roles never touch money moves (409/412).
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.money_transfers FROM %I', r);
      EXECUTE format('REVOKE ALL ON public.money_transfer_events FROM %I', r);
      EXECUTE format('REVOKE ALL ON public.money_transfer_sync_cursors FROM %I', r);
    END IF;
  END LOOP;
END $$;
