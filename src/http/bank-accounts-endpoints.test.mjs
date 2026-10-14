/* /api/finance/bank-accounts — the hand-entry writer for `bank_accounts`.
 *
 * WHY THIS FILE EXISTS AND WHERE IT LIVES. package.json's test glob walks src/
 * and scripts/ ONLY (CLAUDE.md, traps), so a test placed next to the handler
 * under api/ never runs and reports nothing while doing it. It lives here and
 * imports the handler from api/.
 *
 * WHY IT NEEDS NO DATABASE. src/db.mjs exports `db` as a plain object with one
 * `query` method, so the session lookup and every statement the handler issues
 * are stubbed and the handler runs exactly as it does in production. Same
 * approach as src/http/subscriptions-endpoints.test.mjs and for the same reason:
 * the tenancy rules this endpoint turns on are INVISIBLE on a one-org database,
 * and every database this repo has is a one-org database.
 *
 * THE FIVE THINGS THIS FILE IS ACTUALLY GUARDING.
 *
 *   1. ORG COMES FROM THE SESSION. Every read and every write must carry
 *      staff.org_id and must never carry an org id from the body. A session with
 *      no org must match nothing rather than everything. The recorded SQL and
 *      its bound parameters are what this is proved against, not the response.
 *
 *   2. A FULL ACCOUNT NUMBER MUST NOT BE STORABLE. The mask box is the only
 *      place on the screen where a person could type one, and 081:60 permits the
 *      last 2-4 digits and forbids the full number and the routing number in the
 *      same breath. The tests send a full number, a routing number and a
 *      decorated mask, and assert each is refused BEFORE any write.
 *
 *   3. UNKNOWN IS NOT ZERO AND UNKNOWN IS NOT PERSONAL. An empty money box must
 *      reach the column as NULL, never 0 — 081:30 says the difference "decides
 *      whether someone gets funded". An unclassified account must stay
 *      'unknown', and a classification with no basis must be refused with a
 *      sentence rather than left to 082's CHECK to answer as a 500.
 *
 *   4. THE SIGN IS DATA. 081:26 refuses a CHECK (>= 0) because "a chequing
 *      account can be overdrawn ... the exact accounts a funding decision most
 *      needs to see". A negative balance must survive the boundary.
 *
 *   5. A REFUSAL IS NOT A CRASH. Everything a caller can get wrong here — a bad
 *      type, a bad currency, a bad date, a float in a cents field, both
 *      spellings of one amount — used to be an unhandled throw, which
 *      api.mjs:334 renders as HTTP 500 "the server broke" for a form somebody
 *      filled in wrong. Each is asserted to be a 400 carrying a sentence.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import handler from "../../api/finance/bank-accounts.mjs";
import { assertBind, assertSqlHas } from "../testing/s3-scoped-rows.mjs";

/* Two orgs, deliberately. The caller belongs to ORG_A. ORG_B is the tenant whose
   ids get handed in. On a single-org database these are the same value and every
   scoping bug below is unobservable — which is exactly how the identical hole
   survived on the banking-surface read until audit M15. */
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";
const ACCT = "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa";

let savedQuery = null;
beforeEach(() => { savedQuery = db.query; });
afterEach(() => { db.query = savedQuery; });

const makeRes = () => ({
  statusCode: 0,
  body: null,
  headers: {},
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; }
});

/* A stored row as the columns actually come back. The bigint cents columns are
   STRINGS on purpose — node-postgres hands bigints over as strings and anything
   that formats or adds one has to convert first. A fixture of tidy numbers would
   hide the bug that causes. */
const ROW = {
  id: ACCT, client_id: CID, name: "Business Checking", official_name: null,
  mask: "1234", account_type: "depository", account_subtype: "checking",
  currency_code: "USD",
  available_balance_cents: "120450", current_balance_cents: "125000",
  credit_limit_cents: null, balance_as_of: "2026-07-01T00:00:00.000Z",
  entity_kind: "business", entity_kind_source: "staff_reviewed",
  entity_kind_set_at: "2026-07-02T00:00:00.000Z",
  closed_at: null, created_at: "2026-06-01T00:00:00.000Z", updated_at: "2026-07-02T00:00:00.000Z"
};

/* THE STUB IS A ROUTER, NOT A SINGLE MATCHER, because this handler issues
   several different statements per request and the point of most of the tests is
   WHICH statements ran and what they were bound to. Every query is recorded —
   SQL text and parameters — and the recording is what tenancy is proved against.
   An unmatched statement THROWS rather than returning an empty result: a silent
   `{rows:[]}` for a statement nobody anticipated is how a test passes while
   asserting nothing.

   ORDER IS LOAD-BEARING. The account-ownership SELECT and the surface SELECT
   both name bank_accounts; the ownership one is distinguished by selecting
   `client_id` with no FROM clients, so it is matched first. */
const ROUTES = {
  ownsClient: { re: /SELECT\s+1\s+FROM\s+clients/i, rows: () => [{ "?column?": 1 }] },
  ownsEntity: { re: /SELECT\s+1\s+FROM\s+entities/i, rows: () => [{ "?column?": 1 }] },
  ownsAccount: { re: /SELECT\s+id,\s*client_id\s+FROM\s+bank_accounts/i, rows: () => [{ id: ACCT, client_id: CID }] },
  insert: { re: /INSERT\s+INTO\s+bank_accounts/i, rows: () => [{ id: ACCT }] },
  classify: { re: /UPDATE\s+bank_accounts[\s\S]*entity_kind\s*=/i, rows: () => [{ id: ACCT, client_id: CID }] },
  close: { re: /UPDATE\s+bank_accounts[\s\S]*closed_at\s*=\s*COALESCE/i, rows: () => [{ id: ACCT, client_id: CID, closed_at: "2026-07-31T00:00:00.000Z" }] },
  surface: { re: /FROM\s+bank_accounts\s+WHERE\s+org_id/i, rows: () => [ROW] }
};

function stubDb({ role = "owner", orgId = ORG_A, authenticated = true, handlers = {} } = {}) {
  const queries = [];
  db.query = async (sql, params) => {
    assertBind(sql, params);
    const text = String(sql);
    // verifySession's CTE — anything naming `sessions` and none of our tables.
    if (/FROM\s+sessions/i.test(text) || (/session/i.test(text) && !/bank_accounts|clients/i.test(text))) {
      if (!authenticated) return { rows: [] };
      return {
        rows: [{
          session_id: "sess-1",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          staff_id: "staff-1",
          org_id: orgId,
          role,
          email: `${role}@fundhub.ai`,
          name: role,
          status: "active",
          active_flag: "true"
        }]
      };
    }

    queries.push({ sql: text, params });

    for (const [name, spec] of Object.entries(ROUTES)) {
      if (!spec.re.test(text)) continue;
      const h = handlers[name];
      if (typeof h === "function") return h(params, text);
      if (h && h.throws) throw h.throws;
      if (h) return { rows: h.rows || [] };
      return { rows: spec.rows() };
    }
    throw new Error(`test stub: no route for SQL: ${text.slice(0, 90)}`);
  };
  return queries;
}

const call = async ({ method = "POST", body, query = {}, token = "t0ken" } = {}) => {
  const res = makeRes();
  await handler(
    { method, query, body, headers: token ? { authorization: `Bearer ${token}` } : {} },
    res
  );
  return res;
};

const find = (queries, re) => queries.find((q) => re.test(q.sql));

/* ── 1. the gate ───────────────────────────────────────────────────────────── */

describe("who may reach this endpoint at all", () => {

  test("an unauthenticated caller gets 401 and no statement runs", async () => {
    const queries = stubDb({ authenticated: false });
    const res = await call({ method: "GET", query: { client_id: CID } });
    assert.equal(res.statusCode, 401);
    assert.equal(queries.length, 0, "a refused caller must not reach the database");
  });

  /* ROLE_SETS.FINANCE, not STAFF. api/read/banking-surface.mjs carries the same
     gate over the same rows and src/http/banking-surface-gate.test.mjs records
     why (audit M9): configuring a bank connection is not consent, and it must
     not by itself put a named person's balances on every employee's desk. If
     this ever widens, the screen's row in shell.js OWNER_ADMIN_ONLY has to move
     with it or the app offers a screen its data refuses. */
  for (const role of ["closer", "setter", "funding_advisor", "inquiry_specialist"]) {
    test(`a ${role} is refused with 403 and reads nothing`, async () => {
      const queries = stubDb({ role });
      const res = await call({ method: "GET", query: { client_id: CID } });
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.ok, false);
      assert.equal(queries.length, 0);
    });
  }

  /* FAIL CLOSED. A session with no company cannot be scoped to one, and both
     alternatives are worse: a default org files the row under the wrong company,
     and no filter reads every company's rows. */
  test("a session with no org is refused rather than scoped to nothing", async () => {
    const queries = stubDb({ orgId: null });
    const res = await call({ method: "GET", query: { client_id: CID } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "org_required");
    assert.equal(queries.length, 0);
  });

  test("PUT is refused with 405 and names the verbs that work", async () => {
    stubDb();
    const res = await call({ method: "PUT" });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "GET, POST");
  });
});

/* ── 2. org scoping ────────────────────────────────────────────────────────── */

describe("the company comes from the session and from nowhere else", () => {

  test("the read binds the session's org, not any value in the query string", async () => {
    const queries = stubDb();
    const res = await call({
      method: "GET",
      // A caller trying to read another company's client, both by naming its
      // org and by knowing a client id.
      query: { client_id: CID, org_id: ORG_B }
    });
    assert.equal(res.statusCode, 200);
    for (const q of queries) {
      assert.ok(q.params.includes(ORG_A), `every statement binds the session org: ${q.sql.slice(0, 60)}`);
      assert.ok(!q.params.includes(ORG_B), `no statement may bind an org from the request: ${q.sql.slice(0, 60)}`);
    }
  });

  test("a body org_id is refused outright, not ignored", async () => {
    const queries = stubDb();
    const res = await call({ body: { action: "add", client_id: CID, org_id: ORG_B } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "org_id_not_accepted");
    assert.equal(queries.length, 0, "refused before anything ran");
  });

  test("a client belonging to another company is 403, and nothing is written", async () => {
    const queries = stubDb({ handlers: { ownsClient: { rows: [] } } });
    const res = await call({ body: { action: "add", client_id: CID, name: "Theirs" } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "forbidden");
    assert.equal(find(queries, /INSERT/i), undefined, "no INSERT after a failed ownership check");
  });

  test("an account belonging to another company cannot be classified or closed", async () => {
    for (const body of [
      { action: "classify", account_id: ACCT, entity_kind: "business", entity_kind_source: "staff_reviewed" },
      { action: "close", account_id: ACCT }
    ]) {
      const queries = stubDb({ handlers: { ownsAccount: { rows: [] } } });
      const res = await call({ body });
      assert.equal(res.statusCode, 403, JSON.stringify(res.body));
      assert.equal(find(queries, /UPDATE/i), undefined, "no UPDATE after a failed ownership check");
    }
  });

  /* THE CLIENT ID IN THE ANSWER COMES FROM THE STORED ROW. classify and close
     are addressed by account id, and a caller who sent someone else's client_id
     alongside a real account_id would otherwise read a second client's accounts
     back out of a write to the first. */
  test("a write answers with the account's OWN client, not one named in the body", async () => {
    const queries = stubDb();
    const res = await call({
      body: {
        action: "close", account_id: ACCT,
        client_id: "99999999-9999-4999-8999-999999999999"
      }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.client_id, CID);
    const surface = find(queries, /FROM\s+bank_accounts\s+WHERE\s+org_id/i);
    assert.deepEqual(surface.params, [ORG_A, CID]);
  });
});

/* ── 3. the mask is the only fragment that may be stored ───────────────────── */

describe("a full account number cannot be stored, and neither can a routing number", () => {

  test("a long run of digits in the mask box is refused, not truncated", async () => {
    const queries = stubDb();
    const res = await call({ body: { action: "add", client_id: CID, mask: "4011223344556677" } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /full account number/i);
    assert.equal(find(queries, /INSERT/i), undefined, "nothing was stored");
  });

  test("an account_number or routing_number field is refused by name", async () => {
    for (const field of ["account_number", "routing_number", "iban"]) {
      const queries = stubDb();
      const res = await call({ body: { action: "add", client_id: CID, [field]: "123456789" } });
      assert.equal(res.statusCode, 400, field);
      assert.equal(res.body.error, `${field}_not_accepted`);
      assert.equal(queries.length, 0, `${field} refused before anything ran`);
    }
  });

  /* The provider ids stay NULL on a hand-entered row (081:41). If a caller could
     set them, a typed balance would be indistinguishable from a fetched one —
     and there is nothing in this repository that can fetch one. */
  test("a caller cannot claim a plaid item or account id", async () => {
    for (const field of ["plaid_item_id", "plaid_account_id"]) {
      stubDb();
      const res = await call({ body: { action: "add", client_id: CID, [field]: "x" } });
      assert.equal(res.statusCode, 400, field);
      assert.equal(res.body.error, `${field}_not_accepted`);
    }
  });

  test("a decorated mask off a statement is accepted; a letter is not", async () => {
    const queries = stubDb();
    const ok = await call({ body: { action: "add", client_id: CID, mask: "•••• 1234" } });
    assert.equal(ok.statusCode, 201, JSON.stringify(ok.body));
    assert.equal(find(queries, /INSERT/i).params[4], "1234");

    const bad = await call({ body: { action: "add", client_id: CID, mask: "12ab" } });
    assert.equal(bad.statusCode, 400);
    assert.match(bad.body.error, /last 2-4 digits/i);
  });

  test("the INSERT never names a routing or full account column", async () => {
    const queries = stubDb();
    await call({ body: { action: "add", client_id: CID, name: "Checking" } });
    const ins = find(queries, /INSERT/i);
    assert.doesNotMatch(ins.sql, /routing/i);
    assert.doesNotMatch(ins.sql, /account_number/i);
  });
});

/* ── 4. unknown is not zero ────────────────────────────────────────────────── */

describe("an empty money box is unknown, never zero", () => {

  test("omitting every balance binds NULL, not 0", async () => {
    const queries = stubDb();
    const res = await call({ body: { action: "add", client_id: CID, name: "Savings" } });
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    const p = find(queries, /INSERT/i).params;
    // available, current, credit_limit — positions 8, 9, 10 in the VALUES list.
    assert.strictEqual(p[8], null);
    assert.strictEqual(p[9], null);
    assert.strictEqual(p[10], null);
    assert.ok(!p.includes(0), "no balance may arrive at the column as a zero nobody typed");
  });

  test("an explicitly empty string is also NULL", async () => {
    const queries = stubDb();
    await call({ body: { action: "add", client_id: CID, available: "", current: null } });
    const p = find(queries, /INSERT/i).params;
    assert.strictEqual(p[8], null);
    assert.strictEqual(p[9], null);
  });

  test("a typed zero IS stored as zero — the caller said so", async () => {
    const queries = stubDb();
    await call({ body: { action: "add", client_id: CID, available: "0" } });
    assert.strictEqual(find(queries, /INSERT/i).params[8], 0);
  });

  test("dollars become integer cents at the boundary, separators and all", async () => {
    const queries = stubDb();
    await call({ body: { action: "add", client_id: CID, available: "1,204.50", current: "1250" } });
    const p = find(queries, /INSERT/i).params;
    assert.strictEqual(p[8], 120450);
    assert.strictEqual(p[9], 125000);
  });

  /* 081:26 — "A CHECK (>= 0) here would reject the exact accounts a funding
     decision most needs to see, and whoever hit it would 'fix' it by clamping to
     zero — which is a lie about a client's finances. The sign is data." */
  test("an overdrawn balance survives with its sign", async () => {
    const queries = stubDb();
    await call({ body: { action: "add", client_id: CID, current: "-412.19" } });
    assert.strictEqual(find(queries, /INSERT/i).params[9], -41219);
  });

  test("a float in a *_cents field is refused rather than rounded", async () => {
    stubDb();
    const res = await call({ body: { action: "add", client_id: CID, available_balance_cents: 19.99 } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /integer cents/i);
  });

  test("sending both spellings of one amount is refused, not resolved", async () => {
    stubDb();
    const res = await call({
      body: { action: "add", client_id: CID, available: "12", available_balance_cents: 1300 }
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /not both/i);
  });

  test("a balance that is not a number is a 400 with a sentence, not a 500", async () => {
    stubDb();
    const res = await call({ body: { action: "add", client_id: CID, current: "about five hundred" } });
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.length > 0);
  });

  /* An unknown balance must survive all the way to the screen. bankingSurface()
     sends display:null for it and the screen paints an em dash; a 0 here would
     paint "0.00", which is a claim about somebody's money that nobody made. */
  test("a NULL balance reaches the response as display null", async () => {
    stubDb({
      handlers: {
        surface: { rows: [{ ...ROW, available_balance_cents: null, current_balance_cents: null }] }
      }
    });
    const res = await call({ method: "GET", query: { client_id: CID } });
    const acct = res.body.surface.groups.find((g) => g.key === "business").accounts[0];
    assert.strictEqual(acct.available_display, null);
    assert.strictEqual(acct.current_display, null);
    assert.strictEqual(acct.available_balance_cents, null);
  });
});

/* ── 5. unknown is not personal ────────────────────────────────────────────── */

describe("whose money it is, and how we know", () => {

  test("an account arrives unclassified, and that is the honest state", async () => {
    const queries = stubDb();
    await call({ body: { action: "add", client_id: CID, name: "Some account" } });
    const p = find(queries, /INSERT/i).params;
    assert.strictEqual(p[12], "unknown", "entity_kind");
    assert.strictEqual(p[13], null, "entity_kind_source stays empty on an unknown row");
    assert.strictEqual(p[14], null, "and so does the decision date");
  });

  /* 082's bank_accounts_entity_kind_provenance_check refuses this in SQL. A bare
     CHECK violation reaches a person as HTTP 500 through api.mjs:334 — "the
     server broke" for a form they filled in wrong. It is answered here instead,
     in a sentence naming the missing field. */
  test("classifying with no basis is a 400 naming the field, and writes nothing", async () => {
    const queries = stubDb();
    const res = await call({ body: { action: "classify", account_id: ACCT, entity_kind: "business" } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /entity_kind_source/);
    assert.equal(find(queries, /UPDATE/i), undefined);
  });

  test("adding an account as business with no basis is refused the same way", async () => {
    const queries = stubDb();
    const res = await call({ body: { action: "add", client_id: CID, entity_kind: "business" } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /entity_kind_source/);
    assert.equal(find(queries, /INSERT/i), undefined);
  });

  test("a classification with a basis writes all three columns together", async () => {
    const queries = stubDb();
    const res = await call({
      body: {
        action: "classify", account_id: ACCT,
        entity_kind: "personal", entity_kind_source: "document_verified"
      }
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const p = find(queries, /UPDATE\s+bank_accounts[\s\S]*entity_kind/i).params;
    assert.equal(p[2], "personal");
    assert.equal(p[3], "document_verified");
    assert.ok(p[4], "the decision date is stamped");
  });

  /* 082:88 — a NULL source "is the correct state for every 'unknown' row".
     Un-classifying while leaving "a human here looked and decided" attached
     would leave the record asserting something that was withdrawn. */
  test("going back to unclassified clears the basis and the date", async () => {
    const queries = stubDb();
    const res = await call({
      body: { action: "classify", account_id: ACCT, entity_kind: "unknown", entity_kind_source: "staff_reviewed" }
    });
    assert.equal(res.statusCode, 200);
    const p = find(queries, /UPDATE\s+bank_accounts[\s\S]*entity_kind/i).params;
    assert.equal(p[2], "unknown");
    assert.strictEqual(p[3], null);
    assert.strictEqual(p[4], null);
  });

  test("an invented basis is refused rather than stored", async () => {
    stubDb();
    const res = await call({
      body: { action: "classify", account_id: ACCT, entity_kind: "business", entity_kind_source: "vibes" }
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /entity_kind_source must be one of/);
  });

  /* 'connection_metadata' is legal in 082's CHECK and is deliberately not
     offered here: there is no bank connection in this product, so a hand-entry
     path claiming one would be a false statement about provenance. */
  test("a hand entry cannot claim it was read from a bank connection", async () => {
    stubDb();
    const res = await call({
      body: { action: "classify", account_id: ACCT, entity_kind: "business", entity_kind_source: "connection_metadata" }
    });
    assert.equal(res.statusCode, 400);
  });

  test("an invented entity_kind is refused", async () => {
    stubDb();
    const res = await call({ body: { action: "classify", account_id: ACCT, entity_kind: "mixed" } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /entity_kind must be one of/);
  });

  test("the grouped answer never folds unclassified into personal", async () => {
    stubDb({
      handlers: {
        surface: {
          rows: [
            { ...ROW, id: "a1", entity_kind: "unknown", entity_kind_source: null },
            { ...ROW, id: "a2", entity_kind: "personal", entity_kind_source: "client_stated" }
          ]
        }
      }
    });
    const res = await call({ method: "GET", query: { client_id: CID } });
    const by = Object.fromEntries(res.body.surface.groups.map((g) => [g.key, g]));
    assert.equal(by.personal.count, 1);
    assert.equal(by.unknown.count, 1);
    assert.equal(res.body.surface.unclassified, 1);
    assert.equal(res.body.surface.needs_classification, true);
    // The unclassified pile is LAST in the order the screen renders.
    assert.equal(res.body.surface.groups[2].key, "unknown");
    // And there is no combined total anywhere in the answer.
    assert.equal(res.body.surface.total, undefined);
  });
});

/* ── 6. closing ────────────────────────────────────────────────────────────── */

describe("closing an account", () => {

  test("close sets closed_at and never deletes", async () => {
    const queries = stubDb();
    const res = await call({ body: { action: "close", account_id: ACCT } });
    assert.equal(res.statusCode, 200);
    const q = find(queries, /UPDATE\s+bank_accounts[\s\S]*closed_at/i);
    assert.match(q.sql, /COALESCE\(closed_at/i, "the FIRST close date is kept");
    for (const x of queries) assert.doesNotMatch(x.sql, /DELETE/i);
  });

  test("an unparseable close date is a 400, not a 500", async () => {
    stubDb();
    const res = await call({ body: { action: "close", account_id: ACCT, at: "last tuesday" } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /not a date/);
  });

  /* The ownership SELECT said the row is ours; the UPDATE says whether it still
     is. Answering 200 on zero rows updated would report a write that did not
     happen. */
  test("a row that vanished between the check and the write is a 404, not a 200", async () => {
    stubDb({ handlers: { close: { rows: [] } } });
    const res = await call({ body: { action: "close", account_id: ACCT } });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "account_not_found");
  });
});

/* ── 7. the rest of the field rules ────────────────────────────────────────── */

describe("everything else a caller can get wrong comes back as a sentence", () => {

  test("an unmodelled account type is refused and lists the five", async () => {
    stubDb();
    const res = await call({ body: { action: "add", client_id: CID, account_type: "crypto" } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /depository, credit, loan, investment, other/);
  });

  /* 081:76 — there is deliberately no default type, because defaulting to
     'depository' "would quietly turn an unclassified line of credit into cash on
     hand". An unstated type is NULL and stays NULL. */
  test("an unstated type stays empty rather than becoming a deposit account", async () => {
    const queries = stubDb();
    await call({ body: { action: "add", client_id: CID, name: "Something" } });
    assert.strictEqual(find(queries, /INSERT/i).params[5], null);
  });

  test("a credit line typed against a deposit account is refused, naming both fields", async () => {
    const queries = stubDb();
    const res = await call({
      body: { action: "add", client_id: CID, account_type: "depository", credit_limit: "5000" }
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "credit_limit_not_on_a_deposit_account");
    assert.equal(find(queries, /INSERT/i), undefined);
  });

  test("a currency is upper-cased; a four-letter one is refused", async () => {
    const queries = stubDb();
    await call({ body: { action: "add", client_id: CID, currency_code: "usd" } });
    assert.strictEqual(find(queries, /INSERT/i).params[7], "USD");

    const bad = await call({ body: { action: "add", client_id: CID, currency_code: "USDT" } });
    assert.equal(bad.statusCode, 400);
    assert.match(bad.body.error, /three-letter/);
  });

  /* 081:52 — "Never fill these with a placeholder — a screen showing 'Account' is
     honest, a screen showing an invented name is not." An empty string is the
     same lie with fewer letters. */
  test("an empty name is stored as NULL, not as an empty string", async () => {
    const queries = stubDb();
    await call({ body: { action: "add", client_id: CID, name: "   " } });
    assert.strictEqual(find(queries, /INSERT/i).params[2], null);
  });

  /* 081:94 — a NULL balance_as_of "means we do not know how stale the figures
     are, which is itself a reason not to rely on them". Stamping today onto a
     figure copied off last month's statement would turn that unknown into a
     false claim. */
  test("an as-of date is never defaulted to now", async () => {
    const queries = stubDb();
    await call({ body: { action: "add", client_id: CID, available: "100" } });
    assert.strictEqual(find(queries, /INSERT/i).params[11], null);
  });

  test("a bad as-of date is a 400 naming the field", async () => {
    stubDb();
    const res = await call({ body: { action: "add", client_id: CID, balance_as_of: "soon" } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /balance_as_of/);
  });

  test("an unknown action is a 400 and touches nothing", async () => {
    const queries = stubDb();
    const res = await call({ body: { action: "sync", client_id: CID } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "invalid_action");
    assert.equal(queries.length, 0);
  });

  test("a malformed uuid is a 400, not a database error", async () => {
    stubDb();
    const res = await call({ method: "GET", query: { client_id: "not-a-uuid" } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /uuid/);
  });

  /* The backstop for the CHECK constraint somebody adds to a migration later
     without adding a reader here. A 400 naming the constraint is a fault the
     caller can act on; the 500 they would otherwise get says the server broke. */
  test("a CHECK violation from the column becomes a 400, not a 500", async () => {
    const err = new Error("new row violates check constraint");
    err.code = "23514";
    err.constraint = "bank_accounts_entity_kind_provenance_check";
    stubDb({ handlers: { insert: { throws: err } } });
    const res = await call({ body: { action: "add", client_id: CID, name: "x" } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "rejected_by_a_column_rule");
    assert.match(res.body.message, /provenance/);
  });
});

/* ── 8. the shape the screen renders from ──────────────────────────────────── */

describe("the response the screen renders from", () => {

  test("a write answers with the whole surface, so the screen needs no second read", async () => {
    stubDb();
    const res = await call({ body: { action: "add", client_id: CID, name: "Checking" } });
    assert.equal(res.statusCode, 201);
    assert.ok(res.body.surface, "the surface comes back with the write");
    assert.ok(res.body.details, "and so do the fields the grouping drops");
    assert.equal(res.body.account_id, ACCT);
  });

  /* `details` is the COMPLEMENT of the grouped view, not a second copy of it.
     Every field appears in exactly one of the two objects, so there is no
     overlap to drift. */
  test("details carries exactly what the grouped view leaves out", async () => {
    stubDb({ handlers: { surface: { rows: [{ ...ROW, credit_limit_cents: "500000" }] } } });
    const res = await call({ method: "GET", query: { client_id: CID } });
    const d = res.body.details[ACCT];
    assert.equal(d.currency_code, "USD");
    assert.equal(d.credit_limit_display, "5000.00", "bigints arrive as strings and must be converted");
    assert.equal(d.hand_entered, true);

    const acct = res.body.surface.groups.find((g) => g.key === "business").accounts[0];
    assert.equal(acct.currency_code, undefined, "the grouped view does not carry it");
    assert.equal(d.available_display, undefined, "and details does not carry the balances");
  });

  test("a client with no accounts reads as no accounts, not as an error", async () => {
    stubDb({ handlers: { surface: { rows: [] } } });
    const res = await call({ method: "GET", query: { client_id: CID } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.surface.accounts, 0);
    assert.equal(res.body.surface.needs_classification, false);
    assert.equal(res.body.surface.groups.length, 3, "all three groups are always present");
    for (const g of res.body.surface.groups) {
      assert.strictEqual(g.available.display, null, "an empty group totals to unknown, not to 0.00");
    }
  });

  /* This endpoint reads the same columns as api/read/banking-surface.mjs and
     hands them to the same module, so a row written here shows up there. The
     SELECT is asserted to carry both filters. */
  test("the read is filtered on org AND client, and orders unclassified last", async () => {
    const queries = stubDb();
    await call({ method: "GET", query: { client_id: CID } });
    const q = find(queries, /FROM\s+bank_accounts\s+WHERE\s+org_id/i);
    assert.match(q.sql, /WHERE\s+org_id\s*=\s*\$1\s+AND\s+client_id\s*=\s*\$2/i);
    assert.deepEqual(q.params, [ORG_A, CID]);
  });
});

/* ── 9. nothing transmits ──────────────────────────────────────────────────── */

describe("nothing here reaches outside this process", () => {

  /* src/banking/plaid.mjs is a named empty seam behind an open SOC 2 review and
     a consent flow compliance has not signed off. This endpoint must not import
     it, must not call it, and must not grow a "sync" action to compensate for
     hand entry — hand entry IS the product. A source-level assertion, because
     the absence of a call is not observable from a response. */
  test("the handler imports no adapter and offers no sync action", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(here, "../../api/finance/bank-accounts.mjs"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    assert.doesNotMatch(src, /from\s+["'].*plaid/i, "no plaid import");
    assert.doesNotMatch(src, /\bfetch\s*\(/, "no outbound call");
    assert.doesNotMatch(src, /case\s+["']sync["']/, "no sync action");
  });
});

describe("a container named on an add must be this client's, in this company", () => {
  const BIZ = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";

  test("the container is checked in its own statement, and a container that is not theirs is a 400 with nothing written", async () => {
    const q = stubDb({});
    const ok = await call({ body: { action: "add", client_id: CID, name: "Ink", account_type: "credit", entity_id: BIZ } });
    assert.equal(ok.statusCode, 201, JSON.stringify(ok.body));
    const owns = find(q, /FROM\s+entities/i);
    assert.deepEqual(owns.params, [BIZ, ORG_A, CID]);
    assertSqlHas(owns.sql, { "this container, this company, this client": "SELECT 1 FROM entities WHERE id = $1 AND org_id = $2 AND client_id = $3" });

    const q2 = stubDb({ handlers: { ownsEntity: { rows: [] } } });
    const no = await call({ body: { action: "add", client_id: CID, name: "Ink", account_type: "credit", entity_id: BIZ } });
    assert.equal(no.statusCode, 400);
    assert.match(no.body.error, /entity_id does not belong to this client/);
    assert.equal(q2.some((x) => /INSERT\s+INTO\s+bank_accounts/i.test(x.sql)), false);
  });
});
