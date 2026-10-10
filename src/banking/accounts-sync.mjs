// Bank account sync — ask a provider for a client's accounts, write what comes
// back. The thin piece between src/banking/providers/* and
// src/banking/accounts-store.mjs.
//
// WHY IT IS ITS OWN FILE. The store must not know what a provider is (it takes
// an already-shaped list) and a provider must not know there is a database (it
// answers a question). Something has to hold both, and if that something lives
// inside an HTTP handler then the only way to test it is to send it a request.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THE PROVIDER IS ALWAYS NAMED BY THE CALLER. THERE IS NO DEFAULT.
// ═══════════════════════════════════════════════════════════════════════════
// A default provider is how a mock ends up running in production. `providerName`
// is required, the registry below is closed, and an unknown name is a refusal
// rather than a fallback. The same reasoning src/alerts/evaluate.mjs gives about
// thresholds: an explicit null must NOT get the default, because a silent
// fallback defeats the point of shipping unset.
//
// A REFUSAL IS A RETURN VALUE, NEVER AN EXCEPTION. Asking an unbuilt or
// unconfigured integration to do something is a normal state here — plaid.mjs
// says so and this matches it, so a caller branches on `ok` instead of writing a
// try block around the normal case.
//
// NOTHING IS WRITTEN ON A REFUSAL. Not an empty list, not a placeholder row, not
// a "sync attempted" marker. A provider that would not answer has told us
// nothing about this client's finances, and the correct database state after
// that is the one we already had.

import { saveAccounts, AccountStoreError } from "./accounts-store.mjs";
import * as mockProvider from "./providers/mock.mjs";
import { SEAM_REASONS as PLAID_SEAM_REASONS } from "./plaid.mjs";
import { refreshClientAccounts } from "./plaid-refresh.mjs";

/* The closed registry. Adding a provider means adding a line here AND a value to
   091's CHECK — the two lists are meant to be edited together, and a provider
   the database will reject is better caught at the boundary than by a constraint
   violation three layers down.

   A provider answers one of two ways. `getAccounts` is the simple one: hand back a
   list, and syncBankAccounts writes it. `sync` is for a provider that has to be read
   in pieces: it does its own reading AND writing and hands back the result. */
export const PROVIDERS = Object.freeze({
  mock: {
    name: "mock",
    label: "Mock provider — NOT REAL MONEY (src/banking/providers/mock.mjs)",
    real: false,
    getAccounts: (args) => mockProvider.getAccounts(args)
  },
  plaid: {
    name: "plaid",
    label: "Plaid — live bank connection",
    real: true,
    /* A bank connection is read login by login — each has its own token, its own
       state and its own errors — so it does not fit the one-list shape the mock
       uses. The whole read-and-write is src/banking/plaid-refresh.mjs, the same
       code the daily sweep runs. This entry used to call the Plaid seam without
       the stored token and hand its answer to the store in Plaid's shape instead
       of the store's, so it could never write an account. */
    sync: (db, args) => refreshClientAccounts(db, args)
  }
});

export const SYNC_REASONS = Object.freeze({
  UNKNOWN_PROVIDER: "unknown_provider",
  PROVIDER_REFUSED: "provider_refused",
  NOT_IMPLEMENTED: PLAID_SEAM_REASONS.NOT_IMPLEMENTED,
  NOT_CONFIGURED: PLAID_SEAM_REASONS.NOT_CONFIGURED,
  WRITE_FAILED: "write_failed"
});

const refusal = (reason, extra = {}) => ({
  ok: false,
  reason,
  written: 0,
  accounts: [],
  vanished: [],
  provider: null,
  ...extra
});

/**
 * syncBankAccounts(db, { orgId, clientId, providerName, asOf, itemId, env })
 *
 * @param {string} orgId         from the SESSION, never from a request body.
 * @param {string} clientId      the client whose accounts these are.
 * @param {string} providerName  a key of PROVIDERS. Required — there is no default.
 * @param {string} asOf          ISO instant the balances were true. Required:
 *                               this module has no clock, so a caller must say.
 * @param {string} [itemId]      the plaid_items row (its uuid, not Plaid's own item
 *                               id), for the plaid provider only. Omitted, every
 *                               readable login of the client is refreshed.
 * @param {Function} [fetchImpl] a stand-in for fetch, for tests. Production passes none.
 *
 * @returns {{ ok, reason, provider, real, written, accounts, vanished, missing?,
 *             created?, items?, totals? }}
 *
 * `written` is the number of accounts the provider returned and this wrote. An
 * `ok: true` with `written: 0` is a REAL AND MEANINGFUL ANSWER — the provider
 * was asked and said this client has no accounts — and it is not the same as any
 * refusal above, which is why it is reachable at all. (For plaid, a client with no
 * linked bank is also `ok: true` with `written: 0`, and then `ran` is false and
 * `reason` says no_linked_bank: nobody was asked.)
 */
export async function syncBankAccounts(
  db,
  { orgId, clientId, providerName, asOf, itemId = null, env = process.env, fetchImpl = undefined } = {}
) {
  if (!orgId) return refusal("org_is_required");
  if (!clientId) return refusal("client_is_required");
  if (!asOf) return refusal("as_of_is_required");

  const provider = Object.prototype.hasOwnProperty.call(PROVIDERS, providerName)
    ? PROVIDERS[providerName]
    : null;
  if (!provider) {
    return refusal(SYNC_REASONS.UNKNOWN_PROVIDER, {
      known: Object.keys(PROVIDERS)
    });
  }

  if (typeof provider.sync === "function") {
    const r = await provider.sync(db, { orgId, clientId, asOf, itemRowId: itemId, env, fetchImpl });
    if (!r || r.ok !== true) {
      /* The provider's own reason is carried through unchanged — see below. */
      return refusal(r?.reason ?? SYNC_REASONS.PROVIDER_REFUSED, {
        provider: provider.name,
        real: provider.real,
        missing: r?.missing ?? [],
        items: r?.items ?? []
      });
    }
    return {
      ok: true,
      reason: r.reason ?? null,
      provider: provider.name,
      real: provider.real,
      ran: r.ran,
      written: r.totals.written,
      accounts: r.accounts,
      created: r.created,
      vanished: r.vanished,
      items: r.items,
      totals: r.totals
    };
  }

  const answer = await provider.getAccounts({ clientId, asOf, itemId, env });

  if (!answer || answer.ok !== true) {
    /* The provider's own reason is carried through unchanged. "not_configured"
       and "not_implemented" are different problems with different fixes — one
       sends somebody to set an environment variable, the other tells them the
       code does not exist yet — and collapsing them into "sync failed" sends
       people to fix the wrong thing. */
    return refusal(answer?.reason ?? SYNC_REASONS.PROVIDER_REFUSED, {
      provider: provider.name,
      real: provider.real,
      missing: answer?.missing ?? []
    });
  }

  if (!Array.isArray(answer.accounts)) {
    /* ok:true with a null account list is a provider bug, and it is the exact
       shape plaid.mjs warns about: null means "we did not ask" and must never be
       read as "no accounts". Refused loudly rather than written as an empty
       sync. */
    return refusal("provider_returned_no_list", {
      provider: provider.name,
      real: provider.real
    });
  }

  try {
    const result = await saveAccounts(db, answer.accounts, {
      orgId,
      clientId,
      provider: provider.name,
      plaidItemId: provider.name === "plaid" ? itemId : null
    });
    return {
      ok: true,
      reason: null,
      provider: provider.name,
      real: provider.real,
      written: result.written,
      accounts: result.accounts,
      vanished: result.vanished
    };
  } catch (e) {
    /* A shape the store refused is the caller's problem and is reported as such.
       Anything else is ours and is re-thrown for the adapter to shape — a 500
       that says "write failed" while hiding a connection error helps nobody. */
    if (e instanceof AccountStoreError) {
      return refusal(SYNC_REASONS.WRITE_FAILED, {
        provider: provider.name,
        real: provider.real,
        detail: e.message
      });
    }
    throw e;
  }
}

export default { PROVIDERS, SYNC_REASONS, syncBankAccounts };
