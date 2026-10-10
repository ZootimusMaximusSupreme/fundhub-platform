-- 451_loan_due_dates.sql — a loan gets a due date, a payment and reminders.
--
-- FinanceOS wave 3, unit G2 (ops/workflows/finance-os-wave3-2026-10-06.md).
--
--
-- *** WHERE A LOAN'S DUE DATE LIVES: account_statement_cycles (097). NO NEW TABLE. ***
--
-- A loan needs three facts: when the next payment is due, how much that payment
-- is, and what is still owed. All three already have a column:
--
--   next due date   account_statement_cycles.payment_due_day — a day of the
--                   month. The next date is COMPUTED by
--                   src/banking/statement-cycles.mjs (month-end clamp), never
--                   stored, for the reason 097's header gives. A loan is the
--                   cleanest case of that rule there is: "due the 1st, every
--                   month" is exactly how a borrower knows it.
--   payment         account_statement_cycles.minimum_payment_cents — the amount
--                   demanded this month. For a card that is the minimum; for an
--                   instalment loan it is the fixed monthly payment. Same
--                   meaning ("what must be paid by the due date"), same
--                   CHECK (>= 0), so no second column.
--   payoff balance  bank_accounts.current_balance_cents — 081 already says that
--                   for a credit or loan account the current balance is what is
--                   owed. A second "payoff" column next to it would be two
--                   answers to one question.
--
-- 097 HAS NO CARD-ONLY RULE IN THE DATABASE. Its header says so: "There is no
-- CHECK that the account is account_type = 'credit' ... The writer enforces it;
-- see src/banking/accounts.mjs." So widening that rule to loans is a code change
-- in saveStatementCycle(), not a schema change, and 097 is not edited (editing an
-- applied migration is a silent no-op — CLAUDE.md §12). This file records the
-- widening on the table itself so the 097 comment is not the last word.
--
-- REJECTED: a new loan_terms table. It would hold the same due day and the same
-- payment amount as 097, and every reader (overview, reminders, money helper)
-- would need a second join and a rule for which table wins. card_liabilities
-- (083) is rejected for the reason 097 gives: it needs a tradeline, and a loan
-- typed in by hand has none.
--
--
-- *** THE ONE REAL SCHEMA CHANGE: cashflow_reminders.subject_kind GAINS 'loan'. ***
--
-- 087 closed subject_kind to ('card_liability', 'recurring_bill') and said a third
-- value means a migration, on purpose. The card-due reminder job
-- (src/workflows/finance-os-card-due-reminders.mjs) now also reminds loans, and
-- filing a loan payment under 'card_liability' would be a false record. So 'loan'
-- is added. subject_id for a loan is its bank_accounts.id — the same soft link the
-- card reminders already use. The other values are unchanged and every existing
-- row still passes.
--
-- The CHECK was written inline in 087, so Postgres named it
-- cashflow_reminders_subject_kind_check. Dropped and re-added under the same name.

ALTER TABLE cashflow_reminders
  DROP CONSTRAINT IF EXISTS cashflow_reminders_subject_kind_check;

ALTER TABLE cashflow_reminders
  ADD CONSTRAINT cashflow_reminders_subject_kind_check
  CHECK (subject_kind IN ('card_liability', 'recurring_bill', 'loan'));

COMMENT ON TABLE account_statement_cycles IS
  'Due day, payment and statement figures for a credit card OR a loan (widened by 451). '
  'The writer (src/banking/accounts.mjs saveStatementCycle) refuses any other account type. '
  'For a loan, minimum_payment_cents is the monthly payment and payment_due_day its due day.';

COMMENT ON COLUMN account_statement_cycles.minimum_payment_cents IS
  'Amount due by the next due date, integer cents. Card: the minimum. Loan: the monthly payment. NULL = not told.';
