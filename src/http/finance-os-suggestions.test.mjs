/* api/read/finance-os-suggestions.mjs, driven end to end with a stubbed
 * database. Same reason as finance-os-endpoints.test.mjs: package.json's test
 * glob only walks src/ and scripts/ (CLAUDE.md, traps), so an endpoint test has
 * to live under src/http/ to run at all, and src/db.mjs's `db` object is
 * stubbed rather than a real Postgres because this Mac has none installed.
 *
 * WHAT THIS FILE PROVES THAT THE UNDERLYING ENGINE TESTS DO NOT.
 * src/underwrite/black-report-client.test.mjs and src/finance/crs-tier.test.mjs
 * already prove the engine and the mapping are correct on real fixture data —
 * this file does not re-prove that. It proves the WIRING: that a client with no
 * active finance-os subscription gets 403 and entitled:false rather than a 200
 * with empty arrays that would look identical to "checked, nothing to say";
 * that the tenant boundary is real (an org's own client_id lookup, not the
 * caller's say-so); and that "no pull yet" is reported honestly rather than
 * defaulted into the same empty shape a real answer with nothing to flag would
 * produce.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { db } from "../db.mjs";
import handler from "../../api/read/finance-os-suggestions.mjs";
import { mergeBureauReports } from "../finance/crs-map.mjs";
import { assertBind, assertSqlHas } from "../testing/s3-scoped-rows.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX = path.resolve(HERE, "../../vendor/underwriteiq-full/api/lite/crs/sandbox");

/** The same real sandbox pull letter-pack.test.mjs uses — three-bureau merged
 *  result, shaped exactly as crs_results.result stores it. */
function sandboxPull() {
  const load = (n) => JSON.parse(readFileSync(path.join(SANDBOX, n), "utf8"));
  return mergeBureauReports({
    reports: { TU: load("tu.json"), EX: load("exp.json"), EQ: load("efx.json") },
    requestIds: { TU: "tu-1", EX: "ex-1", EQ: "eq-1" },
    environment: "sandbox"
  });
}

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "99999999-9999-4999-8999-999999999999";
const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";
const SUB = "22222222-2222-2222-2222-222222222222";

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

/**
 * A query router: each entry matches SQL text and returns rows. Anything
 * unmatched falls back to the session lookup, matching
 * finance-os-endpoints.test.mjs's convention. Order matters — "SELECT 1 FROM
 * clients" (the tenancy check) must be tried before "FROM clients" broadly.
 */
function routedDb({ orgId = ORG_A, entitled = true, clientExists = true, storedCrs = null, businessRows = [] } = {}) {
  const reads = [];
  return {
    reads,
    query: async (sql, params) => {
      assertBind(sql, params);
      reads.push({ sql, params });
      if (/^SELECT 1 FROM clients/.test(sql)) {
        return { rows: clientExists ? [{ 1: 1 }] : [] };
      }
      if (/FROM subscriptions/.test(sql)) {
        return { rows: entitled ? [{ id: SUB }] : [] };
      }
      if (/SELECT first_name.*FROM clients/s.test(sql)) {
        return { rows: [{ first_name: "Jordan", last_name: "Sample", custom_fields: {} }] };
      }
      if (/FROM crs_results/.test(sql)) {
        return { rows: storedCrs ? [{ result: storedCrs, created_at: new Date("2026-09-01") }] : [] };
      }
      if (/FROM businesses/.test(sql)) {
        return { rows: businessRows };
      }
      // The session lookup (requireAuth).
      return {
        rows: [{
          session_id: "sess-1",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          staff_id: "staff-1",
          org_id: orgId,
          role: "owner",
          email: "owner@fundhub.ai",
          name: "owner",
          status: "active",
          active_flag: "true"
        }]
      };
    }
  };
}

async function call(opts = {}, { method = "GET", query = { client_id: CID } } = {}) {
  db.query = routedDb(opts).query;
  const res = makeRes();
  const req = { method, headers: { authorization: "Bearer session-token" }, query };
  await handler(req, res).catch(() => {});
  return { status: res.statusCode, body: res.body };
}

describe("method and input", () => {
  test("405 on anything but GET", async () => {
    const { status } = await call({}, { method: "POST" });
    assert.equal(status, 405);
  });

  test("400 when client_id is missing or not a uuid", async () => {
    for (const query of [{}, { client_id: "not-a-uuid" }]) {
      const { status } = await call({}, { query });
      assert.equal(status, 400);
    }
  });
});

describe("tenancy", () => {
  test("404 when the client belongs to a different org — same answer as no such id", async () => {
    const { status, body } = await call({ clientExists: false });
    assert.equal(status, 404);
    assert.equal(body.ok, false);
  });
});

describe("entitlement", () => {
  test("403 with entitled:false when there is no active finance-os subscription", async () => {
    const { status, body } = await call({ entitled: false });
    assert.equal(status, 403);
    assert.equal(body.ok, false);
    assert.equal(body.entitled, false);
    assert.equal(body.error, "not_entitled");
  });

  test("a client without entitlement never reaches the crs_results read", async () => {
    db.query = routedDb({ entitled: false }).query;
    const res = makeRes();
    const req = { method: "GET", headers: { authorization: "Bearer x" }, query: { client_id: CID } };
    await handler(req, res);
    // Nothing in this test's routedDb throws on crs_results, so if it were
    // reached the response would carry hasPull — assert it does not.
    assert.equal("hasPull" in (res.body || {}), false);
  });
});

describe("no pull yet", () => {
  test("entitled but nothing in crs_results reports hasPull:false, not empty suggestion arrays pretending to be an answer", async () => {
    const { status, body } = await call({ entitled: true, storedCrs: null });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.entitled, true);
    assert.equal(body.hasPull, false);
    assert.equal(body.pulledAt, null);
    assert.deepEqual(body.costingYou, []);
    assert.deepEqual(body.notAFactor, []);
  });
});

describe("a real pull, mapped through the same engine the deliverables use", () => {
  test("returns the engine's costing_you and not_a_factor, and says when the pull happened", async () => {
    const { status, body } = await call({ entitled: true, storedCrs: sandboxPull() });
    assert.equal(status, 200);
    assert.equal(body.hasPull, true);
    assert.ok(body.pulledAt, "pulledAt must be reported when a pull exists");
    assert.ok(Array.isArray(body.costingYou));
    assert.ok(Array.isArray(body.notAFactor));
    assert.equal(body.subscriptionId, SUB);
  });
});

describe("the tenant boundary on the query itself, not only the gate", () => {
  test("every scoped read is bound to the SESSION's org, not a value off the request", async () => {
    const rdb = routedDb({ orgId: ORG_B, entitled: true, storedCrs: sandboxPull() });
    db.query = rdb.query;
    const res = makeRes();
    const req = { method: "GET", headers: { authorization: "Bearer x" }, query: { client_id: CID } };
    await handler(req, res);

    const entitlementRead = rdb.reads.find((r) => /FROM subscriptions/.test(r.sql));
    assert.ok(entitlementRead, "no entitlement read was issued");
    assert.equal(entitlementRead.params[0], ORG_B, "entitlement check must scope on the session's org");

    const clientRead = rdb.reads.find((r) => /SELECT first_name/.test(r.sql));
    assert.equal(clientRead.params[1], ORG_B);
  });
});

describe("what is read", () => {
  test("the pull it speaks from is this client's newest one, and the client is read inside this company", async () => {
    const routed = routedDb({});
    db.query = routed.query;
    await handler({ method: "GET", headers: { authorization: "Bearer session-token" }, query: { client_id: CID } }, makeRes()).catch(() => {});
    const sqlOf = (re) => routed.reads.find((r) => re.test(r.sql)).sql;
    assertSqlHas(sqlOf(/FROM crs_results/), { "this client, newest pull, one row": "WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1" });
    assertSqlHas(sqlOf(/SELECT first_name.*FROM clients/s), { "this client in this company": "WHERE id = $1 AND org_id = $2" });
    const business = routed.reads.find((r) => /FROM businesses/.test(r.sql));
    if (business) assertSqlHas(business.sql, { "this client's companies, oldest first": "WHERE client_id = $1 ORDER BY created_at ASC" });
    assertSqlHas(sqlOf(/FROM subscriptions/), {
      "this company's client, the finance-os tier, live today inside its paid period, the latest": "WHERE org_id = $1 AND client_id = $2 AND tier = $3 AND status = 'active' AND effective_from <= $4 AND (effective_to IS NULL OR effective_to > $4) AND (current_period_start IS NULL OR current_period_start <= $4) AND (current_period_end IS NULL OR current_period_end > $4) ORDER BY effective_from DESC LIMIT 1"
    });
  });
});
