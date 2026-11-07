// Phone alerts — the shared pure planner. Which card or Important bill is owed a
// push, and the key that makes it one push per card or bill per cycle. No
// database, no clock, no send. Finance OS CFO build, unit D (owner-set
// 2026-11-06: "MOST IMPORTANT").
//
// ONE PLANNER, THREE CLOCKS. The daily file-alerts pass (src/finance/file-alerts/
// run.mjs, through src/finance/file-alerts/phone-alerts.mjs, which re-exports
// every name here), the morning check (src/pulse/coverage/gap-phone-alerts.mjs)
// and the hourly beat money-alerts all decide "is a push owed?" with this code. A
// file in this folder may import only from this folder, so the card-due planner
// and the date helpers come from ./card-due-plan.mjs and ./card-due-helpers.mjs,
// the same files the card-due text already runs on.
//
//   card_due         a card payment due in 0 to 3 days with no payment on file:
//                    planCardDue, the card-due text's own planner. Key: its
//                    eventId, card-due:<account>:<due date>.
//   important_bill   a repeat bill the client marked Important, expected to charge
//                    in 0 to 3 days. Key: bill:<bill id>:<expected date>.
//   statement_close  pay a card down before its statement closes. Its planner
//                    reads the money overview, so it lives with the pass
//                    (src/finance/file-alerts/phone-alerts.mjs). Key:
//                    fpa:pay:<account>:<close date>.
//   loan_due         any loan payment due in 0 to 3 days (D2, owner-set 2026-11-07:
//                    "business credit cards, lines of credit, any loan payment"):
//                    planLoanDue, the loan text's own planner. Key: its eventId,
//                    loan-due:<account>:<due date>.
//   credit_line_due  the same, for a line of credit (a loan or credit account whose
//                    subtype says so). Its own words on the lock screen.
//   plan_due         the next unpaid installment of a payment plan the client owes
//                    Fundhub (Clarity Payments, migration 443), due in 0 to 3 days.
//                    Key: plan:<installment id>:<due date>. A Whop plan's next charge
//                    uses the same kind (unit W): ./whop-plan-push.mjs, key
//                    whop:<whop_memberships id>:<charge day>.
//   custom_alert     an alert the client set by hand, due in 0 to 3 days (unit AL2,
//   custom_bill      2026-11-07), and a repeat bill they added by hand. Their planner
//                    is ./custom-alert-plan.mjs. Key: custom:<id>:<date>.
// A business credit card is a card: card_due and statement_close cover every
// credit card, personal or business.
//
// The queued row's provider_ref is finance-push:<key>, unique per company.
// NOTHING IS INVENTED: a bill with no expected date is skipped with the detector's
// own reason, never rolled forward to a guessed day.

import { planCardDue, planLoanDue, REMIND_DAYS_BEFORE } from "./card-due-plan.mjs";
import { daysBetween, parseIsoDate } from "./card-due-helpers.mjs";

export const PHONE_KINDS = Object.freeze([
  "card_due", "statement_close", "important_bill", "loan_due", "credit_line_due", "plan_due", "custom_alert", "custom_bill"
]);

/** The `messages.template_key` of each queued phone alert. Not a text template:
 *  no message_templates row, no SMS. The prefix is what the partial index in
 *  db/migrations/573_finance_phone_alerts.sql and the checks read. */
export const PUSH_TEMPLATES = Object.freeze({
  card_due: "PUSH-FINANCE-CARD-DUE",
  statement_close: "PUSH-FINANCE-STATEMENT-CLOSE",
  important_bill: "PUSH-FINANCE-BILL-SOON",
  loan_due: "PUSH-FINANCE-LOAN-DUE",
  credit_line_due: "PUSH-FINANCE-CREDIT-LINE-DUE",
  plan_due: "PUSH-FINANCE-PLAN-DUE",
  custom_alert: "PUSH-FINANCE-CUSTOM-ALERT",
  custom_bill: "PUSH-FINANCE-CUSTOM-BILL"
});
export const PUSH_TEMPLATE_PREFIX = "PUSH-FINANCE-";

/** The kind src/push/payload.mjs knows, which picks the fixed lock-screen sentence. */
export const PUSH_KINDS = Object.freeze({
  card_due: "card_payment_due",
  statement_close: "card_statement_close",
  important_bill: "bill_charge_soon",
  loan_due: "loan_payment_due",
  credit_line_due: "credit_line_payment_due",
  plan_due: "plan_payment_due",
  custom_alert: "custom_reminder_due",
  custom_bill: "custom_bill_soon"
});

/** Plain words for the screen. */
export const PHONE_LABELS = Object.freeze({
  card_due: "Card payment due",
  statement_close: "Statement closes",
  important_bill: "Important bill",
  loan_due: "Loan payment due",
  credit_line_due: "Credit line payment due",
  plan_due: "Payment plan due",
  custom_alert: "Alert you added",
  custom_bill: "Bill you added"
});

/** The provider_ref prefix of a queued phone alert. */
export const PUSH_REF_PREFIX = "finance-push:";

/** IMPORTANT BILL — how many days ahead of the expected charge the push goes.
 *  A choice, not a fact: the repo has no rule for it. It is the card-due window
 *  (REMIND_DAYS_BEFORE) so the client hears about every payment the same number
 *  of days ahead. */
export const BILL_PUSH_DAYS_BEFORE = REMIND_DAYS_BEFORE;

export function pushRef(key) {
  return `${PUSH_REF_PREFIX}${key}`;
}

export function kindOfTemplate(templateKey) {
  const key = String(templateKey || "");
  return PHONE_KINDS.find((k) => PUSH_TEMPLATES[k] === key) || null;
}

/** The date every key ends with: the day the alert is about. Null when absent. */
export function eventDateOfKey(key) {
  const m = /:(\d{4}-\d{2}-\d{2})$/.exec(String(key || ""));
  return m && parseIsoDate(m[1]) ? m[1] : null;
}

/** The card or bill id inside a key: card-due:<account>:<date>, fpa:pay:<account>:<date>,
 *  bill:<bill>:<date>, plan:<installment>:<date>, custom:<id>:<date>, or whop:<Whop plan>:<date>
 *  (unit W, ./whop-plan-push.mjs). Null when the key is none of those. */
export function subjectIdOfKey(key) {
  const m = /^(?:card-due|loan-due|fpa:pay|bill|plan|custom|whop):([^:]+):\d{4}-\d{2}-\d{2}$/.exec(String(key || ""));
  return m ? m[1] : null;
}

/** A line of credit, by the account's own subtype (Plaid's "line of credit", or one
 *  typed in). Never guessed from a name. */
export function isCreditLine(subtype) {
  return /\bline of credit\b|\bcredit line\b/i.test(String(subtype || ""));
}

/** A `date` column as "YYYY-MM-DD". node-postgres hands a `date` back as LOCAL
 *  midnight, so the local parts are the stored day on any machine; a string is
 *  read as text. Null when unreadable. */
export function billDay(v) {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = typeof v === "string" ? v.slice(0, 10) : "";
  return parseIsoDate(s) ? s : null;
}

/** What a bill is called on the screen. Its own merchant name; never a guess. */
export function billLabel(bill = {}) {
  const shown = typeof bill.merchant_display === "string" ? bill.merchant_display.trim() : "";
  if (shown) return shown;
  const key = typeof bill.merchant_key === "string" ? bill.merchant_key.trim() : "";
  return key || "Repeat bill";
}

/**
 * planBillPush(bill, { today }) → { push, reason, ... }
 *
 * `bill` is one recurring_bills row (id, important, next_expected_on,
 * next_expected_unknown_reason, merchant_display, confidence_label).
 */
export function planBillPush(bill, { today } = {}) {
  const skip = (reason, extra = {}) => ({ push: false, kind: "important_bill", reason, ...extra });
  if (!parseIsoDate(today)) return skip("bad_today");
  if (!bill || !bill.id) return skip("no_bill");
  if (bill.important !== true) return skip("not_marked_important");
  // A low-confidence guess is not a bill (src/banking/recurring.mjs section 2).
  if (bill.confidence_label && !["medium", "high"].includes(bill.confidence_label)) return skip("not_a_sure_bill");
  const on = billDay(bill.next_expected_on);
  if (!on) return skip(bill.next_expected_unknown_reason || "no_expected_date");
  const daysAway = daysBetween(today, on);
  if (daysAway < 0) return skip("expected_date_passed", { dueOn: on, daysAway });
  if (daysAway > BILL_PUSH_DAYS_BEFORE) return skip("not_yet", { dueOn: on, daysAway });
  return {
    push: true,
    kind: "important_bill",
    reason: null,
    key: `bill:${bill.id}:${on}`,
    subjectId: String(bill.id),
    label: billLabel(bill),
    dueOn: on,
    daysAway
  };
}

/** card_due — the card-due text's own planner, keyed on its own eventId. Every credit
 *  card, personal or business; a credit account whose subtype is a line of credit
 *  gets the credit-line words. */
export function planCardDuePush(card, cycle, { today, subtype = null } = {}) {
  const kind = isCreditLine(subtype ?? card?.subtype) ? "credit_line_due" : "card_due";
  const skip = (reason, extra = {}) => ({ push: false, kind, reason, ...extra });
  if (!card || !card.account_id) return skip("no_card");
  if (!cycle) return skip("no_statement_cycle");
  const plan = planCardDue({ ...cycle, bank_account_id: card.account_id, name: card.name, mask: card.mask }, { today });
  if (!plan.remind) return skip(plan.reason, { dueOn: plan.dueOn ?? null, daysAway: plan.daysAway ?? null });
  return {
    push: true, kind, reason: null, key: plan.eventId,
    subjectId: String(card.account_id), label: plan.label, dueOn: plan.dueOn, daysAway: plan.daysAway
  };
}

/** loan_due / credit_line_due — the loan text's own planner (planLoanDue), keyed on
 *  its own eventId. A loan's payment is due every month on its schedule, whether or
 *  not a payment was made, so a hand-entered loan is alerted too. */
export function planLoanDuePush(loan, cycle, { today, subtype = null } = {}) {
  const kind = isCreditLine(subtype ?? loan?.subtype) ? "credit_line_due" : "loan_due";
  const skip = (reason, extra = {}) => ({ push: false, kind, reason, ...extra });
  if (!loan || !loan.account_id) return skip("no_loan");
  if (!cycle) return skip("no_statement_cycle");
  const plan = planLoanDue({
    ...cycle, bank_account_id: loan.account_id, name: loan.name, mask: loan.mask,
    current_balance_cents: loan.balance_cents ?? cycle.current_balance_cents ?? null
  }, { today });
  if (!plan.remind) return skip(plan.reason, { dueOn: plan.dueOn ?? null, daysAway: plan.daysAway ?? null });
  return {
    push: true, kind, reason: null, key: plan.eventId,
    subjectId: String(loan.account_id), label: plan.label, dueOn: plan.dueOn, daysAway: plan.daysAway
  };
}

/** What a payment plan is called on the screen: its own label, else whom it is owed to. */
export function planLabel(row = {}) {
  const label = typeof row.label === "string" ? row.label.trim() : "";
  if (label) return label;
  const owed = typeof row.owed_to === "string" && row.owed_to.trim() ? row.owed_to.trim() : "Fundhub";
  return `Payment plan with ${owed}`;
}

/**
 * planInstallmentPush(row, { today }) → { push, reason, ... }
 *
 * `row` is one plan's next unpaid installment: { plan_id, installment_id, seq,
 * due_on, left_cents, label, owed_to } (the daily pass's CLARITY_SQL, or the
 * check's own read). A late installment is the money helper's (late check-ins),
 * never a "due soon" push.
 */
export function planInstallmentPush(row, { today } = {}) {
  const skip = (reason, extra = {}) => ({ push: false, kind: "plan_due", reason, ...extra });
  if (!parseIsoDate(today)) return skip("bad_today");
  if (!row || !row.installment_id) return skip("no_installment");
  const left = row.left_cents === null || row.left_cents === undefined ? null : Number(row.left_cents);
  if (left !== null && !(left > 0)) return skip("paid");
  const on = billDay(row.due_on);
  if (!on) return skip("no_due_date");
  const daysAway = daysBetween(today, on);
  if (daysAway < 0) return skip("late", { dueOn: on, daysAway });
  if (daysAway > REMIND_DAYS_BEFORE) return skip("not_yet", { dueOn: on, daysAway });
  return {
    push: true, kind: "plan_due", reason: null, key: `plan:${row.installment_id}:${on}`,
    subjectId: String(row.installment_id), planId: row.plan_id ? String(row.plan_id) : null,
    label: planLabel(row), dueOn: on, daysAway
  };
}
