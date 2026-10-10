// Plaid account refresh — unit tests. Stubbed database (plaid-fake-db.mjs) and a
// stand-in fetch; NOTHING HERE REACHES THE NETWORK OR A DATABASE.
//
// What these tests are really guarding is the set of ways a daily re-read goes
// quietly wrong on a real person's money:
//   * a balance written as 0 when the bank said nothing,
//   * the same account added again every morning,
//   * an account closed, deleted, or re-sorted into personal/business because it was
//     missing from one read,
//   * a client told they opened a new card when all that happened is we looked again,
//   * one broken bank login stopping the rest, or a token decrypted for the wrong login.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  refreshClientAccounts, readRefreshItems, toRefreshAccount, realtimeBalancesOn,
  REALTIME_ENV, BALANCE_SOURCES
} from "./plaid-refresh.mjs";
import { encryptPlaidToken } from "./plaid.mjs";
import { planNewAccounts } from "../finance/file-alerts/new-credit.mjs";
import { fakeBankDb, plaidAccount, stubPlaid } from "./plaid-fake-db.mjs";

const ENV = Object.freeze({
  PLAID_CLIENT_ID: "cid",
  PLAID_SECRET: "sec",
  PLAID_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64"),
  PLAID_ENV: "sandbox",
  ADAPTERS_DRY_RUN: "0"
});

const ORG = "00000000-0000-0000-0000-0000000000aa";
const CLIENT = "00000000-0000-0000-0000-0000000000cc";
const ITEM_A = "00000000-0000-0000-0000-0000000000a1"; // plaid_items.id
const ITEM_B = "00000000-0000-0000-0000-0000000000b1";
const PLAID_A = "item-sandbox-A";                       // Plaid's own item id
const PLAID_B = "item-sandbox-B";
const TOKEN_A = "access-sandbox-secret-A";
const TOKEN_B = "access-sandbox-secret-B";
const NOW = "2026-10-07T07:00:00.000Z";

/** A plaid_items row. `aad` is what the token was sealed against; it defaults to
 *  Plaid's item id, which is what completeLink does and what every reader uses. */
const login = ({
  id = ITEM_A, plaidItemId = PLAID_A, token = TOKEN_A, aad = plaidItemId,
  createdAt = "2026-09-20T10:00:00.000Z", ...over
} = {}) => ({
  id, org_id: ORG, client_id: CLIENT, plaid_item_id: plaidItemId, institution_name: "First Platypus Bank",
  encrypted_access_token: encryptPlaidToken(token, { itemId: aad, env: ENV }),
  consent_granted_at: "2026-09-20T10:00:00.000Z", created_at: createdAt, ...over
});

/** A bank_accounts row as it sits in the database today. */
const held = ({
  id, itemId = ITEM_A, plaidAcc, name = "Checking", mask = "0000", type = "depository",
  current = 100000, available = current, limit = null, kind = "unknown", closedAt = null,
  createdAt = "2026-09-20T10:01:00.000Z"
}) => ({
  id, org_id: ORG, client_id: CLIENT, plaid_item_id: itemId, plaid_account_id: plaidAcc,
  name, mask, account_type: type, current_balance_cents: current, available_balance_cents: available,
  credit_limit_cents: limit, entity_kind: kind, closed_at: closedAt,
  created_at: createdAt, updated_at: createdAt, balance_as_of: "2026-10-06T07:00:00.000Z"
});

const refresh = (db, fetchImpl, over = {}) =>
  refreshClientAccounts(db, { orgId: ORG, clientId: CLIENT, env: ENV, asOf: NOW, fetchImpl, ...over });

const CHECKING = plaidAccount({ id: "p-chk", name: "Business Checking", mask: "2202", current: 20000.5, available: 19000 });

describe("balances", () => {
  test("a balance that moved is updated in place — same row, same id, nothing added", async () => {
    const db = fakeBankDb({
      items: [login()],
      accounts: [
        held({ id: "acc-chk", plaidAcc: "p-chk", name: "Business Checking", mask: "2202", current: 1875000, available: 1873893, kind: "business" }),
        held({ id: "acc-sav", plaidAcc: "p-sav", name: "Savings", mask: "9009", current: 500000 })
      ]
    });
    const plaid = stubPlaid({
      [TOKEN_A]: [CHECKING, plaidAccount({ id: "p-sav", name: "Savings", mask: "9009", subtype: "savings", current: 5000, available: 5000 })]
    });

    const r = await refresh(db, plaid.fetch);

    assert.equal(r.ok, true);
    assert.equal(db.state.accounts.length, 2, "an account was added");
    const chk = db.state.accounts.find((a) => a.id === "acc-chk");
    assert.equal(chk.current_balance_cents, 2000050);
    assert.equal(chk.available_balance_cents, 1900000);
    assert.equal(chk.balance_as_of, NOW, "stamped with the instant the caller gave, not a time the store made up");
    assert.equal(chk.entity_kind, "business", "a refresh must never reset whose money an account is");
    assert.equal(chk.raw.balance_source, BALANCE_SOURCES.CACHED, "the row says the balance came from Plaid's cache");

    assert.deepEqual(r.items[0].balancesChanged, [{
      id: "acc-chk", name: "Business Checking", mask: "2202",
      current: { before: 1875000, after: 2000050 },
      available: { before: 1873893, after: 1900000 }
    }], "only the account whose balance moved is listed");
    assert.equal(r.totals.written, 2);
    assert.equal(r.totals.created, 0);
    assert.equal(r.totals.balancesChanged, 1);
  });

  test("an unknown balance is written as null and never as zero", async () => {
    const db = fakeBankDb({
      items: [login()],
      accounts: [held({ id: "acc-chk", plaidAcc: "p-chk", current: 5000, available: 5000 })]
    });
    const plaid = stubPlaid({
      [TOKEN_A]: [plaidAccount({ id: "p-chk", current: 50, available: null, limit: null })]
    });
    const r = await refresh(db, plaid.fetch);
    const row = db.state.accounts[0];
    assert.equal(row.current_balance_cents, 5000);
    assert.equal(row.available_balance_cents, null, "null must survive the write");
    assert.equal(row.credit_limit_cents, null);
    assert.deepEqual(r.items[0].balancesChanged[0].available, { before: 5000, after: null });
  });

  test("running the same refresh twice leaves the same rows, and the second moves no created_at", async () => {
    let clock = new Date(NOW);
    const db = fakeBankDb({ items: [login()], accounts: [held({ id: "acc-chk", plaidAcc: "p-chk", current: 1 })], now: () => clock });
    const plaid = stubPlaid({
      [TOKEN_A]: [CHECKING, plaidAccount({ id: "p-card", name: "Chase Freedom", mask: "4321", type: "credit", subtype: "credit card", current: 100, available: 900, limit: 1000 })]
    });
    await refresh(db, plaid.fetch);
    const afterFirst = db.state.accounts.map((a) => ({ id: a.id, created_at: new Date(a.created_at).toISOString() }));
    assert.equal(afterFirst.length, 2);

    clock = new Date("2026-10-08T07:00:00.000Z");
    const second = await refresh(db, plaid.fetch, { asOf: clock.toISOString() });

    assert.equal(db.state.accounts.length, 2, "the second run added an account");
    assert.deepEqual(db.state.accounts.map((a) => ({ id: a.id, created_at: new Date(a.created_at).toISOString() })), afterFirst,
      "ids and created_at are untouched by a re-read");
    assert.equal(second.totals.created, 0);
    assert.equal(db.state.accounts.find((a) => a.plaid_account_id === "p-card").updated_at.toISOString(), "2026-10-08T07:00:00.000Z");
  });
});

describe("new and missing accounts", () => {
  const CARD = plaidAccount({
    id: "p-card", name: "Chase Freedom", mask: "4321", type: "credit", subtype: "credit card",
    current: 1200.5, available: 8799.5, limit: 10000
  });

  test("an account Plaid lists that was never stored is created — as a plaid row, ownership unknown", async () => {
    const db = fakeBankDb({
      items: [login()],
      accounts: [held({ id: "acc-chk", plaidAcc: "p-chk", name: "Business Checking", mask: "2202", current: 2000050, kind: "business" })]
    });
    const plaid = stubPlaid({ [TOKEN_A]: [CHECKING, CARD] });

    const r = await refresh(db, plaid.fetch);

    assert.equal(db.state.accounts.length, 2);
    const card = db.state.accounts.find((a) => a.plaid_account_id === "p-card");
    assert.equal(card.provider, "plaid");
    assert.equal(card.plaid_item_id, ITEM_A);
    assert.equal(card.account_type, "credit");
    assert.equal(card.entity_kind, "unknown", "an ingest never decides whose money an account is");
    assert.equal(card.current_balance_cents, 120050);
    assert.equal(card.available_balance_cents, 879950);
    assert.equal(card.credit_limit_cents, 1000000);
    assert.equal(new Date(card.created_at).toISOString(), NOW, "created now — which is what lets the new-credit alert see it");

    assert.deepEqual(r.created, [{
      id: card.id, name: "Chase Freedom", mask: "4321", account_type: "credit", account_subtype: "credit card"
    }]);
    assert.equal(r.totals.created, 1);
    assert.equal(r.items[0].firstRead, false, "this login already had accounts, so this is a discovery, not a baseline");
  });

  test("an account Plaid stopped listing is reported as vanished — and left exactly as it was", async () => {
    const db = fakeBankDb({
      items: [login()],
      accounts: [
        held({ id: "acc-chk", plaidAcc: "p-chk", name: "Business Checking", mask: "2202", current: 2000050 }),
        held({ id: "acc-old", plaidAcc: "p-old", name: "Old Visa", mask: "7777", type: "credit", current: 4000, limit: 500000 })
      ]
    });
    const plaid = stubPlaid({ [TOKEN_A]: [CHECKING] });

    const r = await refresh(db, plaid.fetch);

    assert.equal(r.vanished.length, 1);
    assert.equal(r.vanished[0].id, "acc-old");
    assert.equal(r.vanished[0].name, "Old Visa");
    assert.match(r.vanished[0].note, /has NOT been closed or removed/);
    const old = db.state.accounts.find((a) => a.id === "acc-old");
    assert.ok(old, "the vanished account was deleted");
    assert.equal(old.closed_at, null, "the vanished account was closed on the strength of one missing read");
    assert.equal(old.current_balance_cents, 4000, "its stored figures were not touched");
    assert.equal(db.state.accounts.length, 2);
    assert.ok(db.calls.every((c) => !/closed_at\s*=/.test(c.sql)), "no statement set closed_at");
    assert.equal(r.totals.vanished, 1);
  });

  test("an empty list from Plaid is an answer: every open account is reported vanished, none is closed", async () => {
    const db = fakeBankDb({
      items: [login()],
      accounts: [held({ id: "acc-chk", plaidAcc: "p-chk" }), held({ id: "acc-sav", plaidAcc: "p-sav" })]
    });
    const r = await refresh(db, stubPlaid({ [TOKEN_A]: [] }).fetch);
    assert.equal(r.ok, true);
    assert.equal(r.vanished.length, 2);
    assert.ok(db.state.accounts.every((a) => a.closed_at === null));
  });

  test("an already-closed account that Plaid stops listing is not news; one it still lists stays closed", async () => {
    const closedAt = "2026-10-06T23:06:52.822Z";
    const db = fakeBankDb({
      items: [login()],
      accounts: [
        held({ id: "acc-gone", plaidAcc: "p-gone", closedAt }),
        held({ id: "acc-still", plaidAcc: "p-still", closedAt, current: 1000 })
      ]
    });
    const plaid = stubPlaid({ [TOKEN_A]: [plaidAccount({ id: "p-still", current: 42, available: 42 })] });
    const r = await refresh(db, plaid.fetch);
    assert.deepEqual(r.vanished, [], "a closed account missing from Plaid's list is expected");
    const still = db.state.accounts.find((a) => a.id === "acc-still");
    assert.equal(still.closed_at, closedAt, "a refresh never re-opens or re-dates a closed account");
    assert.equal(still.current_balance_cents, 4200);
    assert.equal(r.totals.created, 0);
  });

  test("'vanished' is judged login by login — one bank's accounts are not missing from another bank's list", async () => {
    const db = fakeBankDb({
      items: [login(), login({ id: ITEM_B, plaidItemId: PLAID_B, token: TOKEN_B })],
      accounts: [
        held({ id: "a1", itemId: ITEM_A, plaidAcc: "p-a1", name: "Bank A Checking" }),
        held({ id: "b1", itemId: ITEM_B, plaidAcc: "p-b1", name: "Bank B Checking" })
      ]
    });
    const plaid = stubPlaid({
      [TOKEN_A]: [plaidAccount({ id: "p-a1", name: "Bank A Checking" })],
      [TOKEN_B]: [plaidAccount({ id: "p-b1", name: "Bank B Checking" })]
    });

    // One login only: the store's own list of "stored but not in this read" would
    // name Bank B's account, because it looks across every Plaid login of the client.
    const one = await refresh(db, plaid.fetch, { itemRowId: ITEM_A });
    assert.deepEqual(one.items.map((i) => i.itemRowId), [ITEM_A]);
    assert.deepEqual(one.vanished, [], "Bank B's account was reported as vanished from Bank A's read");
    assert.equal(plaid.requests.length, 1, "only the named login was asked");

    const both = await refresh(db, plaid.fetch);
    assert.deepEqual(both.vanished, []);
    assert.equal(both.items.length, 2);
  });

  test("an account Plaid sends with no id is skipped, because without an id it would be added again every day", async () => {
    const db = fakeBankDb({ items: [login()], accounts: [] });
    const plaid = stubPlaid({
      [TOKEN_A]: [plaidAccount({ id: null, name: "Mystery" }), plaidAccount({ id: "p-chk", name: "Checking" })]
    });
    const r = await refresh(db, plaid.fetch);
    assert.equal(r.items[0].read, 2);
    assert.equal(r.items[0].skippedNoId, 1);
    assert.equal(db.state.accounts.length, 1);
    assert.equal(db.state.accounts[0].plaid_account_id, "p-chk");
  });
});

describe("a login that fails", () => {
  const LOGIN_REQUIRED = { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "the user must log in again" };

  test("ITEM_LOGIN_REQUIRED marks that login for re-link, writes nothing for it, and the next login still runs", async () => {
    const db = fakeBankDb({
      items: [login(), login({ id: ITEM_B, plaidItemId: PLAID_B, token: TOKEN_B })],
      accounts: [
        held({ id: "a1", itemId: ITEM_A, plaidAcc: "p-a1", current: 111 }),
        held({ id: "b1", itemId: ITEM_B, plaidAcc: "p-b1", current: 222 })
      ]
    });
    const plaid = stubPlaid({
      [TOKEN_A]: LOGIN_REQUIRED,
      [TOKEN_B]: [plaidAccount({ id: "p-b1", current: 9, available: 9 })]
    });

    const r = await refresh(db, plaid.fetch);

    const bad = db.state.items.find((i) => i.id === ITEM_A);
    assert.equal(bad.link_state, "error");
    assert.equal(bad.last_error_code, "ITEM_LOGIN_REQUIRED");
    assert.ok(bad.last_error_at);
    assert.equal(db.state.items.find((i) => i.id === ITEM_B).link_state, "active");

    assert.equal(r.items[0].ok, false);
    assert.equal(r.items[0].relinkNeeded, true);
    assert.equal(r.items[0].errorCode, "ITEM_LOGIN_REQUIRED");
    assert.equal(r.items[0].reason, "upstream_error");
    assert.equal(db.state.accounts.find((a) => a.id === "a1").current_balance_cents, 111, "the failed login's stored balance was touched");
    assert.equal(db.state.accounts.find((a) => a.id === "b1").current_balance_cents, 900, "the healthy login was not refreshed");

    assert.equal(r.ok, true, "one login was read, so the run did something");
    assert.equal(r.totals.itemsOk, 1);
    assert.equal(r.totals.itemsFailed, 1);
    assert.equal(r.totals.relink, 1);
    assert.equal(r.accounts.length, 1, "only the healthy login's rows came back");
  });

  test("a rate limit is recorded and leaves the login active — it is not a re-link", async () => {
    const db = fakeBankDb({ items: [login()], accounts: [held({ id: "a1", plaidAcc: "p-a1" })] });
    const plaid = stubPlaid({
      [TOKEN_A]: { error_type: "RATE_LIMIT_EXCEEDED", error_code: "ACCOUNTS_LIMIT", error_message: "slow down" }
    });
    const r = await refresh(db, plaid.fetch);
    const it = db.state.items[0];
    assert.equal(it.link_state, "active");
    assert.equal(it.last_error_code, "ACCOUNTS_LIMIT");
    assert.equal(r.items[0].relinkNeeded, false);
    assert.equal(r.items[0].retryable, true);
    assert.equal(r.totals.relink, 0);
  });

  test("when every login fails the run is not ok, and says why", async () => {
    const db = fakeBankDb({ items: [login()] });
    const r = await refresh(db, stubPlaid({ [TOKEN_A]: LOGIN_REQUIRED }).fetch);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "upstream_error");
    assert.equal(r.ran, true);
  });

  test("a call the adapters fence holds is reported as held, and the login is left alone", async () => {
    const db = fakeBankDb({ items: [login()], accounts: [held({ id: "a1", plaidAcc: "p-a1" })] });
    let sent = false;
    const r = await refreshClientAccounts(db, {
      orgId: ORG, clientId: CLIENT, asOf: NOW, env: { ...ENV, ADAPTERS_DRY_RUN: "1" },
      fetchImpl: async () => { sent = true; }
    });
    assert.equal(sent, false);
    assert.equal(r.items[0].reason, "held");
    assert.equal(db.state.items[0].last_error_code, null, "a held call is not a bank error");
    assert.equal(db.state.items[0].link_state, "active");
  });
});

describe("the stored token", () => {
  test("it is decrypted with Plaid's item id as the AAD and sent as the access token", async () => {
    const db = fakeBankDb({ items: [login()] });
    const plaid = stubPlaid({ [TOKEN_A]: [CHECKING] });
    await refresh(db, plaid.fetch);
    assert.equal(plaid.requests.length, 1);
    assert.equal(plaid.requests[0].path, "/accounts/get");
    assert.equal(plaid.requests[0].body.access_token, TOKEN_A, "the plaintext of the sealed token reached Plaid");
    assert.equal(plaid.requests[0].body.client_id, "cid");
  });

  test("a token sealed for a different login does not decrypt: nothing is sent, nothing is written, the login is not blamed on Plaid", async () => {
    // Sealed against the plaid_items ROW id instead of Plaid's item id — the wrong AAD.
    const db = fakeBankDb({ items: [login({ aad: ITEM_A })], accounts: [held({ id: "a1", plaidAcc: "p-a1", current: 7 })] });
    let sent = false;
    const r = await refresh(db, async () => { sent = true; });
    assert.equal(sent, false, "a request went out with a token that did not belong to this login");
    assert.equal(r.items[0].ok, false);
    assert.equal(r.items[0].reason, "bad_request");
    assert.equal(r.items[0].errorCode, "token_decrypt_failed");
    assert.equal(db.state.accounts[0].current_balance_cents, 7);
    assert.equal(db.state.items[0].link_state, "active", "a key problem is not Plaid saying the client must log in");
    assert.equal(db.state.items[0].last_error_code, null);
  });

  test("no result carries the token, the ciphertext or the secret", async () => {
    const it = login();
    const db = fakeBankDb({ items: [it] });
    const r = await refresh(db, stubPlaid({ [TOKEN_A]: [CHECKING] }).fetch);
    const text = JSON.stringify(r);
    for (const secret of [TOKEN_A, it.encrypted_access_token, "sec"]) {
      assert.equal(text.includes(secret), false, `the result contained ${secret.slice(0, 8)}…`);
    }
  });
});

describe("real-time balances are opt-in", () => {
  const REALTIME = { ...ENV, [REALTIME_ENV]: "1" };

  test("by default only /accounts/get is called, with no options", async () => {
    const db = fakeBankDb({ items: [login()] });
    const plaid = stubPlaid({ [TOKEN_A]: [CHECKING] });
    const r = await refresh(db, plaid.fetch);
    assert.deepEqual(plaid.requests.map((q) => q.path), ["/accounts/get"]);
    assert.equal(plaid.requests[0].body.options, undefined);
    assert.equal(r.balanceSource, BALANCE_SOURCES.CACHED);
  });

  test("only the exact string '1' switches it on", () => {
    assert.equal(realtimeBalancesOn({ [REALTIME_ENV]: "1" }), true);
    for (const v of [undefined, "", "0", "true", "yes", "TRUE", " 1", "1 ", "on"]) {
      assert.equal(realtimeBalancesOn({ [REALTIME_ENV]: v }), false, `${JSON.stringify(v)} switched on a billed call`);
    }
    assert.equal(realtimeBalancesOn({}), false);
  });

  test("on: /accounts/balance/get with a floor a day back, in whole seconds, and the rows say real-time", async () => {
    const db = fakeBankDb({ items: [login()] });
    const plaid = stubPlaid({}, { balanceByToken: { [TOKEN_A]: [CHECKING] } });
    const r = await refresh(db, plaid.fetch, { env: REALTIME });
    assert.deepEqual(plaid.requests.map((q) => q.path), ["/accounts/balance/get"]);
    assert.deepEqual(plaid.requests[0].body.options, { min_last_updated_datetime: "2026-10-06T07:00:00Z" });
    assert.equal(r.balanceSource, BALANCE_SOURCES.REALTIME);
    assert.equal(r.items[0].balanceSource, BALANCE_SOURCES.REALTIME);
    assert.equal(db.state.accounts[0].raw.balance_source, BALANCE_SOURCES.REALTIME);
    assert.equal(db.state.accounts[0].current_balance_cents, 2000050);
  });

  test("on, and the real-time read fails for a reason other than the login: it falls back to the cached read", async () => {
    const db = fakeBankDb({ items: [login()] });
    const plaid = stubPlaid({ [TOKEN_A]: [CHECKING] }, {
      balanceByToken: { [TOKEN_A]: { error_type: "INVALID_REQUEST", error_code: "INVALID_FIELD", error_message: "needs a floor" } }
    });
    const r = await refresh(db, plaid.fetch, { env: REALTIME });
    assert.deepEqual(plaid.requests.map((q) => q.path), ["/accounts/balance/get", "/accounts/get"]);
    assert.equal(r.items[0].ok, true);
    assert.equal(r.items[0].realtimeError, "INVALID_FIELD", "the report says why a real-time run read the cache");
    assert.equal(r.items[0].balanceSource, BALANCE_SOURCES.CACHED);
    assert.equal(db.state.accounts[0].raw.balance_source, BALANCE_SOURCES.CACHED, "the row must not claim a balance it did not get live");
  });

  test("on, and the login is broken: no fallback — the cached read would fail the same way", async () => {
    const db = fakeBankDb({ items: [login()] });
    const plaid = stubPlaid({ [TOKEN_A]: [CHECKING] }, {
      balanceByToken: { [TOKEN_A]: { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "log in" } }
    });
    const r = await refresh(db, plaid.fetch, { env: REALTIME });
    assert.equal(plaid.requests.length, 1);
    assert.equal(r.items[0].relinkNeeded, true);
    assert.equal(db.state.items[0].link_state, "error");
  });
});

describe("refusals — nothing is read or written", () => {
  test("not configured: names only, no database, no network", async () => {
    const db = fakeBankDb({ items: [login()] });
    const r = await refreshClientAccounts(db, {
      orgId: ORG, clientId: CLIENT, asOf: NOW, env: {}, fetchImpl: () => assert.fail("must not transmit")
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_configured");
    assert.ok(r.missing.includes("PLAID_SECRET"));
    for (const m of r.missing.filter((x) => /^[A-Z_]+$/.test(x))) assert.match(m, /^[A-Z0-9_]+$/);
    assert.equal(db.calls.length, 0);
  });

  test("org, client and a real asOf are required", async () => {
    const db = fakeBankDb({ items: [login()] });
    for (const bad of [{ orgId: null }, { clientId: null }, { asOf: null }, { asOf: "yesterday" }]) {
      const r = await refresh(db, () => assert.fail("must not transmit"), bad);
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.equal(r.reason, "bad_request");
    }
    assert.equal(db.calls.length, 0);
  });

  test("an item id that is not a uuid is refused before the database is touched", async () => {
    const db = fakeBankDb({ items: [login()] });
    const r = await refresh(db, () => assert.fail("must not transmit"), { itemRowId: "item-1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bad_request");
    assert.equal(db.calls.length, 0);
  });

  test("a client with no linked bank is an answer, not an error: nobody was asked", async () => {
    const db = fakeBankDb({ items: [] });
    const r = await refresh(db, () => assert.fail("must not transmit"));
    assert.equal(r.ok, true);
    assert.equal(r.ran, false);
    assert.equal(r.reason, "no_linked_bank");
    assert.equal(r.totals.written, 0);
  });

  test("a named login this client cannot read — not theirs, not active, errored — is no_readable_item", async () => {
    const other = login({ id: ITEM_B, plaidItemId: PLAID_B, token: TOKEN_B, link_state: "error" });
    const db = fakeBankDb({ items: [login(), other] });
    for (const id of [ITEM_B, "00000000-0000-0000-0000-0000000000ff"]) {
      const r = await refresh(db, () => assert.fail("must not transmit"), { itemRowId: id });
      assert.equal(r.ok, false, id);
      assert.equal(r.reason, "no_readable_item");
    }
  });

  test("the login read is scoped to the org and the client and takes only active, consented, tokened, real logins", async () => {
    const db = fakeBankDb({ items: [] });
    await readRefreshItems(db, { orgId: ORG, clientId: CLIENT, itemRowId: null });
    const { sql, params } = db.calls[0];
    assert.match(sql, /org_id = \$1 AND client_id = \$2/);
    assert.match(sql, /link_state = 'active'/);
    assert.match(sql, /consent_granted_at IS NOT NULL/);
    assert.match(sql, /encrypted_access_token IS NOT NULL/);
    assert.match(sql, /plaid_item_id NOT LIKE 'mock:%'/);
    assert.deepEqual(params, [ORG, CLIENT, null]);
  });

  test("a refresh never issues a DELETE or a close", async () => {
    const db = fakeBankDb({
      items: [login()],
      accounts: [held({ id: "acc-old", plaidAcc: "p-old" })]
    });
    await refresh(db, stubPlaid({ [TOKEN_A]: [CHECKING] }).fetch);
    assert.ok(db.calls.every((c) => !/\bDELETE\b/i.test(c.sql)));
    assert.ok(db.calls.every((c) => !/closed_at\s*=/.test(c.sql)));
  });
});

describe("the file-protection new-credit alert reads what a refresh writes", () => {
  /* The alert's own pure planner, fed rows shaped exactly like its snapshot read
     (src/finance/file-alerts/snapshot.mjs ACCOUNT_META_SQL): bank_accounts joined to
     the login's created_at. */
  const metaRows = (db) => db.state.accounts.map((a) => ({
    id: a.id, account_type: a.account_type, plaid_item_id: a.plaid_item_id, mask: a.mask, name: a.name,
    closed_at: a.closed_at, created_at: a.created_at, balance_as_of: a.balance_as_of,
    item_created_at: db.state.items.find((i) => i.id === a.plaid_item_id)?.created_at ?? null
  }));
  const CARD = plaidAccount({
    id: "p-card", name: "Chase Freedom", mask: "4321", type: "credit", subtype: "credit card",
    current: 100, available: 900, limit: 1000
  });
  const OLD_CARD = plaidAccount({
    id: "p-amex", name: "Business Amex", mask: "4404", type: "credit", subtype: "credit card",
    current: 4944.27, available: 20055.73, limit: 25000
  });

  test("a card opened since the link is seen as new credit, once — and the cards already on file are not", async () => {
    const db = fakeBankDb({
      items: [login({ createdAt: "2026-09-20T10:00:00.000Z" })],
      accounts: [held({ id: "acc-amex", plaidAcc: "p-amex", name: "Business Amex", mask: "4404", type: "credit", current: 494427, limit: 2500000, createdAt: "2026-09-20T10:00:05.000Z" })]
    });
    const plaid = stubPlaid({ [TOKEN_A]: [OLD_CARD, CARD] });

    await refresh(db, plaid.fetch);
    const plan = planNewAccounts(metaRows(db), { now: new Date(NOW) });

    assert.equal(plan.alerts.length, 1, "exactly the new card");
    const card = db.state.accounts.find((a) => a.plaid_account_id === "p-card");
    assert.equal(plan.alerts[0].bankAccountId, card.id);
    assert.equal(plan.alerts[0].key, `fpa:new:acct:${card.id}`);
    assert.match(plan.alerts[0].label, /Chase Freedom ending 4321/);
    assert.ok(plan.skipped.some((s) => s.accountId === "acc-amex" && s.reason === "first_read_of_the_login"),
      "the card that came in with the link stayed the baseline");

    // Tomorrow's refresh finds the same two cards: still one alert key, no second card.
    await refresh(db, plaid.fetch, { asOf: "2026-10-08T07:00:00.000Z" });
    const again = planNewAccounts(metaRows(db), { now: new Date("2026-10-08T07:30:00.000Z") });
    assert.deepEqual(again.alerts.map((a) => a.key), plan.alerts.map((a) => a.key), "the same alert key — the alerts store sends it once");
  });

  test("the first read of a login that has no accounts yet is the baseline, even days after the login was made", async () => {
    // The link died after the login row was saved and before its accounts were: five
    // days later this refresh is the first read. None of it is new credit.
    const db = fakeBankDb({ items: [login({ createdAt: "2026-10-02T09:00:00.000Z" })], accounts: [] });
    const plaid = stubPlaid({ [TOKEN_A]: [CHECKING, OLD_CARD, CARD] });

    const r = await refresh(db, plaid.fetch);

    assert.equal(r.items[0].firstRead, true);
    assert.equal(r.totals.created, 3);
    for (const a of db.state.accounts) {
      assert.equal(new Date(a.created_at).toISOString(), "2026-10-02T09:00:00.000Z", "created_at was given the login's own baseline");
    }
    const plan = planNewAccounts(metaRows(db), { now: new Date(NOW) });
    assert.deepEqual(plan.alerts, [], "the client was told they opened new credit when all that happened is we looked");
    assert.deepEqual(
      plan.skipped.map((s) => s.reason).sort(),
      ["first_read_of_the_login", "first_read_of_the_login"]
    );
  });

  test("the baseline is only for a first read — a login that already has accounts is never re-dated", async () => {
    const db = fakeBankDb({
      items: [login({ createdAt: "2026-10-02T09:00:00.000Z" })],
      accounts: [held({ id: "acc-chk", plaidAcc: "p-chk", createdAt: "2026-10-02T09:00:30.000Z" })]
    });
    await refresh(db, stubPlaid({ [TOKEN_A]: [CHECKING, CARD] }).fetch);
    const card = db.state.accounts.find((a) => a.plaid_account_id === "p-card");
    assert.equal(new Date(card.created_at).toISOString(), NOW);
    assert.ok(!db.calls.some((c) => /SET created_at = LEAST/.test(c.sql)), "the baseline statement ran for a login that had accounts");
  });
});

describe("toRefreshAccount", () => {
  test("is the completeLink mapping plus where the balance came from", () => {
    const a = {
      plaidAccountId: "p1", name: "Visa", officialName: null, mask: "3303", type: "credit", subtype: "credit card",
      currentBalance: 1233.3, availableBalance: null, creditLimit: 8000, isoCurrencyCode: "USD", holderCategory: "personal"
    };
    const row = toRefreshAccount(a, { asOf: NOW, source: BALANCE_SOURCES.REALTIME });
    assert.equal(row.providerAccountId, "p1");
    assert.equal(row.currentBalanceCents, 123330);
    assert.equal(row.availableBalanceCents, null);
    assert.equal(row.creditLimitCents, 800000);
    assert.equal(row.balanceAsOf, NOW);
    assert.equal(row.raw.balance_source, BALANCE_SOURCES.REALTIME);
    assert.equal(row.raw.holder_category, "personal", "Plaid's tag is kept for the record");
    assert.equal(row.entityKind, undefined, "no ownership claim of any kind");
    assert.equal(toRefreshAccount(a, { asOf: NOW }).raw.balance_source, BALANCE_SOURCES.CACHED);
  });
});
