// Merchant pull — read a client's processor with their own API key and store
// what it says in merchant_events. Migration 457, mode 'pull'.
//
// Two callers, one function:
//   * the daily sweeper (src/workflows/merchant-pull-sweeper.mjs), every live
//     pull connection;
//   * "Sync now" (POST /api/money/connections { action: "sync" }), one
//     connection on the caller's own file.
//
// WHAT ONE PULL DOES. Decrypt the stored key, ask the provider module
// (src/merchant/providers/<provider>.mjs) for pages until it says it is done
// or the page budget runs out, and write every page as it lands. After each
// page the provider's cursor is saved, so a pull cut short — budget, timeout,
// a 500 from the processor — resumes from the next page instead of starting
// over. Writing a row twice is a no-op (UNIQUE (connection_id,
// provider_event_id)), so overlap is always safe.
//
// THE WINDOW. A fresh pull asks for activity from LOOKBACK_DAYS before the
// last complete pull started — a payment created last week and paid today, or
// a payout created on Monday and completed on Thursday, is still picked up. The
// first pull of a new connection asks for everything.
//
// READS ONLY. Nothing here can refund, charge or pay out. The key never leaves
// this function except in the Authorization / x-api-key header of a GET to the
// processor, and is never written to a log, an error, or a return value.
import { decryptProcessorApiKey } from "./secrets.mjs";
import { recordEvents, saveSyncProgress, saveSyncError } from "./store.mjs";
import { pullProviderFor } from "./providers/index.mjs";
import { MerchantPullError } from "./providers/http.mjs";

export const LOOKBACK_DAYS = 30;
export const DEFAULT_MAX_PAGES = 5;

/* syncConnection(db, row, opts) → {
     ok, done, pages, inserted, duplicates, ignored, code?, error?
   }
   `row` needs id, provider, mode, status, encrypted_api_key, sync_cursor,
   synced_through. Never throws for a processor problem (that is recorded on
   the row and returned); a database fault does throw. */
export async function syncConnection(db, row, {
  env = process.env, fetchImpl = undefined, now = new Date(), maxPages = DEFAULT_MAX_PAGES, provider = null
} = {}) {
  const tally = { ok: false, done: false, pages: 0, inserted: 0, duplicates: 0, ignored: 0 };
  const fail = async (code, error) => {
    await saveSyncError(db, row.id, error);
    return { ...tally, code, error };
  };

  if (!row || row.mode !== "pull") return { ...tally, code: "not_pull", error: "This connection is not read by API key." };
  if (row.status !== "active" || !row.encrypted_api_key) {
    return { ...tally, code: "no_key", error: "Paste your API key first." };
  }
  const mod = provider || pullProviderFor(row.provider);
  if (!mod) return fail("no_provider", `Fundhub cannot read ${row.provider} by API yet.`);

  let apiKey;
  try {
    apiKey = decryptProcessorApiKey(row.encrypted_api_key, { connectionId: row.id, env });
  } catch (err) {
    if (err && err.code === "NOT_CONFIGURED") {
      return fail("not_configured", "Saved API keys cannot be read on this server yet. We are fixing it.");
    }
    if (err && err.code === "SECRET_AUTH_FAILED") {
      return fail("key_unreadable", "The saved API key could not be read. Paste the key again.");
    }
    throw err;
  }

  let cursor = row.sync_cursor || null;
  const since = cursor || !row.synced_through
    ? null
    : new Date(new Date(row.synced_through).getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const budget = Math.max(1, Math.min(50, Number.isInteger(maxPages) ? maxPages : DEFAULT_MAX_PAGES));

  try {
    while (tally.pages < budget) {
      const out = await mod.listEvents({ apiKey, since, cursor, env, fetchImpl });
      tally.pages += 1;
      const events = Array.isArray(out && out.events) ? out.events : [];
      const saved = events.length ? await recordEvents(db, row, events) : { inserted: 0, duplicates: 0 };
      tally.inserted += saved.inserted;
      tally.duplicates += saved.duplicates;
      tally.ignored += Number(out && out.ignored) || 0;
      cursor = out && out.nextCursor ? String(out.nextCursor) : null;
      await saveSyncProgress(db, row.id, { cursor, completedAt: cursor ? null : now.toISOString() });
      if (!cursor) break;
    }
  } catch (err) {
    if (err instanceof MerchantPullError) return fail(err.code, err.message);
    throw err;
  }

  tally.ok = true;
  tally.done = !cursor;
  return tally;
}
