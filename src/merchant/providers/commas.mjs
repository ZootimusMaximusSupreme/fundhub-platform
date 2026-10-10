// Commas — pull a client's sales, fees and refunds with THEIR API key.
//
// Docs read 2026-10-06 at https://commasdocs.com (the Commas API Reference;
// src/payments/commas-api.mjs cites the same site for Fundhub's own account):
//
//   Environments — "Production … Base URL: https://www.fanbasis.com".
//     Use the www host: "The apex domain (https://fanbasis.com) answers with a
//     301 redirect". Auth header `x-api-key` with the seller API key
//     (Account → API Keys in the Commas dashboard). Payments read access is
//     the key's "payments  /public-api/transactions/*" scope.
//   List Transactions — GET /public-api/checkout-sessions/transactions
//     "Returns every payment that's been made across all your products. Each
//     result shows who paid, what they bought, your fee, and your net payout."
//     Query: page (starts at 1), per_page (max 100), product_id, customer_id.
//     Response: data.transactions[] and data.pagination { current_page,
//     total_pages, per_page, total_items, has_more }.
//   Pagination — "There are no sort or order parameters — ordering is fixed
//     per endpoint." "use data.pagination.has_more".
//
// WHAT COMMAS DOES NOT HAVE, SAID PLAINLY:
//   * NO PAYOUT ENDPOINT. The public API documents checkout sessions,
//     products, discount codes, transactions, refunds (create only), webhooks,
//     customers, subscriptions and invoices. Nothing lists payouts to the
//     seller's bank, so a Commas pull carries sales, fees and refunds only.
//   * NO DATE FILTER on List Transactions. `since` is ignored and every pull
//     walks the list from page 1. Re-reading a row is a no-op
//     (merchant_events UNIQUE (connection_id, provider_event_id)).
//   * NO SEPARATE REFUND LIST. Refunds come from each transaction's `refunds`
//     array (src/merchant/normalize.mjs commasTransactionEvents).
//
// listEvents({ apiKey, since, cursor }) → { events, nextCursor, ignored }
//   ONE page per call. The cursor is this module's JSON { v, page }.
import { getJson, MerchantPullError } from "./http.mjs";
import { commasTransactionEvents } from "../normalize.mjs";

export const id = "commas";
export const label = "Commas";
export const COMMAS_API_BASE = "https://www.fanbasis.com";
export const TRANSACTIONS_PATH = "/public-api/checkout-sessions/transactions";
export const PAGE_SIZE = 100;
export const keyHelp = "In Commas, open Account → API Keys, make a key that can read payments, and paste it here.";

function parseCursor(cursor) {
  if (!cursor) return null;
  try {
    const c = JSON.parse(String(cursor));
    if (c && c.v === 1 && Number.isSafeInteger(c.page) && c.page >= 1) return c;
  } catch { /* a cursor we did not write — start over */ }
  return null;
}

export async function listEvents({ apiKey, since: _since = null, cursor = null, env = process.env, fetchImpl = undefined } = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw new MerchantPullError("bad_key", "No Commas API key is saved for this connection.");
  const c = parseCursor(cursor) || { v: 1, page: 1 };

  const q = new URLSearchParams({ page: String(c.page), per_page: String(PAGE_SIZE) });
  const body = await getJson(`${COMMAS_API_BASE}${TRANSACTIONS_PATH}?${q.toString()}`, {
    headers: { "x-api-key": key },
    env,
    fetchImpl,
    what: "commas GET /public-api/checkout-sessions/transactions"
  });
  const data = body.data && typeof body.data === "object" ? body.data : null;
  if (!data || !Array.isArray(data.transactions)) {
    throw new MerchantPullError("bad_response", "Commas' transactions list came back without a transactions list.");
  }

  const events = [];
  let ignored = 0;
  for (const t of data.transactions) {
    const out = commasTransactionEvents(t);
    events.push(...out.events);
    if (!out.events.length || out.ignored) ignored++;
  }

  const more = data.pagination && data.pagination.has_more === true && data.transactions.length > 0;
  return { events, nextCursor: more ? JSON.stringify({ v: 1, page: c.page + 1 }) : null, ignored };
}
