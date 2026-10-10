// /api/finance/containers — endpoint tests. Stubbed db and auth; no network.
import { test, describe } from "node:test";
import assert from "node:assert";

import handler from "../../api/finance/containers.mjs";

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const ACCT = "bbbbbbbb-0000-0000-0000-000000000001";
const BUSINESS = "aaaaaaaa-0000-0000-0000-000000000002";
const OWNER = { id: "s1", role: "owner", org_id: "org-1" };
const CLOSER = { id: "s2", role: "closer", org_id: "org-1" };
const authAs = (staff) => async () => staff;

function fakeDb({ clientRows = [{ "?column?": 1 }], extra = [] } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      for (const [re, rows] of extra) {
        if (re.test(sql)) return { rows: typeof rows === "function" ? rows(sql, params) : rows };
      }
      if (/count\(\*\)/.test(sql)) return { rows: [{ n: 1 }] };
      if (/FROM clients/.test(sql)) return { rows: clientRows };
      return { rows: [] };
    }
  };
}

describe("GET /api/finance/containers", () => {
  test("403 for a role outside FINANCE", async () => {
    const res = makeRes();
    await handler({ method: "GET", query: { client_id: CLIENT_ID } }, res, { db: fakeDb(), requireAuth: authAs(CLOSER) });
    assert.equal(res.statusCode, 403);
  });

  test("400 without a uuid client_id", async () => {
    const res = makeRes();
    await handler({ method: "GET", query: { client_id: "x" } }, res, { db: fakeDb(), requireAuth: authAs(OWNER) });
    assert.equal(res.statusCode, 400);
  });

  test("404 for a client outside the org", async () => {
    const res = makeRes();
    await handler({ method: "GET", query: { client_id: CLIENT_ID } }, res,
      { db: fakeDb({ clientRows: [] }), requireAuth: authAs(OWNER) });
    assert.equal(res.statusCode, 404);
  });

  test("200 with containers, unassigned and billing; price unset reads null", async () => {
    const res = makeRes();
    const db = fakeDb({ extra: [[/FROM entities\s+WHERE org_id/, [{ id: BUSINESS, kind: "business", name: "Fundhub LLC" }]]] });
    await handler({ method: "GET", query: { client_id: CLIENT_ID } }, res,
      { db, requireAuth: authAs(OWNER), env: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.containers[0].name, "Fundhub LLC");
    assert.ok(res.body.unassigned);
    assert.deepEqual(res.body.billing, { containers: 1, price_per_container_cents: null, monthly_cents: null });
  });

  test("billing reads the price from env", async () => {
    const res = makeRes();
    await handler({ method: "GET", query: { client_id: CLIENT_ID } }, res,
      { db: fakeDb(), requireAuth: authAs(OWNER), env: { FINANCE_OS_PRICE_PER_CONTAINER_CENTS: "3000" } });
    assert.equal(res.body.billing.monthly_cents, 3000);
  });
});

describe("POST /api/finance/containers", () => {
  test("org comes from the session, never the body", async () => {
    const res = makeRes();
    const db = fakeDb();
    await handler({ method: "POST", body: { action: "create", client_id: CLIENT_ID, kind: "business", name: "X", org_id: "evil" } }, res,
      { db, requireAuth: authAs(OWNER) });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "org_id_not_accepted");
    assert.equal(db.calls.length, 0);
  });

  test("create → 201 with the session org in the insert", async () => {
    const res = makeRes();
    const db = fakeDb({ extra: [[/INSERT INTO entities/, (_s, p) => [{ id: BUSINESS, client_id: p[1], kind: p[2], name: p[3] }]]] });
    await handler({ method: "POST", body: { action: "create", client_id: CLIENT_ID, kind: "business", name: "Fundhub LLC" } }, res,
      { db, requireAuth: authAs(OWNER), env: {} });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.container_id, BUSINESS);
    const ins = db.calls.find((c) => /INSERT/.test(c.sql));
    assert.equal(ins.params[0], "org-1");
  });

  test("create with a bad kind → 400", async () => {
    const res = makeRes();
    await handler({ method: "POST", body: { action: "create", client_id: CLIENT_ID, kind: "trust", name: "X" } }, res,
      { db: fakeDb(), requireAuth: authAs(OWNER) });
    assert.equal(res.statusCode, 400);
  });

  test("assign → 200, kind follows the container", async () => {
    const res = makeRes();
    const db = fakeDb({ extra: [
      [/UPDATE bank_accounts/, (_s, p) => [{ id: p[0], client_id: CLIENT_ID, entity_id: p[2], entity_kind: p[3] }]],
      [/FROM bank_accounts WHERE id/, [{ id: ACCT, client_id: CLIENT_ID, entity_id: null, entity_kind: "unknown", entity_kind_source: null }]],
      [/FROM entities WHERE id/, [{ id: BUSINESS, client_id: CLIENT_ID, kind: "business", archived_at: null }]]
    ] });
    await handler({ method: "POST", body: { action: "assign", account_id: ACCT, container_id: BUSINESS } }, res,
      { db, requireAuth: authAs(OWNER), env: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.kind, "business");
    assert.equal(res.body.client_id, CLIENT_ID);
  });

  test("assign to an unknown container → 404", async () => {
    const res = makeRes();
    const db = fakeDb({ extra: [
      [/FROM bank_accounts WHERE id/, [{ id: ACCT, client_id: CLIENT_ID, entity_kind: "unknown" }]]
    ] });
    await handler({ method: "POST", body: { action: "assign", account_id: ACCT, container_id: BUSINESS } }, res,
      { db, requireAuth: authAs(OWNER) });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "container_not_found");
  });

  test("unassign of an account outside the org → 404", async () => {
    const res = makeRes();
    await handler({ method: "POST", body: { action: "unassign", account_id: ACCT } }, res,
      { db: fakeDb(), requireAuth: authAs(OWNER) });
    assert.equal(res.statusCode, 404);
  });

  test("unknown action → 400; PUT → 405", async () => {
    let res = makeRes();
    await handler({ method: "POST", body: { action: "delete" } }, res, { db: fakeDb(), requireAuth: authAs(OWNER) });
    assert.equal(res.statusCode, 400);
    res = makeRes();
    await handler({ method: "PUT" }, res, { db: fakeDb(), requireAuth: authAs(OWNER) });
    assert.equal(res.statusCode, 405);
  });
});
