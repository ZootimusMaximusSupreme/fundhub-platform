-- 573_finance_phone_alerts.sql — phone alerts (push notifications) for card
-- payments and important bills. Finance OS CFO build, unit D
-- (ops/workflows/finance-os-cfo-build-2026-11-06.txt, spec item 1, owner-set
-- 2026-11-06: "MOST IMPORTANT").
--
-- Three things, all additive. Re-running it is a no-op.
--
--   1. recurring_bills.important — the client marks a repeat bill as one they
--      care about (their tech stack, their key payments). Default false: a bill
--      nobody marked never buzzes a phone.
--   2. file_protection_settings.phone_alerts — the client's own on/off switch for
--      every finance phone alert. Default true, like the four text switches next
--      to it: a client with no row has alerts on.
--   3. Two small read indexes, for the Alerts screen and the morning check.
--
-- WHERE A PHONE ALERT LIVES: the `messages` table, channel 'push'. No new table.
-- The daily file-alerts pass (src/finance/file-alerts/run.mjs) writes one row
-- per card or bill per cycle at status 'queued', with provider_ref
-- 'finance-push:<key>' (the unique (org_id, provider_ref) index from
-- db/schema/004_comms_indexes.sql is what makes it one per cycle). The
-- dispatcher hands it to src/push/finance-alerts.mjs, which waits for 9 a.m. to
-- 5 p.m. Arizona, re-reads the opt-outs, and sends one of three fixed lock-screen
-- sentences. The sentence never holds an amount, a bank name or account digits
-- (src/push/payload.mjs refuses anything else).
--
-- THE IMPORTANT FLAG SURVIVES RE-DETECTION. upsertRecurringBill
-- (src/banking/store.mjs) updates only the columns toBillRow() names, and it does
-- not name these three. A bill the detector finds again keeps its flag.

-- ---------------------------------------------------------------------------
-- 1. the important flag on a repeat bill
-- ---------------------------------------------------------------------------
ALTER TABLE recurring_bills
  ADD COLUMN IF NOT EXISTS important        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS important_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS important_set_by text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_bills_important_by_ck') THEN
    ALTER TABLE recurring_bills ADD CONSTRAINT recurring_bills_important_by_ck
      CHECK (important_set_by IS NULL OR important_set_by IN ('client', 'staff'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_bills_important_stamp_ck') THEN
    -- Who and when travel together: a flag someone changed says who did it.
    ALTER TABLE recurring_bills ADD CONSTRAINT recurring_bills_important_stamp_ck
      CHECK ((important_set_at IS NULL) = (important_set_by IS NULL));
  END IF;
END $$;

COMMENT ON COLUMN recurring_bills.important IS
  'The client marked this repeat bill important. The daily file-alerts pass sends one phone alert a few days before its next expected charge. Default false.';

-- The pass and the morning check read only the marked bills of one client.
CREATE INDEX IF NOT EXISTS recurring_bills_important_idx
  ON recurring_bills (org_id, client_id)
  WHERE important;

-- ---------------------------------------------------------------------------
-- 2. the phone alert switch, next to the four text switches
-- ---------------------------------------------------------------------------
ALTER TABLE file_protection_settings
  ADD COLUMN IF NOT EXISTS phone_alerts boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN file_protection_settings.phone_alerts IS
  'The client''s switch for every finance phone alert (card due, statement close, important bill). Off means no push; the texts follow their own switches.';

-- ---------------------------------------------------------------------------
-- 3. finding the phone alerts again
-- ---------------------------------------------------------------------------
-- The Alerts screen lists a client's recent phone alerts and the morning check
-- reads the last few days of them. Small and partial: only finance push rows.
CREATE INDEX IF NOT EXISTS messages_finance_push_idx
  ON messages (org_id, client_id, created_at DESC)
  WHERE channel = 'push' AND template_key LIKE 'PUSH-FINANCE-%';
