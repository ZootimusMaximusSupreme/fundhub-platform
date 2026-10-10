// Merchant pull sweeper — the daily clock behind "pull my sales by API key".
//
// WHAT ONE PASS DOES. For every live pull connection (merchant_connections
// mode 'pull', status 'active', a key saved — migration 457), read the
// client's processor with their own API key through src/merchant/sync.mjs
// syncConnection(): sales, refunds, fees and (Whop) payouts into
// merchant_events. Unit H5 of ops/workflows/finance-os-wave4-2026-10-06.md.
//
// READS ONLY. Every call is a GET to the client's own processor account, held
// by the ADAPTERS fence (src/merchant/providers/http.mjs). It sends nothing to
// the client and moves no money.
//
// ONE STEP PER CHUNK. An Inngest step runs inside the /api/inngest request,
// which Netlify cuts at 26 seconds. Each connection is read in chunks of
// PAGES_PER_STEP pages, each chunk its own step.run, until the provider says it
// is done or MAX_STEPS_PER_CONNECTION chunks have run. The cursor is saved
// after every page, so whatever is left carries over to tomorrow. Re-reading a
// row is a no-op (UNIQUE (connection_id, provider_event_id)).
//
// NEVER THROWS FOR THE WHOLE PASS. One connection's failure is recorded on its
// row (last_sync_error) and in the tally; the next connection still runs —
// same rule as plaid-transactions-sweeper.mjs.
//
// 07:30 UTC daily: after the 07:00 Plaid pull, so the morning screens have
// last night's sales.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { listPullConnections, getPullConnection } from "../merchant/store.mjs";
import { syncConnection } from "../merchant/sync.mjs";

export const SWEEP_CRON = "30 7 * * *";
export const SOURCE_WORKFLOW = "merchant-pull-sweeper";
export const PAGES_PER_STEP = 5;
export const MAX_STEPS_PER_CONNECTION = 20;

/** one chunk of one connection — never throws. */
async function chunk(conn, id, { env, now, sync, fetchImpl }) {
  try {
    const row = await getPullConnection(conn, id);
    if (!row) return { ok: false, done: true, code: "gone", inserted: 0 };
    const r = await sync(conn, row, { env, now, fetchImpl, maxPages: PAGES_PER_STEP });
    return { ok: !!r.ok, done: !r.ok || !!r.done, code: r.code ?? null, inserted: r.inserted ?? 0 };
  } catch (e) {
    return { ok: false, done: true, code: "errored", error: String(e?.message || e).slice(0, 300), inserted: 0 };
  }
}

/** sweep — one pass. db, env, clock, list and sync are arguments so tests drive
    it without Inngest or a processor. `step` is optional; with it, each chunk
    is its own Inngest step. */
export async function sweep(conn = db, {
  now = new Date(), env = process.env, sync = syncConnection, list = listPullConnections, step = null, fetchImpl = undefined
} = {}) {
  const tally = { checked: 0, synced: 0, partway: 0, inserted: 0, failed: [] };
  const run = (name, fn) => (step && typeof step.run === "function" ? step.run(name, fn) : fn());

  const rows = await run("list-connections", () => list(conn));
  tally.checked = rows.length;

  for (const row of rows) {
    let last = null;
    for (let i = 0; i < MAX_STEPS_PER_CONNECTION; i++) {
      last = await run(`pull-${row.id}-${i}`, () => chunk(conn, row.id, { env, now, sync, fetchImpl }));
      tally.inserted += last.inserted || 0;
      if (last.done) break;
    }
    if (last && last.ok && last.done) tally.synced += 1;
    else if (last && last.ok) tally.partway += 1;
    else tally.failed.push({ connectionId: row.id, code: last?.code ?? null, error: last?.error ?? null });
  }
  return tally;
}

/* handle — the shape src/journeys/runner/registry.mjs expects. A cron, so it
   sits in the runner's neverFired list by design. */
export async function handle({ db: handleDb, step } = {}) {
  return sweep(handleDb || db, { step });
}

export const merchantPullSweeper = inngest.createFunction(
  { id: "merchant-pull-sweeper", name: "Merchant processing daily pull" },
  { cron: SWEEP_CRON },
  ({ step }) => sweep(db, { step })
);

export default sweep;
