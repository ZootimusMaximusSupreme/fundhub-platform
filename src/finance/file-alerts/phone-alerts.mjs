// Phone alerts — the pure half the daily pass runs. Which card or bill is owed a
// push today, and the key that makes it one push per card or bill per cycle. No
// database, no clock, no send. Finance OS CFO build, unit D (owner-set 2026-11-06:
// "MOST IMPORTANT").
//
// SIX ALERTS, EACH ON TOP OF A PLANNER THAT ALREADY EXISTS, so the push and the
// text next to it can never disagree about the day:
//   card_due         planCardDue, the 9 a.m. card-due text's own planner. Every
//                    credit card, personal or business. Key: card-due:<account>:<due date>.
//   statement_close  planPaymentTiming (./payment-timing.mjs), the pay-before-close
//                    text's own planner. Key: fpa:pay:<account>:<close date>.
//   important_bill   planBillPush. Key: bill:<bill id>:<expected date>.
//   loan_due         planLoanDue, the loan text's own planner (D2, owner-set
//   credit_line_due  2026-11-07). Key: loan-due:<account>:<due date>. A line of
//                    credit, by its subtype, gets its own words.
//   plan_due         the next unpaid installment of a plan owed to Fundhub
//                    (Clarity Payments). Key: plan:<installment id>:<due date>.
//                    And each Whop plan's next charge (unit W, owner ask 2026-11-07):
//                    planWhopPush, from whop_memberships. Key: whop:<plan id>:<charge day>.
//   custom_alert     an alert or a repeat bill the client added by hand (unit AL2,
//   custom_bill      2026-11-07): planCustomPush. Key: custom:<id>:<date>.
//
// THE SHARED PART LIVES IN src/pulse/beats/lib/phone-alert-plan.mjs, so the daily
// pass, the morning check and the hourly beat decide "owed" with one planner (the
// same move src/banking/card-due-reminders.mjs made). This file re-exports every
// name from there and adds the one planner that needs the money overview.
//
// ONE PUSH PER CARD OR BILL PER CYCLE. Every key holds a date that does not move,
// and the queued row's provider_ref is finance-push:<key> under the unique
// (org_id, provider_ref) index. The first pass inside the window writes it; every
// later pass finds it.
//
// THE LOCK SCREEN NEVER SEES THE PLAN. A plan carries the card name and the date
// for the screen and the logs. What reaches the phone is one of three fixed
// sentences chosen by kind in src/push/payload.mjs, which refuses free text.

import { planPaymentTiming } from "./payment-timing.mjs";
import {
  planCardDuePush, planBillPush, planLoanDuePush, planInstallmentPush, billLabel, planLabel
} from "../../pulse/beats/lib/phone-alert-plan.mjs";
import { planCustomPush, customLabel } from "../../pulse/beats/lib/custom-alert-plan.mjs";
import { planWhopPush, whopLabel } from "../../pulse/beats/lib/whop-plan-push.mjs";

export {
  PHONE_KINDS, PUSH_TEMPLATES, PUSH_TEMPLATE_PREFIX, PUSH_KINDS, PHONE_LABELS, PUSH_REF_PREFIX,
  BILL_PUSH_DAYS_BEFORE, pushRef, kindOfTemplate, eventDateOfKey, subjectIdOfKey, billDay, billLabel,
  planBillPush, planCardDuePush, planLoanDuePush, planInstallmentPush, planLabel, isCreditLine
} from "../../pulse/beats/lib/phone-alert-plan.mjs";

/** statement_close — the pay-before-close text's own planner, keyed on its own key. */
export function planStatementClosePush(card, cycle, { today, daysBefore } = {}) {
  const plan = planPaymentTiming(card, cycle, { today, daysBefore });
  if (!plan.alert) return { push: false, kind: "statement_close", reason: plan.reason, dueOn: plan.closesOn ?? null };
  return {
    push: true, kind: "statement_close", reason: null, key: plan.key,
    subjectId: String(card.account_id), label: plan.label, dueOn: plan.dueOn, daysAway: plan.daysAway
  };
}

/**
 * planPhoneAlerts({ cards, loans, cycleOf, subtypeOf, bills, plans, whop, custom, settings, today, daysBefore })
 *   → { owed: [plan], skipped: [{ kind, subject, reason }] }
 *
 * cards and loans are the money overview's debt.cards and debt.loans; subtypeOf
 * gives an account's own subtype (to tell a line of credit); plans are each open
 * payment plan's next unpaid installment; whop is the client's open Whop plans
 * (whop_memberships rows, src/finance/whop-plans.mjs listWhopPlans); custom are the
 * client's own alerts and repeat bills (finance_custom_alerts, migration 583).
 *
 * Pure. The pass decides; the queue (src/push/finance-alerts.mjs) writes.
 * statement_close follows the client's "pay before the statement closes" switch,
 * so a client who turned that text off is not buzzed about it either.
 */
export function planPhoneAlerts({
  cards = [], loans = [], cycleOf = () => null, subtypeOf = () => null, bills = [], plans = [], whop = [], custom = [], settings = {},
  today, daysBefore
} = {}) {
  const owed = [];
  const skipped = [];
  const take = (plan, subject) => {
    if (plan.push) owed.push(plan);
    else skipped.push({ kind: plan.kind, subject, reason: plan.reason });
  };
  for (const card of Array.isArray(cards) ? cards : []) {
    const cycle = cycleOf(card);
    const subject = card?.name || card?.account_id || "card";
    take(planCardDuePush(card, cycle, { today, subtype: subtypeOf(card) }), subject);
    if (settings.payment_timing === false) skipped.push({ kind: "statement_close", subject, reason: "switched_off" });
    else take(planStatementClosePush(card, cycle, { today, daysBefore }), subject);
  }
  for (const loan of Array.isArray(loans) ? loans : []) {
    take(planLoanDuePush(loan, cycleOf(loan), { today, subtype: subtypeOf(loan) }), loan?.name || loan?.account_id || "loan");
  }
  for (const bill of Array.isArray(bills) ? bills : []) {
    if (bill?.important !== true) continue; // the ordinary state of a bill; not worth a line
    take(planBillPush(bill, { today }), billLabel(bill));
  }
  for (const row of Array.isArray(plans) ? plans : []) {
    take(planInstallmentPush(row, { today }), planLabel(row));
  }
  for (const row of Array.isArray(whop) ? whop : []) {
    take(planWhopPush(row, { today }), whopLabel(row));
  }
  for (const row of Array.isArray(custom) ? custom : []) {
    if (row && row.phone_alert === false) continue; // the client's own choice; not worth a line
    take(planCustomPush(row, { today }), customLabel(row));
  }
  return { owed, skipped };
}

export default planPhoneAlerts;
