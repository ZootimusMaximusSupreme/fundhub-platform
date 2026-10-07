// FinanceOS trend snapshots — the daily clock behind the Trends line charts.
//
// ONE PASS: for every client with at least one open bank account,
//   1. snapshotClient(): write today's balances per account and today's
//      rollups (cash per kind, debt, cards used %) — finance_account_daily /
//      finance_client_daily, migration 458;
//   2. backfillClient(): rebuild past daily balances for checking and savings
//      from bank_transactions, marked estimated. A real snapshot is never
//      overwritten by an estimate.
// Unit H6 of ops/workflows/finance-os-wave4-2026-10-06.md.
//
// READS AND RECORDS ONLY. It sends nothing to anybody and moves no money.
//
// IDEMPOTENT. One row per (account, day) and per (client, day). A retried job or
// a second scheduler the same day updates the same rows.
//
// ONE STEP PER CLIENT. An Inngest pass runs inside the /api/inngest request,
// which Netlify cuts at 26 seconds; each client gets its own step.run so one
// slow client cannot sink the rest. NEVER THROWS FOR THE WHOLE PASS — one
// client's failure is recorded in the tally and the next client runs.
//
// 07:30 UTC daily: after the 07:00 Plaid transactions pull
// (plaid-transactions-sweeper), so the backfill sees last night's activity.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { clientsToSnapshot, snapshotClient, backfillClient } from "../finance/money-trends.mjs";

export const SWEEP_CRON = "30 7 * * *";
export const SOURCE_WORKFLOW = "finance-os-trend-snapshots";

/** One client, never throws. */
async function runOne(conn, row, { day, snapshot, backfill }) {
  try {
    const s = await snapshot(conn, { orgId: row.org_id, clientId: row.client_id, day });
    const b = await backfill(conn, { orgId: row.org_id, clientId: row.client_id, today: day });
    return { clientId: row.client_id, ok: true, accounts: s.accounts, estimatedDays: b.rollupRows };
  } catch (e) {
    return { clientId: row.client_id, ok: false, error: String(e?.message || e).slice(0, 300) };
  }
}

/** sweep — one pass. db, clock and the writers are arguments so tests drive it
    without Inngest or Postgres. `step` is optional; with it, each client is its
    own Inngest step. */
export async function sweep(conn = db, {
  now = new Date(), list = clientsToSnapshot, snapshot = snapshotClient, backfill = backfillClient, step = null
} = {}) {
  const day = now.toISOString().slice(0, 10);
  const tally = { day, checked: 0, snapshotted: 0, accounts: 0, estimatedDays: 0, failed: [] };
  const run = (name, fn) => (step && typeof step.run === "function" ? step.run(name, fn) : fn());

  const rows = await run("list-clients", () => list(conn));
  tally.checked = rows.length;
  for (const row of rows) {
    const one = await run(`snapshot-${row.client_id}`, () => runOne(conn, row, { day, snapshot, backfill }));
    if (one.ok) {
      tally.snapshotted += 1;
      tally.accounts += one.accounts || 0;
      tally.estimatedDays += one.estimatedDays || 0;
    } else {
      tally.failed.push({ clientId: one.clientId, error: one.error ?? null });
    }
  }
  return tally;
}

/* handle — the shape src/journeys/runner/registry.mjs expects. A cron with no
   event trigger, so it sits in the runner's neverFired list by design. */
export async function handle({ db: handleDb, step } = {}) {
  return sweep(handleDb || db, { step });
}

export const financeOsTrendSnapshots = inngest.createFunction(
  { id: "finance-os-trend-snapshots", name: "FinanceOS trend snapshots" },
  { cron: SWEEP_CRON },
  ({ step }) => sweep(db, { step })
);

export default sweep;
