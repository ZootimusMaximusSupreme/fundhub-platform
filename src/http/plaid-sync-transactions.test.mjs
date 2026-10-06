// POST /api/banking/sync-transactions — endpoint tests. Stubbed db, auth and
// sync; no network. Same gate as link-token: FINANCE role, client in org.
import { test, describe } from "node:test";
import assert from "node:assert";

import syncTransactionsHandler from "../../api/banking/sync-transactions.mjs";

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const OWNER = { id: "s1", role: "owner", org_id: "org-1" };
const CLOSER = { id: "s2", role: "closer", org_id: "org-1" };
const db = (clientRows = [{ "?column?": 1 }]) => ({
  query: async (sql) => (/FROM clients/.test(sql) ? { rows: clientRows } : { rows: [] })
});
const authAs = (staff) => async () => staff;
const mustNotSync = async () => assert.fail("must not sync");

describe("POST /api/banking/sync-transactions", () => {
  test("405 on GET", async () => {
    const res = makeRes();
    await syncTransactionsHandler({ method: "GET" }, res, { db: db(), requireAuth: authAs(OWNER) });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "POST");
  });

  test("403 for a role outside FINANCE", async () => {
    const res = makeRes();
    await syncTransactionsHandler({ method: "POST", body: { client_id: CLIENT_ID } }, res,
      { db: db(), requireAuth: authAs(CLOSER), syncClientTransactions: mustNotSync });
    assert.equal(res.statusCode, 403);
  });

  test("400 without a uuid client_id", async () => {
    const res = makeRes();
    await syncTransactionsHandler({ method: "POST", body: { client_id: "nope" } }, res,
      { db: db(), requireAuth: authAs(OWNER), syncClientTransactions: mustNotSync });
    assert.equal(res.statusCode, 400);
  });

  test("404 for a client outside the org", async () => {
    const res = makeRes();
    await syncTransactionsHandler({ method: "POST", body: { client_id: CLIENT_ID } }, res,
      { db: db([]), requireAuth: authAs(OWNER), syncClientTransactions: mustNotSync });
    assert.equal(res.statusCode, 404);
  });

  test("503 names missing keys when Plaid is not configured (real sync, empty env)", async () => {
    const res = makeRes();
    await syncTransactionsHandler({ method: "POST", body: { client_id: CLIENT_ID } }, res,
      { db: db(), requireAuth: authAs(OWNER), env: {} });
    assert.equal(res.statusCode, 503);
    assert.ok(res.body.missing.includes("PLAID_SECRET"));
  });

  test("200: org from the session, clock passed down, no token or cursor out", async () => {
    const res = makeRes();
    let seen;
    await syncTransactionsHandler({ method: "POST", body: { client_id: CLIENT_ID, org_id: "evil" } }, res, {
      db: db(), requireAuth: authAs(OWNER), now: () => new Date("2026-10-06T12:00:00Z"),
      syncClientTransactions: async (_db, args) => {
        seen = args;
        return {
          ok: true, ran: true, environment: "sandbox",
          items: [{ itemRowId: "item-1", ok: true, reason: null, errorCode: null, error: null,
            added: 3, modified: 0, removed: 0, written: 3, markedRemoved: 0, dropped: {},
            capped: false, updateStatus: "HISTORICAL_UPDATE_COMPLETE", cursorSaved: true,
            encrypted_access_token: "v1:secret", transactions_cursor: "cur-secret" }],
          totals: { written: 3, markedRemoved: 0, dropped: 0 },
          bills: { ran: true, bills: 1 }
        };
      }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(seen.orgId, "org-1");
    assert.equal(seen.clientId, CLIENT_ID);
    assert.equal(seen.asOf, "2026-10-06T12:00:00.000Z");
    assert.equal(res.body.items[0].written, 3);
    assert.equal(res.body.bills.bills, 1);
    const out = JSON.stringify(res.body);
    assert.equal(out.includes("v1:secret"), false, "no token in the response");
    assert.equal(out.includes("cur-secret"), false, "no cursor in the response");
  });

  test("502 when every bank failed upstream", async () => {
    const res = makeRes();
    await syncTransactionsHandler({ method: "POST", body: { client_id: CLIENT_ID } }, res, {
      db: db(), requireAuth: authAs(OWNER),
      syncClientTransactions: async () => ({
        ok: false, reason: "upstream_error",
        items: [{ itemRowId: "item-1", ok: false, reason: "upstream_error", errorCode: "ITEM_LOGIN_REQUIRED" }]
      })
    });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.items[0].error_code, "ITEM_LOGIN_REQUIRED");
  });
});
