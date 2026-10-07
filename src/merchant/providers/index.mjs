// Merchant pull providers — "any merchant" is one module in this directory.
//
// To add a processor that has a read API:
//   1. Write src/merchant/providers/<id>.mjs exporting
//        id, label, keyHelp,
//        listEvents({ apiKey, since, cursor, env, fetchImpl })
//          → { events, nextCursor, ignored }
//      `events` are merchant_events rows (src/merchant/normalize.mjs shape:
//      provider_event_id, kind sale|refund|payout|fee, signed amount_cents,
//      currency, occurred_at, description, raw). `nextCursor` is the module's
//      own resume string, or null when the pull is done. Every HTTP call goes
//      through ./http.mjs getJson (the ADAPTERS fence) — never fetch directly.
//   2. Add it to PULL_PROVIDERS below.
//   3. Allow its id in merchant_connections (a new migration widening
//      merchant_connections_pull_provider and the provider CHECK) and in
//      src/merchant/store.mjs PROVIDERS.
//
// A processor with no read API keeps using the open API
// (POST /api/merchant/events, docs/finance/merchant-open-api.md).
import * as whop from "./whop.mjs";
import * as commas from "./commas.mjs";

/* Null-prototype, so a provider id off a request ("constructor", "toString")
   finds nothing — same defence as src/http/router.mjs. */
export const PULL_PROVIDERS = Object.freeze(Object.assign(Object.create(null), {
  whop: { id: whop.id, label: whop.label, keyHelp: whop.keyHelp, listEvents: whop.listEvents },
  commas: { id: commas.id, label: commas.label, keyHelp: commas.keyHelp, listEvents: commas.listEvents }
}));

export function pullProviderFor(provider) {
  return PULL_PROVIDERS[String(provider || "")] || null;
}

export const PULL_PROVIDER_IDS = Object.freeze(Object.keys(PULL_PROVIDERS));
