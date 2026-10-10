// Plaid transactions sweeper — the daily clock behind "charges and deposits".
//
// WHAT ONE PASS DOES. For every client holding an active, consented Plaid login
// (clientsWithPlaid()), in this order:
//   1. refreshClientAccounts(): re-read each login's account list and balances into
//      bank_accounts, so balances are today's and a card opened since yesterday
//      exists (src/banking/plaid-refresh.mjs). Unit F1 of FinanceOS.
//   2. syncClientTransactions(): read new charges and deposits from Plaid into
//      bank_transactions, then re-run the repeating-bill detector for that client.
//      Unit A of ops/workflows/finance-os-build-2026-10-06.md.
// Then, ONCE, after every client (FinanceOS F2):
//   3. queueReconnectNotices(): a login either read above sent to 'error' (Plaid says
//      the client must sign in again) — or any login an earlier day left there — gets
//      ONE text: "your bank connection needs a quick reconnect in FinanceOS"
//      (src/finance/bank-reconnect-notice.mjs). Finance OS clients and Blueprint
//      buyers only; once per error episode. HELD: the template is seeded NOT
//      approved (migration 474) until the Reconnect screen ships, so today this
//      step queues nothing and marks nobody. It runs after the loop, as its own step,
//      because a broken login drops out of clientsWithPlaid() — the list the loop
//      walks — so a client's only login going bad would never be seen by a per-client
//      step on the NEXT pass.
//
// ACCOUNTS FIRST, AND WHY. Everything that runs after 07:00 UTC reads bank_accounts
// as it stands: the trend snapshots and the file-protection alerts at 07:30, the card
// reminders at 16:00. And a transaction is only stored for an account that is already
// in bank_accounts, so a card that opened yesterday would have had its charges dropped
// ("account_not_saved") until something wrote the card. A refresh that fails (or
// throws) is recorded under tally.accounts and NEVER stops the transactions sync — the
// two reads are separate asks of Plaid and one being down says nothing about the other.
//
// DOES NOTHING WHEN PLAID IS NOT CONFIGURED. isPlaidEnabled() is checked first;
// with PLAID_CLIENT_ID / PLAID_SECRET / PLAID_TOKEN_ENC_KEY missing the pass
// returns { skipped: "not_configured" } without reading a single row.
//
// THE PLAID READS SEND NOTHING. /accounts/get and /transactions/sync are reads of the
// client's own bank and move no money. (The refresh WRITES bank_accounts — balances
// and new accounts — and never deletes or closes one.) The one thing in this pass that
// reaches a client is step 3's text, and it only QUEUES it: sendTemplated writes a
// `messages` row at status='queued', and the dispatcher sends it behind the dry-run
// fence, quiet hours and the opt-out read.
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
import { refreshClientAccounts } from "../banking/plaid-refresh.mjs";
import { queueReconnectNotices } from "../finance/bank-reconnect-notice.mjs";

export const SWEEP_CRON = "0 7 * * *";
export const SOURCE_WORKFLOW = "plaid-transactions-sweeper";

/** refreshOne — one client's accounts and balances, never throws. */
async function refreshOne(conn, row, { env, now, refresh }) {
  try {
    const r = await refresh(conn, { orgId: row.org_id, clientId: row.client_id, env, asOf: now.toISOString() });
    return {
      ok: !!r.ok,
      reason: r.reason ?? null,
      created: r.totals?.created ?? 0,
      vanished: r.totals?.vanished ?? 0,
      balancesChanged: r.totals?.balancesChanged ?? 0,
      relink: r.totals?.relink ?? 0
    };
  } catch (e) {
    return { ok: false, reason: "errored", error: String(e?.message || e).slice(0, 300) };
  }
}

/** syncOne — one client, never throws. Accounts first, then transactions. */
async function syncOne(conn, row, { env, now, sync, refresh }) {
  const accounts = await refreshOne(conn, row, { env, now, refresh });
  try {
    const r = await sync(conn, { orgId: row.org_id, clientId: row.client_id, env, asOf: now.toISOString() });
    return {
      clientId: row.client_id,
      ok: !!r.ok,
      reason: r.reason ?? null,
      written: r.totals?.written ?? 0,
      bills: r.bills?.bills ?? 0,
      accounts
    };
  } catch (e) {
    return { clientId: row.client_id, ok: false, reason: "errored", error: String(e?.message || e).slice(0, 300), accounts };
  }
}

/** reconnectNotices — the one text for every login left in 'error', never throws.
    Counts only: the rows it looked at are in the notice module's own result. */
async function reconnectNotices(conn, { now, notify }) {
  try {
    const r = await notify(conn, { now });
    return {
      ok: true,
      checked: r?.checked ?? 0,
      queued: r?.queued ?? 0,
      notEntitled: r?.notEntitled ?? 0,
      notQueued: (r?.notQueued ?? []).length,
      skipped: (r?.skipped ?? []).length,
      errored: r?.errored ?? []
    };
  } catch (e) {
    return {
      ok: false, checked: 0, queued: 0, notEntitled: 0, notQueued: 0, skipped: 0,
      errored: [{ error: String(e?.message || e).slice(0, 300) }]
    };
  }
}

/** sweep — one pass. `db`, env, clock and the two syncs are arguments so tests
    drive it without Inngest or Plaid. `step` is optional; with it, each client is
    its own Inngest step, and the reconnect texts are one more at the end. */
export async function sweep(conn = db, {
  now = new Date(), env = process.env, sync = syncClientTransactions, refresh = refreshClientAccounts,
  list = clientsWithPlaid, notify = queueReconnectNotices, step = null
} = {}) {
  const tally = {
    skipped: null, checked: 0, synced: 0, written: 0, failed: [],
    /* the account refresh, kept apart from the transactions numbers above:
       `created` = accounts that did not exist yesterday, `vanished` = accounts
       Plaid stopped listing (reported, never closed), `relink` = logins whose
       client must sign in at the bank again. */
    accounts: { refreshed: 0, created: 0, vanished: 0, balancesChanged: 0, relink: 0, failed: [] },
    /* the one "needs a quick reconnect" text per broken login (FinanceOS F2). null
       until the step has run. `queued` = texts written to the outbox this pass. */
    reconnect: null
  };
  if (!isPlaidEnabled(env)) {
    tally.skipped = "not_configured";
    return tally;
  }

  const run = (name, fn) => (step && typeof step.run === "function" ? step.run(name, fn) : fn());

  const rows = await run("list-clients", () => list(conn));
  tally.checked = rows.length;

  for (const row of rows) {
    const one = await run(`sync-${row.client_id}`, () => syncOne(conn, row, { env, now, sync, refresh }));
    if (one.ok) {
      tally.synced += 1;
      tally.written += one.written;
    } else {
      tally.failed.push({ clientId: one.clientId, reason: one.reason, error: one.error ?? null });
    }
    const a = one.accounts;
    if (a?.ok) tally.accounts.refreshed += 1;
    else tally.accounts.failed.push({ clientId: one.clientId, reason: a?.reason ?? null, error: a?.error ?? null });
    tally.accounts.created += a?.created ?? 0;
    tally.accounts.vanished += a?.vanished ?? 0;
    tally.accounts.balancesChanged += a?.balancesChanged ?? 0;
    tally.accounts.relink += a?.relink ?? 0;
  }

  tally.reconnect = await run("reconnect-notices", () => reconnectNotices(conn, { now, notify }));
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
