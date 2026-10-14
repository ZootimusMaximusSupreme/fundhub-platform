// GET /api/read/transactions — endpoint tests.
//
// STUBBED db, STUBBED requireAuth, STUBBED clock, NO DATABASE_URL — same
// discipline as src/http/money-map.test.mjs, and for the same reason: what is
// worth proving here (the gate, the org scope, the refusals) needs no
// Postgres, and a security gate proved only by a test that skips for lack of
// DATABASE_URL is not proved at all.
//
// It lives under src/ rather than api/ because npm test's glob is `src/**`
// and `scripts/**` ONLY.

import { test } from "node:test";
import assert from "node:assert";
import { assertBind, assertSqlHas } from "../testing/s3-scoped-rows.mjs";

import handler, { readDays, readLimit, today, DEFAULT_DAYS, DEFAULT_LIMIT, MAX_LIMIT }
  from "../../api/read/transactions.mjs";

function makeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const OWNER = { id: "s1", role: "owner", org_id: "org-1", email: "o@x.test" };
const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const ENTITY_ID = "99999999-8888-7777-6666-555555555555";

function makeDb({ clientRows = [{ id: "c1" }], entityRows = [], txRows = [] } = {}) {
  const calls = [];
  return {
    calls,
    query(sql, params) {
      assertBind(sql, params);
      calls.push({ sql, params });
      const from = (t) => sql.includes(`FROM ${t}`);
      if (from("clients")) return Promise.resolve({ rows: clientRows });
      if (from("entities")) return Promise.resolve({ rows: entityRows });
      if (from("bank_transactions")) return Promise.resolve({ rows: txRows });
      throw new Error("unexpected query: " + sql);
    }
  };
}

const authAs = (staff) => async () => staff;
const authDenies = () => async (req, res) => {
  res.status(401).json({ ok: false, error: "unauthorized" });
  return null;
};

async function call({ staff = OWNER, query = {}, method = "GET", db, auth, now } = {}) {
  const res = makeRes();
  const database = db ?? makeDb();
  await handler(
    { method, query: { client_id: CLIENT_ID, ...query } },
    res,
    { db: database, requireAuth: auth ?? authAs(staff), now: now ?? (() => new Date("2026-08-01T12:00:00Z")) }
  );
  return { res, db: database };
}

/* ── method and gate ────────────────────────────────────────────────────── */

test("a non-GET is refused with an allow header", async () => {
  const { res } = await call({ method: "POST" });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, "GET");
});

test("no session: 401, and no query is ever run", async () => {
  const db = makeDb();
  const { res } = await call({ auth: authDenies(), db });
  assert.equal(res.statusCode, 401);
  assert.equal(db.calls.length, 0);
});

test("an authenticated role outside the staff set gets 403 and reads nothing", async () => {
  const db = makeDb();
  const { res } = await call({ staff: { id: "p1", role: "partner", org_id: "org-1" }, db });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "forbidden");
  assert.equal(db.calls.length, 0);
});

test("every staff role in the set is admitted", async () => {
  for (const role of ["owner", "admin", "funding_advisor", "closer", "inquiry_specialist", "setter"]) {
    const { res } = await call({ staff: { id: "s", role, org_id: "org-1" } });
    assert.equal(res.statusCode, 200, `${role} was refused`);
  }
});

/* ── org scoping ────────────────────────────────────────────────────────── */

test("a session with no org is refused outright — no default, no fallback", async () => {
  const db = makeDb();
  const { res } = await call({ staff: { id: "s1", role: "owner" }, db });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "no_org_scope");
  assert.equal(db.calls.length, 0);
});

test("a client in another org reads as not found, not as forbidden", async () => {
  const db = makeDb({ clientRows: [] });
  const { res } = await call({ db });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "no_such_client");
  assert.equal(db.calls.length, 1);
});

test("the transaction query filters on org_id, client_id, and only this client's accounts", async () => {
  const { db } = await call();
  const tx = db.calls.find((c) => /FROM bank_transactions/.test(c.sql));
  assert.match(tx.sql, /client_id = \$1 AND org_id = \$2/);
  assert.match(tx.sql, /bank_account_id IN/);
  assert.deepEqual(tx.params.slice(0, 2), [CLIENT_ID, "org-1"]);
});

test("the org comes from the SESSION, and a query-string org cannot override it", async () => {
  const { res, db } = await call({ query: { org_id: "org-2" } });
  assert.equal(res.statusCode, 200);
  const tx = db.calls.find((c) => /FROM bank_transactions/.test(c.sql));
  assert.ok(!tx.params.includes("org-2"));
});

/* ── entity narrowing ───────────────────────────────────────────────────── */

test("entity_id must be a uuid", async () => {
  const { res } = await call({ query: { entity_id: "nope" } });
  assert.equal(res.statusCode, 400);
});

test("an entity_id naming another client's row is refused", async () => {
  const db = makeDb({ entityRows: [] });
  const { res } = await call({ query: { entity_id: ENTITY_ID }, db });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /does not belong to this client/);
});

test("a valid entity narrows the transaction query by the account's entity_kind", async () => {
  const db = makeDb({ entityRows: [{ kind: "business" }] });
  const { res, db: after } = await call({ query: { entity_id: ENTITY_ID }, db });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.entity_kind, "business");
  const tx = after.calls.find((c) => /FROM bank_transactions/.test(c.sql));
  assert.match(tx.sql, /entity_kind = \$/);
  assert.ok(tx.params.includes("business"));
});

/* ── parameters ─────────────────────────────────────────────────────────── */

test("client_id is required and must be a uuid", async () => {
  for (const bad of [undefined, "", "nope"]) {
    const res = makeRes();
    await handler({ method: "GET", query: bad === undefined ? {} : { client_id: bad } }, res, {
      db: makeDb(), requireAuth: authAs(OWNER)
    });
    assert.equal(res.statusCode, 400, `client_id=${JSON.stringify(bad)} was accepted`);
  }
});

test("readDays: default, bounds, refusal rather than coercion", () => {
  assert.equal(readDays(undefined).days, DEFAULT_DAYS);
  assert.equal(readDays("7").days, 7);
  assert.ok(readDays("banana").error);
  assert.ok(readDays("0").error);
  assert.ok(readDays("-5").error);
});

test("readLimit: default, bounds, refusal rather than coercion", () => {
  assert.equal(readLimit(undefined).limit, DEFAULT_LIMIT);
  assert.equal(readLimit(String(MAX_LIMIT)).limit, MAX_LIMIT);
  assert.ok(readLimit("0").error);
  assert.ok(readLimit(String(MAX_LIMIT + 1)).error);
  assert.ok(readLimit("lots").error);
});

test("today() is UTC", () => {
  assert.equal(today(new Date("2026-08-01T23:59:59Z")), "2026-08-01");
});

test("no query is a SELECT *", async () => {
  const { db } = await call();
  for (const c of db.calls) assert.ok(!/SELECT\s+\*/i.test(c.sql));
});

test("date columns are cast to text in SQL", async () => {
  const { db } = await call();
  const tx = db.calls.find((c) => /FROM bank_transactions/.test(c.sql));
  assert.match(tx.sql, /posted_on::text/);
  assert.match(tx.sql, /authorized_on::text/);
});

/* ── the body ───────────────────────────────────────────────────────────── */

test("an empty database answers 200 with an empty list, not an invented row", async () => {
  const { res } = await call();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.transactions, []);
  assert.deepEqual(res.body.categories, []);
});

test("amount sign decides direction, and the display is unsigned", async () => {
  const db = makeDb({
    txRows: [
      { id: "t1", bank_account_id: "b1", amount_cents: "-4200", posted_on: "2026-07-30",
        authorized_on: "2026-07-30", merchant_name: "Shell", category: "Gas", is_pending: false, provider: "mock" },
      { id: "t2", bank_account_id: "b1", amount_cents: "180000", posted_on: "2026-07-29",
        authorized_on: "2026-07-29", merchant_name: null, category: null, is_pending: false, provider: "mock" }
    ]
  });
  const { res } = await call({ db });
  assert.equal(res.body.transactions[0].direction, "out");
  assert.equal(res.body.transactions[0].amount_display, "42.00");
  assert.equal(res.body.transactions[1].direction, "in");
  assert.equal(res.body.transactions[1].amount_display, "1800.00");
});

test("categories are grouped from outflow only, pending excluded, uncategorised kept as its own bucket", async () => {
  const db = makeDb({
    txRows: [
      { id: "t1", bank_account_id: "b1", amount_cents: "-4200", posted_on: "2026-07-30",
        authorized_on: "2026-07-30", merchant_name: "Shell", category: "Gas", is_pending: false, provider: "mock" },
      { id: "t2", bank_account_id: "b1", amount_cents: "-1000", posted_on: "2026-07-30",
        authorized_on: "2026-07-30", merchant_name: "Coffee", category: "Gas", is_pending: false, provider: "mock" },
      { id: "t3", bank_account_id: "b1", amount_cents: "-500", posted_on: "2026-07-30",
        authorized_on: "2026-07-30", merchant_name: null, category: null, is_pending: false, provider: "mock" },
      { id: "t4", bank_account_id: "b1", amount_cents: "-999999", posted_on: "2026-07-30",
        authorized_on: "2026-07-30", merchant_name: "Pending thing", category: "Gas", is_pending: true, provider: "mock" },
      { id: "t5", bank_account_id: "b1", amount_cents: "50000", posted_on: "2026-07-30",
        authorized_on: "2026-07-30", merchant_name: "Deposit", category: "Income", is_pending: false, provider: "mock" }
    ]
  });
  const { res } = await call({ db });
  assert.deepEqual(res.body.categories, [
    { name: "Gas", cents: 5200, display: "52.00" },
    { name: "Uncategorized", cents: 500, display: "5.00" }
  ]);
});

test("a bad-parameter database error becomes a 400, not a 500", async () => {
  const db = {
    calls: [],
    query() {
      const e = new Error("invalid input syntax for type uuid");
      e.code = "22P02";
      return Promise.reject(e);
    }
  };
  const { res } = await call({ db });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "bad request parameter");
});

/* ── routing ────────────────────────────────────────────────────────────── */

test("the handler is in the hardcoded ROUTES map", async () => {
  const { ROUTES, routePath } = await import("../../netlify/functions/api.mjs");
  assert.ok(
    Object.prototype.hasOwnProperty.call(ROUTES, "read/transactions"),
    "read/transactions is absent from ROUTES — the endpoint 404s locally and deployed"
  );
  assert.equal(ROUTES["read/transactions"], handler);
  assert.equal(routePath("/api/read/transactions"), "read/transactions");
  assert.equal(routePath("/.netlify/functions/api/read/transactions"), "read/transactions");
});

test("the read names this client, this company, only this client's accounts, the window, and newest first", async () => {
  const { db } = await call({});
  const read = db.calls.find((c) => c.sql.includes("FROM bank_transactions"));
  assertSqlHas(read.sql, {
    "this client and company, and only this client's accounts, in this company":
      "FROM bank_transactions WHERE client_id = $1 AND org_id = $2 AND bank_account_id IN ( SELECT id FROM bank_accounts WHERE client_id = $1 AND org_id = $2 )",
    "inside the day window": "AND COALESCE(posted_on, authorized_on) >= ($3::date - ($4 || ' days')::interval)",
    "newest first, then the last one saved": "ORDER BY COALESCE(posted_on, authorized_on) DESC NULLS LAST, created_at DESC",
    "one page": "LIMIT $5"
  });
});

test("a named container narrows the read to accounts of that kind, still inside this client and company", async () => {
  const { db } = await call({ query: { entity_id: ENTITY_ID }, db: makeDb({ entityRows: [{ kind: "business" }] }) });
  const read = db.calls.find((c) => c.sql.includes("FROM bank_transactions"));
  assertSqlHas(read.sql, {
    "only accounts of that kind of this client and company": "AND bank_account_id IN ( SELECT id FROM bank_accounts WHERE client_id = $1 AND org_id = $2 AND entity_kind = $5 )"
  });
  assertSqlHas(db.calls.find((c) => /FROM entities/.test(c.sql)).sql, { "the container is this client's, in this company": "WHERE id = $1 AND org_id = $2 AND client_id = $3" });
});
