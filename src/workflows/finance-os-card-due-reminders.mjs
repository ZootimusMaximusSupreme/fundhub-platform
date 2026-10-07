// Finance OS card due reminders — the daily clock.
//
// ONE PASS: for every client with an active `finance-os` subscription,
//   1. read fresh card bills from Plaid (syncClientLiabilities) when the client
//      has a linked bank login,
//   2. for each card due in 0-3 days with no payment on file, write ONE
//      cashflow_reminders row, then
//   3. queue ONE text through sendTemplated.
//
// IT NEVER MOVES MONEY AND IT DOES NOT SEND. sendTemplated writes a `messages`
// row at status='queued'. The dispatcher (src/messaging/dispatch.mjs) is the only
// thing that hands it to a provider, behind the dry-run fence, the per-company
// outbound switch, quiet hours and the gate's fresh opt-out read. sendTemplated
// also refuses an opted-out client before writing anything.
//
// CLAIM, THEN QUEUE — the order src/nudge/run.mjs uses. The reminder row is
// written first; the text is queued second. Both are keyed on the card and its
// due date (see src/banking/card-due-reminders.mjs), so a retried job, a second
// scheduler or tomorrow's pass all collapse into the one text. A pass that dies
// between the two is picked up by the next pass, and sendTemplated's provider_ref
// stops it from ever queueing twice.
//
// NEVER THROWS FOR THE WHOLE PASS. One client's Plaid error or bad row is
// recorded in the tally and the next client runs — same as
// finance-os-pull-sweeper.mjs.
//
// ONLY PLAID CARDS ARE REMINDED. A cycle typed in by hand (source='manual') has
// no exact due date and no payment record, so it cannot say "no payment on
// file" truthfully. Those rows are left alone.
//
// LOANS TOO (wave 3, G2) — hand-entered or not. A loan's payment is fixed and
// due every month on its due day, so the schedule alone is enough to say "your
// SBA Loan payment of $1,050.00 is due Nov 1" truthfully (planLoanDue). Same
// window, same one-text-per-due-date keys, same template. The reminder row is
// filed under subject_kind 'loan' (451), not 'card_liability'.
//
// WHY HERE AND NOT THE MONEY HELPER (src/finance/money-agent.mjs). The helper
// owns what happens AFTER a due date (late check-ins, a CSM task) and says in
// its header that reminders before a due date are this job's, so it never
// repeats them. A loan's before-the-date reminder is the same job as a card's.
// No new workflow, no new template. loanCycles is a separate query so
// providerCycles — which the money helper also reads — still returns cards only.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { sendTemplated as defaultSend } from "./messaging.mjs";
import { entitledFinanceOsClients } from "./blueprint-finance-os-alerts.mjs";
import { syncClientLiabilities as defaultSync } from "../banking/plaid-liabilities.mjs";
import { createReminder as defaultCreateReminder } from "../banking/reminders.mjs";
import { planCardDue, planLoanDue, TEMPLATE_KEY } from "../banking/card-due-reminders.mjs";

export const SWEEP_CRON = "0 16 * * *"; // 16:00 UTC = 9am Arizona, inside the SMS day window
export const SOURCE_WORKFLOW = "finance-os-card-due-reminders";

/** Plaid-sourced card cycles for one client, joined to the card's name. Closed
 *  cards are skipped — a closed card has no bill to remind about. */
export async function providerCycles(conn, { orgId, clientId }) {
  const res = await conn.query(
    `SELECT c.id AS cycle_id, c.bank_account_id, c.minimum_payment_cents,
            c.last_statement_balance_cents, c.last_statement_date, c.raw,
            a.name, a.mask
       FROM account_statement_cycles c
       JOIN bank_accounts a ON a.id = c.bank_account_id
      WHERE c.org_id = $1 AND c.client_id = $2
        AND c.source = 'provider'
        AND a.closed_at IS NULL`,
    [orgId, clientId]
  );
  return res.rows;
}

/** Loan cycles for one client, any source (a hand-entered loan counts), joined
 *  to the loan's name and balance. Closed loans are skipped. */
export async function loanCycles(conn, { orgId, clientId }) {
  const res = await conn.query(
    `SELECT c.id AS cycle_id, c.bank_account_id, c.payment_due_day, c.minimum_payment_cents,
            c.raw, a.name, a.mask, a.current_balance_cents
       FROM account_statement_cycles c
       JOIN bank_accounts a ON a.id = c.bank_account_id AND a.org_id = c.org_id
      WHERE c.org_id = $1 AND c.client_id = $2
        AND a.account_type = 'loan'
        AND a.closed_at IS NULL`,
    [orgId, clientId]
  );
  return res.rows;
}

/**
 * remindClient(conn, { orgId, clientId, todayIso, send, createReminder })
 * — step 2 and 3 for one client. Exported so the endpoint and tests can drive it.
 */
export async function remindClient(conn, {
  orgId, clientId, todayIso, send = defaultSend, createReminder = defaultCreateReminder
} = {}) {
  const out = { cards: 0, loans: 0, reminded: 0, alreadyReminded: 0, queued: 0, notQueued: [], skipped: [] };
  const cardRows = await providerCycles(conn, { orgId, clientId });
  const loanRows = await loanCycles(conn, { orgId, clientId });
  out.cards = cardRows.length;
  out.loans = loanRows.length;

  const work = [
    ...cardRows.map((row) => ({ row, subjectKind: "card_liability", plan: planCardDue(row, { today: todayIso }) })),
    ...loanRows.map((row) => ({ row, subjectKind: "loan", plan: planLoanDue(row, { today: todayIso }) }))
  ];

  for (const { row, subjectKind, plan } of work) {
    if (!plan.remind) {
      out.skipped.push({ bankAccountId: row.bank_account_id, reason: plan.reason });
      continue;
    }

    const claim = await createReminder(conn, {
      orgId,
      clientId,
      subjectKind,
      subjectId: row.bank_account_id,
      subjectLabel: plan.label,
      reminderKind: "payment_due",
      body: plan.body,
      surfaceAt: plan.surfaceAt
    });
    if (claim.created) out.reminded += 1;
    else out.alreadyReminded += 1;

    const sent = await send(conn, {
      orgId,
      clientId,
      channel: "sms",
      templateKey: TEMPLATE_KEY,
      eventId: plan.eventId,
      context: { card: plan.card }
    });
    if (sent?.sent) out.queued += 1;
    else out.notQueued.push({ bankAccountId: row.bank_account_id, reason: sent?.reason ?? "not_sent" });
  }
  return out;
}

function utcDate(now) {
  return now.toISOString().slice(0, 10);
}

/** sweep — one pass. db, clock, Plaid and send are arguments so tests drive it
    without Inngest or a network. Returns a tally, never throws per client. */
export async function sweep(conn = db, {
  now = new Date(), env = process.env, send = defaultSend, sync = defaultSync, createReminder = defaultCreateReminder
} = {}) {
  const todayIso = utcDate(now);
  const tally = { checked: 0, synced: 0, syncErrors: [], reminded: 0, queued: 0, errored: [] };
  const clients = await entitledFinanceOsClients(conn, now);
  tally.checked = clients.length;

  for (const c of clients) {
    try {
      const s = await sync(conn, { orgId: c.org_id, clientId: c.client_id, env, asOf: now.toISOString() });
      if (s?.ok) {
        tally.synced += s.written || 0;
        for (const it of s.items || []) {
          if (!it.ok) tally.syncErrors.push({ clientId: c.client_id, itemRowId: it.itemRowId, errorCode: it.errorCode });
        }
      } else if (s && s.reason !== "not_configured") {
        tally.syncErrors.push({ clientId: c.client_id, errorCode: s.reason });
      }

      const r = await remindClient(conn, { orgId: c.org_id, clientId: c.client_id, todayIso, send, createReminder });
      tally.reminded += r.reminded;
      tally.queued += r.queued;
    } catch (e) {
      tally.errored.push({ clientId: c.client_id, error: String(e?.message || e).slice(0, 300) });
    }
  }
  return tally;
}

/* handle — the shape src/journeys/runner/registry.mjs expects. A cron with no
   event trigger, so it sits in the runner's neverFired list by design. */
export async function handle({ db: handleDb, step } = {}) {
  const run = () => sweep(handleDb || db);
  return step && typeof step.run === "function" ? step.run("sweep", run) : run();
}

export const financeOsCardDueReminders = inngest.createFunction(
  { id: "finance-os-card-due-reminders", name: "Finance OS card due reminders" },
  { cron: SWEEP_CRON },
  () => sweep(db)
);

export default sweep;
