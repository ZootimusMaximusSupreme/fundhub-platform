-- 583_finance_custom_alerts.sql — alerts and repeat bills the client adds by hand.
-- Finance OS CFO build, unit AL2 (ops/workflows/finance-os-cfo-build-2026-11-06.txt;
-- owner ask 2026-11-07: "they can add alerts too... add recurring expenses...
-- organize it by business").
--
-- ONE NEW TABLE. Additive. Re-running this file is a no-op.
--
--   kind 'alert'  a reminder the client sets: a name, an amount if they want one,
--                 and a day of the month (repeats) or one date (once).
--   kind 'bill'   a repeat bill the detector missed: a name, an amount, how often
--                 (weekly, every two weeks, monthly, yearly) and its day.
--
-- Each one is personal, or belongs to one of the client's businesses (entities,
-- 106), or to "business" with no company picked yet.
--
-- WHY NOT recurring_bills (source 'manual', 107). That table needs a bank account
-- on every row, and the detector's upsert (src/banking/store.mjs
-- upsertRecurringBill) rewrites every detection column of a row with the same
-- (account, merchant, cadence), which a manual row's shape check refuses. A
-- hand-added bill would break the detector for that client. So the client's own
-- items live here, away from the detector.
--
-- HOW THEY ALERT. The daily file-alerts pass (src/finance/file-alerts/run.mjs, step
-- 5) queues one phone alert a few days before each next date, when phone_alert is
-- on: a `messages` row, channel 'push', provider_ref 'finance-push:custom:<id>:<date>'.
-- The unique (org_id, provider_ref) index makes it one per date. The dispatcher
-- sends it 9 a.m. to 5 p.m. Arizona with a fixed lock-screen sentence (no name, no
-- amount: src/push/payload.mjs). The date math is
-- src/pulse/beats/lib/custom-alert-plan.mjs.
--
-- REMOVED, NOT DELETED. Removing one sets archived_at. The row stays, so a phone
-- alert already queued can see it was removed and stop.
--
-- MONEY IS INTEGER CENTS, the size of the payment (positive). NULL is "no amount".

CREATE TABLE IF NOT EXISTS finance_custom_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('alert', 'bill')),
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  amount_cents  bigint CHECK (amount_cents IS NULL OR (amount_cents > 0 AND amount_cents <= 100000000000)),
  -- once: on start_on. weekly / biweekly / annual: counted from start_on.
  -- monthly: on day_of_month (a day past a month's end lands on its last day).
  cadence       text NOT NULL CHECK (cadence IN ('once', 'weekly', 'biweekly', 'monthly', 'annual')),
  day_of_month  smallint CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),
  start_on      date,
  scope         text NOT NULL CHECK (scope IN ('personal', 'business')),
  -- The business it belongs to. NULL on a business row: no company picked.
  entity_id     uuid REFERENCES entities(id) ON DELETE SET NULL,
  phone_alert   boolean NOT NULL DEFAULT true,
  created_by    text NOT NULL CHECK (created_by IN ('client', 'staff')),
  updated_by    text NOT NULL CHECK (updated_by IN ('client', 'staff')),
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- A monthly one has a day of the month and no date; every other one has a date.
  CONSTRAINT finance_custom_alerts_schedule_ck CHECK (
    (cadence = 'monthly' AND day_of_month IS NOT NULL AND start_on IS NULL)
    OR (cadence <> 'monthly' AND day_of_month IS NULL AND start_on IS NOT NULL)
  ),
  -- An alert repeats monthly or goes once. A bill repeats and has an amount.
  CONSTRAINT finance_custom_alerts_kind_ck CHECK (
    (kind = 'alert' AND cadence IN ('once', 'monthly'))
    OR (kind = 'bill' AND cadence IN ('weekly', 'biweekly', 'monthly', 'annual') AND amount_cents IS NOT NULL)
  ),
  -- Only a business row names a business.
  CONSTRAINT finance_custom_alerts_scope_ck CHECK (scope = 'business' OR entity_id IS NULL)
);

-- The screen, the daily pass and the morning check read one client's live rows.
CREATE INDEX IF NOT EXISTS finance_custom_alerts_client_idx
  ON finance_custom_alerts (org_id, client_id)
  WHERE archived_at IS NULL;

COMMENT ON TABLE finance_custom_alerts IS
  'Alerts and repeat bills a Finance OS client adds by hand. One phone alert a few days before each next date when phone_alert is on (src/finance/file-alerts/run.mjs). Removed rows keep archived_at.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
     WHERE event_object_table = 'finance_custom_alerts' AND trigger_name = 'finance_custom_alerts_set_updated_at'
  ) THEN
    CREATE TRIGGER finance_custom_alerts_set_updated_at
      BEFORE UPDATE ON finance_custom_alerts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Row-level security — the shape file_protection_alerts carries (471): ENABLE +
-- FORCE + one permissive policy. Isolation lives in the app layer, which binds
-- org_id and client_id into every read and write. No DELETE grant: a row is
-- removed by archived_at.
ALTER TABLE public.finance_custom_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_custom_alerts FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'finance_custom_alerts' AND policyname = 'finance_custom_alerts_app_all') THEN
    CREATE POLICY finance_custom_alerts_app_all ON public.finance_custom_alerts USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.finance_custom_alerts TO fundhub_app;
  END IF;
END $$;
