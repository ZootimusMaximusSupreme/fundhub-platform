// Blueprint + Finance OS file-protection alerts — the daily clock.
//
// WHAT USED TO BE HERE. A stub: it worked out each card's due date and sent
// nothing, and its promo sweep was a documented no-op. As of migration 471 it sends.
//
// ONE PASS: for every client who is a paid Capital Blueprint buyer or holds an
// active Finance OS subscription, run the four alerts (src/finance/file-alerts/):
//   payment timing  a card's statement closes in a few days -> pay it down first
//   promo end       a card's promo rate ends in 60 / 30 / 7 days
//   cash cushion    personal or business cash fell below six months of minimums
//   new credit      a new card, loan or inquiry showed up (and a CSM task on a
//                   Blueprint file)
// Spec and the JSON the screen reads: docs/finance/file-protection-alerts.md.
//
// IT DOES NOT SEND. Each alert goes through sendTemplated, which only writes a
// `messages` row at status='queued'. The dispatcher (src/messaging/dispatch.mjs)
// is the only thing that hands it to a provider — behind the dry-run fence, the
// per-company outbound switch, quiet hours and the fresh opt-out read. It moves no
// money.
//
// EXTENDED, NOT REPLACED. Two other workflows import entitledFinanceOsClients from
// this file (finance-os-card-due-reminders, finance-os-money-agent), so that
// function and its query are exactly as they were. No new workflow is registered:
// this is the same Inngest function id, so the registered count does not move.
//
// ONE STEP PER CLIENT. An Inngest pass runs inside the /api/inngest request, which
// Netlify cuts at 26 seconds; each client gets its own step.run so one slow client
// cannot sink the rest, and a retry re-runs only that client. NEVER THROWS FOR THE
// WHOLE PASS — one client's failure is recorded in the tally and the next runs.
//
// 07:30 UTC daily: after the 07:00 Plaid transactions pull. A text queued here
// waits for the dispatcher's quiet-hours window like any other.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { FINANCE_OS_TIER } from "../finance/finance-os-entitlement.mjs";
import { formatIsoDate, nextDueDate } from "../banking/statement-cycles.mjs";
import { PAID_TRANSACTION_STATUS } from "../entitlements/entitlements.mjs";
import { BLUEPRINT_PRODUCT_CODE } from "../waypoints/purchase.mjs";
import { runFileAlerts } from "../finance/file-alerts/run.mjs";

export const SWEEP_CRON = "30 7 * * *";
export const SOURCE_WORKFLOW = "blueprint-finance-os-alerts";

export async function entitledFinanceOsClients(conn, now) {
  const res = await conn.query(
    `SELECT s.org_id, s.client_id
       FROM subscriptions s
      WHERE s.tier = $1
        AND s.status = 'active'
        AND s.effective_from <= $2
        AND (s.effective_to IS NULL OR s.effective_to > $2)
        AND s.client_id IS NOT NULL`,
    [FINANCE_OS_TIER, now]
  );
  return res.rows;
}

/** Every client who has paid for the Capital Blueprint. The same query the closer-ready
 *  sweeper uses (src/workflows/blueprint-closer-ready-sweeper.mjs). */
export async function blueprintBuyerClients(conn) {
  const res = await conn.query(
    `SELECT DISTINCT c.org_id, c.id AS client_id
       FROM clients c
       JOIN transactions t ON t.client_id = c.id AND t.org_id = c.org_id
       JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
      WHERE lower(p.code) = lower($1)
        AND lower(btrim(COALESCE(t.status, ''))) = $2`,
    [BLUEPRINT_PRODUCT_CODE, PAID_TRANSACTION_STATUS]
  );
  return res.rows;
}

/** Who gets the alerts: Blueprint buyers and Finance OS subscribers, once each. */
export async function alertAudience(conn, now) {
  const [finance, blueprint] = await Promise.all([
    entitledFinanceOsClients(conn, now),
    blueprintBuyerClients(conn)
  ]);
  const seen = new Map();
  for (const row of [...finance, ...blueprint]) {
    if (!row || !row.org_id || !row.client_id) continue;
    const key = `${row.org_id}|${row.client_id}`;
    if (!seen.has(key)) seen.set(key, { org_id: row.org_id, client_id: row.client_id });
  }
  return [...seen.values()];
}

export async function paymentTimingHints(conn, { orgId, clientId, todayIso }) {
  const res = await conn.query(
    `SELECT statement_close_day, payment_due_day
       FROM account_statement_cycles
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 20`,
    [orgId, clientId]
  );
  const hints = [];
  for (const row of res.rows) {
    const due = nextDueDate(row, { today: todayIso });
    if (due.dueOn) {
      hints.push({
        paymentDueDay: row.payment_due_day,
        statementCloseDay: row.statement_close_day,
        nextDueOn: due.dueOn,
        daysAway: due.daysAway
      });
    }
  }
  return hints;
}

/** sweep — one pass. db, clock, env and the per-client run are arguments so tests
    drive it without Inngest, Postgres or a message. `step` is optional; with it,
    each client is its own Inngest step. Returns a tally, never throws per client. */
export async function sweep(conn = db, {
  now = new Date(), env = process.env, step = null, run = runFileAlerts, audience = alertAudience
} = {}) {
  const todayIso = formatIsoDate({
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate()
  });
  const tally = {
    day: todayIso, checked: 0, texts: 0, tasks: 0, rearmed: 0, held: 0, notQueued: 0,
    byKind: { payment_timing: 0, promo_end: 0, cash_reserve: 0, new_credit: 0 },
    errored: []
  };
  const inStep = (name, fn) => (step && typeof step.run === "function" ? step.run(name, fn) : fn());

  const clients = await inStep("audience", () => audience(conn, now));
  tally.checked = clients.length;

  for (const c of clients) {
    try {
      const r = await inStep(`alerts-${c.client_id}`, () =>
        run(conn, { orgId: c.org_id, clientId: c.client_id, now, env }));
      if (!r || r.ok === false) {
        tally.errored.push({ clientId: c.client_id, error: (r && r.reason) || "no_result" });
        continue;
      }
      for (const s of r.sent || []) {
        if (s.delivery === "text") tally.texts += 1;
        if (s.taskId) tally.tasks += 1;
        if (tally.byKind[s.kind] !== undefined) tally.byKind[s.kind] += 1;
      }
      tally.rearmed += (r.rearmed || []).length;
      tally.held += (r.held || []).length;
      tally.notQueued += (r.notQueued || []).length;
      for (const e of r.errors || []) tally.errored.push({ clientId: c.client_id, kind: e.kind, error: e.error });
    } catch (e) {
      tally.errored.push({ clientId: c.client_id, error: String((e && e.message) || e).slice(0, 300) });
    }
  }
  return tally;
}

/* handle — the shape src/journeys/runner/registry.mjs expects. A cron with no event
   trigger, so it sits in the runner's neverFired list by design. */
export async function handle({ db: handleDb, step } = {}) {
  return sweep(handleDb || db, { step });
}

export const blueprintFinanceOsAlerts = inngest.createFunction(
  { id: "blueprint-finance-os-alerts", name: "Blueprint file-protection alerts" },
  { cron: SWEEP_CRON },
  ({ step }) => sweep(db, { step })
);

export default sweep;
