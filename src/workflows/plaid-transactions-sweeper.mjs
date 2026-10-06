// Plaid transactions sweeper — the daily clock behind "charges and deposits".
//
// WHAT ONE PASS DOES. For every client holding an active, consented Plaid login
// (clientsWithPlaid()), run syncClientTransactions(): read new charges and
// deposits from Plaid into bank_transactions, then re-run the repeating-bill
// detector for that client. Unit A of ops/workflows/finance-os-build-2026-10-06.md.
//
// DOES NOTHING WHEN PLAID IS NOT CONFIGURED. isPlaidEnabled() is checked first;
// with PLAID_CLIENT_ID / PLAID_SECRET / PLAID_TOKEN_ENC_KEY missing the pass
// returns { skipped: "not_configured" } without reading a single row.
//
// READS ONLY. Plaid's /transactions/sync is a read of the client's own bank. It
// sends nothing to the client and moves no money.
//
// ONE STEP PER CLIENT. An Inngest pass runs inside the /api/inngest request,
// which Netlify cuts at 26 seconds. Each client gets its own step.run so one
// slow bank cannot sink the rest, and a retry re-runs only that client. Re-
// running is safe: every row upserts on (bank_account_id,
// provider_transaction_id).
//
// NEVER THROWS FOR THE WHOLE PASS. One client's failure is recorded in the tally
// and the next client still runs — same rule as finance-os-pull-sweeper.mjs.
//
// 07:00 UTC daily: after the 06:00 finance-os pull sweeper, so the morning
// screens have last night's bank activity.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { isPlaidEnabled } from "../banking/plaid.mjs";
import { syncClientTransactions, clientsWithPlaid } from "../banking/plaid-transactions.mjs";

export const SWEEP_CRON = "0 7 * * *";
export const SOURCE_WORKFLOW = "plaid-transactions-sweeper";

/** syncOne — one client, never throws. */
async function syncOne(conn, row, { env, now, sync }) {
  try {
    const r = await sync(conn, { orgId: row.org_id, clientId: row.client_id, env, asOf: now.toISOString() });
    return {
      clientId: row.client_id,
      ok: !!r.ok,
      reason: r.reason ?? null,
      written: r.totals?.written ?? 0,
      bills: r.bills?.bills ?? 0
    };
  } catch (e) {
    return { clientId: row.client_id, ok: false, reason: "errored", error: String(e?.message || e).slice(0, 300) };
  }
}

/** sweep — one pass. `db`, env, clock and the sync are arguments so tests drive
    it without Inngest or Plaid. `step` is optional; with it, each client is its
    own Inngest step. */
export async function sweep(conn = db, {
  now = new Date(), env = process.env, sync = syncClientTransactions, list = clientsWithPlaid, step = null
} = {}) {
  const tally = { skipped: null, checked: 0, synced: 0, written: 0, failed: [] };
  if (!isPlaidEnabled(env)) {
    tally.skipped = "not_configured";
    return tally;
  }

  const run = (name, fn) => (step && typeof step.run === "function" ? step.run(name, fn) : fn());

  const rows = await run("list-clients", () => list(conn));
  tally.checked = rows.length;

  for (const row of rows) {
    const one = await run(`sync-${row.client_id}`, () => syncOne(conn, row, { env, now, sync }));
    if (one.ok) {
      tally.synced += 1;
      tally.written += one.written;
    } else {
      tally.failed.push({ clientId: one.clientId, reason: one.reason, error: one.error ?? null });
    }
  }
  return tally;
}

/* handle — the shape src/journeys/runner/registry.mjs expects. A cron, so it
   sits in the runner's neverFired list by design. */
export async function handle({ db: handleDb, step } = {}) {
  return sweep(handleDb || db, { step });
}

export const plaidTransactionsSweeper = inngest.createFunction(
  { id: "plaid-transactions-sweeper", name: "Plaid transactions daily sync" },
  { cron: SWEEP_CRON },
  ({ step }) => sweep(db, { step })
);

export default sweep;
