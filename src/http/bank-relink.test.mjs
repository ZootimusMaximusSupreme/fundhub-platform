// /api/banking/relink — endpoint tests. Stubbed auth and database; Plaid is a
// stand-in fetch. No network, no real database. The same gate as link-token.mjs, so
// the gate tests below follow src/http/plaid-link.test.mjs.
//
// What these guard: the right person, the right file, the right login. A client who
// can reach another client's bank login through this door; a response that carries the
// bank access token; a refusal that arrives as a 500 or as "ok".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import relink, { ACTIONS } from "../../api/banking/relink.mjs";
import { AUTH_UNAVAILABLE } from "./middleware/requireAuth.mjs";
import { startRelink, finishRelink, listBankLoginStatus } from "../banking/plaid-relink.mjs";
import { encryptPlaidToken } from "../banking/plaid.mjs";
import { fakeBankDb, plaidAccount, stubPlaid } from "../banking/plaid-fake-db.mjs";

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const ORG = "00000000-0000-0000-0000-0000000000aa";
const CLIENT = "11111111-2222-3333-4444-555555555555";
const OTHER_CLIENT = "99999999-8888-7777-6666-555555555555";
const ITEM = "00000000-0000-0000-0000-0000000000a1";
const OTHER_ITEM = "00000000-0000-0000-0000-0000000000b1";
const ENV = Object.freeze({
  PLAID_CLIENT_ID: "cid", PLAID_SECRET: "sec", PLAID_ENV: "sandbox", ADAPTERS_DRY_RUN: "0",
  PLAID_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64")
});
const TOKEN = "access-sandbox-the-secret";

const OWNER = { id: "s1", role: "owner", org_id: ORG };
const CLOSER = { id: "s2", role: "closer", org_id: ORG };
const authAs = (staff) => async () => staff;
const noStaff = async () => assert.fail("a client session must not go through the staff gate");
const asClient = (clientId = CLIENT) => async () => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId });
const asStaff = (role = "owner") => async () => ({ kind: "staff", role, orgId: ORG });

/* A database that knows which clients live in which org, and nothing else. */
const clientsDb = (inOrg = [CLIENT]) => ({
  query: async (sql, params) => (/FROM clients/.test(sql)
    ? { rows: inOrg.includes(params[0]) && params[1] === ORG ? [{ "?column?": 1 }] : [] }
    : { rows: [] })
});

const VIEW = {
  item_id: ITEM, institution: "First Platypus Bank", state: "needs_reconnect", state_label: "Needs reconnect",
  real: true, account_count: 3, connected_at: "2026-09-20T10:00:00.000Z", last_good_refresh_at: "2026-10-04T07:00:00.000Z",
  error: { code: "ITEM_LOGIN_REQUIRED", plain: "Your bank needs you to sign in again.", fix: "reconnect", at: "2026-10-05T07:00:02.000Z" }
};
const ACTIVE_VIEW = { ...VIEW, state: "active", state_label: "Connected", error: null };

const get = (query, deps) => {
  const res = makeRes();
  return relink({ method: "GET", query }, res, { db: clientsDb(), requireAuth: authAs(OWNER), env: ENV, ...deps })
    .then(() => res);
};
const post = (body, deps) => {
  const res = makeRes();
  return relink({ method: "POST", body }, res, { db: clientsDb(), requireAuth: authAs(OWNER), env: ENV, ...deps })
    .then(() => res);
};

describe("method and body", () => {
  test("only GET and POST; the others are 405 with an Allow header", async () => {
    for (const method of ["PUT", "DELETE", "PATCH"]) {
      const res = makeRes();
      await relink({ method }, res, { db: clientsDb(), requireAuth: authAs(OWNER) });
      assert.equal(res.statusCode, 405, method);
      assert.equal(res.headers.allow, "GET, POST");
    }
  });

  test("a body that is not JSON is 400, before anyone is asked who they are", async () => {
    const res = await post("{not json", { resolvePrincipal: async () => assert.fail("must not resolve") });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "body must be JSON");
  });

  test("the actions are exactly start and finish", () => {
    assert.deepEqual([...ACTIONS], ["start", "finish"]);
  });
});

describe("the gate — staff", () => {
  test("a role outside FINANCE is 403 and nothing is read", async () => {
    let touched = false;
    const res = await get({ client_id: CLIENT }, {
      requireAuth: authAs(CLOSER), listBankLoginStatus: async () => { touched = true; return []; }
    });
    assert.equal(res.statusCode, 403);
    assert.equal(touched, false);
  });

  test("staff must name a client: 400 without a uuid", async () => {
    for (const query of [{}, { client_id: "nope" }]) {
      const res = await get(query, { listBankLoginStatus: async () => assert.fail("must not list") });
      assert.equal(res.statusCode, 400);
    }
    const res = await post({ action: "start", item_id: ITEM }, { startRelink: async () => assert.fail("must not start") });
    assert.equal(res.statusCode, 400);
  });

  test("a client in another org is 404, identical to one that does not exist — and nothing is read or sent", async () => {
    const res = await get({ client_id: CLIENT }, {
      db: clientsDb([]), listBankLoginStatus: async () => assert.fail("must not list")
    });
    assert.equal(res.statusCode, 404);
    const res2 = await post({ client_id: CLIENT, action: "start", item_id: ITEM }, {
      db: clientsDb([]), startRelink: async () => assert.fail("must not start")
    });
    assert.equal(res2.statusCode, 404);
    const res3 = await post({ client_id: CLIENT, action: "finish", item_id: ITEM }, {
      db: clientsDb([]), finishRelink: async () => assert.fail("must not finish")
    });
    assert.equal(res3.statusCode, 404);
  });

  test("staff name the client in the query on GET and in the body on POST, and the org is the session's", async () => {
    let seen;
    await get({ client_id: CLIENT }, { listBankLoginStatus: async (_db, a) => { seen = a; return []; } });
    assert.deepEqual(seen, { orgId: ORG, clientId: CLIENT });

    let started;
    await post({ client_id: CLIENT, org_id: "evil", action: "start", item_id: ITEM }, {
      startRelink: async (_db, a) => { started = a; return { ok: true, linkToken: "l", expiration: "e", environment: "sandbox", itemRowId: ITEM, institution: null }; }
    });
    assert.equal(started.orgId, ORG, "the body's org_id was read");
    assert.equal(started.clientId, CLIENT);
  });

  test("a session of no kind at all is 401 from the staff gate", async () => {
    const res = makeRes();
    await relink({ method: "GET", query: { client_id: CLIENT } }, res, {
      db: clientsDb(), resolvePrincipal: async () => null,
      requireAuth: async (_req, r) => { r.status(401).json({ ok: false, error: "unauthorized" }); return null; }
    });
    assert.equal(res.statusCode, 401);
  });

  test("an auth store that is down is 503, not a 401", async () => {
    const res = await get({ client_id: CLIENT }, { resolvePrincipal: async () => AUTH_UNAVAILABLE, requireAuth: noStaff });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.db, "down");
  });

  test("an affiliate or partner session is 403", async () => {
    const res = await get({ client_id: CLIENT }, {
      resolvePrincipal: async () => ({ kind: "affiliate", orgId: ORG }), requireAuth: noStaff
    });
    assert.equal(res.statusCode, 403);
  });
});

describe("the gate — a signed-in client", () => {
  test("reads their own file: the client_id and org come off the SESSION, never the query or body", async () => {
    let seen;
    const res = await get({ client_id: OTHER_CLIENT, org_id: "evil" }, {
      resolvePrincipal: asClient(), requireAuth: noStaff, db: clientsDb([CLIENT, OTHER_CLIENT]),
      listBankLoginStatus: async (_db, a) => { seen = a; return [VIEW]; }
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(seen, { orgId: ORG, clientId: CLIENT });
  });

  test("start and finish are pinned to the session's client the same way", async () => {
    let started, finished;
    await post({ client_id: OTHER_CLIENT, action: "start", item_id: ITEM }, {
      resolvePrincipal: asClient(), requireAuth: noStaff, db: clientsDb([CLIENT, OTHER_CLIENT]),
      startRelink: async (_db, a) => { started = a; return { ok: true, linkToken: "l", expiration: "e", environment: "sandbox", itemRowId: ITEM, institution: null }; }
    });
    await post({ client_id: OTHER_CLIENT, action: "finish", item_id: ITEM }, {
      resolvePrincipal: asClient(), requireAuth: noStaff, db: clientsDb([CLIENT, OTHER_CLIENT]),
      finishRelink: async (_db, a) => { finished = a; return { ok: true, state: "active", alreadyActive: true, itemRowId: ITEM, institution: null, written: 0, accounts: [], created: [], vanished: [], balancesChanged: [] }; },
      listBankLoginStatus: async () => [ACTIVE_VIEW]
    });
    assert.equal(started.clientId, CLIENT);
    assert.equal(finished.clientId, CLIENT);
  });

  test("a login not attached to a client file is 403", async () => {
    const res = await get({}, { resolvePrincipal: asClient(null), requireAuth: noStaff });
    assert.equal(res.statusCode, 403);
  });

  test("a session whose client is gone from the org is 404", async () => {
    const res = await get({}, {
      resolvePrincipal: asClient(), requireAuth: noStaff, db: clientsDb([]),
      listBankLoginStatus: async () => assert.fail("must not list")
    });
    assert.equal(res.statusCode, 404);
  });

  test("a staff session through resolvePrincipal still goes through the FINANCE gate", async () => {
    const res = await get({ client_id: CLIENT }, { resolvePrincipal: asStaff("closer"), requireAuth: authAs(CLOSER) });
    assert.equal(res.statusCode, 403);
  });
});

describe("GET — the logins", () => {
  test("the screen's whole read: when, whether Plaid is on, how many need the client, and every login", async () => {
    const res = await get({ client_id: CLIENT }, {
      now: () => new Date("2026-10-07T12:00:00Z"),
      listBankLoginStatus: async () => [VIEW, ACTIVE_VIEW, { ...ACTIVE_VIEW, item_id: OTHER_ITEM }]
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ["as_of", "environment", "logins", "needs_reconnect", "ok", "plaid_ready"]);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.as_of, "2026-10-07T12:00:00.000Z");
    assert.equal(res.body.environment, "sandbox");
    assert.equal(res.body.plaid_ready, true);
    assert.equal(res.body.needs_reconnect, 1);
    assert.equal(res.body.logins.length, 3);
    assert.equal(res.body.logins[0].error.plain, "Your bank needs you to sign in again.");
  });

  test("with Plaid not set up the list still answers; the screen is told to hide Reconnect", async () => {
    const res = await get({ client_id: CLIENT }, { env: {}, listBankLoginStatus: async () => [VIEW] });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.plaid_ready, false);
    assert.equal(res.body.environment, null);
  });

  test("a client with no logins gets an empty list", async () => {
    const res = await get({ client_id: CLIENT }, { listBankLoginStatus: async () => [] });
    assert.deepEqual(res.body.logins, []);
    assert.equal(res.body.needs_reconnect, 0);
  });

  test("the database not answering is 503 with db: down — not a 500 that blames our code", async () => {
    const res = await get({ client_id: CLIENT }, {
      listBankLoginStatus: async () => { throw new Error("Connection terminated unexpectedly"); }
    });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.db, "down");
  });
});

describe("POST start", () => {
  const started = { ok: true, linkToken: "link-sandbox-update-1", expiration: "2026-10-07T12:30:00Z", environment: "sandbox", itemRowId: ITEM, institution: "First Platypus Bank" };

  test("hands back the link token and where it is for — and nothing from the stored credential", async () => {
    const res = await post({ client_id: CLIENT, action: "start", item_id: ITEM }, { startRelink: async () => started });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      ok: true, link_token: "link-sandbox-update-1", expiration: "2026-10-07T12:30:00Z", environment: "sandbox",
      item_id: ITEM, institution: "First Platypus Bank"
    });
  });

  test("add_accounts is passed on only when it is exactly true", async () => {
    for (const [value, expected] of [[true, true], [false, false], ["true", false], [1, false], [undefined, false]]) {
      let seen;
      await post({ client_id: CLIENT, action: "start", item_id: ITEM, add_accounts: value }, {
        startRelink: async (_db, a) => { seen = a; return started; }
      });
      assert.equal(seen.accountSelection, expected, `add_accounts ${String(value)}`);
    }
  });

  test("an item_id that is not a uuid is 400; an unknown action is 400 with the list", async () => {
    const bad = await post({ client_id: CLIENT, action: "start", item_id: "nope" }, { startRelink: async () => assert.fail("must not start") });
    assert.equal(bad.statusCode, 400);
    const missing = await post({ client_id: CLIENT, action: "start" }, { startRelink: async () => assert.fail("must not start") });
    assert.equal(missing.statusCode, 400);
    const unknown = await post({ client_id: CLIENT, action: "revoke", item_id: ITEM }, {});
    assert.equal(unknown.statusCode, 400);
    assert.equal(unknown.body.error, "unknown_action");
    assert.deepEqual(unknown.body.actions, ["start", "finish"]);
    const none = await post({ client_id: CLIENT, item_id: ITEM }, {});
    assert.equal(none.body.error, "unknown_action");
  });

  test("each refusal is the right status, in the same shape, with the words and the action", async () => {
    const cases = [
      [{ ok: false, reason: "not_configured", missing: ["PLAID_SECRET"] }, 503],
      [{ ok: false, reason: "no_such_login" }, 404],
      [{ ok: false, reason: "not_reconnectable", plain: "This bank was disconnected. Connect your bank again.", fix: "connect_again" }, 409],
      [{ ok: false, reason: "token_unreadable", plain: "We could not open this saved connection. Connect your bank again.", fix: "connect_again" }, 409],
      [{ ok: false, reason: "upstream_error", errorCode: "ITEM_NOT_FOUND", error: "the item was removed", plain: "This bank connection was removed. Connect your bank again.", fix: "connect_again" }, 502],
      [{ ok: false, reason: "held", plain: "We could not check your bank just now. Try again in a little while.", fix: "check_again" }, 502]
    ];
    for (const [answer, status] of cases) {
      const res = await post({ client_id: CLIENT, action: "start", item_id: ITEM }, { startRelink: async () => answer });
      assert.equal(res.statusCode, status, answer.reason);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.error, answer.reason);
      assert.equal(res.body.message, answer.plain ?? null);
      assert.equal(res.body.fix, answer.fix ?? null);
      assert.equal(res.body.code, answer.errorCode ?? null);
      assert.deepEqual(res.body.missing, answer.missing ?? []);
    }
  });
});

describe("POST finish", () => {
  const finished = {
    ok: true, state: "active", alreadyActive: false, itemRowId: ITEM, institution: "First Platypus Bank", written: 2,
    accounts: [{ id: "a1", name: "Business Checking", mask: "2202", account_type: "depository", account_subtype: "checking", entity_kind: "business", current_balance_cents: 2000050, raw: { secret: "x" } }],
    created: [{ id: "a2", name: "Savings", mask: "9009", account_type: "depository", account_subtype: "savings" }],
    vanished: [], balancesChanged: [{ id: "a1" }]
  };

  test("the clock is the handler's: the read is stamped with the instant of the request", async () => {
    let seen;
    await post({ client_id: CLIENT, action: "finish", item_id: ITEM }, {
      now: () => new Date("2026-10-07T12:00:00Z"),
      finishRelink: async (_db, a) => { seen = a; return finished; },
      listBankLoginStatus: async () => [ACTIVE_VIEW]
    });
    assert.equal(seen.asOf, "2026-10-07T12:00:00.000Z");
    assert.equal(seen.orgId, ORG);
    assert.equal(seen.itemRowId, ITEM);
  });

  test("a fixed login: the accounts as the link-exchange door shows them, what is new, and the login repainted", async () => {
    const res = await post({ client_id: CLIENT, action: "finish", item_id: ITEM }, {
      now: () => new Date("2026-10-07T12:00:00Z"),
      finishRelink: async () => finished,
      listBankLoginStatus: async (_db, a) => { assert.equal(a.itemRowId, ITEM); return [ACTIVE_VIEW]; }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.item_id, ITEM);
    assert.equal(res.body.state, "active");
    assert.equal(res.body.already_active, false);
    assert.equal(res.body.refreshed_at, "2026-10-07T12:00:00.000Z");
    assert.equal(res.body.written, 2);
    assert.deepEqual(res.body.accounts, [{
      id: "a1", summary: "Business Checking · ••2202 · depository · 20000.50", name: "Business Checking", mask: "2202",
      type: "depository", subtype: "checking", entity_kind: "business"
    }]);
    assert.deepEqual(res.body.created.map((a) => a.name), ["Savings"]);
    assert.deepEqual(res.body.login, ACTIVE_VIEW);
    assert.equal(JSON.stringify(res.body).includes('"secret"'), false, "a stored account's raw payload went out");
  });

  test("a login that was already active says so and has no refresh time", async () => {
    const res = await post({ client_id: CLIENT, action: "finish", item_id: ITEM }, {
      finishRelink: async () => ({ ...finished, alreadyActive: true, written: 0, accounts: [], created: [], vanished: [] }),
      listBankLoginStatus: async () => [ACTIVE_VIEW]
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.already_active, true);
    assert.equal(res.body.refreshed_at, null);
    assert.deepEqual(res.body.accounts, []);
  });

  test("still broken: 409 with the words, the code, the action and the login as it stands", async () => {
    const res = await post({ client_id: CLIENT, action: "finish", item_id: ITEM }, {
      finishRelink: async () => ({
        ok: false, reason: "still_needs_reconnect", state: "needs_reconnect", errorCode: "ITEM_LOGIN_REQUIRED",
        error: "the user must log in again", plain: "Your bank needs you to sign in again.", fix: "reconnect"
      }),
      listBankLoginStatus: async () => [VIEW]
    });
    assert.equal(res.statusCode, 409);
    assert.deepEqual(
      { ok: res.body.ok, error: res.body.error, message: res.body.message, fix: res.body.fix, code: res.body.code, state: res.body.state },
      { ok: false, error: "still_needs_reconnect", message: "Your bank needs you to sign in again.", fix: "reconnect", code: "ITEM_LOGIN_REQUIRED", state: "needs_reconnect" }
    );
    assert.deepEqual(res.body.login, VIEW, "the screen repaints the row from this answer");
  });

  test("the bank was busy: 502 with the 'check again' action; our own write refused: 500 and the login still active", async () => {
    const busy = await post({ client_id: CLIENT, action: "finish", item_id: ITEM }, {
      finishRelink: async () => ({ ok: false, reason: "upstream_error", state: "needs_reconnect", errorCode: "INSTITUTION_DOWN", plain: "Your bank is down for now. We will keep trying.", fix: "check_again", retryable: true }),
      listBankLoginStatus: async () => [VIEW]
    });
    assert.equal(busy.statusCode, 502);
    assert.equal(busy.body.fix, "check_again");
    const write = await post({ client_id: CLIENT, action: "finish", item_id: ITEM }, {
      finishRelink: async () => ({ ok: false, reason: "write_failed", state: "active", plain: "x", fix: "check_again" }),
      listBankLoginStatus: async () => [ACTIVE_VIEW]
    });
    assert.equal(write.statusCode, 500);
    assert.equal(write.body.login.state, "active");
  });

  test("no such login is 404 and the login is not read again", async () => {
    const res = await post({ client_id: CLIENT, action: "finish", item_id: ITEM }, {
      finishRelink: async () => ({ ok: false, reason: "no_such_login" }),
      listBankLoginStatus: async () => assert.fail("must not list for a login that is not there")
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.login, null);
  });

  test("not configured is 503, not reconnectable is 409", async () => {
    const a = await post({ client_id: CLIENT, action: "finish", item_id: ITEM }, {
      finishRelink: async () => ({ ok: false, reason: "not_configured", missing: ["PLAID_SECRET"] }), listBankLoginStatus: async () => []
    });
    assert.equal(a.statusCode, 503);
    const b = await post({ client_id: CLIENT, action: "finish", item_id: ITEM }, {
      finishRelink: async () => ({ ok: false, reason: "not_reconnectable", plain: "p", fix: "connect_again" }), listBankLoginStatus: async () => [VIEW]
    });
    assert.equal(b.statusCode, 409);
  });
});

/* THE WHOLE STACK, with only Plaid and the database stood in: the real service
   modules behind the real handler. This is where "a client cannot reach another
   client's login" and "the token never leaves" are proved end to end. */
describe("end to end — the real service behind the handler", () => {
  const LOGIN_REQUIRED = { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "log in" };

  const row = (id, clientId, plaidItemId, token, over = {}) => ({
    id, org_id: ORG, client_id: clientId, plaid_item_id: plaidItemId, institution_name: "First Platypus Bank",
    encrypted_access_token: encryptPlaidToken(token, { itemId: plaidItemId, env: ENV }),
    consent_granted_at: "2026-09-20T10:00:00.000Z", created_at: "2026-09-20T10:00:00.000Z",
    link_state: "error", last_error_code: "ITEM_LOGIN_REQUIRED", last_error_at: "2026-10-05T07:00:02.000Z", ...over
  });

  function world({ byToken = {}, link = null } = {}) {
    const fake = fakeBankDb({
      items: [row(ITEM, CLIENT, "item-sandbox-1", TOKEN), row(OTHER_ITEM, OTHER_CLIENT, "item-sandbox-2", "access-sandbox-other-secret")]
    });
    const accounts = stubPlaid(byToken);
    const linkRequests = [];
    const fetchImpl = async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/link/token/create") {
        linkRequests.push(JSON.parse(init.body));
        return new Response(JSON.stringify(link || { link_token: "link-sandbox-update-e2e", expiration: "e", request_id: "r" }), {
          status: link?.error_code ? 400 : 200, headers: { "content-type": "application/json" }
        });
      }
      return accounts.fetch(url, init);
    };
    const database = {
      state: fake.state, calls: fake.calls,
      query: (sql, params) => (/FROM clients/.test(sql)
        ? Promise.resolve({ rows: [CLIENT, OTHER_CLIENT].includes(params[0]) && params[1] === ORG ? [{ "?column?": 1 }] : [] })
        : fake.query(sql, params))
    };
    return {
      database, linkRequests, reads: accounts.requests,
      deps: {
        db: database, env: ENV, requireAuth: noStaff, resolvePrincipal: asClient(),
        now: () => new Date("2026-10-07T12:00:00Z"),
        startRelink: (db, args) => startRelink(db, { ...args, fetchImpl }),
        finishRelink: (db, args) => finishRelink(db, { ...args, fetchImpl }),
        listBankLoginStatus
      }
    };
  }
  const SECRET_STRINGS = [TOKEN, "access-sandbox-other-secret", "sec", "v1:"];
  const assertClean = (res) => {
    const text = JSON.stringify(res.body);
    for (const s of SECRET_STRINGS) assert.equal(text.includes(s), false, `the response contained ${s}`);
  };

  test("a client sees only their own login, with no credential anywhere", async () => {
    const w = world();
    const res = makeRes();
    await relink({ method: "GET", query: { client_id: OTHER_CLIENT } }, res, w.deps);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.logins.map((l) => l.item_id), [ITEM], "another client's login is in the answer");
    assert.equal(res.body.needs_reconnect, 1);
    assertClean(res);
  });

  test("start: Plaid is asked in update mode with the client's own token, and the response carries only the link token", async () => {
    const w = world();
    const res = makeRes();
    await relink({ method: "POST", body: { action: "start", item_id: ITEM } }, res, w.deps);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.link_token, "link-sandbox-update-e2e");
    assert.equal(w.linkRequests.length, 1);
    assert.equal(w.linkRequests[0].access_token, TOKEN);
    assert.equal("products" in w.linkRequests[0], false);
    assert.equal(w.linkRequests[0].user.client_user_id, CLIENT);
    assertClean(res);
  });

  test("start for ANOTHER client's login id is 404 — the same as an id that never existed — and Plaid is never asked", async () => {
    const w = world();
    for (const itemId of [OTHER_ITEM, "00000000-0000-0000-0000-00000000dead"]) {
      const res = makeRes();
      await relink({ method: "POST", body: { action: "start", item_id: itemId } }, res, w.deps);
      assert.equal(res.statusCode, 404, itemId);
      assert.equal(res.body.error, "no_such_login");
    }
    assert.equal(w.linkRequests.length, 0);
    assert.equal(w.database.calls.some((q) => /relink:token/.test(q.sql)), false, "the other client's credential was read");
  });

  test("finish for ANOTHER client's login id is 404 and that login is untouched", async () => {
    const w = world({ byToken: { "access-sandbox-other-secret": [plaidAccount({ id: "p1" })] } });
    const res = makeRes();
    await relink({ method: "POST", body: { action: "finish", item_id: OTHER_ITEM } }, res, w.deps);
    assert.equal(res.statusCode, 404);
    assert.equal(w.reads.length, 0);
    assert.equal(w.database.state.items.find((i) => i.id === OTHER_ITEM).link_state, "error");
  });

  test("finish, fixed: the login is active, the accounts come back, and the row repaints as Connected", async () => {
    const w = world({ byToken: { [TOKEN]: [plaidAccount({ id: "p1", name: "Business Checking", mask: "2202", current: 100, available: 100 })] } });
    const res = makeRes();
    await relink({ method: "POST", body: { action: "finish", item_id: ITEM } }, res, w.deps);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.state, "active");
    assert.equal(res.body.accounts.length, 1);
    assert.equal(res.body.accounts[0].name, "Business Checking");
    assert.equal(res.body.login.state, "active");
    assert.equal(res.body.login.error, null);
    assert.equal(res.body.login.account_count, 1);
    assert.equal(res.body.login.last_good_refresh_at, "2026-10-07T12:00:00.000Z");
    assert.equal(w.database.state.items.find((i) => i.id === ITEM).link_state, "active");
    assertClean(res);
  });

  test("finish, still broken: 409, the words, and the login still reads Needs reconnect", async () => {
    const w = world({ byToken: { [TOKEN]: LOGIN_REQUIRED } });
    const res = makeRes();
    await relink({ method: "POST", body: { action: "finish", item_id: ITEM } }, res, w.deps);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "still_needs_reconnect");
    assert.equal(res.body.message, "Your bank needs you to sign in again.");
    assert.equal(res.body.fix, "reconnect");
    assert.equal(res.body.login.state, "needs_reconnect");
    assertClean(res);
  });

  test("finish twice: the second is a harmless no-op, 200 and already_active", async () => {
    const w = world({ byToken: { [TOKEN]: [plaidAccount({ id: "p1" })] } });
    const first = makeRes();
    await relink({ method: "POST", body: { action: "finish", item_id: ITEM } }, first, w.deps);
    const second = makeRes();
    await relink({ method: "POST", body: { action: "finish", item_id: ITEM } }, second, w.deps);
    assert.equal(first.body.already_active, false);
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.already_active, true);
    assert.equal(w.reads.length, 1, "the second tap asked Plaid again");
  });
});
