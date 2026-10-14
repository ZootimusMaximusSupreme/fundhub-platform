// GET /api/read/money-map — endpoint tests.
//
// STUBBED db, STUBBED requireAuth, STUBBED clock, NO DATABASE_URL. This file is
// `.test.mjs` and not `.pg.test.mjs` on purpose: the things worth proving here
// are the gate, the org scope and the refusals, none of which need Postgres, and
// all of which would silently skip if this file needed a connection string.
// AUDIT-FINDINGS records that ~193 pg tests skip with DATABASE_URL unset and the
// suite still reports zero failures — a security gate proved only by a test that
// skips is not proved at all.
//
// It also lives under src/ rather than api/ because npm test's glob is
// `src/**` and `scripts/**` ONLY. A test placed beside the handler never runs.

import { test } from "node:test";
import assert from "node:assert";

import handler, { readDays, readAmount, today, DEFAULT_DAYS, MAX_DAYS } from "../../api/read/money-map.mjs";
import { assertBind, assertSqlHas } from "../testing/s3-scoped-rows.mjs";

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

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
const CLOSER = { id: "s2", role: "closer", org_id: "org-1" };
const CLIENT_ROW = { id: "c1", first_name: "Dana", last_name: "Reyes" };

/* A db whose answers are chosen by matching the SQL. Every query this handler
   makes is recorded so a test can assert on the PARAMETERS — which is the only
   way to prove the org id actually reached the WHERE clause rather than being
   read and dropped. */
function makeDb(tables = {}, { clientRows = [CLIENT_ROW], settingsRows = [] } = {}) {
  const calls = [];
  return {
    calls,
    query(sql, params) {
      assertBind(sql, params);
      calls.push({ sql, params });
      const from = (t) => sql.includes(`FROM ${t}`);
      if (from("cashflow_settings")) return Promise.resolve({ rows: settingsRows });
      if (from("clients")) return Promise.resolve({ rows: clientRows });
      if (from("tradelines")) return Promise.resolve({ rows: tables.tradelines ?? [] });
      if (from("card_liabilities")) return Promise.resolve({ rows: tables.liabilities ?? [] });
      if (from("bank_accounts")) return Promise.resolve({ rows: tables.bankAccounts ?? [] });
      if (from("recurring_bills")) return Promise.resolve({ rows: tables.recurringBills ?? [] });
      if (from("cashflow_reminders")) return Promise.resolve({ rows: tables.reminders ?? [] });
      throw new Error("unexpected query: " + sql);
    }
  };
}

const authAs = (staff) => async () => staff;
const authDenies = () => async (req, res) => {
  res.status(401).json({ ok: false, error: "unauthorized" });
  return null;
};

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";

async function call({ staff = OWNER, query = {}, method = "GET", db, auth, now } = {}) {
  const res = makeRes();
  const database = db ?? makeDb();
  await handler(
    { method, query: { client_id: CLIENT_ID, ...query } },
    res,
    { db: database, requireAuth: auth ?? authAs(staff), now: now ?? (() => new Date("2026-07-31T12:00:00Z")) }
  );
  return { res, db: database };
}

/* ------------------------------------------------------------------ *
 * Method and gate
 * ------------------------------------------------------------------ */

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

/* THE ROLE GATE IS A SECOND CALL, NOT A `roles` KEY ON requireAuth.
   api/read/tradelines.mjs shipped `{ roles: ROLE_SETS.STAFF }` as requireAuth's
   third argument, which is { db, env } — the key was accepted by the object
   literal and silently dropped, and the effective rule became "any
   authenticated staff session, any role". These two tests are what would catch
   that shape here. */
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

/* ------------------------------------------------------------------ *
 * Org scoping — from the session, and it FAILS CLOSED
 * ------------------------------------------------------------------ */

test("a session with no org is refused outright — no default, no fallback", async () => {
  const db = makeDb();
  const { res } = await call({ staff: { id: "s1", role: "owner" }, db });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "no_org_scope");
  assert.equal(db.calls.length, 0, "a session with no org must not reach the database");
});

test("an empty-string org is refused, not treated as a scope", async () => {
  const { res } = await call({ staff: { id: "s1", role: "owner", org_id: "" } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "no_org_scope");
});

test("the org comes from the SESSION, and a query-string org cannot override it", async () => {
  const { res, db } = await call({
    staff: { ...OWNER, org_id: "org-1" },
    query: { org_id: "org-2" }
  });
  assert.equal(res.statusCode, 200);
  for (const c of db.calls) {
    assert.ok(c.params.includes("org-1"), "a query did not carry the session org: " + c.sql);
    assert.ok(!c.params.includes("org-2"), "a caller-supplied org reached a query: " + c.sql);
  }
});

test("a client in another org reads as not found, not as forbidden", async () => {
  const db = makeDb({}, { clientRows: [] });
  const { res } = await call({ db });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "no_such_client");
  // The scope check runs FIRST — nothing else was read.
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /FROM clients/);
});

test("every per-client query filters on org_id as well as client_id", async () => {
  const { db } = await call();
  const perClient = db.calls.filter(
    (c) => !/FROM clients/.test(c.sql) && !/FROM cashflow_settings/.test(c.sql)
  );
  assert.equal(perClient.length, 5, "expected five per-client reads");
  for (const c of perClient) {
    assert.match(c.sql, /org_id = \$2/, "a data query is not org-scoped: " + c.sql);
    assert.deepEqual(c.params, [CLIENT_ID, "org-1"]);
  }
});

/* The org's thresholds are a property of the ORG, not of one client, so this
   one is scoped by org alone — and it must never be scoped by anything the
   caller supplied. */
test("the settings read is org-scoped and carries no caller input", async () => {
  const { db } = await call({ query: { org_id: "org-2" } });
  const settings = db.calls.find((c) => /FROM cashflow_settings/.test(c.sql));
  assert.ok(settings, "the org's cash-flow thresholds were never read");
  assert.match(settings.sql, /WHERE org_id = \$1/);
  assert.deepEqual(settings.params, ["org-1"]);
});

/* loadThresholds must not create a row. A read that wrote a default would bake
   "somebody decided zero" into the database on first open of the screen. */
test("reading the thresholds writes nothing", async () => {
  const { db } = await call();
  for (const c of db.calls) {
    assert.ok(!/INSERT|UPDATE|DELETE/i.test(c.sql), "a read endpoint wrote to the database: " + c.sql);
  }
});

test("all six tables are read", async () => {
  const { db } = await call();
  const sql = db.calls.map((c) => c.sql).join("\n");
  for (const t of ["clients", "tradelines", "card_liabilities", "bank_accounts", "recurring_bills", "cashflow_reminders"]) {
    assert.match(sql, new RegExp("FROM " + t), `${t} was never read`);
  }
});

/* SELECTED COLUMNS, NOT SELECT *. plaid_items.encrypted_access_token is one
   join away from bank_accounts. */
test("no query is a SELECT *", async () => {
  const { db } = await call();
  for (const c of db.calls) {
    assert.ok(!/SELECT\s+\*/i.test(c.sql), "a SELECT * reached the database: " + c.sql);
  }
});

/* Date columns are cast in SQL so node-postgres never hands back a Date at
   local midnight that a UTC reader then shifts by a day. */
test("date columns are cast to text in SQL", async () => {
  const { db } = await call();
  const liab = db.calls.find((c) => /FROM card_liabilities/.test(c.sql));
  assert.match(liab.sql, /payment_due_date::text/);
  assert.match(liab.sql, /statement_date::text/);
  const bills = db.calls.find((c) => /FROM recurring_bills/.test(c.sql));
  assert.match(bills.sql, /next_expected_on::text/);
});

/* ------------------------------------------------------------------ *
 * Parameters
 * ------------------------------------------------------------------ */

test("client_id is required and must be a uuid", async () => {
  for (const bad of [undefined, "", "nope", "1234"]) {
    const res = makeRes();
    await handler({ method: "GET", query: bad === undefined ? {} : { client_id: bad } }, res, {
      db: makeDb(), requireAuth: authAs(OWNER)
    });
    assert.equal(res.statusCode, 400, `client_id=${JSON.stringify(bad)} was accepted`);
  }
});

test("readDays: default, bounds, and a refusal rather than a coercion", () => {
  assert.equal(readDays(undefined).days, DEFAULT_DAYS);
  assert.equal(readDays("").days, DEFAULT_DAYS);
  assert.equal(readDays("7").days, 7);
  assert.equal(readDays(String(MAX_DAYS)).days, MAX_DAYS);
  // "days=banana" silently becoming 30 is how a screen shows a window nobody
  // asked for.
  assert.ok(readDays("banana").error);
  assert.ok(readDays("0").error);
  assert.ok(readDays("-5").error);
  assert.ok(readDays("1.5").error);
  assert.ok(readDays(String(MAX_DAYS + 1)).error);
});

test("readAmount: absent is not zero", () => {
  assert.equal(readAmount(undefined).amount, null);
  assert.equal(readAmount("").amount, null);
  assert.equal(readAmount("5000").amount, 5000);
  assert.equal(readAmount("$5,000").amount, 5000);
  assert.equal(readAmount("0").amount, 0);
  assert.ok(readAmount("-1").error);
  assert.ok(readAmount("lots").error);
});

test("a bad days or amount is a 400 before any read", async () => {
  for (const query of [{ days: "banana" }, { amount: "-3" }]) {
    const db = makeDb();
    const { res } = await call({ query, db });
    assert.equal(res.statusCode, 400);
    assert.equal(db.calls.length, 0);
  }
});

test("the window the caller asked for is the window that comes back", async () => {
  const { res } = await call({ query: { days: "7" } });
  assert.equal(res.body.horizon_days, 7);
  assert.equal(res.body.window.from, "2026-07-31");
  assert.equal(res.body.window.to, "2026-08-06");
});

test("today() is UTC, so the same request from two regions names the same day", () => {
  assert.equal(today(new Date("2026-07-31T23:59:59Z")), "2026-07-31");
  assert.equal(today(new Date("2026-08-01T00:00:01Z")), "2026-08-01");
});

/* ------------------------------------------------------------------ *
 * The body
 * ------------------------------------------------------------------ */

test("an empty database answers 200 and SAYS it is empty", async () => {
  const { res } = await call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.source, "money-map");
  assert.equal(res.body.empty.everything, true);
  // Not a single fabricated figure anywhere in the headline numbers.
  assert.equal(res.body.cards.minimum_payments_total.display, null);
  assert.equal(res.body.cashflow.opening.display, null);
});

test("the client's name comes back, and nothing else about them", async () => {
  const { res } = await call();
  assert.deepEqual(res.body.client, { id: "c1", name: "Dana Reyes" });
  assert.equal(res.body.client.email, undefined);
  assert.equal(res.body.client.phone, undefined);
});

test("real rows flow through to the payload with their engine labels", async () => {
  const db = makeDb({
    tradelines: [{
      id: "t1", lender: "Amex", kind: "revolving",
      credit_limit_cents: "750000", balance_cents: "150000", apr: "0.1899",
      account_ref: "4444555566667777", closed_at: null
    }],
    liabilities: [{
      id: "l1", tradeline_id: "t1", as_of: "2026-07-20",
      payment_due_date: "2026-08-12", minimum_payment_cents: "3500",
      statement_balance_cents: "150000", statement_date: "2026-07-15",
      past_due_cents: "0", payment_status: "current", source: "crs"
    }],
    bankAccounts: [{
      id: "b1", name: "Everyday Checking", account_type: "depository",
      current_balance_cents: "240000", available_balance_cents: "240000",
      entity_kind: "personal", mask: "1234", closed_at: null
    }]
  });
  const { res } = await call({ db });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.cards.rows[0].due_date, "2026-08-12");
  assert.equal(res.body.cards.rows[0].minimum_payment.display, "35.00");
  assert.equal(res.body.cashflow.ok, true);
  assert.equal(res.body.cashflow.opening.display, "2400.00");
  for (const e of res.body.utilization.overall) {
    assert.ok(e.engine_label, "a utilization line arrived with no engine label");
  }
});

test("only bills the detector is reasonably confident about are read", async () => {
  const { db } = await call();
  const bills = db.calls.find((c) => /FROM recurring_bills/.test(c.sql));
  assert.match(bills.sql, /confidence_label IN \('medium', 'high'\)/);
});

test("reading a reminder changes nothing — the query is a SELECT", async () => {
  const { db } = await call();
  const rem = db.calls.find((c) => /FROM cashflow_reminders/.test(c.sql));
  assert.match(rem.sql, /^\s*SELECT/);
  assert.ok(!/UPDATE|INSERT|DELETE/i.test(rem.sql));
  assert.match(rem.sql, /acknowledged_at IS NULL/);
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

test("an unexpected database error is re-thrown for the adapter to shape", async () => {
  const db = { calls: [], query() { return Promise.reject(new Error("connection refused to db://user:pw@host")); } };
  await assert.rejects(
    () => handler({ method: "GET", query: { client_id: CLIENT_ID } }, makeRes(),
                  { db, requireAuth: authAs(OWNER) }),
    /connection refused/
  );
});

/* ------------------------------------------------------------------ *
 * Routing — the failure this repo has shipped twice
 * ------------------------------------------------------------------ */

test("the handler is in the hardcoded ROUTES map", async () => {
  const { ROUTES, routePath } = await import("../../netlify/functions/api.mjs");
  assert.ok(
    Object.prototype.hasOwnProperty.call(ROUTES, "read/money-map"),
    "read/money-map is absent from ROUTES — the endpoint 404s locally and deployed"
  );
  assert.equal(ROUTES["read/money-map"], handler);
  assert.equal(routePath("/api/read/money-map"), "read/money-map");
  assert.equal(routePath("/.netlify/functions/api/read/money-map"), "read/money-map");
});

test("each read names this client and this company, and keeps the rows the map is about: confident bills, due unacknowledged reminders", async () => {
  const { db } = await call({});
  const sqlOf = (table) => db.calls.find((c) => c.sql.includes(`FROM ${table}`) && c.params.includes(CLIENT_ID)).sql;
  assertSqlHas(sqlOf("tradelines"), { "tradelines": "WHERE client_id = $1 AND org_id = $2 ORDER BY apr ASC NULLS LAST, lender ASC" });
  assertSqlHas(sqlOf("card_liabilities"), { "card bills, soonest due first": "WHERE client_id = $1 AND org_id = $2 ORDER BY payment_due_date ASC NULLS LAST, as_of DESC" });
  assertSqlHas(sqlOf("bank_accounts"), { "accounts": "WHERE client_id = $1 AND org_id = $2 ORDER BY entity_kind, name NULLS LAST, id" });
  assertSqlHas(sqlOf("recurring_bills"), {
    "across every account, medium or high confidence only": "WHERE client_id = $1 AND org_id = $2 AND confidence_label IN ('medium', 'high') ORDER BY typical_amount_cents ASC, merchant_key ASC"
  });
  assertSqlHas(sqlOf("cashflow_reminders"), {
    "due and not yet acknowledged, soonest first": "WHERE client_id = $1 AND org_id = $2 AND acknowledged_at IS NULL AND surface_at <= now() ORDER BY surface_at ASC, created_at ASC LIMIT 200"
  });
});
