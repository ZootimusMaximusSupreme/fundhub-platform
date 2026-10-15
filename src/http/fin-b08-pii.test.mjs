// finish-853 batch 08: GET/POST /api/pii. The real handler and the real src/pii/index.mjs run on
// a stand-in pii_identity and pii_access_log. The row's words: GET gives the masked identity (last
// four) or the access history; POST reveal needs a reason and is access-logged; POST store keeps
// the SSN encrypted; only owner, admin, inquiry specialist and funding advisor may call it.
// Practice test, fake data, no network, no database. (The handler has no company check: that is a
// product finding in the manifest, not something this test pins.)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import handler from "../../api/pii.mjs";
import { decryptSsn } from "../pii/index.mjs";
import { makeRes, req, runWithSharedDb, staffSession, accountSession, STAFF_ID, ORG_ID } from "../testing/handler-harness.mjs";
import { fakeDb } from "../testing/handler-harness.mjs";
import { bindProblem } from "../testing/s3-scoped-rows.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER = "c2000000-0000-4000-8000-000000000002";
const SSN = "123-45-6789";

const saved = process.env.PII_ENC_KEY;
before(() => { process.env.PII_ENC_KEY = crypto.randomBytes(32).toString("base64"); });
after(() => { if (saved === undefined) delete process.env.PII_ENC_KEY; else process.env.PII_ENC_KEY = saved; });

/** pii_identity and pii_access_log in memory; COALESCE and plain replace follow the statement's own SET list. */
function piiTables({ identities = [], log = [], failLog = false } = {}) {
  const state = { identities, log };
  const fake = fakeDb([
    [/^\s*SELECT id, org_id, client_id, ssn_enc, dob, addresses, created_at, updated_at\s+FROM pii_identity WHERE client_id = \$1/i,
      (_s, p) => identities.filter((r) => r.client_id === p[0]).map((r) => ({ ...r }))],
    [/^\s*SELECT org_id, ssn_enc FROM pii_identity WHERE client_id = \$1/i,
      (_s, p) => identities.filter((r) => r.client_id === p[0]).map((r) => ({ org_id: r.org_id, ssn_enc: r.ssn_enc }))],
    [/^\s*INSERT INTO pii_access_log/i, (_s, p) => {
      if (failLog) return new Error("log table is read-only");
      log.push({ org_id: p[0], client_id: p[1], accessed_by: p[2], field: p[3], created_at: `2026-10-14T12:0${log.length}:00Z` });
      return { rows: [], rowCount: 1 };
    }],
    [/^\s*SELECT id, accessed_by, field, created_at\s+FROM pii_access_log WHERE client_id = \$1\s+ORDER BY created_at DESC LIMIT \$2/i,
      (_s, p) => log.filter((r) => r.client_id === p[0]).slice().reverse().slice(0, p[1])],
    [/^\s*INSERT INTO pii_identity \(org_id, client_id, ssn_enc, dob, addresses\)/i, (s, p) => {
      const [org_id, client_id, ssn_enc, dob, addresses] = p;
      const incoming = { org_id, client_id, ssn_enc, dob, addresses: JSON.parse(addresses) };
      const existing = identities.find((r) => r.client_id === client_id);
      const list = /DO UPDATE SET([\s\S]*?)RETURNING/i.exec(s)[1];
      if (!existing) {
        const row = { id: `a0000000-0000-4000-8000-00000000000${identities.length + 1}`, ...incoming, created_at: "x", updated_at: "x" };
        identities.push(row);
        return [{ ...row, ssn_enc: undefined }];
      }
      for (const [, col, body] of list.matchAll(/([a-z_]+)\s*=\s*([^,]+?(?:\([^)]*\))?)\s*(?:,|$)/gi)) {
        if (col === "updated_at") continue;
        if (/COALESCE\(EXCLUDED\./i.test(body)) existing[col] = incoming[col] ?? existing[col];
        else if (/EXCLUDED\./i.test(body)) existing[col] = incoming[col];
      }
      return [{ ...existing, ssn_enc: undefined }];
    }],
  ]);
  const inner = fake.query;
  fake.query = async (sql, params = []) => {
    const text = typeof sql === "string" ? sql : (sql && sql.text) || "";
    const args = typeof sql === "string" ? params : (sql && sql.values) || params;
    const problem = bindProblem(text, args);
    if (problem) throw Object.assign(new Error(`bind: ${problem}`), { code: "08P01" });
    return inner(sql, params);
  };
  fake.connect = async () => ({ query: fake.query, release() {} });
  fake.state = state;
  return fake;
}

async function call(request, tables, who = [staffSession({ role: "owner" })]) {
  const fake = tables;
  fake.rules = who;
  const res = makeRes();
  const withSession = fakeDb([...who, [/.*/, (s, p) => null]]);
  // Session rules first, then the table stand-in, through one fake.
  const combined = { ...fake, query: async (sql, params) => {
    const text = typeof sql === "string" ? sql : sql.text;
    if (/FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/.test(text)) return withSession.query(sql, params);
    return fake.query(sql, params);
  }, connect: async () => ({ query: combined.query, release() {} }) };
  let error = null;
  await runWithSharedDb(combined, async () => {
    try { await handler(request, res); } catch (e) { error = e; }
  });
  return { res, fake, error };
}

const identity = (over = {}) => ({
  id: "a0000000-0000-4000-8000-000000000001", org_id: ORG_ID, client_id: CLIENT,
  ssn_enc: null, dob: "1985-02-03", addresses: [{ street: "1 Main St", state: "AZ" }], created_at: "x", updated_at: "x", ...over,
});
async function storedWithSsn() {
  const tables = piiTables();
  const { res } = await call(req("POST", { body: { client_id: CLIENT, action: "store", ssn: SSN, dob: "1985-02-03", addresses: [{ state: "AZ" }] } }), tables);
  assert.equal(res.statusCode, 200);
  return tables;
}

describe("/api/pii", () => {
  test("store keeps the SSN encrypted: the saved value is not the digits, it decrypts to them for this client only, and the answer carries no SSN", async () => {
    const tables = await storedWithSsn();
    const row = tables.state.identities[0];
    assert.equal(row.org_id, ORG_ID, "stored under the session's company");
    const stored = Buffer.isBuffer(row.ssn_enc) ? row.ssn_enc.toString("utf8") : String(row.ssn_enc);
    assert.doesNotMatch(stored, /123-?45-?6789/);
    assert.equal(decryptSsn(row.ssn_enc, { clientId: CLIENT }), "123456789");
    assert.throws(() => decryptSsn(row.ssn_enc, { clientId: OTHER }), "ciphertext is bound to one client");
    const again = await call(req("POST", { body: { client_id: CLIENT, action: "store", addresses: [] } }), tables);
    assert.equal(again.res.statusCode, 200);
    assert.equal(JSON.stringify(again.res.body).includes("123456789"), false);
    assert.equal(decryptSsn(tables.state.identities[0].ssn_enc, { clientId: CLIENT }), "123456789", "an update with no SSN keeps the one on file");
    assert.equal(tables.state.identities[0].dob, "1985-02-03", "an update with no date of birth keeps the one on file");
    const changed = await call(req("POST", { body: { client_id: CLIENT, action: "store", dob: "1990-01-01", addresses: [] } }), tables);
    assert.equal(changed.res.statusCode, 200);
    assert.equal(tables.state.identities[0].dob, "1990-01-01", "a new date of birth replaces the old one");
  });

  test("a store with a bad SSN is refused and nothing is saved", async () => {
    const tables = piiTables();
    const { res } = await call(req("POST", { body: { client_id: CLIENT, action: "store", ssn: "12345" } }), tables);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /9 digits/);
    assert.equal(tables.state.identities.length, 0);
  });

  test("GET returns the masked identity: last four only, no ciphertext, no full number", async () => {
    const tables = await storedWithSsn();
    const { res } = await call(req("GET", { query: { client_id: CLIENT } }), tables);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.identity.ssn_present, true);
    assert.equal(res.body.identity.ssn_last4, "6789");
    const blob = JSON.stringify(res.body);
    assert.doesNotMatch(blob, /123456789|123-45-6789|ssn_enc/);
    assert.deepEqual(tables.state.log, [], "a masked read is not an access-log entry");
  });

  test("reveal needs a reason: no reason is 400 with no log row and no number; a reason returns the SSN and writes one log row for the signed-in staff member", async () => {
    const tables = await storedWithSsn();
    const noReason = await call(req("POST", { body: { client_id: CLIENT, action: "reveal", reason: "   " } }), tables);
    assert.equal(noReason.res.statusCode, 400);
    assert.equal(JSON.stringify(noReason.res.body).includes("123456789"), false);
    assert.equal(tables.state.log.length, 0);

    const ok = await call(req("POST", { body: { client_id: CLIENT, action: "reveal", reason: "Bureau dispute call", accessed_by: "someone-else" } }), tables);
    assert.equal(ok.res.statusCode, 200);
    assert.equal(ok.res.body.ssn, "123456789");
    assert.equal(tables.state.log.length, 1);
    assert.equal(tables.state.log[0].accessed_by, STAFF_ID, "the session decides who is logged, never the request body");
    assert.equal(tables.state.log[0].client_id, CLIENT);
    assert.equal(tables.state.log[0].field, "ssn (Bureau dispute call)");
    const order = tables.calls.map((c) => c.sql.trim());
    const logAt = order.findIndex((s) => /^INSERT INTO pii_access_log/.test(s));
    const commitAt = order.lastIndexOf("COMMIT");
    assert.ok(logAt > -1 && commitAt > logAt, "the log row is written inside the transaction, before it commits");
  });

  test("when the access log cannot be written the number is not handed out, and the work is rolled back", async () => {
    const tables = piiTables({ failLog: true, identities: [] });
    await call(req("POST", { body: { client_id: CLIENT, action: "store", ssn: SSN } }), tables);
    const { res, error } = await call(req("POST", { body: { client_id: CLIENT, action: "reveal", reason: "Dispute call" } }), tables);
    assert.ok(error, "the failure is not swallowed");
    assert.equal(res.body, null, "no answer, so no number, went back");
    assert.equal(tables.count("ROLLBACK") >= 1, true);
  });

  test("reveal for a client with no identity or no SSN is 404", async () => {
    const none = await call(req("POST", { body: { client_id: CLIENT, action: "reveal", reason: "x" } }), piiTables());
    assert.equal(none.res.statusCode, 404);
    const noSsn = await call(req("POST", { body: { client_id: CLIENT, action: "reveal", reason: "x" } }), piiTables({ identities: [identity()] }));
    assert.equal(noSsn.res.statusCode, 404);
    assert.match(noSsn.res.body.error, /no SSN on file/);
  });

  test("history lists who revealed it, newest first", async () => {
    const tables = await storedWithSsn();
    await call(req("POST", { body: { client_id: CLIENT, action: "reveal", reason: "first" } }), tables);
    await call(req("POST", { body: { client_id: CLIENT, action: "reveal", reason: "second" } }), tables);
    const { res } = await call(req("GET", { query: { client_id: CLIENT, history: "1" } }), tables);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.access.map((a) => a.field), ["ssn (second)", "ssn (first)"]);
    assert.equal(res.body.access[0].accessed_by, STAFF_ID);
  });

  test("every staff role is tried: only owner, admin, inquiry specialist and funding advisor reach it; the identity table is not read for the rest", async () => {
    const letIn = [];
    for (const role of STAFF_ROLES) {
      const tables = piiTables({ identities: [identity()] });
      const { res } = await call(req("GET", { query: { client_id: CLIENT } }), tables, [staffSession({ role })]);
      if (res.statusCode === 403) assert.equal(tables.find(/pii_identity/).length, 0, `${role}: no read`);
      else letIn.push(role);
    }
    assert.deepEqual(letIn.sort(), ["admin", "funding_advisor", "inquiry_specialist", "owner"]);
    const client = await call(req("GET", { query: { client_id: CLIENT } }), piiTables(), accountSession({ kind: "client", clientId: CLIENT }));
    assert.equal(client.res.statusCode, 403);
    const nobody = await call(req("GET", { query: { client_id: CLIENT } }), piiTables(), []);
    assert.equal(nobody.res.statusCode, 401);
  });

  test("a client id that is not a uuid is refused before any table is read", async () => {
    const tables = piiTables();
    const { res } = await call(req("GET", { query: { client_id: "nope" } }), tables);
    assert.equal(res.statusCode, 400);
    assert.equal(tables.find(/pii_identity|pii_access_log/).length, 0);
  });
});
