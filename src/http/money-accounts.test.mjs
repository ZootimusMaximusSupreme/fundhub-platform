// /api/money/accounts — endpoint tests for both callers. Stubbed principal and
// an in-memory db that knows two clients in one org. No network, no Postgres.
// The rules are tested in src/finance/money-accounts.test.mjs,
// src/finance/business-info.test.mjs and src/finance/containers.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/money/accounts.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const ORG = "org-1";
const MINE = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const MY_BIZ = "aaaaaaaa-0000-0000-0000-000000000001";
const THEIR_BIZ = "aaaaaaaa-0000-0000-0000-000000000002";
const MY_ACCT = "bbbbbbbb-0000-0000-0000-000000000001";
const THEIR_ACCT = "bbbbbbbb-0000-0000-0000-000000000002";

const clientPrincipal = (clientId = MINE) => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId });
const staffPrincipal = (role) => ({ kind: "staff", role, orgId: ORG, staff: { id: "s1", role, org_id: ORG } });

const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};

/* Two clients, one org. Each has a business container and one account. The db
   answers like Postgres would for the WHERE clauses this endpoint's modules
   send, and records every write. */
function twoClientDb() {
  const entities = [
    { id: MY_BIZ, client_id: MINE, kind: "business", name: "Mine LLC", archived_at: null },
    { id: THEIR_BIZ, client_id: OTHER, kind: "business", name: "Theirs LLC", archived_at: null }
  ];
  const accounts = [
    { id: MY_ACCT, client_id: MINE, name: "My Checking", account_type: "depository", entity_id: null, entity_kind: "unknown" },
    { id: THEIR_ACCT, client_id: OTHER, name: "Their Checking", account_type: "depository", entity_id: THEIR_BIZ, entity_kind: "business" }
  ];
  const writes = [];
  const reads = [];
  const db = {
    writes, reads,
    query: async (sql, p = []) => {
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes.push({ sql, p });
      else reads.push({ sql, p });
      if (/FROM clients/.test(sql)) return { rows: [MINE, OTHER].includes(p[0]) ? [{ "?column?": 1 }] : [] };
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      if (/count\(\*\)/.test(sql)) return { rows: [{ n: 0 }] };
      if (/FROM entities\s+WHERE org_id = \$1 AND client_id = \$2/.test(sql)) {
        return { rows: entities.filter((e) => e.client_id === p[1]) };
      }
      if (/FROM entities WHERE id = \$1 AND org_id = \$2 AND client_id = \$3/.test(sql)) {
        return { rows: entities.filter((e) => e.id === p[0] && e.client_id === p[2]) };
      }
      if (/FROM entities WHERE id = \$1 AND org_id = \$2/.test(sql)) {
        return { rows: entities.filter((e) => e.id === p[0]) };
      }
      if (/FROM entities WHERE id = \$1 AND org_id = \$2 AND client_id = \$3\s+FOR UPDATE/.test(sql)) {
        return { rows: entities.filter((e) => e.id === p[0] && e.client_id === p[2]) };
      }
      if (/UPDATE entities SET name/.test(sql)) {
        const e = entities.find((x) => x.id === p[0] && (p[3] === null || x.client_id === p[3]));
        return { rows: e ? [{ ...e, name: p[2] }] : [] };
      }
      if (/SELECT id, client_id, entity_id, entity_kind, entity_kind_source/.test(sql)) {
        return { rows: accounts.filter((a) => a.id === p[0]) };
      }
      if (/UPDATE bank_accounts\s+SET entity_id = NULL/.test(sql)) {
        const a = accounts.find((x) => x.id === p[0] && (p[2] === null || x.client_id === p[2]));
        return { rows: a ? [{ id: a.id, client_id: a.client_id }] : [] };
      }
      if (/UPDATE bank_accounts/.test(sql)) {
        const a = accounts.find((x) => x.id === p[0]);
        return { rows: a ? [{ id: a.id, client_id: a.client_id, entity_id: p[2], entity_kind: p[3] }] : [] };
      }
      if (/INSERT INTO entities/.test(sql)) {
        const e = { id: "eeeeeeee-0000-0000-0000-000000000009", client_id: p[1], kind: p[2], name: p[3], archived_at: null };
        entities.push(e);
        return { rows: [e] };
      }
      if (/INSERT INTO bank_accounts/.test(sql)) return { rows: [{ id: "new-acct" }] };
      if (/INSERT INTO businesses/.test(sql)) return { rows: [{ id: "new-biz" }] };
      if (/FROM entities/.test(sql)) {
        const e = entities.find((x) => x.id === p[0] && x.client_id === p[2]);
        return { rows: e ? [e] : [] };
      }
      return { rows: [] };
    }
  };
  return db;
}

const call = async (principal, req, db = twoClientDb()) => {
  const res = makeRes();
  await handler({ query: {}, ...req }, res, { db, requirePrincipal: gateAs(principal), env: {}, now: () => new Date("2026-10-06T12:00:00Z") });
  return { res, db };
};

describe("/api/money/accounts — a client manages only their own file", () => {
  test("GET reads the session's file; ?client_id of another client is ignored", async () => {
    const { res, db } = await call(clientPrincipal(), { method: "GET", query: { client_id: OTHER } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.client_id, MINE);
    assert.deepEqual(res.body.containers.map((c) => c.id), [MY_BIZ]);
    assert.equal(db.reads.some((r) => r.p.includes(OTHER)), false, "the other client was never even queried");
  });

  test("a client_id in the POST body is ignored: the new business lands on the session's client", async () => {
    const { res, db } = await call(clientPrincipal(), {
      method: "POST", body: { action: "create_business", client_id: OTHER, name: "New Co", info: { ein_last4: "0000" } }
    });
    assert.equal(res.statusCode, 201);
    const ins = db.writes.find((w) => /INSERT INTO entities/.test(w.sql));
    assert.equal(ins.p[1], MINE);
    const biz = db.writes.find((w) => /INSERT INTO businesses/.test(w.sql));
    assert.equal(biz.p[1], MINE);
  });

  test("cannot move another client's account → 404, nothing written", async () => {
    const { res, db } = await call(clientPrincipal(), {
      method: "POST", body: { action: "assign", account_id: THEIR_ACCT, container_id: MY_BIZ }
    });
    assert.equal(res.statusCode, 404);
    assert.equal(db.writes.length, 0);
  });

  test("cannot move own account into another client's container → 404, nothing written", async () => {
    const { res, db } = await call(clientPrincipal(), {
      method: "POST", body: { action: "assign", account_id: MY_ACCT, container_id: THEIR_BIZ }
    });
    assert.equal(res.statusCode, 404);
    assert.equal(db.writes.length, 0);
  });

  test("cannot unassign another client's account → 404, no row changed", async () => {
    const { res } = await call(clientPrincipal(), { method: "POST", body: { action: "unassign", account_id: THEIR_ACCT } });
    assert.equal(res.statusCode, 404);
  });

  test("cannot rename another client's container → 404", async () => {
    const { res } = await call(clientPrincipal(), { method: "POST", body: { action: "rename", container_id: THEIR_BIZ, name: "Mine now" } });
    assert.equal(res.statusCode, 404);
  });

  test("cannot write business info onto another client's container → 404, nothing written", async () => {
    const { res, db } = await call(clientPrincipal(), {
      method: "POST", body: { action: "save_business", container_id: THEIR_BIZ, info: { ein_last4: "1234" } }
    });
    assert.equal(res.statusCode, 404);
    assert.equal(db.writes.length, 0);
  });

  test("cannot add an account into another client's container → 404, nothing written", async () => {
    const { res, db } = await call(clientPrincipal(), {
      method: "POST", body: { action: "add_account", name: "Card", type: "credit_card", container_id: THEIR_BIZ }
    });
    assert.equal(res.statusCode, 404);
    assert.equal(db.writes.length, 0);
  });

  test("own account into own container works, stamped client_stated", async () => {
    const { res, db } = await call(clientPrincipal(), {
      method: "POST", body: { action: "assign", account_id: MY_ACCT, container_id: MY_BIZ }
    });
    assert.equal(res.statusCode, 200);
    const up = db.writes.find((w) => /UPDATE bank_accounts/.test(w.sql));
    assert.equal(up.p[4], "client_stated");
  });

  test("a full account number, a full EIN, an SSN or an org_id is refused", async () => {
    for (const body of [
      { action: "add_account", name: "X", type: "checking", account_number: "123456789" },
      { action: "save_business", container_id: MY_BIZ, info: { ein: "12-3456789" } },
      { action: "save_business", container_id: MY_BIZ, info: { ssn: "123-45-6789" } },
      { action: "create_personal", name: "Me", org_id: "org-2" }
    ]) {
      const { res, db } = await call(clientPrincipal(), { method: "POST", body });
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.equal(db.writes.length, 0);
    }
  });

  test("a login with no client file is refused", async () => {
    const { res } = await call(clientPrincipal(null), { method: "GET" });
    assert.equal(res.statusCode, 403);
  });
});

describe("/api/money/accounts — staff", () => {
  test("FINANCE role reads the named client", async () => {
    const { res } = await call(staffPrincipal("owner"), { method: "GET", query: { client_id: OTHER } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.client_id, OTHER);
  });

  test("a staff role outside FINANCE is refused", async () => {
    const { res } = await call(staffPrincipal("closer"), { method: "GET", query: { client_id: MINE } });
    assert.equal(res.statusCode, 403);
  });

  test("staff must name a client", async () => {
    const { res } = await call(staffPrincipal("owner"), { method: "POST", body: { action: "create_personal", name: "X" } });
    assert.equal(res.statusCode, 400);
  });
});

describe("/api/money/accounts — the door", () => {
  test("no session → 401; other methods → 405; routed", async () => {
    let { res } = await call(null, { method: "GET" });
    assert.equal(res.statusCode, 401);
    ({ res } = await call(clientPrincipal(), { method: "DELETE" }));
    assert.equal(res.statusCode, 405);
    assert.equal(ROUTES["money/accounts"], handler);
  });
});
