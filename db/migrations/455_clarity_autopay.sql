-- 455_clarity_autopay.sql — a Commas payment to Fundhub that could not be
-- matched to a Clarity Payment gets a row staff can see.
--
-- FinanceOS wave 4, unit H1 (ops/workflows/finance-os-wave4-2026-10-06.md).
--
-- src/finance/clarity-autopay.mjs reads every Commas payment.received. When it
-- can tie the money to one plan, it records the payment through the same path
-- the staff "Record payment" button uses, and logs it as 'payment_recorded'
-- (actor 'agent', detail.via = 'commas'). That needs no schema change.
--
-- When the client HAS an open plan but the money does not fit it (wrong amount,
-- two plans it could belong to, more than is owed), the rule is: do not guess.
-- The payment is left alone and one 'payment_unmatched' row is written so the
-- Payments tab can show it to staff. That action word is the only change here.
--
-- One row per Commas payment, ever: the row's idempotency_key is
-- 'commas-payment:<payment id>', unique per org (money_agent_log_idem_uniq,
-- 443). A repeat webhook writes nothing and applies nothing.

ALTER TABLE money_agent_log DROP CONSTRAINT IF EXISTS money_agent_log_action_check;
ALTER TABLE money_agent_log ADD CONSTRAINT money_agent_log_action_check
  CHECK (action IN ('reminder', 'late_check_in', 'second_check_in', 'csm_task', 'held',
                    'plan_added', 'payment_recorded', 'plan_settled', 'asked_for_person',
                    'payment_unmatched'));
