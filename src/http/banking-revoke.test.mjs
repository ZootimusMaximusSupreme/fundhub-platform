// /api/banking/revoke — endpoint tests, stubbed db, no DATABASE_URL.
//
// Lives here and not under api/ because npm test's glob is "src/**" and
// "scripts/**" ONLY. A test placed under api/ silently never runs, which is
// CLAUDE.md §12's first trap. It imports the api/ handler, like every other
// endpoint test in this directory.
//
// THE ASSERTION THAT MATTERS MOST IS THE ROLE GATE. requireAuth's third argument
// is `opts`, forwarded to authenticate(), which reads only { db, env } — so a
// `roles` key there is accepted, ignored, and dropped. api/read/tradelines.mjs
// shipped exactly that, and its effective gate was "any authenticated staff of
// any role" over a client's credit limits. This endpoint deletes a bank
// credential, so the gate is proven behaviourally here: a closer with a valid
// session gets a 403, not a 200.

import { test, describe, mock } from "node:test";
import assert from "node:assert";
import { assertBind, assertSqlHas } from "../testing/s3-scoped-rows.mjs";

/* The handler imports src/db.mjs at module load. Nothing connects at import time
   — src/db.mjs builds its pool lazily inside pool() — so importing is safe with
   no DATABASE_URL, and every db call below is intercepted before it reaches it. */
const { default: handler } = await import("../../api/banking/revoke.mjs");
const dbModule = await import("../db.mjs");

const ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CLIENT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ITEM = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const STAFF = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const REASON = "client asked us to disconnect their Chase login";

/* A res double that records what the handler wrote. */
function mockRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

/* An ES module's exported bindings cannot be redefined, so the session is not
   stubbed at authenticate(). Instead the SESSION QUERY itself is answered from
   the stubbed db, which drives the genuine chain — requireAuth → authenticate →
   verifySession → requireRole — rather than skipping over the part being tested.
   That matters here: the bug this file exists to catch lives in how requireAuth
   and requireRole compose, and a stub above them would hide it. */
const SESSION_SQL = /FROM live JOIN staff/i;

/* The row verifySession expects back. status must be "active" or the session is
   revoked on the spot. */
const sessionRow = (role, orgId) => ({
  rows: [{
    session_id: "s1", expires_at: "2099-01-01T00:00:00Z",
    staff_id: STAFF, org_id: orgId, role,
    email: "dana@example.com", name: "Dana", status: "active", active_flag: null
  }]
});

/* A signed-in request. The token is a throwaway string that only has to be
   non-empty — verifySession hashes it and the stub answers regardless. */
const signedReq = (over = {}) => ({
  headers: { authorization: "Bearer test-session-token" },
  query: {}, body: {}, ...over
});

function stubQueries(rows, { role = "owner", orgId = ORG } = {}) {
  return mock.method(dbModule.db, "query", async (sql, params) => {
    if (SESSION_SQL.test(sql)) return sessionRow(role, orgId);
    for (const [re, out] of rows) if (re.test(sql)) return typeof out === "function" ? out(params) : out;
    throw new Error("unexpected sql: " + sql);
  });
}

/* A transaction double.
   src/db/with-transaction.mjs takes its FIRST branch when the handle has a
   connect() — documented as "a real Pool, OR A TEST DOUBLE THAT WANTS TO OBSERVE
   BEGIN/COMMIT/ROLLBACK". That is exactly what this is. Attaching it to the
   shared handle is what lets an endpoint test drive the real transactional path
   without Postgres, and it means these tests can assert the thing that matters
   most on a destructive endpoint: that the work really was wrapped in a
   transaction, so a failure halfway cannot leave a credential gone with no audit
   row behind it. */
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

  return {
    issued,
    restore() { q.mock.restore(); delete dbModule.db.connect; }
  };
}

/* Queries issued after authentication — the ones a refused caller must never
   cause. The session lookup itself does not count. */
const dbCallsAfterAuth = (q) =>
  q.mock.calls.filter((c) => !SESSION_SQL.test(c.arguments[0])).length;

const REVOKE_FLOW = [
  [/FROM plaid_items[\s\S]*FOR UPDATE/i, { rows: [{ id: ITEM, org_id: ORG, client_id: CLIENT, institution_name: "Chase", link_state: "active", has_access_token: true }] }],
  [/SELECT id FROM bank_accounts/i, { rows: [{ id: "acct-1" }] }],
  [/subject_client_id IS NULL/i, { rows: [{ n: "0" }] }],
  [/count\(\*\)[\s\S]*bank_transactions/i, { rows: [{ n: "12" }] }],
  [/INSERT INTO erasure_requests/i, { rows: [{ id: "audit-1", created_at: "2026-07-31T00:00:00Z" }] }],
  [/DELETE FROM plaid_items/i, { rowCount: 1, rows: [{ id: ITEM }] }]
];

describe("/api/banking/revoke — the role gate", () => {

  test("*** a closer with a valid session is REFUSED — the gate is a real call ***", async () => {
    const q = stubQueries([], { role: "closer" });
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: { item_id: ITEM, reason: REASON } }), res);

      assert.equal(res.statusCode, 403, "a closer must not be able to destroy a bank connection");
      assert.equal(res.body.ok, false);
      assert.equal(dbCallsAfterAuth(q), 0, "a refused caller must not reach the revoke queries");
    } finally { q.mock.restore(); }
  });

  test("every non-owner, non-admin staff role is refused", async () => {
    for (const role of ["closer", "setter", "funding_advisor", "inquiry_specialist", "partner", "", null]) {
      const q = stubQueries([], { role });
      try {
        const res = mockRes();
        await handler(signedReq({ method: "POST", body: { item_id: ITEM, reason: REASON } }), res);
        assert.equal(res.statusCode, 403, `role ${JSON.stringify(role)} should be refused`);
        assert.equal(dbCallsAfterAuth(q), 0);
      } finally { q.mock.restore(); }
    }
  });

  test("owner and admin are admitted", async () => {
    for (const role of ["owner", "admin", "Owner", "ADMIN"]) {
      const q = withFakePool(REVOKE_FLOW, { role });
      try {
        const res = mockRes();
        await handler(signedReq({ method: "POST", body: { item_id: ITEM, reason: REASON } }), res);
        assert.equal(res.statusCode, 200, `role ${role} should be admitted`);
        assert.equal(res.body.revoked, true);
      } finally { q.restore(); }
    }
  });

  test("no session is a 401 and never reaches the revoke queries", async () => {
    const q = mock.method(dbModule.db, "query", async (sql) => {
      if (SESSION_SQL.test(sql)) return { rows: [] };   // no live session
      throw new Error("must not be reached: " + sql);
    });
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: { item_id: ITEM, reason: REASON } }), res);
      assert.equal(res.statusCode, 401);
      assert.equal(dbCallsAfterAuth(q), 0);
    } finally { q.mock.restore(); }
  });

  test("a request with no token at all is a 401", async () => {
    const q = stubQueries([]);
    try {
      const res = mockRes();
      await handler({ method: "POST", headers: {}, query: {}, body: { item_id: ITEM, reason: REASON } }, res);
      assert.equal(res.statusCode, 401);
      assert.equal(q.mock.callCount(), 0, "no token means no session lookup either");
    } finally { q.mock.restore(); }
  });

  test("a suspended staff member loses the session rather than keeping it until expiry", async () => {
    const q = mock.method(dbModule.db, "query", async (sql) => {
      if (SESSION_SQL.test(sql)) {
        const r = sessionRow("owner", ORG);
        r.rows[0].status = "suspended";
        return r;
      }
      if (/UPDATE sessions SET revoked_at/i.test(sql)) return { rowCount: 1, rows: [] };
      throw new Error("must not be reached: " + sql);
    });
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: { item_id: ITEM, reason: REASON } }), res);
      assert.equal(res.statusCode, 401);
    } finally { q.mock.restore(); }
  });

  test("a database outage is a 503, not a 401 — the caller is not signed out", async () => {
    const q = mock.method(dbModule.db, "query", async () => { throw new Error("connection refused"); });
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: { item_id: ITEM, reason: REASON } }), res);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.db, "down");
    } finally { q.mock.restore(); }
  });

  test("*** a session with no org is REFUSED — an unscoped revoke hits another org ***", async () => {
    for (const orgId of [null, "", "not-a-uuid"]) {
      const q = stubQueries([], { role: "owner", orgId });
      try {
        const res = mockRes();
        await handler(signedReq({ method: "POST", body: { item_id: ITEM, reason: REASON } }), res);
        assert.equal(res.statusCode, 403, `org ${JSON.stringify(orgId)} must fail closed`);
        assert.match(res.body.message, /no organisation/i);
        assert.equal(dbCallsAfterAuth(q), 0);
      } finally { q.mock.restore(); }
    }
  });
});

describe("/api/banking/revoke — the org comes from the session, not the body", () => {

  test("an org_id in the body is ignored", async () => {
    const q = withFakePool(REVOKE_FLOW);
    try {
      const res = mockRes();
      await handler(signedReq({
        method: "POST",
        body: { item_id: ITEM, reason: REASON, org_id: "99999999-9999-9999-9999-999999999999" }
      }), res);

      assert.equal(res.statusCode, 200);
      const lookup = q.issued.find((c) => /FOR UPDATE/i.test(c.sql));
      assert.equal(lookup.params[1], ORG, "the session's org must win over anything in the body");
      assertSqlHas(lookup.sql, {
        "the login in this company, locked, token presence only": "(encrypted_access_token IS NOT NULL) AS has_access_token FROM plaid_items WHERE id = $1 AND org_id = $2 FOR UPDATE"
      });
    } finally { q.restore(); }
  });

  test("*** the whole revoke runs inside one transaction ***", async () => {
    // Cascading deletes with autocommit is how half-deleted data happens: the
    // credential gone, the audit row absent, and no way to tell afterwards.
    const q = withFakePool(REVOKE_FLOW);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: { item_id: ITEM, reason: REASON } }), res);
      assert.equal(res.statusCode, 200);

      const verbs = q.issued.map((c) => c.sql).filter((s) => /^(BEGIN|COMMIT|ROLLBACK)$/i.test(s));
      assert.deepEqual(verbs, ["BEGIN", "COMMIT"], "the revoke must be wrapped in a real transaction");

      const begin = q.issued.findIndex((c) => /^BEGIN$/i.test(c.sql));
      const del = q.issued.findIndex((c) => /DELETE FROM plaid_items/i.test(c.sql));
      const commit = q.issued.findIndex((c) => /^COMMIT$/i.test(c.sql));
      assert.ok(begin < del && del < commit, "the delete must happen inside the transaction");
    } finally { q.restore(); }
  });

  test("a failure mid-revoke rolls back rather than leaving it half done", async () => {
    const q = withFakePool([
      ...REVOKE_FLOW.slice(0, 4),
      [/INSERT INTO erasure_requests/i, () => { throw new Error("audit write failed"); }]
    ]);
    try {
      const res = mockRes();
      await assert.rejects(() => handler(signedReq({ method: "POST", body: { item_id: ITEM, reason: REASON } }), res));
      const verbs = q.issued.map((c) => c.sql).filter((s) => /^(BEGIN|COMMIT|ROLLBACK)$/i.test(s));
      assert.deepEqual(verbs, ["BEGIN", "ROLLBACK"], "a failed audit write must roll the whole thing back");
      assert.ok(!q.issued.some((c) => /DELETE FROM plaid_items/i.test(c.sql)),
        "nothing may be deleted once the audit write has failed");
    } finally { q.restore(); }
  });
});

describe("/api/banking/revoke — input handling", () => {

  test("a missing or malformed item_id is a 400", async () => {
    for (const bad of [undefined, null, "", "not-a-uuid", 42]) {
      const q = stubQueries([]);
      try {
        const res = mockRes();
        await handler(signedReq({ method: "POST", body: { item_id: bad, reason: REASON } }), res);
        assert.equal(res.statusCode, 400);
        assert.match(res.body.error, /item_id must be a uuid/);
        assert.equal(dbCallsAfterAuth(q), 0);
      } finally { q.mock.restore(); }
    }
  });

  test("a missing or throwaway reason is a 400 from the service module", async () => {
    for (const bad of [undefined, "", "cleanup", "n/a"]) {
      const q = withFakePool(REVOKE_FLOW);
      try {
        const res = mockRes();
        await handler(signedReq({ method: "POST", body: { item_id: ITEM, reason: bad } }), res);
        assert.equal(res.statusCode, 400, `reason ${JSON.stringify(bad)} should be refused`);
        assert.match(res.body.error, /reason is required/);
      } finally { q.restore(); }
    }
  });

  test("an unknown item is a 404 carrying no detail about whether it exists elsewhere", async () => {
    const q = withFakePool([[/FROM plaid_items[\s\S]*FOR UPDATE/i, { rows: [] }]]);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: { item_id: ITEM, reason: REASON } }), res);
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.error, "bank login not found");
    } finally { q.restore(); }
  });

  test("an unanchored ledger is a 409 and the endpoint surfaces the refusal", async () => {
    const q = withFakePool([
      ...REVOKE_FLOW.slice(0, 2),
      [/subject_client_id IS NULL/i, { rows: [{ n: "3" }] }],
      [/count\(\*\)[\s\S]*bank_transactions/i, { rows: [{ n: "10" }] }]
    ]);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: { item_id: ITEM, reason: REASON } }), res);
      assert.equal(res.statusCode, 409);
      assert.match(res.body.error, /refusing to revoke/i);
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

  test("GET lists the logins for a client and needs a uuid", async () => {
    let q = stubQueries([[/FROM plaid_items i/i, { rows: [{ id: ITEM, has_access_token: true, account_count: "2" }] }]], { role: "admin" });
    try {
      const res = mockRes();
      await handler(signedReq({ method: "GET", query: { client_id: CLIENT } }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.logins.length, 1);
      const list = q.mock.calls.map((c) => c.arguments[0]).find((sql) => /FROM plaid_items i/.test(sql));
      assertSqlHas(list, {
        "presence of the credential, never its value": "(i.encrypted_access_token IS NOT NULL) AS has_access_token",
        "this company and client, newest first": "WHERE i.org_id = $1 AND i.client_id = $2 ORDER BY i.created_at DESC"
      });
    } finally { q.mock.restore(); }

    q = stubQueries([], { role: "admin" });
    try {
      const res = mockRes();
      await handler(signedReq({ method: "GET", query: { client_id: "nope" } }), res);
      assert.equal(res.statusCode, 400);
    } finally { q.mock.restore(); }
  });
});

describe("/api/banking/revoke — the response tells the truth", () => {

  test("*** it says access was NOT revoked at the provider ***", async () => {
    // Nothing in this repository transmits. A caller reading "revoked: true" as
    // "the bank connection is torn down" would be wrong in the direction that
    // matters — they would stop chasing it.
    const q = withFakePool(REVOKE_FLOW);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: { item_id: ITEM, reason: REASON } }), res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.provider_revoked, false);
      assert.match(res.body.provider_note, /has NOT been revoked at the provider/i);
    } finally { q.restore(); }
  });

  test("the response carries both manifests and the audit id", async () => {
    const q = withFakePool(REVOKE_FLOW);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: { item_id: ITEM, reason: REASON } }), res);

      assert.equal(res.body.audit_id, "audit-1");
      assert.ok(Array.isArray(res.body.removed) && res.body.removed.length > 0);
      const kept = res.body.kept.find((k) => k.table === "bank_transactions");
      assert.equal(kept.rows, 12);
      assert.ok(kept.reason.length >= 20);
    } finally { q.restore(); }
  });

  test("no credential appears anywhere in the response", async () => {
    const q = withFakePool(REVOKE_FLOW);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "POST", body: { item_id: ITEM, reason: REASON } }), res);
      const blob = JSON.stringify(res.body);
      assert.ok(!/encrypted_access_token/.test(blob));
      assert.ok(!/access-sandbox|access-production|PLAID_TOKEN_ENC_KEY/.test(blob));
    } finally { q.restore(); }
  });
});
