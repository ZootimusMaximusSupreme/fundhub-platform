// money-alerts: every hour, did the texts and phone alerts we promised Finance OS and Capital Blueprint
// clients go out?
//
// Same SQL, same verdict as the morning lanes gap-alerts.mjs (lib/alerts-truth.mjs) and
// gap-phone-alerts.mjs (lib/phone-alerts-truth.mjs). Up to nine reads. No text, no push, no web call.
//
//   alerts:texts-went-out
//     1. every file-protection alert that says a text was queued (src/workflows/blueprint-finance-os-alerts.mjs)
//        has a message that left and arrived, or is still waiting for its hour; not failed, gone, stuck or held
//     2. every card or loan payment reminder the 9 a.m. job (src/workflows/finance-os-card-due-reminders.mjs)
//        owed at its last pass has a text. "Owed" is decided by the job's OWN planner: planCardDue and
//        planLoanDue live in lib/card-due-plan.mjs, and src/banking/card-due-reminders.mjs re-exports them
//        to the job, so the job and this beat cannot disagree about who is owed a reminder.
//
//   alerts:phone-alerts-went-out (Finance OS CFO build unit D, 2026-11-07)
//     every card due date and Important bill the daily pass owed a phone alert has a queued push row, and
//     every recent finance push row was sent, is waiting for its hour, or was stopped by the client.
//     "Owed" is the pass's own planner (lib/phone-alert-plan.mjs, re-exported by
//     src/finance/file-alerts/phone-alerts.mjs).
//
// What it guards, and why each surface is on `covers` (the exact deep checks tripwires.mjs names):
//   route:money/alerts, desk:money-alerts.html,
//   job:blueprint-finance-os-alerts                    alerts:texts-went-out, alerts:phone-alerts-went-out
//   job:finance-os-card-due-reminders                  alerts:texts-went-out
//   job:finance-os-weekly-money (unit AL)              alerts:texts-went-out
// Every check those five name runs here, so all five are on `covers`.
//
// Read only: every read goes through ctx.read (the read box). No send, no write, no web call.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import {
  ALERT_TEXTS_SQL, CARD_CYCLES_SQL, CARD_TEMPLATE_SQL, CARD_TEXTS_SQL, CHECK_IDS as ALERT_CHECK_IDS, runAlertChecks
} from "./lib/alerts-truth.mjs";
import {
  PHONE_CLIENTS_SQL, PHONE_CARDS_SQL, PHONE_BILLS_SQL, OWED_PUSHES_SQL, RECENT_PUSHES_SQL,
  CHECK_IDS as PHONE_CHECK_IDS, runPhoneAlertChecks
} from "./lib/phone-alerts-truth.mjs";

export const HOURLY_CHECK_IDS = Object.freeze([...ALERT_CHECK_IDS, ...PHONE_CHECK_IDS]);

const ONE = (row) => Object.freeze([Object.freeze(row)]);

/* The self test's clock is SELF_TEST_NOW (2026-10-09 19:07 UTC), so the job's last pass is 2026-10-09 and a
   card due 2026-10-11 is owed a reminder. Made-up rows only. */
const OWED_CARD = Object.freeze({
  cycle_id: "c0000000-0000-4000-8000-000000000001",
  client_id: "c1000000-0000-4000-8000-000000000001",
  bank_account_id: "a0000000-0000-4000-8000-000000000001",
  payment_due_day: 11,
  minimum_payment_cents: 135000,
  last_statement_balance_cents: 500000,
  last_statement_date: "2026-09-20",
  raw: Object.freeze({ next_payment_due_date: "2026-10-11" }),
  name: "Business Card",
  mask: "4404",
  current_balance_cents: 500000,
  is_loan: false,
  sms_opted_out: false
});
const OWED_REF = "workflow:SMS-FINANCE-OS-CARD-DUE:card-due:a0000000-0000-4000-8000-000000000001:2026-10-11";
/* The same card owes a phone alert at the 07:30 UTC pass of 2026-10-09; its push row waits for 16:00 UTC. */
const OWED_PUSH_REF = "finance-push:card-due:a0000000-0000-4000-8000-000000000001:2026-10-11";
const PUSH_ROW = Object.freeze({
  provider_ref: OWED_PUSH_REF, template_key: "PUSH-FINANCE-CARD-DUE", status: "sent", last_error: null, blocked_reason: null,
  scheduled_at: "2026-10-09T16:00:00.000Z", created_at: "2026-10-09T07:30:00.000Z", updated_at: "2026-10-09T16:00:04.000Z",
  last_attempt_at: "2026-10-09T16:00:02.000Z"
});

const PASS_ROWS = Object.freeze([
  Object.freeze([ALERT_TEXTS_SQL, ONE({
    kind: "payment_timing", due_on: "2026-10-12", sent_at: "2026-10-09T16:00:00.000Z", message_id: "m0000000-0000-4000-8000-000000000001",
    status: "delivered", blocked_reason: null, message_created_at: "2026-10-09T16:00:00.000Z", due_at: "2026-10-09T16:00:00.000Z",
    last_attempt_at: "2026-10-09T16:00:05.000Z"
  })]),
  Object.freeze([CARD_CYCLES_SQL, ONE(OWED_CARD)]),
  Object.freeze([CARD_TEMPLATE_SQL, ONE({ compliance_passed: true })]),
  Object.freeze([CARD_TEXTS_SQL, ONE({
    provider_ref: OWED_REF, status: "delivered", blocked_reason: null, due_at: "2026-10-09T16:00:00.000Z",
    last_attempt_at: "2026-10-09T16:00:05.000Z", message_created_at: "2026-10-09T16:00:00.000Z", message_id: "m0000000-0000-4000-8000-000000000002"
  })]),
  Object.freeze([PHONE_CLIENTS_SQL, ONE({ client_id: OWED_CARD.client_id })]),
  Object.freeze([PHONE_CARDS_SQL, ONE({ ...OWED_CARD, last_statement_date: "2026-09-20" })]),
  Object.freeze([PHONE_BILLS_SQL, Object.freeze([])]),
  Object.freeze([OWED_PUSHES_SQL, ONE(PUSH_ROW)]),
  Object.freeze([RECENT_PUSHES_SQL, ONE(PUSH_ROW)])
]);

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => {
    const db = { query: (sql, params) => io.read(sql, params) };
    return [
      ...(await runAlertChecks({ db, orgId: io.orgId, now: io.now })),
      ...(await runPhoneAlertChecks({ db, orgId: io.orgId, now: io.now }))
    ];
  },
  selfTest: Object.freeze({
    passRows: PASS_ROWS,
    // The job owed a payment reminder for a card due in two days and no text exists: red at alerts-texts-went-out.
    // The pass owed that card a phone alert and no push row exists: red at alerts-phone-alerts-went-out.
    failRows: Object.freeze([
      Object.freeze([CARD_TEXTS_SQL, Object.freeze([])]),
      Object.freeze([OWED_PUSHES_SQL, Object.freeze([])])
    ])
  })
});

export const id = "money-alerts";
export const title = "Promised client alert texts and phone alerts went out";
export const kind = "probe";
export const covers = [
  "route:money/alerts",
  "desk:money-alerts.html",
  "job:blueprint-finance-os-alerts",
  "job:finance-os-card-due-reminders",
  // Unit AL, 2026-11-07: the Monday money text writes the same file_protection_alerts rows this beat reads.
  "job:finance-os-weekly-money"
];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 9000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "alert" });
}

export const fixGuide = [
  "A promised alert text or card-due payment text to a client did not go out, or the daily job never queued it.",
  "",
  "Likely causes:",
  "- The card-due template SMS-FINANCE-OS-CARD-DUE is not approved (compliance_passed false), so the 9 a.m. job queued nothing.",
  "- The job finance-os-card-due-reminders or blueprint-finance-os-alerts did not run, or the client has no phone on file.",
  "- The text provider failed it, our own gate held it (blocked for a reason other than STOP), or the dispatcher left it queued.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs money-alerts and read the red step: it names the alert kind, or the card and its due date.",
  "- Read the file_protection_alerts row and the messages row it points at, or the account_statement_cycles row and the",
  "  messages row whose provider_ref is workflow:SMS-FINANCE-OS-CARD-DUE:card-due:<account>:<due date>.",
  "- A phone alert (alerts-phone-alerts-went-out): read the messages row with channel push and provider_ref",
  "  finance-push:<key>. No row means the 07:30 UTC pass did not queue it (src/finance/file-alerts/run.mjs step 5).",
  "  A row stuck queued means the dispatcher did not claim it. A row left sending had an unknown outcome: never resend it.",
  "- A person fixes it. Do not send from the pulse, do not change the outbound switch, do not re-run the job from here.",
  "Files: src/pulse/beats/lib/alerts-truth.mjs, src/pulse/beats/lib/card-due-plan.mjs, src/pulse/beats/lib/phone-alerts-truth.mjs, src/push/finance-alerts.mjs, src/workflows/finance-os-card-due-reminders.mjs, src/workflows/blueprint-finance-os-alerts.mjs, src/messaging/dispatch.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
