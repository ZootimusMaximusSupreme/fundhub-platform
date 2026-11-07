-- 586_bill_cancel_requests.sql — "Cancel it for me" on a client's repeat bills.
--
-- Finance OS wave 4, unit CANCEL (ops/workflows/finance-os-wave4-brief.txt):
-- a button on a repeat bill creates a Fundhub team task to cancel that bill
-- (the existing staff task system: `tasks`, src/lib/create-task.mjs, the CSM
-- queue), with status Requested / Working / Cancelled shown on the bill, plus
-- the merchant's own cancel link when one is known. Never auto-cancel through
-- an API: nothing here calls a merchant, a bank or a card company.
--
-- Two tables. Additive. Re-running it is a no-op.
--
-- 1. bill_cancel_requests — one row per press that opened a team task.
--
--    THE STATUS IS NOT STORED HERE. It is read from the task the press opened,
--    so the bill and the CSM queue can never disagree:
--      task open, nobody took it      Requested
--      task open, a person claimed it Working     (PATCH /api/tasks claim)
--      task done                      Cancelled   (PATCH /api/tasks done)
--    A bill is named the way every money screen names one: the bank account it
--    is charged to and the detector's merchant key (src/banking/recurring.mjs
--    normaliseMerchant). recurring_bill_id points at the row that was pressed,
--    and is only a pointer: re-detection may replace that row.
--
--    ONE TASK, ONE ROW. The unique index on task_id is what makes two presses
--    at the same moment one request (createTask already makes them one task).
--    Rows are never updated: a second request for the same bill (it charged
--    again after it was cancelled) is a new row with a new task.
--
-- 2. merchant_cancel_links — the merchant's own cancel page, per org, set by a
--    person on the Fundhub team who used it. Empty until someone sets one.
--    Never guessed from a merchant name and never filled by a script. https only.

-- ---------------------------------------------------------------------------
-- 1. bill_cancel_requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_cancel_requests (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES orgs(id),
  client_id              uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  bank_account_id        uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  merchant_key           text NOT NULL CHECK (btrim(merchant_key) <> '' AND length(merchant_key) <= 200),
  recurring_bill_id      uuid REFERENCES recurring_bills(id) ON DELETE SET NULL,
  -- What the bill looked like at the press, for the task and the history.
  -- amount_cents is the SIZE of the usual charge (positive); NULL when unknown.
  merchant_name          text,
  amount_cents           bigint CHECK (amount_cents IS NULL OR amount_cents > 0),
  cadence                text,
  task_id                uuid REFERENCES tasks(id) ON DELETE SET NULL,
  requested_by_kind      text NOT NULL CHECK (requested_by_kind IN ('client', 'staff')),
  requested_by_staff_id  uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bill_cancel_requests_one_per_task
  ON bill_cancel_requests (task_id)
  WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bill_cancel_requests_client_idx
  ON bill_cancel_requests (org_id, client_id, created_at DESC);

ALTER TABLE public.bill_cancel_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_cancel_requests FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'bill_cancel_requests' AND policyname = 'bill_cancel_requests_app_all') THEN
    CREATE POLICY bill_cancel_requests_app_all ON public.bill_cancel_requests USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. merchant_cancel_links
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS merchant_cancel_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),
  merchant_key     text NOT NULL CHECK (btrim(merchant_key) <> '' AND length(merchant_key) <= 200),
  url              text NOT NULL CHECK (url ~ '^https://[^[:space:]]+$' AND length(url) <= 500),
  set_by_staff_id  uuid REFERENCES staff(id) ON DELETE SET NULL,
  set_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, merchant_key)
);

ALTER TABLE public.merchant_cancel_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_cancel_links FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'merchant_cancel_links' AND policyname = 'merchant_cancel_links_app_all') THEN
    CREATE POLICY merchant_cancel_links_app_all ON public.merchant_cancel_links USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT ON public.bill_cancel_requests TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON public.merchant_cancel_links TO fundhub_app;
  END IF;
END $$;

COMMENT ON TABLE bill_cancel_requests IS
  'Cancel it for me: one row per press that opened a Fundhub team task to cancel a repeat bill. Status comes from the task (open = Requested, claimed = Working, done = Cancelled). Nothing cancels through an API.';
COMMENT ON TABLE merchant_cancel_links IS
  'A merchant''s own cancel page, set by a Fundhub team member who used it. Empty until set; never guessed.';
