// POST /api/banking/sync-liabilities — endpoint tests. Stubbed db, auth and
// sync; no network.
import { test, describe } from "node:test";
import assert from "node:assert";

import syncLiabilities from "../../api/banking/sync-liabilities.mjs";

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
const CLOSER = { id: "s2", role: "setter", org_id: "org-1" };
const db = (clientRows = [{ "?column?": 1 }]) => ({
  query: async (sql) => (/FROM clients/.test(sql) ? { rows: clientRows } : { rows: [] })
});
const authAs = (staff) => async () => staff;
const never = async () => assert.fail("must not sync");

describe("POST /api/banking/sync-liabilities", () => {
  test("405 on GET", async () => {
    const res = makeRes();
    await syncLiabilities({ method: "GET" }, res, { db: db(), requireAuth: authAs(OWNER) });
    assert.equal(res.statusCode, 405);
  });

  test("403 for a role outside FINANCE", async () => {
    const res = makeRes();
    await syncLiabilities({ method: "POST", body: { client_id: CLIENT_ID } }, res,
      { db: db(), requireAuth: authAs(CLOSER), syncClientLiabilities: never });
    assert.equal(res.statusCode, 403);
  });

  test("400 without a uuid client_id", async () => {
    const res = makeRes();
    await syncLiabilities({ method: "POST", body: { client_id: "x" } }, res,
      { db: db(), requireAuth: authAs(OWNER), syncClientLiabilities: never });
    assert.equal(res.statusCode, 400);
  });

  test("404 for a client outside the org", async () => {
    const res = makeRes();
    await syncLiabilities({ method: "POST", body: { client_id: CLIENT_ID } }, res,
      { db: db([]), requireAuth: authAs(OWNER), syncClientLiabilities: never });
    assert.equal(res.statusCode, 404);
  });

  test("503 names missing keys when Plaid is not configured", async () => {
    const res = makeRes();
    await syncLiabilities({ method: "POST", body: { client_id: CLIENT_ID } }, res,
      { db: db(), requireAuth: authAs(OWNER), env: {} });
    assert.equal(res.statusCode, 503);
    assert.ok(res.body.missing.includes("PLAID_SECRET"));
  });

  test("200: org from the session, per-item results, no token", async () => {
    const res = makeRes();
    let seen;
    await syncLiabilities({ method: "POST", body: { client_id: CLIENT_ID, org_id: "evil" } }, res, {
      db: db(), requireAuth: authAs(OWNER), now: () => new Date("2026-10-06T12:00:00Z"),
      syncClientLiabilities: async (_db, args) => {
        seen = args;
        return {
          ok: true, environment: "sandbox", written: 1,
          items: [
            { itemRowId: "i1", ok: true, errorCode: null, error: null, written: 1, skipped: [] },
            { itemRowId: "i2", ok: false, errorCode: "PRODUCTS_NOT_SUPPORTED", error: "not supported", written: 0, skipped: [] }
          ]
        };
      }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(seen.orgId, "org-1");
    assert.equal(seen.clientId, CLIENT_ID);
    assert.equal(seen.asOf, "2026-10-06T12:00:00.000Z");
    assert.equal(res.body.written, 1);
    assert.equal(res.body.items[1].error_code, "PRODUCTS_NOT_SUPPORTED");
    assert.equal(JSON.stringify(res.body).includes("access"), false);
  });
});
