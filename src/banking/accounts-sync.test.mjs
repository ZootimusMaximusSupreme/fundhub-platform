// Bank account sync + the mock provider — unit tests. No Postgres, no network.
//
// The two things worth proving here are both about NOT WRITING:
//   * a mock that is not explicitly switched on writes nothing, and
//   * a provider that refuses leaves the database exactly as it was.
//
// A stand-in provider that can be switched on by accident, or that leaves half
// a sync behind when it fails, would put invented balances on an owner's
// funding screen. That is the worst outcome available in this repository, so it
// is the thing with the most assertions on it.

import { test, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";

import { syncBankAccounts, PROVIDERS, SYNC_REASONS } from "./accounts-sync.mjs";
import { getAccounts as mockGetAccounts, isMockEnabled, MOCK_REASONS } from "./providers/mock.mjs";
import { encryptPlaidToken } from "./plaid.mjs";
import { fakeBankDb, plaidAccount, stubPlaid } from "./plaid-fake-db.mjs";

const ON = { BANKING_MOCK_PROVIDER: "1" };
const AS_OF = "2026-07-31T00:00:00.000Z";

function makeDb() {
  const calls = [];
  return {
    calls,
    query(sql, params) {
      calls.push({ sql, params });
      if (/^\s*SELECT/.test(sql)) return Promise.resolve({ rows: [] });
      if (/INSERT INTO bank_accounts/.test(sql)) {
        const cols = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map((s) => s.trim());
        const row = {};
        cols.forEach((c, i) => { row[c] = params[i]; });
        return Promise.resolve({ rows: [{ id: "row-" + row.provider_account_id, entity_kind: "unknown", ...row }] });
      }
      return Promise.resolve({ rows: [] });
    }
  };
}

const base = { orgId: "org-1", clientId: "c-1", asOf: AS_OF };

describe("the mock provider is off unless explicitly switched on", () => {

  test("only the exact string '1' enables it", () => {
    assert.equal(isMockEnabled({ BANKING_MOCK_PROVIDER: "1" }), true);
    for (const v of [undefined, "", "0", "true", "yes", "TRUE", " 1", "1 ", "on"]) {
      assert.equal(isMockEnabled({ BANKING_MOCK_PROVIDER: v }), false,
        `${JSON.stringify(v)} enabled the mock provider`);
    }
    assert.equal(isMockEnabled({}), false);
    assert.equal(isMockEnabled(undefined), false);
  });

  test("disabled: accounts is null, NOT an empty array", async () => {
    const out = await mockGetAccounts({ clientId: "c-1", asOf: AS_OF, env: {} });
    assert.equal(out.ok, false);
    assert.equal(out.reason, MOCK_REASONS.NOT_ENABLED);
    // [] would mean "this client has no bank accounts" — a finding a funding
    // decision would act on. null means "we did not ask".
    assert.equal(out.accounts, null);
    assert.deepEqual(out.missing, ["BANKING_MOCK_PROVIDER"]);
  });

  test("disabled: the sync writes NOTHING at all", async () => {
    const db = makeDb();
    const out = await syncBankAccounts(db, { ...base, providerName: "mock", env: {} });
    assert.equal(out.ok, false);
    assert.equal(out.reason, MOCK_REASONS.NOT_ENABLED);
    assert.equal(out.written, 0);
    assert.equal(db.calls.length, 0, "a refused sync touched the database");
  });

  test("it has no clock — asOf is required and is what gets stamped", async () => {
    const refused = await mockGetAccounts({ clientId: "c-1", asOf: null, env: ON });
    assert.equal(refused.ok, false);
    assert.equal(refused.accounts, null);

    const out = await mockGetAccounts({ clientId: "c-1", asOf: AS_OF, env: ON });
    for (const a of out.accounts) assert.equal(a.balanceAsOf, AS_OF);
  });

  test("it returns the same answer twice — no randomness", async () => {
    const a = await mockGetAccounts({ clientId: "c-1", asOf: AS_OF, env: ON });
    const b = await mockGetAccounts({ clientId: "c-1", asOf: AS_OF, env: ON });
    assert.deepEqual(a.accounts, b.accounts);
  });

  /* The fixture is shaped to prove the screen tells the truth, not to make it
     look full. These two rows are the ones that matter. */
  test("the fixture includes a credit line and an account with no balance", async () => {
    const out = await mockGetAccounts({ clientId: "c-1", asOf: AS_OF, env: ON });
    const credit = out.accounts.filter((a) => a.accountType === "credit");
    assert.equal(credit.length, 1, "no credit line — the headroom-is-not-cash rule is untested");
    assert.ok(credit[0].availableBalanceCents > 0, "the credit line has no headroom to mistake for cash");

    const unknown = out.accounts.filter((a) => a.currentBalanceCents === null);
    assert.equal(unknown.length, 1, "no unknown balance — the projection refusal is untested");
  });

  test("the fixture never carries an ownership claim", async () => {
    const out = await mockGetAccounts({ clientId: "c-1", asOf: AS_OF, env: ON });
    for (const a of out.accounts) {
      assert.equal(a.entityKind, undefined);
      assert.equal(a.entity_kind, undefined);
    }
  });

  test("every fixture row says NOT REAL in its raw payload", async () => {
    const out = await mockGetAccounts({ clientId: "c-1", asOf: AS_OF, env: ON });
    for (const a of out.accounts) {
      assert.equal(a.raw.provider, "mock");
      assert.match(a.raw.note, /NOT REAL/);
    }
  });
});

describe("the provider is always named — there is no default", () => {

  test("an unknown provider is refused and nothing is written", async () => {
    const db = makeDb();
    const out = await syncBankAccounts(db, { ...base, providerName: "wishful", env: ON });
    assert.equal(out.ok, false);
    assert.equal(out.reason, SYNC_REASONS.UNKNOWN_PROVIDER);
    assert.deepEqual(out.known.sort(), ["mock", "plaid"]);
    assert.equal(db.calls.length, 0);
  });

  test("a missing provider name is refused, not defaulted", async () => {
    const db = makeDb();
    for (const providerName of [undefined, null, "", "__proto__", "constructor"]) {
      const out = await syncBankAccounts(db, { ...base, providerName, env: ON });
      assert.equal(out.ok, false, `${JSON.stringify(providerName)} resolved to a provider`);
      assert.equal(db.calls.length, 0);
    }
  });

  test("org, client and asOf are each required before anything happens", async () => {
    const db = makeDb();
    for (const missing of [{ orgId: null }, { clientId: null }, { asOf: null }]) {
      const out = await syncBankAccounts(db, { ...base, ...missing, providerName: "mock", env: ON });
      assert.equal(out.ok, false);
      assert.equal(out.written, 0);
    }
    assert.equal(db.calls.length, 0);
  });
});

describe("the plaid seam stays unclosed and says so honestly", () => {

  test("unconfigured plaid reports not_configured and names only variables", async () => {
    const db = makeDb();
    const out = await syncBankAccounts(db, { ...base, providerName: "plaid", itemId: "item-1", env: {} });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "not_configured");
    // Names only. A secret value must never reach a response body.
    for (const m of out.missing) assert.match(m, /^[A-Z0-9_]+$/);
    assert.equal(db.calls.length, 0);
  });

  /* "not_configured" sends somebody to set an environment variable;
     "not_implemented" tells them the code does not exist. Collapsing them into
     one "sync failed" sends people to fix the wrong thing. */
  test("configured plaid reports not_implemented, which is a different problem", async () => {
    const db = makeDb();
    const out = await syncBankAccounts(db, {
      ...base,
      providerName: "plaid",
      itemId: "item-1",
      /* A well-formed 32-byte base64 key, because plaidConfigFromEnv checks the
         key is USABLE and not merely present — a short one would come back as
         not_configured and this test would pass for the wrong reason. Not a
         credential: 32 zero bytes. */
      env: {
        PLAID_CLIENT_ID: "test-client",
        PLAID_SECRET: "test-secret",
        PLAID_TOKEN_ENC_KEY: Buffer.alloc(32).toString("base64"),
        PLAID_ENV: "sandbox"
      }
    });
    assert.equal(out.ok, false);
    assert.notEqual(out.reason, "not_configured");
    assert.equal(out.written, 0);
    assert.equal(db.calls.length, 0);
  });

  test("plaid is registered as real, mock is not", () => {
    assert.equal(PROVIDERS.plaid.real, true);
    assert.equal(PROVIDERS.mock.real, false);
    assert.match(PROVIDERS.mock.label, /NOT REAL/);
  });
});

describe("a successful mock sync", () => {

  test("writes every fixture account, marked as mock, ownership unestablished", async () => {
    const db = makeDb();
    const out = await syncBankAccounts(db, { ...base, providerName: "mock", env: ON });
    assert.equal(out.ok, true);
    assert.equal(out.real, false);
    assert.equal(out.written, 4);
    for (const a of out.accounts) {
      assert.equal(a.provider, "mock");
      assert.equal(a.plaid_item_id, null);
      assert.equal(a.entity_kind, "unknown");
      assert.ok(a.provider_account_id, "a mock row landed with no provider key");
    }
  });

  test("the unknown balance is written as null, not zero", async () => {
    const db = makeDb();
    const out = await syncBankAccounts(db, { ...base, providerName: "mock", env: ON });
    const blank = out.accounts.find((a) => a.provider_account_id === "mock-checking-2");
    assert.equal(blank.current_balance_cents, null);
    assert.equal(blank.available_balance_cents, null);
  });

  test("running it twice writes the same rows, via ON CONFLICT", async () => {
    const db = makeDb();
    await syncBankAccounts(db, { ...base, providerName: "mock", env: ON });
    const first = db.calls.filter((c) => /INSERT/.test(c.sql)).length;
    await syncBankAccounts(db, { ...base, providerName: "mock", env: ON });
    const total = db.calls.filter((c) => /INSERT/.test(c.sql)).length;
    assert.equal(total, first * 2, "the second run issued a different number of writes");
    for (const c of db.calls.filter((x) => /INSERT/.test(x.sql))) {
      assert.match(c.sql, /ON CONFLICT/, "a mock write had no conflict target — a re-sync would duplicate it");
    }
  });

  test("the org is what the caller passed, never anything from the fixture", async () => {
    const db = makeDb();
    const out = await syncBankAccounts(db, { ...base, orgId: "org-9", providerName: "mock", env: ON });
    for (const a of out.accounts) assert.equal(a.org_id, "org-9");
  });
});

/* THE PLAID PATH, CLOSED (2026-10-07). It used to call the Plaid seam with an item id
   and no stored token — so it could never succeed — and, had it succeeded, it would
   have handed the store Plaid's own account shape instead of the store's, which writes
   a row with no plaid_account_id (and a new copy of it on every sync). It now reads the
   login's stored token, asks Plaid, and writes through the same code the daily sweep
   runs (src/banking/plaid-refresh.mjs). */
describe("the plaid path reads the stored login and writes real accounts", () => {
  const ORG = "org-plaid";
  const CLIENT = "client-plaid";
  const LOGIN = "00000000-0000-0000-0000-0000000000a1";   // plaid_items.id
  const PLAID_ITEM = "item-sandbox-1";                    // Plaid's own item id
  const TOKEN = "access-sandbox-secret-1";
  const PLAID_ENV_VARS = Object.freeze({
    PLAID_CLIENT_ID: "cid", PLAID_SECRET: "sec", PLAID_ENV: "sandbox", ADAPTERS_DRY_RUN: "0",
    PLAID_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64")
  });
  const login = (over = {}) => ({
    id: LOGIN, org_id: ORG, client_id: CLIENT, plaid_item_id: PLAID_ITEM, institution_name: "First Platypus Bank",
    encrypted_access_token: encryptPlaidToken(TOKEN, { itemId: PLAID_ITEM, env: PLAID_ENV_VARS }),
    consent_granted_at: "2026-09-20T10:00:00.000Z", created_at: "2026-09-20T10:00:00.000Z", ...over
  });
  const plaidOpts = { orgId: ORG, clientId: CLIENT, asOf: AS_OF, providerName: "plaid", env: PLAID_ENV_VARS };
  const CHECKING = plaidAccount({ id: "p-chk", name: "Business Checking", mask: "2202", current: 20000.5, available: 19000 });

  test("a named login is read with its own token and written in the store's shape, keyed by Plaid's account id", async () => {
    const db = fakeBankDb({ items: [login()] });
    const plaid = stubPlaid({ [TOKEN]: [CHECKING] });

    const out = await syncBankAccounts(db, { ...plaidOpts, itemId: LOGIN, fetchImpl: plaid.fetch });

    assert.equal(out.ok, true, JSON.stringify(out.missing));
    assert.equal(out.provider, "plaid");
    assert.equal(out.real, true);
    assert.equal(out.written, 1);
    assert.equal(plaid.requests[0].body.access_token, TOKEN, "the stored token was decrypted and used");
    const [a] = out.accounts;
    assert.equal(a.provider, "plaid");
    assert.equal(a.plaid_item_id, LOGIN, "hung off the login's row id, not Plaid's item id");
    assert.equal(a.plaid_account_id, "p-chk", "without this key every sync adds the account again");
    assert.equal(a.current_balance_cents, 2000050);
    assert.equal(a.entity_kind, "unknown");
    assert.equal(out.created.length, 1);
    assert.deepEqual(out.vanished, []);
  });

  test("syncing again updates the same row — it does not add a second one", async () => {
    const db = fakeBankDb({ items: [login()] });
    const plaid = stubPlaid({ [TOKEN]: [CHECKING] });
    await syncBankAccounts(db, { ...plaidOpts, itemId: LOGIN, fetchImpl: plaid.fetch });
    const again = await syncBankAccounts(db, { ...plaidOpts, itemId: LOGIN, fetchImpl: plaid.fetch });
    assert.equal(db.state.accounts.length, 1);
    assert.equal(again.created.length, 0);
  });

  test("with no item named, every readable login of the client is refreshed", async () => {
    const second = login({ id: "00000000-0000-0000-0000-0000000000b1", plaid_item_id: "item-sandbox-2" });
    second.encrypted_access_token = encryptPlaidToken("access-sandbox-secret-2", { itemId: "item-sandbox-2", env: PLAID_ENV_VARS });
    const db = fakeBankDb({ items: [login(), second] });
    const plaid = stubPlaid({
      [TOKEN]: [CHECKING],
      "access-sandbox-secret-2": [plaidAccount({ id: "p-sav", name: "Savings", mask: "9009", subtype: "savings" })]
    });
    const out = await syncBankAccounts(db, { ...plaidOpts, fetchImpl: plaid.fetch });
    assert.equal(out.ok, true);
    assert.equal(out.written, 2);
    assert.equal(out.items.length, 2);
    assert.equal(plaid.requests.length, 2);
  });

  test("a client with no linked bank is ok with nothing written — nobody was asked", async () => {
    const db = fakeBankDb({ items: [] });
    const out = await syncBankAccounts(db, { ...plaidOpts, fetchImpl: () => assert.fail("must not transmit") });
    assert.equal(out.ok, true);
    assert.equal(out.ran, false);
    assert.equal(out.reason, "no_linked_bank");
    assert.equal(out.written, 0);
  });

  test("a login that is not readable is refused with its own reason, and nothing is written", async () => {
    const db = fakeBankDb({ items: [login({ link_state: "error" })] });
    const out = await syncBankAccounts(db, { ...plaidOpts, itemId: LOGIN, fetchImpl: () => assert.fail("must not transmit") });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_readable_item");
    assert.equal(out.written, 0);
    assert.equal(db.state.accounts.length, 0);
  });

  test("Plaid saying the client must log in again is a refusal that carries the per-login report", async () => {
    const db = fakeBankDb({ items: [login()] });
    const plaid = stubPlaid({ [TOKEN]: { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "log in" } });
    const out = await syncBankAccounts(db, { ...plaidOpts, itemId: LOGIN, fetchImpl: plaid.fetch });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "upstream_error");
    assert.equal(out.written, 0);
    assert.equal(out.items[0].relinkNeeded, true);
    assert.equal(out.items[0].errorCode, "ITEM_LOGIN_REQUIRED");
    assert.equal(db.state.items[0].link_state, "error");
    assert.equal(JSON.stringify(out).includes(TOKEN), false);
  });

  test("the plaid entry no longer has the old token-less getAccounts; it has a sync", () => {
    assert.equal(typeof PROVIDERS.plaid.sync, "function");
    assert.equal(PROVIDERS.plaid.getAccounts, undefined);
    assert.equal(typeof PROVIDERS.mock.getAccounts, "function", "the mock path is untouched");
  });
});
