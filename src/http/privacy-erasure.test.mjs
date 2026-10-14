// /api/privacy/erasure — endpoint tests, stubbed db, no DATABASE_URL.
//
// Lives here and not under api/ because npm test's glob is "src/**" and
// "scripts/**" ONLY — a test under api/ silently never runs (CLAUDE.md §12).
//
// THIS IS THE MOST DESTRUCTIVE ENDPOINT IN THE PRODUCT, so the gate is proven
// behaviourally rather than by reading the source: a closer with a perfectly
// valid session must get a 403, not a 200. requireAuth's third argument is
// `opts`, forwarded to authenticate(), which reads only { db, env } — a `roles`
// key there is silently dropped, which is exactly the hole api/read/tradelines.mjs
// shipped. The gate here is a SECOND, separate requireRole() call, and these
// tests fail if somebody collapses it back into one.

import { test, describe, mock } from "node:test";
import assert from "node:assert";
import { assertBind } from "../testing/s3-scoped-rows.mjs";

const { default: handler } = await import("../../api/privacy/erasure.mjs");
const dbModule = await import("../db.mjs");

const ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CLIENT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const STAFF = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const REASON = "data subject emailed on 2026-07-30 asking to be erased";

function mockRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const SESSION_SQL = /FROM live JOIN staff/i;

const sessionRow = (role, orgId) => ({
  rows: [{
    session_id: "s1", expires_at: "2099-01-01T00:00:00Z",
    staff_id: STAFF, org_id: orgId, role,
    email: "dana@example.com", name: "Dana", status: "active", active_flag: null
  }]
});

const signedReq = (over = {}) => ({
  headers: { authorization: "Bearer test-session-token" },
  query: {}, body: {}, ...over
});

/* The full erasure flow, answered from a stub. Counts are arbitrary but distinct
   so a manifest that mixes two tables up is visible. */
const ERASE_FLOW = [
  [/FROM clients WHERE id/i, { rows: [{ id: CLIENT, org_id: ORG }] }],
  [/SELECT id FROM plaid_items/i, { rows: [{ id: "item-1" }] }],
  [/count\(\*\)[\s\S]*FROM pii_identity/i, { rows: [{ n: "1" }] }],
  [/count\(\*\)[\s\S]*FROM bank_accounts/i, { rows: [{ n: "2" }] }],
  [/count\(\*\)[\s\S]*FROM bank_transactions/i, { rows: [{ n: "412" }] }],
  [/count\(\*\)[\s\S]*FROM crs_results/i, { rows: [{ n: "3" }] }],
  [/count\(\*\)[\s\S]*FROM tradelines/i, { rows: [{ n: "40" }] }],
  [/count\(\*\)[\s\S]*FROM soft_pull_requests/i, { rows: [{ n: "2" }] }],
  [/count\(\*\)[\s\S]*FROM pii_access_log/i, { rows: [{ n: "9" }] }],
  [/count\(\*\)[\s\S]*FROM transactions/i, { rows: [{ n: "5" }] }],
  [/count\(\*\)[\s\S]*FROM invoices/i, { rows: [{ n: "4" }] }],
  [/count\(\*\)[\s\S]*FROM commission_ledger/i, { rows: [{ n: "6" }] }],
  [/count\(\*\)[\s\S]*FROM erasure_requests/i, { rows: [{ n: "0" }] }],
  [/INSERT INTO erasure_requests/i, { rows: [{ id: "audit-1", created_at: "2026-07-31T00:00:00Z" }] }],
  [/^\s*(DELETE|UPDATE)/i, { rowCount: 1, rows: [] }]
];

/* See src/http/banking-revoke.test.mjs for why this attaches connect(): it is
   with-transaction.mjs's documented test-double branch, and it lets these tests
   assert the erasure really was wrapped in a transaction. */
function withFakePool(rows, { role = "owner", orgId = ORG } = {}) {
  const issued = [];
  const answer = async (sql, params) => {
    assertBind(sql, params);
    issued.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
    if (SESSION_SQL.test(sql)) return sessionRow(role, orgId);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(String(sql).trim())) return { rows: [] };
    for (const [re, out] of rows) if (re.test(sql)) return typeof out === "function" ? out(params) : out;
    throw new Error("unexpected sql: " + sql);
  };
  const q = mock.method(dbModule.db, "query", answer);
  dbModule.db.connect = async () => ({ query: answer, release() {} });
  return { issued, restore() { q.mock.restore(); delete dbModule.db.connect; } };
}

function stubQueries(rows, { role = "owner", orgId = ORG } = {}) {
  return mock.method(dbModule.db, "query", async (sql, params) => {
    if (SESSION_SQL.test(sql)) return sessionRow(role, orgId);
    for (const [re, out] of rows) if (re.test(sql)) return typeof out === "function" ? out(params) : out;
    throw new Error("unexpected sql: " + sql);
  });
}

const dbCallsAfterAuth = (q) =>
  q.mock.calls.filter((c) => !SESSION_SQL.test(c.arguments[0])).length;

const goodBody = { client_id: CLIENT, confirm_client_id: CLIENT, reason: REASON };

describe("/api/privacy/erasure — the role gate", () => {

  test("*** a closer with a valid session is REFUSED ***", async () => {
    const q = stubQueries([], { role: "closer" });
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: goodBody }), res);
      assert.equal(res.statusCode, 403, "a closer must not be able to erase a person");
      assert.equal(dbCallsAfterAuth(q), 0, "a refused caller must not reach the erasure queries");
    } finally { q.mock.restore(); }
  });

  test("every non-owner, non-admin role is refused", async () => {
    for (const role of ["closer", "setter", "funding_advisor", "inquiry_specialist", "partner", "", null]) {
      const q = stubQueries([], { role });
      try {
        const res = mockRes();
        await handler(signedReq({ method: "POST", body: goodBody }), res);
        assert.equal(res.statusCode, 403, `role ${JSON.stringify(role)} should be refused`);
        assert.equal(dbCallsAfterAuth(q), 0);
      } finally { q.mock.restore(); }
    }
  });

  test("owner and admin are admitted", async () => {
    for (const role of ["owner", "admin"]) {
      const q = withFakePool(ERASE_FLOW, { role });
      try {
        const res = mockRes();
        await handler(signedReq({ method: "POST", body: goodBody }), res);
        assert.equal(res.statusCode, 200, `role ${role} should be admitted`);
        assert.equal(res.body.erased, true);
      } finally { q.restore(); }
    }
  });

  test("no session is a 401 and reaches nothing", async () => {
    const q = mock.method(dbModule.db, "query", async (sql) => {
      if (SESSION_SQL.test(sql)) return { rows: [] };
      throw new Error("must not be reached: " + sql);
    });
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: goodBody }), res);
      assert.equal(res.statusCode, 401);
      assert.equal(dbCallsAfterAuth(q), 0);
    } finally { q.mock.restore(); }
  });

  test("a database outage is a 503, not a 401", async () => {
    const q = mock.method(dbModule.db, "query", async () => { throw new Error("connection refused"); });
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: goodBody }), res);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.db, "down");
    } finally { q.mock.restore(); }
  });

  test("*** a session with no org is REFUSED — an unscoped erasure hits another org ***", async () => {
    for (const orgId of [null, "", "not-a-uuid"]) {
      const q = stubQueries([], { role: "owner", orgId });
      try {
        const res = mockRes();
        await handler(signedReq({ method: "POST", body: goodBody }), res);
        assert.equal(res.statusCode, 403, `org ${JSON.stringify(orgId)} must fail closed`);
        assert.match(res.body.message, /no organisation/i);
        assert.equal(dbCallsAfterAuth(q), 0);
      } finally { q.mock.restore(); }
    }
  });
});

describe("/api/privacy/erasure — confirmation is not a boolean", () => {

  test("*** an erasure without a matching confirm_client_id is REFUSED ***", async () => {
    // `confirm: true` is one typo in a script away from being sent by accident.
    // Repeating the id means the caller had to know which record they were erasing.
    for (const body of [
      { client_id: CLIENT, reason: REASON },
      { client_id: CLIENT, reason: REASON, confirm: true },
      { client_id: CLIENT, reason: REASON, confirm_client_id: "" },
      { client_id: CLIENT, reason: REASON, confirm_client_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }
    ]) {
      const q = stubQueries([]);
      try {
        const res = mockRes();
        await handler(signedReq({ method: "POST", body }), res);
        assert.equal(res.statusCode, 400, JSON.stringify(body));
        assert.match(res.body.error, /confirm_client_id must repeat client_id/);
        assert.equal(dbCallsAfterAuth(q), 0, "an unconfirmed erasure must not reach the database");
      } finally { q.mock.restore(); }
    }
  });

  test("a matching confirmation proceeds", async () => {
    const q = withFakePool(ERASE_FLOW);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: goodBody }), res);
      assert.equal(res.statusCode, 200);
    } finally { q.restore(); }
  });
});

describe("/api/privacy/erasure — input handling", () => {

  test("a missing or malformed client_id is a 400", async () => {
    for (const bad of [undefined, null, "", "not-a-uuid", 42]) {
      const q = stubQueries([]);
      try {
        const res = mockRes();
        await handler(signedReq({ method: "POST", body: { client_id: bad, confirm_client_id: bad, reason: REASON } }), res);
        assert.equal(res.statusCode, 400);
        assert.match(res.body.error, /client_id must be a uuid/);
        assert.equal(dbCallsAfterAuth(q), 0);
      } finally { q.mock.restore(); }
    }
  });

  test("a missing or throwaway reason is a 400", async () => {
    for (const bad of [undefined, "", "cleanup", "n/a", "gdpr"]) {
      const q = withFakePool(ERASE_FLOW);
      try {
        const res = mockRes();
        await handler(signedReq({ method: "POST", body: { ...goodBody, reason: bad } }), res);
        assert.equal(res.statusCode, 400, `reason ${JSON.stringify(bad)} should be refused`);
        assert.match(res.body.error, /reason is required/);
      } finally { q.restore(); }
    }
  });

  test("an unknown client is a 404", async () => {
    const q = withFakePool([[/FROM clients WHERE id/i, { rows: [] }]]);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: goodBody }), res);
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.error, "client not found");
    } finally { q.restore(); }
  });

  test("an unsupported method gets a 405 with an allow header", async () => {
    for (const method of ["DELETE", "PUT", "PATCH"]) {
      const q = stubQueries([]);
      try {
        const res = mockRes();
        await handler(signedReq({ method, body: {} }), res);
        assert.equal(res.statusCode, 405);
        assert.equal(res.headers.allow, "GET, POST");
      } finally { q.mock.restore(); }
    }
  });

  test("DELETE is not the erasure verb — it must not erase anything", async () => {
    // Worth its own assertion: DELETE is the method somebody reaches for on an
    // endpoint called "erasure", and it must be a 405 rather than a shortcut past
    // the confirmation and the reason.
    const q = stubQueries([]);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "DELETE", query: { client_id: CLIENT } }), res);
      assert.equal(res.statusCode, 405);
      assert.equal(dbCallsAfterAuth(q), 0);
    } finally { q.mock.restore(); }
  });
});

describe("/api/privacy/erasure — the transaction", () => {

  test("*** the whole erasure runs inside one transaction ***", async () => {
    const q = withFakePool(ERASE_FLOW);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: goodBody }), res);
      assert.equal(res.statusCode, 200);

      const verbs = q.issued.map((c) => c.sql).filter((s) => /^(BEGIN|COMMIT|ROLLBACK)$/i.test(s));
      assert.deepEqual(verbs, ["BEGIN", "COMMIT"]);
    } finally { q.restore(); }
  });

  test("*** a failed audit write rolls back and removes NOTHING ***", async () => {
    // The rule from migration 102: the audit row is written first, in the same
    // transaction. If it fails, the erasure fails. An erasure system whose
    // auditing is best-effort is an unaudited erasure system with paperwork.
    const q = withFakePool([
      ...ERASE_FLOW.filter(([re]) => !/INSERT INTO erasure_requests/i.test(re.source)),
      [/INSERT INTO erasure_requests/i, () => { throw new Error("kept reason too short") }]
    ]);
    try {
      const res = mockRes();
      await assert.rejects(() => handler(signedReq({ method: "POST", body: goodBody }), res));

      const verbs = q.issued.map((c) => c.sql).filter((s) => /^(BEGIN|COMMIT|ROLLBACK)$/i.test(s));
      assert.deepEqual(verbs, ["BEGIN", "ROLLBACK"]);
      assert.ok(!q.issued.some((c) => /^\s*DELETE/i.test(c.sql)),
        "nothing may be deleted once the audit write has failed");
      assert.ok(!q.issued.some((c) => /UPDATE clients/i.test(c.sql)),
        "the client must not be de-identified without an audit row");
    } finally { q.restore(); }
  });
});

describe("/api/privacy/erasure — the response tells the truth", () => {

  test("it returns both manifests and the audit id", async () => {
    const q = withFakePool(ERASE_FLOW);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: goodBody }), res);

      assert.equal(res.body.audit_id, "audit-1");
      assert.equal(res.body.client_id, CLIENT);
      assert.ok(res.body.removed.length > 0);
      assert.ok(res.body.kept.length > 0, "a completed erasure that kept nothing is an incomplete audit");
      for (const k of res.body.kept) assert.ok(k.reason.trim().length >= 20, `${k.table} needs a real reason`);
    } finally { q.restore(); }
  });

  test("the kept list names CRS, tradelines and the soft-pull ledger with counts", async () => {
    const q = withFakePool(ERASE_FLOW);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: goodBody }), res);
      const kept = Object.fromEntries(res.body.kept.map((k) => [k.table, k.rows]));
      assert.equal(kept.crs_results, 3);
      assert.equal(kept.tradelines, 40);
      assert.equal(kept.soft_pull_requests, 2);
    } finally { q.restore(); }
  });

  test("no SSN, token or key material appears in the response", async () => {
    const q = withFakePool(ERASE_FLOW);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: goodBody }), res);
      const blob = JSON.stringify(res.body);
      for (const bad of ["ssn_enc", "encrypted_access_token", "PII_ENC_KEY", "PLAID_TOKEN_ENC_KEY"]) {
        assert.ok(!blob.includes(bad), `${bad} leaked into the response`);
      }
    } finally { q.restore(); }
  });
});

describe("/api/privacy/erasure — reading the record", () => {

  test("GET with a client id lists that person's requests", async () => {
    const q = stubQueries([[/FROM erasure_requests/i, { rows: [{ id: "audit-1", kind: "client_erasure" }] }]]);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "GET", query: { client_id: CLIENT } }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.requests.length, 1);
    } finally { q.mock.restore(); }
  });

  test("GET with no client id lists the org's removals, for a compliance review", async () => {
    const q = stubQueries([[/FROM erasure_requests/i, { rows: [] }]]);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "GET", query: {} }), res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.requests, []);
    } finally { q.mock.restore(); }
  });

  test("GET with a malformed client id is a 400", async () => {
    const q = stubQueries([]);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "GET", query: { client_id: "nope" } }), res);
      assert.equal(res.statusCode, 400);
    } finally { q.mock.restore(); }
  });

  test("a GET is read-only — it issues no DELETE or UPDATE", async () => {
    const q = stubQueries([[/FROM erasure_requests/i, { rows: [] }]]);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "GET", query: { client_id: CLIENT } }), res);
      for (const call of q.mock.calls) {
        assert.ok(!/^\s*(DELETE|UPDATE|INSERT)/i.test(call.arguments[0]),
          "reading the erasure log must never write");
      }
    } finally { q.mock.restore(); }
  });
});
