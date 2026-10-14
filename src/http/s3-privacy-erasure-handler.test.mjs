// Slice S3 proof: POST /api/privacy/erasure. De-identify one client on a written
// request: the audit row first, then the identity, bank logins, accounts and the
// scrub of the ledger. The real handler and the real erasure logic run. The
// database is a stand-in that holds three clients' rows (this one, another in the
// same company, one in another company) and answers each statement by the id,
// company and client its SQL names. The proof is what is left on the other rows.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import erasureHandler from "../../api/privacy/erasure.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";
import { rowsWhere, tableRules } from "../testing/s3-scoped-rows.mjs";
import { req, staffSession, ORG_ID, OTHER_ORG_ID } from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const NEIGHBOUR = "c2000000-0000-4000-8000-000000000002";
const FOREIGN = "c3000000-0000-4000-8000-000000000003";
const REASON = "written request from the client, received by email on the 12th";

function world() {
  const person = (id, org, name) => ({ id, org_id: org, first_name: name, last_name: name, email: `${name}@example.test`, phone: "+15555550100", custom_fields: { note: "x" }, tags: ["a"] });
  const tables = {
    clients: [person(CLIENT, ORG_ID, "Dana"), person(NEIGHBOUR, ORG_ID, "Omar"), person(FOREIGN, OTHER_ORG_ID, "Ines")],
    pii_identity: [CLIENT, NEIGHBOUR, FOREIGN].map((id) => ({ client_id: id, ssn: "x" })),
    plaid_items: [CLIENT, NEIGHBOUR, FOREIGN].map((id, i) => ({ id: `p${i}`, client_id: id, org_id: id === FOREIGN ? OTHER_ORG_ID : ORG_ID })),
    bank_accounts: [CLIENT, NEIGHBOUR, FOREIGN].map((id, i) => ({ id: `a${i}`, client_id: id, org_id: id === FOREIGN ? OTHER_ORG_ID : ORG_ID })),
    bank_transactions: [CLIENT, NEIGHBOUR, FOREIGN].map((id, i) => ({
      id: `t${i}`, client_id: id, subject_client_id: id, org_id: id === FOREIGN ? OTHER_ORG_ID : ORG_ID, merchant_name: "Shell", raw: { a: 1 }
    }))
  };
  const audit = [];
  const scrub = (row) => Object.assign(row, { merchant_name: null, raw: {} });
  const erase = (row, params) => Object.assign(row, { first_name: params[2], last_name: params[2], email: null, phone: null, custom_fields: {}, tags: [] });
  const counted = /^\s*SELECT\s+count\(\*\)::bigint\s+AS\s+n\s+FROM\s+(\w+)/i;
  const rules = [
    [(sql) => counted.test(sql), (sql, params) => [{ n: String(rowsWhere(tables[counted.exec(sql)[1]] || [], sql, params).length) }]],
    [/INSERT INTO erasure_requests/i, (_sql, p) => { audit.push({ org: p[0], client: p[1] }); return [{ id: "audit-1", created_at: "2026-10-13T00:00:00Z" }]; }],
    ...tableRules("clients", tables.clients, { set: erase }),
    ...tableRules("pii_identity", tables.pii_identity),
    ...tableRules("plaid_items", tables.plaid_items),
    ...tableRules("bank_accounts", tables.bank_accounts),
    ...tableRules("bank_transactions", tables.bank_transactions, { set: scrub })
  ];
  return { tables, audit, rules };
}
const erasing = (clientId, rules, role = "owner") => callShared(
  erasureHandler, req("POST", { body: { client_id: clientId, confirm_client_id: clientId, reason: REASON } }), [staffSession({ role }), ...rules]);
const ids = (rows, key = "client_id") => rows.map((r) => r[key]);

describe("POST /api/privacy/erasure", () => {
  test("de-identifies this client only: the other client's rows and the other company's are untouched", async () => {
    const { tables, audit, rules } = world();
    const { res, fake } = await erasing(CLIENT, rules);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.erased, true);
    // Each write also names the company, so a company-wide id slip cannot reach another company's row.
    const named = (re) => fake.find(re)[0];
    assert.match(named(/DELETE FROM plaid_items/).sql, /client_id = \$1 AND org_id = \$2/);
    assert.match(named(/DELETE FROM bank_accounts/).sql, /client_id = \$1 AND org_id = \$2/);
    assert.match(named(/UPDATE bank_transactions/).sql, /WHERE org_id = \$1 AND \(subject_client_id = \$2 OR client_id = \$2\)/);
    assert.match(named(/UPDATE clients/).sql, /WHERE id = \$1 AND org_id = \$2/);
    assert.deepEqual(audit, [{ org: ORG_ID, client: CLIENT }]);
    assert.deepEqual(ids(tables.pii_identity), [NEIGHBOUR, FOREIGN]);
    assert.deepEqual(ids(tables.plaid_items), [NEIGHBOUR, FOREIGN]);
    assert.deepEqual(ids(tables.bank_accounts), [NEIGHBOUR, FOREIGN]);
    const names = Object.fromEntries(tables.clients.map((c) => [c.id, c.first_name]));
    assert.deepEqual(names, { [CLIENT]: "[erased]", [NEIGHBOUR]: "Omar", [FOREIGN]: "Ines" });
    assert.deepEqual(tables.clients.find((c) => c.id === CLIENT), { id: CLIENT, org_id: ORG_ID, first_name: "[erased]", last_name: "[erased]", email: null, phone: null, custom_fields: {}, tags: [] });
    const scrubbed = Object.fromEntries(tables.bank_transactions.map((t) => [t.client_id, t.merchant_name]));
    assert.deepEqual(scrubbed, { [CLIENT]: null, [NEIGHBOUR]: "Shell", [FOREIGN]: "Shell" });
    assert.equal(tables.bank_transactions.length, 3, "the ledger rows stay");
    const removed = Object.fromEntries(res.body.removed.map((r) => [r.table, r.rows]));
    assert.deepEqual([removed.pii_identity, removed.plaid_items, removed.bank_accounts, removed.bank_transactions], [1, 1, 1, 1]);
  });

  test("a client of another company is a 404 and nothing is removed, audited or scrubbed", async () => {
    const { tables, audit, rules } = world();
    const { res } = await erasing(FOREIGN, rules);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(audit, []);
    assert.equal(tables.pii_identity.length, 3);
    assert.equal(tables.plaid_items.length, 3);
    assert.equal(tables.bank_accounts.length, 3);
    assert.ok(tables.clients.every((c) => c.first_name !== "[erased]"));
    assert.ok(tables.bank_transactions.every((t) => t.merchant_name === "Shell"));
  });

  test("the confirmation must repeat the client id, and only owner or admin may ask", async () => {
    const { tables, audit, rules } = world();
    const wrong = await callShared(erasureHandler, req("POST", { body: { client_id: CLIENT, confirm_client_id: NEIGHBOUR, reason: REASON } }), [staffSession({ role: "owner" }), ...rules]);
    assert.equal(wrong.res.statusCode, 400);
    const closer = await erasing(CLIENT, rules, "closer");
    assert.equal(closer.res.statusCode, 403);
    assert.deepEqual(audit, []);
    assert.equal(tables.pii_identity.length, 3);
  });
});
