import { test, describe } from "node:test";
import assert from "node:assert";
import { hasDisputeAuthorization, hasRepairAgreement, currentRepairMailAuthorizationSql, hasCurrentRepairMailAuthorization } from "./dispute-auth.mjs";

function fakeDb(rows = []) {
  const calls = [];
  const queue = [...rows];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return queue.length ? queue.shift() : { rows: [] };
    }
  };
}

describe("hasDisputeAuthorization", () => {
  test("missing org is false and issues no query", async () => {
    const db = fakeDb([{ rows: [{ is_valid: true }] }]);
    assert.equal(await hasDisputeAuthorization(db, { clientId: "c" }), false);
    assert.deepEqual(db.calls, []);
  });

  test("missing client is false and issues no query", async () => {
    const db = fakeDb([{ rows: [{ is_valid: true }] }]);
    assert.equal(await hasDisputeAuthorization(db, { orgId: "o" }), false);
    assert.deepEqual(db.calls, []);
  });

  test("asks hasValidConsent for kind dispute_authorization", async () => {
    const db = fakeDb([{ rows: [] }]);
    assert.equal(await hasDisputeAuthorization(db, { orgId: "o", clientId: "c" }), false);
    assert.equal(db.calls.length, 1);
    assert.equal(db.calls[0].params[2], "dispute_authorization");
  });

  test("true when a valid consent row is on file", async () => {
    const db = fakeDb([{ rows: [{ is_valid: true }] }]);
    assert.equal(await hasDisputeAuthorization(db, { orgId: "o", clientId: "c" }), true);
  });
});

describe("hasRepairAgreement", () => {
  test("missing org is false and issues no query", async () => {
    const db = fakeDb([{ rows: [{ "?column?": 1 }] }]);
    assert.equal(await hasRepairAgreement(db, { clientId: "c" }), false);
    assert.deepEqual(db.calls, []);
  });

  test("true only from a signed repair contract", async () => {
    const db = fakeDb([{ rows: [{ "?column?": 1 }] }]);
    assert.equal(await hasRepairAgreement(db, { orgId: "o", clientId: "c" }), true);
    assert.equal(db.calls.length, 1);
    assert.match(db.calls[0].text, /FROM contracts/i);
  });

  test("staff consent or enroll is not a signed repair agreement", async () => {
    const db = fakeDb([{ rows: [] }]);
    assert.equal(await hasRepairAgreement(db, { orgId: "o", clientId: "c" }), false);
    assert.equal(db.calls.length, 1);
    assert.match(db.calls[0].text, /FROM contracts/i);
  });

  test("false when nothing is on file", async () => {
    const db = fakeDb([{ rows: [] }]);
    assert.equal(await hasRepairAgreement(db, { orgId: "o", clientId: "c" }), false);
  });
});


describe("final same-statement dispute-mail authorization", () => {
  test("reuses signed repair and canonical current consent validity with scoped binds", () => {
    const sql = currentRepairMailAuthorizationSql(2, 3);
    for (const term of ["c.org_id = $2::uuid", "c.client_id = $3::uuid",
      "c.status = 'signed'", "t.subtype = 'credit_repair'",
      "org_id = $2::uuid AND client_id = $3::uuid", "kind = 'dispute_authorization'",
      "revoked_at IS NULL", "expires_at > now()", "granted_at <= now()"])
      assert.ok(sql.includes(term), term);
    assert.throws(() => currentRepairMailAuthorizationSql(0, 3), TypeError);
  });
  test("final authorization read fails closed on invalid input or database error", async () => {
    const db = { query: async (sql, params) => {
      assert.match(sql, /SELECT \(EXISTS/);
      assert.deepEqual(params, ["org", "client"]);
      return { rows: [{ authorized: true }] };
    } };
    assert.equal(await hasCurrentRepairMailAuthorization(db, { orgId: "org", clientId: "client" }), true);
    assert.equal(await hasCurrentRepairMailAuthorization(db, { orgId: "org" }), false);
    assert.equal(await hasCurrentRepairMailAuthorization({ query: async () => { throw Error("db offline"); } },
      { orgId: "org", clientId: "client" }), false);
  });
});
