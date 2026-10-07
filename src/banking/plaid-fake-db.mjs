// A stand-in database for the Plaid account tests (plaid-refresh.test.mjs,
// accounts-sync.test.mjs). NOT USED BY ANY PRODUCTION CODE.
//
// It holds two tables in memory — plaid_items and bank_accounts — and answers the
// exact statements the account refresh issues, by the shape of the SQL:
//
//   * the readable-login read (plaid-refresh.mjs readRefreshItems),
//   * the per-login "what is stored now" read,
//   * the store's own statements (accounts-store.mjs saveAccounts / upsertBankAccount),
//     including the UPSERT on (plaid_item_id, plaid_account_id): an existing row keeps
//     its id, created_at, entity_kind and closed_at and takes the new balances; a new
//     account is inserted with entity_kind 'unknown' and created_at = the fake clock,
//   * the login error-state write and the first-read baseline write.
//
// ANY OTHER SQL THROWS. A test that quietly got an empty answer for a statement it
// never taught this file would prove nothing, so a statement nobody modelled is a
// loud failure, and so is a DELETE.

import crypto from "node:crypto";

/* The columns the store's ON CONFLICT ... DO UPDATE replaces — accounts-store.mjs
   UPDATABLE. org, client, provider, the two id columns, entity_kind, closed_at and
   created_at are the row's identity and history, and a re-read never touches them. */
const UPDATABLE = [
  "name", "official_name", "mask", "account_type", "account_subtype", "currency_code",
  "available_balance_cents", "current_balance_cents", "credit_limit_cents", "balance_as_of", "raw"
];

const asMs = (v) => (v instanceof Date ? v.getTime() : Date.parse(String(v)));

/**
 * fakeBankDb({ items, accounts, now })
 *
 * `items` are plaid_items rows, `accounts` bank_accounts rows (any columns the test
 * cares about; the rest default). `now` is the fake clock for created_at and
 * updated_at. Returns the query handle plus `state` (the live tables) and `calls`
 * (every statement, in order).
 */
export function fakeBankDb({ items = [], accounts = [], now = () => new Date("2026-10-07T07:00:00.000Z") } = {}) {
  const state = {
    items: items.map((i) => ({
      link_state: "active", last_error_code: null, last_error_at: null, ...i
    })),
    accounts: accounts.map((a) => ({
      provider: "plaid", entity_kind: "unknown", closed_at: null,
      available_balance_cents: null, current_balance_cents: null, credit_limit_cents: null,
      raw: {}, ...a
    }))
  };
  const calls = [];

  const readable = (i, [orgId, clientId, itemRowId]) =>
    i.org_id === orgId && i.client_id === clientId
    && i.link_state === "active" && i.consent_granted_at
    && i.encrypted_access_token && i.plaid_item_id && !String(i.plaid_item_id).startsWith("mock:")
    && (itemRowId === null || itemRowId === undefined || i.id === itemRowId);

  const db = {
    state,
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (/\bDELETE\b/i.test(sql)) throw new Error(`fake db: a DELETE was issued: ${sql.slice(0, 80)}`);

      // plaid-refresh: which logins can be read
      if (/FROM plaid_items/.test(sql) && /SELECT/.test(sql)) {
        return {
          rows: state.items.filter((i) => readable(i, params)).map((i) => ({ ...i })),
          rowCount: 0
        };
      }

      // plaid-refresh: what is stored for ONE login right now
      if (/SELECT id, plaid_account_id, name, mask, account_type, closed_at/.test(sql)) {
        const [orgId, clientId, itemId] = params;
        return {
          rows: state.accounts
            .filter((a) => a.org_id === orgId && a.client_id === clientId && a.plaid_item_id === itemId)
            .map((a) => ({ ...a })),
          rowCount: 0
        };
      }

      // accounts-store saveAccounts: every stored row of the client under the
      // provider — ACROSS logins, which is why plaid-refresh does not trust its
      // `vanished`.
      if (/SELECT id, provider_account_id, plaid_account_id, name/.test(sql)) {
        const [orgId, clientId, provider] = params;
        return {
          rows: state.accounts
            .filter((a) => a.org_id === orgId && a.client_id === clientId && a.provider === provider)
            .map((a) => ({ ...a })),
          rowCount: 0
        };
      }

      // accounts-store upsertBankAccount
      if (/INSERT INTO bank_accounts/.test(sql)) {
        const cols = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map((s) => s.trim());
        const row = {};
        cols.forEach((c, i) => { row[c] = params[i]; });
        const keyed = row.provider === "plaid" && row.plaid_item_id && row.plaid_account_id && /ON CONFLICT/.test(sql);
        const existing = keyed
          ? state.accounts.find((a) => a.plaid_item_id === row.plaid_item_id && a.plaid_account_id === row.plaid_account_id)
          : null;
        if (existing) {
          for (const c of UPDATABLE) if (c in row) existing[c] = row[c];
          existing.updated_at = now();
          return { rows: [{ ...existing }], rowCount: 1 };
        }
        const made = {
          id: crypto.randomUUID(), entity_kind: "unknown", closed_at: null,
          created_at: now(), updated_at: now(), ...row
        };
        state.accounts.push(made);
        return { rows: [{ ...made }], rowCount: 1 };
      }

      // plaid-refresh: the login's error state
      if (/UPDATE plaid_items/.test(sql)) {
        const [id, orgId, code, relink] = params;
        const item = state.items.find((i) => i.id === id && i.org_id === orgId);
        if (!item) return { rows: [], rowCount: 0 };
        item.last_error_code = code;
        item.last_error_at = now();
        if (relink && item.link_state === "active") item.link_state = "error";
        item.updated_at = now();
        return { rows: [], rowCount: 1 };
      }

      // plaid-refresh: the first-read baseline
      if (/UPDATE bank_accounts\s+SET created_at = LEAST/.test(sql)) {
        const [orgId, clientId, itemId, itemCreatedAt, ids] = params;
        let n = 0;
        for (const a of state.accounts) {
          if (a.org_id === orgId && a.client_id === clientId && a.plaid_item_id === itemId && ids.includes(a.id)) {
            if (asMs(itemCreatedAt) < asMs(a.created_at)) a.created_at = new Date(asMs(itemCreatedAt));
            n += 1;
          }
        }
        return { rows: [], rowCount: n };
      }

      throw new Error(`fake db: nobody taught this statement: ${sql.replace(/\s+/g, " ").slice(0, 120)}`);
    }
  };
  return db;
}

/* ---- builders shared by the tests ------------------------------------------- */

/** One account the way Plaid's /accounts/get sends it (dollars, snake_case). */
export function plaidAccount({
  id, name = "Checking", mask = "0000", type = "depository", subtype = "checking",
  current = 100, available = 100, limit = null, official = null
}) {
  return {
    account_id: id, name, official_name: official, mask, type, subtype,
    balances: { current, available, limit, iso_currency_code: "USD" }
  };
}

/**
 * stubPlaid({ [accessToken]: accountsOrErrorBody })  →  { fetch, requests }
 *
 * A stand-in fetch that answers /accounts/get and /accounts/balance/get by the
 * access token in the request body. An array is a 200 with those accounts; an
 * object is sent as the (error) body with HTTP 400. `requests` records every call
 * so a test can assert the path, the token and the options that went on the wire.
 */
export function stubPlaid(byToken, { balanceByToken = null } = {}) {
  const requests = [];
  const respond = (body, status) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" }
  });
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const path = new URL(url).pathname;
    requests.push({ path, body });
    const source = path === "/accounts/balance/get" && balanceByToken ? balanceByToken : byToken;
    const answer = source[body.access_token];
    if (answer === undefined) return respond({ error_code: "INVALID_ACCESS_TOKEN", error_type: "INVALID_INPUT", error_message: "unknown token" }, 400);
    if (Array.isArray(answer)) return respond({ accounts: answer, item: { item_id: "x" }, request_id: "r" }, 200);
    return respond(answer, 400);
  };
  return { fetch, requests };
}

export default { fakeBankDb, plaidAccount, stubPlaid };
