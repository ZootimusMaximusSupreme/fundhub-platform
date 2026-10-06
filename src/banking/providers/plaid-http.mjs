// The Plaid HTTP client. The only file in the banking layer that can put a
// request on the wire, and it does so through src/lib/outbound-fetch.mjs like
// everything else — src/lib/no-unfenced-transmit.test.mjs reads the tree and
// fails the build for anything that reaches the network another way.
//
// WHY A SEPARATE FILE AND NOT A FEW LINES IN plaid.mjs. That module holds the
// access-token encryption for every stored item, and CLAUDE.md §12 keeps
// transmission in provider modules rather than scattered through the layer that
// calls them. Splitting it also means the credential handling can be tested with
// no network anywhere near it, and this file can be tested by handing it a
// stand-in response.
//
// THE FENCE IS `adapters`, NOT `internal`. A bank connection is an outside
// vendor holding standing read access to someone's accounts — exactly the class
// ADAPTERS_DRY_RUN exists to hold. `internal` is for calls that cannot reach a
// person or change a record at a vendor, and this is neither.
//
// NOTHING HERE LOGS A CREDENTIAL. The public_token, the access_token and the
// client secret pass through and are never written to a log line, an error
// string or a returned object. `outbound-fetch.mjs`'s redact() covers the error
// path; the rest is this file not doing it.
//
// SANDBOX IS THE DEFAULT AND IT IS A REAL DIFFERENCE. PLAID_ENV decides the
// host. `sandbox` reaches Plaid's fake institutions with fake balances and
// touches nobody's real account. Production access to a real person's bank is a
// separate decision recorded on plaid_items.consent_granted_at, and writing this
// client does not make it.

import { transmit, ADAPTERS } from "../../lib/outbound-fetch.mjs";

/** Plaid publishes one host per environment. No path, no trailing slash. */
export const PLAID_HOSTS = Object.freeze({
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com"
});

/** Plaid answers 200 with an error body for some failures and 4xx for others,
 *  so a caller cannot branch on the status alone. This is the shape both paths
 *  collapse into. `retryable` is Plaid's own RATE_LIMIT / API error types. */
const RETRYABLE_TYPES = new Set(["RATE_LIMIT_EXCEEDED", "API_ERROR"]);

export function hostFor(environment) {
  return PLAID_HOSTS[environment] || null;
}

/**
 * plaidPost(path, payload, { config, clientId, secret, env, fetchImpl, timeoutMs })
 *
 * One POST to Plaid, fenced. Returns a flat result rather than throwing, for the
 * same reason the seams do: an unconfigured or held call is a normal state here.
 *
 *   { ok, blocked, transmitted, status, data, errorCode, errorType, retryable,
 *     error }
 *
 * `data` is null unless Plaid answered with a body it considers successful.
 * `error` is a short human string, already redacted by the chokepoint.
 */
export async function plaidPost(path, payload = {}, {
  environment = "sandbox",
  clientId = null,
  secret = null,
  env = process.env,
  fetchImpl = undefined,
  timeoutMs = 15_000
} = {}) {
  const host = hostFor(environment);
  if (!host) {
    return {
      ok: false, blocked: false, transmitted: false, status: 0, data: null,
      errorCode: null, errorType: null, retryable: false,
      error: `unknown Plaid environment: ${environment}`
    };
  }

  /* The credentials go in the BODY, which is how Plaid's API works — there is no
     Authorization header. They are assembled here and nowhere else, and the
     object is not returned, logged or spread into any result. */
  const body = { ...payload, client_id: clientId, secret };

  const res = await transmit(`${host}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }, {
    fence: ADAPTERS,
    what: `plaid ${path}`,
    env,
    fetchImpl,
    timeoutMs
  });

  if (res.blocked) {
    return {
      ok: false, blocked: true, transmitted: false, status: 0, data: null,
      errorCode: null, errorType: null, retryable: false,
      error: res.error || "held by the adapters fence"
    };
  }

  const data = res.body && typeof res.body === "object" ? res.body : null;

  /* Plaid's error envelope. Present on both 200-with-error and 4xx, so it is
     checked before the status. error_message is Plaid's prose and can name an
     institution but never a credential; it is safe to carry. */
  const errorCode = data?.error_code ? String(data.error_code) : null;
  const errorType = data?.error_type ? String(data.error_type) : null;
  if (errorCode || errorType) {
    return {
      ok: false, blocked: false, transmitted: res.transmitted, status: res.status,
      data: null, errorCode, errorType,
      retryable: RETRYABLE_TYPES.has(errorType || ""),
      error: String(data?.error_message || errorCode || errorType).slice(0, 300)
    };
  }

  if (!res.ok || res.status < 200 || res.status >= 300) {
    return {
      ok: false, blocked: false, transmitted: res.transmitted, status: res.status,
      data: null, errorCode: null, errorType: null,
      /* A 0 here is a timeout or a dropped socket, and the header of
         outbound-fetch.mjs is explicit that the vendor may have done the work
         anyway. Treating it as retryable is correct for the two calls this file
         makes — both are idempotent reads or an exchange Plaid de-duplicates —
         and would NOT be correct for anything that charges or mails. */
      retryable: res.status === 0 || res.status >= 500,
      error: (res.error || `plaid ${path} answered ${res.status}`).slice(0, 300)
    };
  }

  return {
    ok: true, blocked: false, transmitted: res.transmitted, status: res.status,
    data, errorCode: null, errorType: null, retryable: false, error: null
  };
}

/**
 * exchangePublicToken — POST /item/public_token/exchange
 *
 * Link hands the browser a short-lived public_token; this trades it for the
 * long-lived access_token and the item id. Returns them raw. The CALLER encrypts
 * the token before it goes anywhere near the database — that is plaid.mjs's job
 * and it is deliberately not done here, so this file never decides how a
 * credential is stored.
 */
export async function exchangePublicToken(publicToken, opts = {}) {
  const r = await plaidPost("/item/public_token/exchange", { public_token: publicToken }, opts);
  if (!r.ok) return r;
  const accessToken = r.data?.access_token;
  const itemId = r.data?.item_id;
  if (!accessToken || !itemId) {
    return {
      ...r, ok: false, data: null,
      error: "plaid exchange answered 200 without access_token or item_id"
    };
  }
  return { ...r, accessToken, itemId, data: null };
}

/**
 * fetchAccounts — POST /accounts/get
 *
 * Returns Plaid's account rows as they arrive, normalised only in shape. It does
 * NOT decide ownership: see the note in plaid.mjs's getAccounts and the header of
 * db/migrations/082_bank_account_entity_kind.sql. A Plaid subtype is not evidence
 * that an account is personal or business, and mapping one onto the other is the
 * defect that migration exists to prevent.
 */
export async function fetchAccounts(accessToken, opts = {}) {
  const r = await plaidPost("/accounts/get", { access_token: accessToken }, opts);
  if (!r.ok) return r;
  const raw = Array.isArray(r.data?.accounts) ? r.data.accounts : null;
  if (!raw) {
    return { ...r, ok: false, data: null, error: "plaid /accounts/get answered 200 without an accounts array" };
  }
  const accounts = raw.map((a) => ({
    plaidAccountId: a.account_id ?? null,
    name: a.name ?? null,
    officialName: a.official_name ?? null,
    mask: a.mask ?? null,
    type: a.type ?? null,
    subtype: a.subtype ?? null,
    /* Plaid returns null for a balance it does not have. NULL means unknown and
       unknown must survive — never defaulted to 0, which would read as a real
       zero balance on a funding decision. */
    currentBalance: a.balances?.current ?? null,
    availableBalance: a.balances?.available ?? null,
    creditLimit: a.balances?.limit ?? null,
    isoCurrencyCode: a.balances?.iso_currency_code ?? null,
    /* Plaid's own business/personal tag, carried for the record only. It is NOT
       written to entity_kind — 082 says a human or a document decides that. */
    holderCategory: a.holder_category ?? null
  }));
  return { ...r, accounts, item: r.data?.item ?? null, data: null };
}

/**
 * fetchLiabilities — POST /liabilities/get
 *
 * The card BILL facts: when the next payment is due, the minimum, the last
 * statement and the last payment. Field names are Plaid's own
 * (https://plaid.com/docs/api/products/liabilities/), carried one-for-one so a
 * disputed reading can be checked against Plaid's docs without a mapping table.
 *
 * Only `liabilities.credit` is read. Mortgage and student loans come back in the
 * same response and are not this caller's job.
 *
 * DOLLARS STAY DOLLARS HERE. Plaid sends decimal dollars; the cents conversion
 * happens once, in src/banking/plaid-liabilities.mjs, next to the store. And
 * NULL STAYS NULL: Plaid returns null for a figure it does not have, and an
 * unknown minimum is not a $0 minimum.
 *
 * An Item that was never set up for liabilities answers with a Plaid error, not
 * an empty list. That comes back as `ok:false` with Plaid's errorCode, the same
 * flat shape as every other call here — the caller records it and moves on.
 *
 * `liabilities.credit` may be null when the Item has no credit cards. That is a
 * real answer (no cards), returned as an empty list, and is not the same as an
 * error.
 */
export async function fetchLiabilities(accessToken, opts = {}) {
  const payload = { access_token: accessToken };
  if (Array.isArray(opts.accountIds) && opts.accountIds.length) {
    payload.options = { account_ids: opts.accountIds.map(String) };
  }
  const r = await plaidPost("/liabilities/get", payload, opts);
  if (!r.ok) return r;
  const liabilities = r.data?.liabilities;
  if (!liabilities || typeof liabilities !== "object") {
    return { ...r, ok: false, data: null, error: "plaid /liabilities/get answered 200 without a liabilities object" };
  }
  const rawCredit = Array.isArray(liabilities.credit) ? liabilities.credit : [];
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const date = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const credit = rawCredit.map((c) => ({
    account_id: c?.account_id ?? null,
    next_payment_due_date: date(c?.next_payment_due_date),
    minimum_payment_amount: num(c?.minimum_payment_amount),
    last_statement_balance: num(c?.last_statement_balance),
    last_statement_issue_date: date(c?.last_statement_issue_date),
    last_payment_amount: num(c?.last_payment_amount),
    last_payment_date: date(c?.last_payment_date),
    is_overdue: typeof c?.is_overdue === "boolean" ? c.is_overdue : null,
    aprs: Array.isArray(c?.aprs)
      ? c.aprs.map((a) => ({
        apr_percentage: num(a?.apr_percentage),
        apr_type: a?.apr_type ?? null,
        balance_subject_to_apr: num(a?.balance_subject_to_apr),
        interest_charge_amount: num(a?.interest_charge_amount)
      }))
      : []
  }));
  return { ...r, credit, item: r.data?.item ?? null, data: null };
}

/**
 * createLinkToken — POST /link/token/create
 *
 * The short-lived token the browser needs to open Plaid Link. `transactions` is
 * the product because it covers checking, savings AND credit cards; `auth` would
 * hide every card. Nothing here decides personal vs business — see fetchAccounts.
 */
export async function createLinkToken({ clientUserId, products = ["transactions"] } = {}, opts = {}) {
  const r = await plaidPost("/link/token/create", {
    client_name: "Fundhub",
    language: "en",
    country_codes: ["US"],
    user: { client_user_id: String(clientUserId) },
    products
  }, opts);
  if (!r.ok) return r;
  const linkToken = r.data?.link_token;
  if (!linkToken) {
    return { ...r, ok: false, data: null, error: "plaid /link/token/create answered 200 without link_token" };
  }
  return { ...r, linkToken, expiration: r.data?.expiration ?? null, data: null };
}

/**
 * sandboxPublicToken — POST /sandbox/public_token/create
 *
 * SANDBOX HOST ONLY. Makes a public_token for a fake institution without the
 * browser, so a link can be proved end to end from a script. Refuses any other
 * environment before anything is sent.
 */
export async function sandboxPublicToken({ institutionId, products = ["transactions"], options = undefined } = {}, opts = {}) {
  if ((opts.environment || "sandbox") !== "sandbox") {
    return {
      ok: false, blocked: false, transmitted: false, status: 0, data: null,
      errorCode: null, errorType: null, retryable: false,
      error: "sandboxPublicToken only runs against the sandbox host"
    };
  }
  const payload = { institution_id: institutionId, initial_products: products };
  if (options) payload.options = options;
  const r = await plaidPost("/sandbox/public_token/create", payload, opts);
  if (!r.ok) return r;
  const publicToken = r.data?.public_token;
  if (!publicToken) {
    return { ...r, ok: false, data: null, error: "plaid sandbox answered 200 without public_token" };
  }
  return { ...r, publicToken, data: null };
}

export default {
  PLAID_HOSTS, hostFor, plaidPost, exchangePublicToken, fetchAccounts, fetchLiabilities, createLinkToken, sandboxPublicToken
};
