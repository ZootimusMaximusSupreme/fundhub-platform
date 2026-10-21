// Card due reminders — the pure half. Decides, for one card's or loan's statement cycle,
// whether a payment reminder is owed today and what it says. No database, no clock, no
// send. src/workflows/finance-os-card-due-reminders.mjs does the rest.
//
// IT NEVER MOVES MONEY. It reads a due date and writes a sentence.
//
// THE CODE NOW LIVES IN src/pulse/beats/lib/card-due-plan.mjs (2026-10-20). It moved there
// so the daily job and the hourly pulse beat money-alerts run ONE planner: the beat asks
// "did every reminder the job owed go out?" and must decide "owed" exactly the way the job
// does. A beat may import only from src/pulse/beats/lib, so the planner went to the library
// and this file re-exports every name it used to export. Every caller (the job, the money
// screens, the file alerts, the tests) imports from here unchanged.
//
// The window, the one-reminder-per-due-date keys, Plaid's due date, the narrow "no payment
// on file" rule and the loan schedule are documented at the top of that file.

import plan from "../pulse/beats/lib/card-due-plan.mjs";

export {
  planCardDue,
  planLoanDue,
  loanDueOn,
  cardLabel,
  loanLabel,
  shortDate,
  dollars,
  TEMPLATE_KEY,
  REMIND_DAYS_BEFORE
} from "../pulse/beats/lib/card-due-plan.mjs";

export default plan;
