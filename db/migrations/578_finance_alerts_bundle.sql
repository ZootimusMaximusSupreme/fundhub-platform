-- 578_finance_alerts_bundle.sql — three more Finance OS alerts. Finance OS CFO
-- build, unit AL (ops/workflows/finance-os-cfo-build-2026-11-06.txt, owner go
-- part 4, ideas 1, 5 and 7, 2026-11-07). Planners: src/finance/file-alerts/
-- card-over-10.mjs, business-credit.mjs, weekly-money.mjs.
--
--   card_over_10     after funding, a card is over 10% of its limit before its
--                    statement closes. One text per card per cycle:
--                    fpa:over10:<account>:<statement close date>
--   business_credit  a business's saved score changed between its last two
--                    reports. One text per business per report:
--                    fpa:biz:<business>:<pull>
--   weekly_money     money in, card use, seasoning and steps left, Monday 9 a.m.
--                    Arizona. One text per client per week:
--                    fpa:week:<client>:<Monday>
--
-- NO NEW TABLE. A sent alert is one file_protection_alerts row, like the four
-- older kinds (471): the same once-only key under the same unique index, the
-- same "a row means a text was queued" rule, and the same morning check
-- (alerts:texts-went-out reads every row of that table, whatever its kind).
--
-- Three things. Re-running this file is a no-op.
--
--   1. file_protection_alerts.kind allows the three new kinds. The old check is
--      replaced by one that lists all seven (the four from 471 plus these three);
--      a later unit that adds a kind must list all of them again.
--   2. file_protection_settings gains one on/off switch per new kind, default ON,
--      like the four next to it.
--   3. Three SMS templates, seeded the way 471 seeds its four.
--
-- THE LOCK SCREEN. A text preview shows on a locked phone. None of the three
-- texts holds a dollar amount, a bank or card name, or account digits (unit AL
-- brief; owner-set 2026-11-06, spec item 1). The amounts are on the Alerts
-- screen, behind the login. src/finance/file-alerts/bundle-migration.test.mjs
-- renders each template against its planner's sentence and checks the words.

-- ---------------------------------------------------------------------------
-- 1. the kinds
-- ---------------------------------------------------------------------------
ALTER TABLE file_protection_alerts DROP CONSTRAINT IF EXISTS file_protection_alerts_kind_check;
ALTER TABLE file_protection_alerts ADD CONSTRAINT file_protection_alerts_kind_check
  CHECK (kind IN ('payment_timing', 'promo_end', 'cash_reserve', 'new_credit',
                  'card_over_10', 'business_credit', 'weekly_money'));

-- A card-over-10% text is about one statement close, and a weekly text about one
-- week: each carries its date. (bank_account_id stays nullable: it is SET NULL
-- when an account is removed, and the alert outlives the account.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'file_protection_alerts_bundle_due_ck') THEN
    ALTER TABLE file_protection_alerts ADD CONSTRAINT file_protection_alerts_bundle_due_ck
      CHECK (kind NOT IN ('card_over_10', 'weekly_money') OR due_on IS NOT NULL);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. the switches
-- ---------------------------------------------------------------------------
ALTER TABLE file_protection_settings
  ADD COLUMN IF NOT EXISTS card_over_10    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS business_credit boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS weekly_money    boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN file_protection_settings.card_over_10 IS
  'After funding: text when a card is over 10% of its limit before its statement closes. Default on.';
COMMENT ON COLUMN file_protection_settings.business_credit IS
  'Text when a business''s saved credit score changed on its newest report. Default on.';
COMMENT ON COLUMN file_protection_settings.weekly_money IS
  'The Monday money text: money in, card use, seasoning, steps left. Default on.';

-- ---------------------------------------------------------------------------
-- 3. the three texts
-- ---------------------------------------------------------------------------
-- Queued only through sendTemplated (src/finance/file-alerts/run.mjs for the
-- first two, src/workflows/finance-os-weekly-money.mjs for the weekly one). The
-- dispatcher sends, behind dry-run, quiet hours and the opt-out read. Nothing
-- here moves money.
--
-- Tags, filled by the job (each planner returns the same sentence as `body`):
--   card over 10%    alert.when     "on Nov 15", or "today"
--   business credit  alert.change   "went up", "went down" or "changed"
--   weekly money     alert.summary  " Money came in 3 times to your personal accounts this week. ..."
--
-- DO NOTHING on conflict: a company that already edited one of these keys in the
-- template editor keeps its own copy.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, t.template_key, 'sms', NULL::text, t.body, true
  FROM orgs o
 CROSS JOIN (VALUES
   ('SMS-FILE-PROTECT-CARD-OVER-10',
    $c$Fundhub reminder: one of your cards is over 10% of its limit. Pay it under 10% before its statement closes {{alert.when}} so a low balance reports. Open Fundhub to see which card. Reply STOP to opt out.$c$),
   ('SMS-FILE-PROTECT-BUSINESS-CREDIT',
    $c$Fundhub alert: a business credit score on your file {{alert.change}} on its newest report. Open Fundhub to see it. Reply STOP to opt out.$c$),
   ('SMS-FINANCE-WEEKLY-MONEY',
    $c$Fundhub weekly:{{alert.summary}} Open Fundhub to see the numbers and your next step. Reply STOP to opt out.$c$)
 ) AS t(template_key, body)
ON CONFLICT (org_id, template_key) DO NOTHING;
