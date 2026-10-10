// Plaid update mode — the repair of a broken bank login. Stubbed database
// (plaid-fake-db.mjs) and a stand-in fetch; NOTHING HERE REACHES THE NETWORK OR A
// DATABASE. The SQL itself is proved against real Postgres in plaid-relink.pg.test.mjs.
//
// What these tests are really guarding, in the order a client would meet it:
//   * a Link token made for the wrong person's login, or from a login that is gone;
//   * the bank access token leaking into a result, an error, or any query that did
//     not need it;
//   * a login that reads "Connected" because a button was pressed, not because the
//     bank answered;
//   * a login Plaid still says is broken being told it is fixed (or fixed twice);
//   * the daily job's own rules being weakened by the repair path: an account closed
//     or its ownership reset, an unknown balance turned into zero.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  startRelink, finishRelink, listBankLoginStatus, bankLoginView, RELINK_REASONS, RelinkInputError
} from "./plaid-relink.mjs";
import { encryptPlaidToken } from "./plaid.mjs";
import { fakeBankDb, plaidAccount, stubPlaid } from "./plaid-fake-db.mjs";

const ENV = Object.freeze({
  PLAID_CLIENT_ID: "cid",
  PLAID_SECRET: "sec",
  PLAID_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64"),
  PLAID_ENV: "sandbox",
  ADAPTERS_DRY_RUN: "0"
});

const ORG = "00000000-0000-0000-0000-0000000000aa";
const OTHER_ORG = "00000000-0000-0000-0000-0000000000ab";
const CLIENT = "00000000-0000-0000-0000-0000000000cc";
const OTHER_CLIENT = "00000000-0000-0000-0000-0000000000dd";
const ITEM_A = "00000000-0000-0000-0000-0000000000a1"; // plaid_items.id
const ITEM_B = "00000000-0000-0000-0000-0000000000b1";
const PLAID_A = "item-sandbox-A";                       // Plaid's own item id
const PLAID_B = "item-sandbox-B";
const TOKEN_A = "access-sandbox-secret-A";
const TOKEN_B = "access-sandbox-secret-B";
const NOW = "2026-10-07T12:00:00.000Z";
const ERRORED_AT = "2026-10-05T07:00:02.000Z";

const LOGIN_REQUIRED = { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "the user must log in again" };

/** A plaid_items row. In 'error' by default: that is the login a repair is for. */
const login = ({
  id = ITEM_A, plaidItemId = PLAID_A, token = TOKEN_A, aad = plaidItemId, linkState = "error",
  orgId = ORG, clientId = CLIENT, ...over
} = {}) => ({
  id, org_id: orgId, client_id: clientId, plaid_item_id: plaidItemId, institution_name: "First Platypus Bank",
  encrypted_access_token: encryptPlaidToken(token, { itemId: aad, env: ENV }),
  consent_granted_at: "2026-09-20T10:00:00.000Z", created_at: "2026-09-20T10:00:00.000Z",
  link_state: linkState,
  last_error_code: linkState === "error" ? "ITEM_LOGIN_REQUIRED" : null,
  last_error_at: linkState === "error" ? ERRORED_AT : null,
  ...over
});

const held = ({ id, itemId = ITEM_A, plaidAcc, name = "Checking", current = 100000, kind = "unknown", closedAt = null }) => ({
  id, org_id: ORG, client_id: CLIENT, plaid_item_id: itemId, plaid_account_id: plaidAcc,
  name, mask: "0000", account_type: "depository", current_balance_cents: current, available_balance_cents: current,
  credit_limit_cents: null, entity_kind: kind, closed_at: closedAt,
  created_at: "2026-09-20T10:01:00.000Z", updated_at: "2026-09-20T10:01:00.000Z", balance_as_of: "2026-10-04T07:00:00.000Z"
});

const CHECKING = plaidAccount({ id: "p-chk", name: "Business Checking", mask: "2202", current: 20000.5, available: 19000 });

/** A stand-in for Plaid: /link/token/create answers by `link`, every other path by
 *  the access token (stubPlaid). Every request is recorded. */
function plaidStub({ byToken = {}, link = null } = {}) {
  const accounts = stubPlaid(byToken);
  const linkRequests = [];
  const fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/link/token/create") {
      linkRequests.push(JSON.parse(init.body));
      const answer = link || { link_token: "link-sandbox-update-abc", expiration: "2026-10-07T12:30:00Z", request_id: "r" };
      return new Response(JSON.stringify(answer), {
        status: answer.error_code ? 400 : 200, headers: { "content-type": "application/json" }
      });
    }
    return accounts.fetch(url, init);
  };
  return {
    fetch,
    linkRequests,
    get reads() { return accounts.requests; },
    get calls() { return linkRequests.length + accounts.requests.length; }
  };
}

const start = (db, plaid, over = {}) =>
  startRelink(db, { orgId: ORG, clientId: CLIENT, itemRowId: ITEM_A, env: ENV, fetchImpl: plaid.fetch, ...over });
const finish = (db, plaid, over = {}) =>
  finishRelink(db, { orgId: ORG, clientId: CLIENT, itemRowId: ITEM_A, asOf: NOW, env: ENV, fetchImpl: plaid.fetch, ...over });

const SECRETS = (...rows) => [TOKEN_A, TOKEN_B, "sec", ...rows.map((r) => r.encrypted_access_token)];
const assertNoSecrets = (value, ...rows) => {
  const text = JSON.stringify(value);
  for (const s of SECRETS(...rows)) assert.equal(text.includes(s), false, `the result contained ${s.slice(0, 10)}…`);
};

/* ── startRelink ─────────────────────────────────────────────────────────────── */

describe("startRelink — the Link token for update mode", () => {
  test("a broken login gets a link token made WITH its access token and WITHOUT products", async () => {
    const row = login();
    const db = fakeBankDb({ items: [row] });
    const plaid = plaidStub();
    const r = await start(db, plaid);

    assert.equal(r.ok, true);
    assert.equal(r.linkToken, "link-sandbox-update-abc");
    assert.equal(r.expiration, "2026-10-07T12:30:00Z");
    assert.equal(r.environment, "sandbox");
    assert.equal(r.itemRowId, ITEM_A);
    assert.equal(r.institution, "First Platypus Bank");

    assert.equal(plaid.linkRequests.length, 1);
    const sent = plaid.linkRequests[0];
    assert.equal(sent.access_token, TOKEN_A, "the plaintext of the sealed token reached Plaid (AAD = Plaid's item id)");
    assert.equal("products" in sent, false, "an update-mode link token carries no products");
    assert.equal("update" in sent, false, "no account selection unless asked");
    assert.equal(sent.user.client_user_id, CLIENT);
    assertNoSecrets(r, row);
  });

  test("accountSelection: true asks Plaid for the account picker — and only true does", async () => {
    const db = fakeBankDb({ items: [login()] });
    const on = plaidStub();
    await start(db, on, { accountSelection: true });
    assert.deepEqual(on.linkRequests[0].update, { account_selection_enabled: true });

    for (const value of [false, undefined, "true", 1]) {
      const off = plaidStub();
      await start(db, off, { accountSelection: value });
      assert.equal("update" in off.linkRequests[0], false, `${String(value)} turned the picker on`);
    }
  });

  test("an active login can also be taken through update mode (to add accounts)", async () => {
    const db = fakeBankDb({ items: [login({ linkState: "active" })] });
    const plaid = plaidStub();
    const r = await start(db, plaid, { accountSelection: true });
    assert.equal(r.ok, true);
    assert.equal(plaid.linkRequests.length, 1);
  });

  test("not configured: names only, and nothing is read or sent", async () => {
    const db = fakeBankDb({ items: [login()] });
    const plaid = plaidStub();
    const r = await start(db, plaid, { env: {} });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_configured");
    assert.ok(r.missing.includes("PLAID_SECRET"));
    assert.equal(plaid.calls, 0);
    assert.equal(db.calls.length, 0);
  });

  test("bad ids are refused before the database is touched", async () => {
    const db = fakeBankDb({ items: [login()] });
    const plaid = plaidStub();
    for (const over of [{ itemRowId: "nope" }, { itemRowId: undefined }, { clientId: "x" }, { orgId: null }]) {
      const r = await start(db, plaid, over);
      assert.equal(r.ok, false);
      assert.equal(r.reason, "bad_request", JSON.stringify(over));
    }
    assert.equal(db.calls.length, 0);
    assert.equal(plaid.calls, 0);
  });

  test("another client's login, or another org's, is no_such_login — and Plaid is never asked", async () => {
    const mine = login({ id: ITEM_A });
    const theirs = login({ id: ITEM_B, plaidItemId: PLAID_B, token: TOKEN_B, clientId: OTHER_CLIENT });
    const foreign = login({ id: "00000000-0000-0000-0000-0000000000f1", plaidItemId: "item-sandbox-F", orgId: OTHER_ORG });
    const db = fakeBankDb({ items: [mine, theirs, foreign] });
    const plaid = plaidStub();

    // CLIENT asks for OTHER_CLIENT's login.
    const a = await start(db, plaid, { itemRowId: ITEM_B });
    assert.equal(a.ok, false);
    assert.equal(a.reason, RELINK_REASONS.NO_SUCH_LOGIN);
    // CLIENT in ORG asks for a login that lives in another org.
    const b = await start(db, plaid, { itemRowId: foreign.id });
    assert.equal(b.reason, RELINK_REASONS.NO_SUCH_LOGIN);
    // A login that does not exist is the same answer.
    const c = await start(db, plaid, { itemRowId: "00000000-0000-0000-0000-00000000dead" });
    assert.equal(c.reason, RELINK_REASONS.NO_SUCH_LOGIN);
    assert.equal(plaid.calls, 0);
    assert.equal(db.calls.some((q) => /relink:token/.test(q.sql)), false, "the credential was read for a login that is not theirs");
  });

  test("a revoked, unlinked, pending, practice, consent-less or credential-less login cannot go through update mode", async () => {
    const cases = {
      revoked: login({ linkState: "revoked" }),
      unlinked: login({ linkState: "unlinked" }),
      pending: login({ linkState: "pending" }),
      practice: login({ plaidItemId: "mock:" + CLIENT }),
      noConsent: login({ consent_granted_at: null }),
      noCredential: login({ encrypted_access_token: null }),
      noItem: login({ plaidItemId: null, aad: PLAID_A })
    };
    for (const [name, row] of Object.entries(cases)) {
      const db = fakeBankDb({ items: [row] });
      const plaid = plaidStub();
      const r = await start(db, plaid);
      assert.equal(r.ok, false, name);
      assert.equal(r.reason, RELINK_REASONS.NOT_RECONNECTABLE, name);
      assert.equal(r.fix, "connect_again", name);
      assert.equal(typeof r.plain, "string", name);
      assert.equal(plaid.calls, 0, `${name}: Plaid was asked about a login that cannot be repaired`);
      assert.equal(db.calls.some((q) => /relink:token/.test(q.sql)), false, `${name}: the credential was read`);
    }
  });

  test("a token sealed for a different login does not decrypt: token_unreadable, nothing sent, no key text in the answer", async () => {
    const row = login({ aad: ITEM_A }); // sealed against the ROW id, not Plaid's item id
    const db = fakeBankDb({ items: [row] });
    const plaid = plaidStub();
    const r = await start(db, plaid);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RELINK_REASONS.TOKEN_UNREADABLE);
    assert.equal(r.fix, "connect_again");
    assert.equal(plaid.calls, 0);
    assert.doesNotMatch(JSON.stringify(r), /authentication failed|ciphertext|PLAID_TOKEN_ENC_KEY/);
  });

  test("Plaid says the login cannot be updated: upstream_error with the code and words for 'connect again'", async () => {
    const db = fakeBankDb({ items: [login()] });
    const plaid = plaidStub({ link: { error_type: "ITEM_ERROR", error_code: "ITEM_NOT_FOUND", error_message: "the item was removed" } });
    const r = await start(db, plaid);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "upstream_error");
    assert.equal(r.errorCode, "ITEM_NOT_FOUND");
    assert.equal(r.fix, "connect_again");
    assert.match(r.plain, /connect your bank again/i);
    assertNoSecrets(r);
  });

  test("the adapters fence holds the call: reason held, nothing sent", async () => {
    const db = fakeBankDb({ items: [login()] });
    let sent = false;
    const r = await startRelink(db, {
      orgId: ORG, clientId: CLIENT, itemRowId: ITEM_A, env: { ...ENV, ADAPTERS_DRY_RUN: "1" },
      fetchImpl: async () => { sent = true; }
    });
    assert.equal(sent, false);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "held");
    assert.equal(r.fix, "check_again");
  });

  test("THE CREDENTIAL IS READ BY ONE STATEMENT ONLY — no other query in the repair path selects it", async () => {
    const db = fakeBankDb({ items: [login()] });
    const plaid = plaidStub({ byToken: { [TOKEN_A]: [CHECKING] } });
    await start(db, plaid);
    await finish(db, plaid);
    const touching = db.calls.filter((q) => /encrypted_access_token/.test(q.sql));
    for (const q of touching) {
      const isTheOne = /relink:token/.test(q.sql);
      // refreshClientAccounts has its own read of it (the daily job's, unchanged).
      const isRefresh = /FROM plaid_items/.test(q.sql) && /SELECT id, plaid_item_id, institution_name, encrypted_access_token/.test(q.sql);
      // The others may only ask whether one EXISTS.
      const onlyExistence = /encrypted_access_token IS NOT NULL/.test(q.sql) && !/SELECT\s+(?:i\.)?encrypted_access_token/.test(q.sql);
      assert.ok(isTheOne || isRefresh || onlyExistence, `this statement selects the credential: ${q.sql.replace(/\s+/g, " ").slice(0, 100)}`);
    }
    assert.equal(db.calls.filter((q) => /relink:token/.test(q.sql)).length, 1);
  });
});

/* ── finishRelink ────────────────────────────────────────────────────────────── */

describe("finishRelink — the client says it is fixed", () => {
  test("a read that works: the login is active again, its error is gone, the accounts come back", async () => {
    const db = fakeBankDb({
      items: [login({ reconnect_notified_at: "2026-10-05T07:05:00.000Z" })],
      accounts: [held({ id: "acc-chk", plaidAcc: "p-chk", name: "Business Checking", current: 1875000, kind: "business" })]
    });
    const plaid = plaidStub({
      byToken: { [TOKEN_A]: [CHECKING, plaidAccount({ id: "p-new", name: "Savings", mask: "9009", subtype: "savings", current: 50, available: 50 })] }
    });
    const r = await finish(db, plaid);

    assert.equal(r.ok, true);
    assert.equal(r.state, "active");
    assert.equal(r.alreadyActive, false);
    assert.equal(r.itemRowId, ITEM_A);
    assert.equal(r.written, 2);
    assert.equal(r.accounts.length, 2);
    assert.deepEqual(r.created.map((a) => a.name), ["Savings"], "the account that was not stored before is reported as new");

    const it = db.state.items[0];
    assert.equal(it.link_state, "active");
    assert.equal(it.last_error_code, null, "the error is cleared");
    assert.equal(it.last_error_at, null);
    assert.equal(it.reconnect_notified_at, null, "the episode is over: a later break is texted again");

    const chk = db.state.accounts.find((a) => a.id === "acc-chk");
    assert.equal(chk.current_balance_cents, 2000050);
    assert.equal(chk.balance_as_of, NOW, "stamped with the instant the caller gave");
    assert.equal(chk.entity_kind, "business", "a repair must never reset whose money an account is");
    assert.equal(plaid.reads.length, 1);
    assert.equal(plaid.reads[0].body.access_token, TOKEN_A);
  });

  test("the daily job's rules hold: nothing deleted or closed, an unknown balance stays null", async () => {
    const db = fakeBankDb({
      items: [login()],
      accounts: [
        held({ id: "acc-chk", plaidAcc: "p-chk", current: 5000 }),
        held({ id: "acc-old", plaidAcc: "p-old", current: 700 })
      ]
    });
    const plaid = plaidStub({ byToken: { [TOKEN_A]: [plaidAccount({ id: "p-chk", current: 50, available: null })] } });
    const r = await finish(db, plaid);
    assert.equal(r.ok, true);
    assert.equal(db.state.accounts.length, 2, "an account the bank stopped listing was removed");
    assert.equal(db.state.accounts.find((a) => a.id === "acc-old").closed_at, null, "and must not be closed");
    assert.deepEqual(r.vanished.map((v) => v.id), ["acc-old"], "it is reported, not closed");
    assert.equal(db.state.accounts.find((a) => a.id === "acc-chk").available_balance_cents, null, "null must survive, never 0");
    assert.equal(db.calls.some((q) => /\bDELETE\b/i.test(q.sql)), false);
  });

  test("Plaid still says the client must sign in: still_needs_reconnect, back in 'error', and the marker is left alone", async () => {
    const db = fakeBankDb({ items: [login({ reconnect_notified_at: "2026-10-05T07:05:00.000Z" })] });
    const plaid = plaidStub({ byToken: { [TOKEN_A]: LOGIN_REQUIRED } });
    const r = await finish(db, plaid);

    assert.equal(r.ok, false);
    assert.equal(r.reason, RELINK_REASONS.STILL_NEEDS_RECONNECT);
    assert.equal(r.state, "needs_reconnect");
    assert.equal(r.errorCode, "ITEM_LOGIN_REQUIRED");
    assert.equal(r.fix, "reconnect");
    assert.equal(r.plain, "Your bank needs you to sign in again.");

    const it = db.state.items[0];
    assert.equal(it.link_state, "error", "a button press must not leave a broken login looking connected");
    assert.equal(it.last_error_code, "ITEM_LOGIN_REQUIRED");
    assert.ok(it.last_error_at, "the new failure is recorded");
    assert.equal(it.reconnect_notified_at, "2026-10-05T07:05:00.000Z", "a failed try must not start a new text episode");
  });

  test("the bank or Plaid is busy: no proof the login works, so it goes back to 'error' with the new code and words for check_again", async () => {
    const db = fakeBankDb({ items: [login()], accounts: [held({ id: "a1", plaidAcc: "p-chk", current: 7 })] });
    const plaid = plaidStub({ byToken: { [TOKEN_A]: { error_type: "RATE_LIMIT_EXCEEDED", error_code: "ACCOUNTS_LIMIT", error_message: "slow down" } } });
    const r = await finish(db, plaid);

    assert.equal(r.ok, false);
    assert.equal(r.reason, "upstream_error");
    assert.equal(r.state, "needs_reconnect");
    assert.equal(r.errorCode, "ACCOUNTS_LIMIT");
    assert.equal(r.retryable, true);
    assert.equal(r.fix, "check_again");

    const it = db.state.items[0];
    assert.equal(it.link_state, "error", "an unverified login must not read Connected");
    assert.equal(it.last_error_code, "ACCOUNTS_LIMIT", "the newest failure is the one kept");
    assert.equal(db.state.accounts[0].current_balance_cents, 7, "nothing was written");
  });

  test("a call the fence holds: nothing sent, the login goes back to 'error' with the code and time it had", async () => {
    const db = fakeBankDb({ items: [login()] });
    let sent = false;
    const r = await finishRelink(db, {
      orgId: ORG, clientId: CLIENT, itemRowId: ITEM_A, asOf: NOW, env: { ...ENV, ADAPTERS_DRY_RUN: "1" },
      fetchImpl: async () => { sent = true; }
    });
    assert.equal(sent, false);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "held");
    assert.equal(r.fix, "check_again");
    const it = db.state.items[0];
    assert.equal(it.link_state, "error", "nothing was read, so nothing is proved");
    assert.equal(it.last_error_code, "ITEM_LOGIN_REQUIRED", "the reason it was broken is not lost");
    assert.equal(it.last_error_at, ERRORED_AT);
  });

  test("a token that will not decrypt: token_unreadable, nothing sent, back to 'error'", async () => {
    const db = fakeBankDb({ items: [login({ aad: ITEM_A })] });
    const plaid = plaidStub();
    const r = await finish(db, plaid);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RELINK_REASONS.TOKEN_UNREADABLE);
    assert.equal(r.fix, "connect_again");
    assert.equal(plaid.calls, 0);
    assert.equal(db.state.items[0].link_state, "error");
  });

  test("Plaid answered but our own write was refused: the login works, so it stays active, and the failure is reported", async () => {
    const db = fakeBankDb({ items: [login()] });
    const plaid = plaidStub({ byToken: { [TOKEN_A]: [plaidAccount({ id: "p1", name: "x".repeat(600) })] } });
    const r = await finish(db, plaid);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RELINK_REASONS.WRITE_FAILED);
    assert.equal(r.state, "active");
    assert.equal(db.state.items[0].link_state, "active", "reverting would send a client to reconnect a login that is fine");
  });

  test("Plaid answered but our write was refused: the 'we texted you' marker is cleared too, so a LATER break is texted", async () => {
    const db = fakeBankDb({ items: [login({ reconnect_notified_at: "2026-10-05T07:05:00.000Z" })] });
    const plaid = plaidStub({ byToken: { [TOKEN_A]: [plaidAccount({ id: "p1", name: "x".repeat(600) })] } });
    const r = await finish(db, plaid);
    assert.equal(r.reason, RELINK_REASONS.WRITE_FAILED);
    assert.equal(db.state.items[0].link_state, "active");
    assert.equal(
      db.state.items[0].reconnect_notified_at, null,
      "the bank answered, so the episode is over — a marker left set would hide the next break from the text job"
    );
  });

  test("...and if clearing the marker is refused as well, the answer is still write_failed — never a crash, and the marker is untouched", async () => {
    const inner = fakeBankDb({ items: [login({ reconnect_notified_at: "2026-10-05T07:05:00.000Z" })] });
    const db = {
      state: inner.state,
      calls: inner.calls,
      query: (sql, params) => (/relink:episode-end/.test(sql) ? Promise.reject(new Error("db blip")) : inner.query(sql, params))
    };
    const plaid = plaidStub({ byToken: { [TOKEN_A]: [plaidAccount({ id: "p1", name: "x".repeat(600) })] } });
    const r = await finish(db, plaid);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RELINK_REASONS.WRITE_FAILED);
    assert.equal(r.state, "active");
    assert.equal(inner.state.items[0].link_state, "active");
    assert.equal(inner.state.items[0].reconnect_notified_at, "2026-10-05T07:05:00.000Z");
  });

  test("a login that is ALREADY active is a no-op: no Plaid call, no change, and a second tap is harmless", async () => {
    const db = fakeBankDb({ items: [login({ linkState: "active" })] });
    const plaid = plaidStub();
    const r = await finish(db, plaid);
    assert.equal(r.ok, true);
    assert.equal(r.alreadyActive, true);
    assert.equal(r.state, "active");
    assert.deepEqual(r.accounts, []);
    assert.equal(plaid.calls, 0, "finish must not become a way to ask Plaid for balances on demand");
    assert.equal(db.calls.some((q) => /relink:claim/.test(q.sql)), false);
  });

  test("two finishes at once: one claims and reads, the other sees an active login — Plaid is asked ONCE", async () => {
    const db = fakeBankDb({ items: [login()] });
    const plaid = plaidStub({ byToken: { [TOKEN_A]: [CHECKING] } });
    const [x, y] = await Promise.all([finish(db, plaid), finish(db, plaid)]);
    assert.equal(x.ok && y.ok, true);
    assert.deepEqual([x.alreadyActive, y.alreadyActive].sort(), [false, true]);
    assert.equal(plaid.reads.length, 1);
    assert.equal(db.state.items[0].link_state, "active");
  });

  test("another client's login is no_such_login: nothing is read, nothing changes", async () => {
    const theirs = login({ id: ITEM_B, plaidItemId: PLAID_B, token: TOKEN_B, clientId: OTHER_CLIENT });
    const db = fakeBankDb({ items: [theirs] });
    const plaid = plaidStub({ byToken: { [TOKEN_B]: [CHECKING] } });
    const r = await finish(db, plaid, { itemRowId: ITEM_B });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RELINK_REASONS.NO_SUCH_LOGIN);
    assert.equal(plaid.calls, 0);
    assert.equal(db.state.items[0].link_state, "error");
    assert.equal(db.calls.some((q) => /relink:claim/.test(q.sql)), false);
  });

  test("a revoked or practice login is not_reconnectable and is not touched", async () => {
    for (const row of [login({ linkState: "revoked" }), login({ plaidItemId: "mock:" + CLIENT })]) {
      const db = fakeBankDb({ items: [row] });
      const plaid = plaidStub();
      const r = await finish(db, plaid);
      assert.equal(r.reason, RELINK_REASONS.NOT_RECONNECTABLE);
      assert.equal(plaid.calls, 0);
      assert.equal(db.state.items[0].link_state, row.link_state);
    }
  });

  test("a refresh that throws puts the claimed login back to 'error' and the error still reaches the caller", async () => {
    const db = fakeBankDb({ items: [login()] });
    const flaky = {
      state: db.state, calls: db.calls,
      query: (sql, params) => (/SELECT id, plaid_account_id, name, mask, account_type, closed_at/.test(sql)
        ? Promise.reject(new Error("db down"))
        : db.query(sql, params))
    };
    await assert.rejects(finish(flaky, plaidStub({ byToken: { [TOKEN_A]: [CHECKING] } })), /db down/);
    assert.equal(db.state.items[0].link_state, "error", "left active with nothing proving it");
  });

  test("not configured, bad ids and a missing or bad asOf are refused before anything happens", async () => {
    const db = fakeBankDb({ items: [login()] });
    const plaid = plaidStub();
    assert.equal((await finish(db, plaid, { env: {} })).reason, "not_configured");
    assert.equal((await finish(db, plaid, { itemRowId: "x" })).reason, "bad_request");
    assert.equal((await finish(db, plaid, { asOf: undefined })).reason, "bad_request");
    assert.equal((await finish(db, plaid, { asOf: "last tuesday" })).reason, "bad_request");
    assert.equal(db.calls.length, 0);
    assert.equal(plaid.calls, 0);
    assert.equal(db.state.items[0].link_state, "error");
  });

  test("no result carries the token, the ciphertext or the secret — success or failure", async () => {
    const row = login();
    const ok = await finish(fakeBankDb({ items: [row] }), plaidStub({ byToken: { [TOKEN_A]: [CHECKING] } }));
    const still = await finish(fakeBankDb({ items: [row] }), plaidStub({ byToken: { [TOKEN_A]: LOGIN_REQUIRED } }));
    assertNoSecrets(ok, row);
    assertNoSecrets(still, row);
  });
});

/* ── the status read ─────────────────────────────────────────────────────────── */

describe("bankLoginView — what a screen reads", () => {
  const base = {
    id: ITEM_A, institution_name: "Chase", plaid_item_id: "item-x", link_state: "active",
    last_error_code: null, last_error_at: null, transactions_synced_at: null, created_at: "2026-09-20T10:00:00.000Z",
    account_count: 3, balances_as_of: null
  };

  test("the five link states read as active / needs reconnect / revoked / connecting / not connected", () => {
    const states = Object.fromEntries(["active", "error", "revoked", "pending", "unlinked"]
      .map((s) => [s, bankLoginView({ ...base, link_state: s })]));
    assert.deepEqual(
      Object.fromEntries(Object.entries(states).map(([k, v]) => [k, [v.state, v.state_label]])),
      {
        active: ["active", "Connected"],
        error: ["needs_reconnect", "Needs reconnect"],
        revoked: ["revoked", "Disconnected"],
        pending: ["pending", "Connecting"],
        unlinked: ["not_connected", "Not connected"]
      }
    );
  });

  test("last_good_refresh_at is the later of the last balance read and the last transactions read; null = never read", () => {
    assert.equal(bankLoginView(base).last_good_refresh_at, null);
    assert.equal(bankLoginView({ ...base, balances_as_of: "2026-10-04T07:00:00.000Z" }).last_good_refresh_at, "2026-10-04T07:00:00.000Z");
    assert.equal(bankLoginView({ ...base, transactions_synced_at: new Date("2026-10-05T07:00:05.000Z") }).last_good_refresh_at, "2026-10-05T07:00:05.000Z");
    assert.equal(bankLoginView({
      ...base, balances_as_of: new Date("2026-10-06T07:00:00.000Z"), transactions_synced_at: "2026-10-05T07:00:05.000Z"
    }).last_good_refresh_at, "2026-10-06T07:00:00.000Z");
  });

  test("a login in 'error' carries Plaid's code, plain words and the action — with the time it broke", () => {
    const v = bankLoginView({ ...base, link_state: "error", last_error_code: "ITEM_LOGIN_REQUIRED", last_error_at: ERRORED_AT });
    assert.deepEqual(v.error, {
      code: "ITEM_LOGIN_REQUIRED", plain: "Your bank needs you to sign in again.", fix: "reconnect", at: ERRORED_AT
    });
  });

  test("a login in 'error' with no code, or one nobody mapped, still says something a client can act on", () => {
    for (const code of [null, "SOME_NEW_CODE"]) {
      const v = bankLoginView({ ...base, link_state: "error", last_error_code: code, last_error_at: ERRORED_AT });
      assert.match(v.error.plain, /stopped working/);
      assert.equal(v.error.fix, "reconnect");
      assert.equal(v.error.code, code);
    }
  });

  test("an active login shows an error only when its latest failure is NEWER than its last good read", () => {
    const recent = bankLoginView({
      ...base, last_error_code: "INSTITUTION_DOWN", last_error_at: "2026-10-06T07:00:00.000Z", balances_as_of: "2026-10-05T07:00:00.000Z"
    });
    assert.equal(recent.state, "active");
    assert.equal(recent.error.fix, "check_again");
    assert.equal(recent.error.code, "INSTITUTION_DOWN");

    const outlived = bankLoginView({
      ...base, last_error_code: "INSTITUTION_DOWN", last_error_at: "2026-10-04T07:00:00.000Z", balances_as_of: "2026-10-05T07:00:00.000Z"
    });
    assert.equal(outlived.error, null, "a failure a later read outlived is not news");

    assert.equal(bankLoginView({ ...base, last_error_code: "INSTITUTION_DOWN", last_error_at: null }).error, null, "no time, no way to tell it is recent");
    assert.equal(bankLoginView({ ...base, last_error_code: "INSTITUTION_DOWN", last_error_at: "2026-10-06T07:00:00.000Z" }).error.code, "INSTITUTION_DOWN",
      "never read well, and the last try failed");
    assert.equal(bankLoginView(base).error, null);
  });

  test("an unnamed bank is 'Unknown bank', never a guess; a practice or placeholder login is not real", () => {
    assert.equal(bankLoginView({ ...base, institution_name: null }).institution, "Unknown bank");
    assert.equal(bankLoginView(base).real, true);
    assert.equal(bankLoginView({ ...base, plaid_item_id: "mock:abc" }).real, false);
    assert.equal(bankLoginView({ ...base, plaid_item_id: null }).real, false);
  });

  test("the view names only what a screen needs", () => {
    assert.deepEqual(Object.keys(bankLoginView(base)).sort(), [
      "account_count", "connected_at", "error", "institution", "item_id", "last_good_refresh_at", "real", "state", "state_label"
    ]);
  });
});

describe("listBankLoginStatus", () => {
  test("lists ONE client's logins oldest first, never another client's or org's, and never a credential", async () => {
    const a = login({ id: ITEM_A, created_at: "2026-09-20T10:00:00.000Z" });
    const b = login({ id: ITEM_B, plaidItemId: PLAID_B, token: TOKEN_B, linkState: "active", created_at: "2026-09-10T10:00:00.000Z", institution_name: "Chase" });
    const theirs = login({ id: "00000000-0000-0000-0000-0000000000c1", plaidItemId: "item-C", clientId: OTHER_CLIENT });
    const foreign = login({ id: "00000000-0000-0000-0000-0000000000f1", plaidItemId: "item-F", orgId: OTHER_ORG });
    const db = fakeBankDb({
      items: [a, b, theirs, foreign],
      accounts: [
        held({ id: "a1", itemId: ITEM_A, plaidAcc: "p1" }),
        held({ id: "b1", itemId: ITEM_B, plaidAcc: "p2" }),
        held({ id: "b2", itemId: ITEM_B, plaidAcc: "p3", closedAt: "2026-09-30T00:00:00.000Z" })
      ]
    });
    const rows = await listBankLoginStatus(db, { orgId: ORG, clientId: CLIENT });
    assert.deepEqual(rows.map((r) => r.item_id), [ITEM_B, ITEM_A]);
    assert.equal(rows[0].institution, "Chase");
    assert.equal(rows[0].state, "active");
    assert.equal(rows[0].account_count, 1, "a closed account is not counted");
    assert.equal(rows[1].state, "needs_reconnect");
    assert.equal(rows[1].last_good_refresh_at, "2026-10-04T07:00:00.000Z", "the last balance read");
    assertNoSecrets(rows, a, b);
  });

  test("itemRowId narrows it to one login", async () => {
    const db = fakeBankDb({ items: [login({ id: ITEM_A }), login({ id: ITEM_B, plaidItemId: PLAID_B })] });
    const rows = await listBankLoginStatus(db, { orgId: ORG, clientId: CLIENT, itemRowId: ITEM_B });
    assert.deepEqual(rows.map((r) => r.item_id), [ITEM_B]);
  });

  test("a client with no logins gets an empty list — a fact, not an error", async () => {
    assert.deepEqual(await listBankLoginStatus(fakeBankDb(), { orgId: ORG, clientId: CLIENT }), []);
  });

  test("bad ids throw a 400 before any query", async () => {
    const db = fakeBankDb();
    for (const args of [{ orgId: "x", clientId: CLIENT }, { orgId: ORG, clientId: null }, { orgId: ORG, clientId: CLIENT, itemRowId: "no" }]) {
      await assert.rejects(listBankLoginStatus(db, args), (e) => e instanceof RelinkInputError && e.status === 400);
    }
    assert.equal(db.calls.length, 0);
  });

  test("the status read never names the credential column", async () => {
    const db = fakeBankDb({ items: [login()] });
    await listBankLoginStatus(db, { orgId: ORG, clientId: CLIENT });
    for (const q of db.calls) assert.doesNotMatch(q.sql, /encrypted_access_token/);
  });
});
