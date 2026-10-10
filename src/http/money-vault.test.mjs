// /api/money/vault — the gate for both callers, the read (a client's own file, staff
// for any client in their org), and the staff-only writes. Stubbed principal, db and
// logic: the logic itself is covered by src/finance/document-vault.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler, { ACTIONS } from "../../api/money/vault.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { VaultError } from "../finance/document-vault.mjs";

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const MINE = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const DOC = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BIZ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORG = "org-1";
const STAFF_ID = "5aff0000-0000-4000-8000-000000000001";

const clientP = (clientId = MINE) => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId });
const staffP = (role) => ({ kind: "staff", staffId: STAFF_ID, role, orgId: ORG, staff: { id: STAFF_ID, role, org_id: ORG } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};
const db = (inOrg = [MINE]) => ({
  query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: inOrg.includes(params[0]) ? [{ "?column?": 1 }] : [] } : { rows: [] })
});

const VIEW = { ok: true, audience: "client", complete: false, items: [], unfiled: [], summary: { required: 3 } };
const NOW = () => new Date("2026-10-07T12:00:00Z");

function spies(over = {}) {
  const calls = {};
  const rec = (name, ret) => async (_db, args) => { (calls[name] ||= []).push(args); return typeof ret === "function" ? ret(args) : ret; };
  return {
    calls,
    deps: {
      readVault: rec("read", (a) => ({ ...VIEW, audience: a.audience })),
      decideDocument: rec("decide", { id: "r1", status: "accepted", lines: ["id_document:client"] }),
      addCustomItem: rec("add", { id: "i1", item_key: "custom_ab12cd34" }),
      retireItem: rec("retire", { id: "i1" }),
      waiveItem: rec("waive", { id: "w1", created: true }),
      unwaiveItem: rec("unwaive", { id: "w1" }),
      ...over
    }
  };
}
async function call(req, principal, { inOrg, s = spies(), headers = { host: "app.example" } } = {}) {
  const res = makeRes();
  await handler({ headers, ...req }, res, { db: db(inOrg), requirePrincipal: gateAs(principal), now: NOW, env: {}, ...s.deps });
  return { res, calls: s.calls };
}

describe("/api/money/vault", () => {
  test("is routed", () => {
    assert.equal(typeof ROUTES["money/vault"], "function");
  });

  test("GET as a client: their own file, read as a client, signing links against this host", async () => {
    const { res, calls } = await call({ method: "GET", query: { client_id: OTHER } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.audience, "client");
    assert.equal(calls.read[0].clientId, MINE, "the session, never the query");
    assert.equal(calls.read[0].orgId, ORG);
    assert.equal(calls.read[0].audience, "client");
    assert.deepEqual(calls.read[0].sign, { baseUrl: "https://app.example" });
    assert.equal(calls.decide, undefined, "a read never writes");
  });

  test("GET as staff FINANCE: any client in their org, read as staff", async () => {
    const { res, calls } = await call({ method: "GET", query: { client_id: MINE } }, staffP("owner"));
    assert.equal(res.statusCode, 200);
    assert.equal(calls.read[0].audience, "staff");
    assert.equal(calls.read[0].clientId, MINE);
  });

  test("staff need a client_id, a client in their org, and the FINANCE role", async () => {
    assert.equal((await call({ method: "GET", query: {} }, staffP("admin"))).res.statusCode, 400);
    assert.equal((await call({ method: "GET", query: { client_id: "not-a-uuid" } }, staffP("admin"))).res.statusCode, 400);
    assert.equal((await call({ method: "GET", query: { client_id: OTHER } }, staffP("owner"))).res.statusCode, 404, "another org's client is 404, not 403");
    for (const role of ["setter", "csm", "setter", "funding_advisor"]) {
      const { res, calls } = await call({ method: "GET", query: { client_id: MINE } }, staffP(role));
      assert.equal(res.statusCode, 403, role);
      assert.equal(calls.read, undefined, role);
    }
  });

  test("no login is 401; a login with no client file is 403; a client the read cannot find is 404", async () => {
    assert.equal((await call({ method: "GET", query: {} }, null)).res.statusCode, 401);
    assert.equal((await call({ method: "GET", query: {} }, clientP(null))).res.statusCode, 403);
    const missing = await call({ method: "GET", query: {} }, clientP(), { s: spies({ readVault: async () => null }) });
    assert.equal(missing.res.statusCode, 404);
  });

  test("a client cannot POST: accepting a paper is a person's job", async () => {
    for (const action of ACTIONS) {
      const { res, calls } = await call({ method: "POST", body: { action, document_id: DOC } }, clientP());
      assert.equal(res.statusCode, 403, action);
      assert.deepEqual(Object.keys(calls), [], action);
    }
  });

  test("POST accept: staff id and the typed units and date reach the logic, and the fresh vault comes back", async () => {
    const { res, calls } = await call(
      { method: "POST", body: { action: "accept", client_id: MINE, document_id: DOC, covers: 3, period_end: "2026-09-30", entity_id: BIZ, item_key: "bank_statements_business" } },
      staffP("admin")
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual([res.body.ok, res.body.action, res.body.result.status], [true, "accept", "accepted"]);
    assert.equal(res.body.vault.audience, "staff");
    const a = calls.decide[0];
    assert.deepEqual(
      [a.status, a.documentId, a.covers, a.periodEnd, a.entityId, a.itemKey, a.staffId, a.orgId, a.clientId],
      ["accepted", DOC, 3, "2026-09-30", BIZ, "bank_statements_business", STAFF_ID, ORG, MINE]
    );
    assert.equal(a.now.toISOString(), "2026-10-07T12:00:00.000Z");
  });

  test("POST reject: the reason goes through as the client-visible words", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "reject", client_id: MINE, document_id: DOC, reason: "Cut off" } }, staffP("owner"));
    assert.equal(res.statusCode, 200);
    assert.deepEqual([calls.decide[0].status, calls.decide[0].reason], ["rejected", "Cut off"]);
  });

  test("POST add_item, retire_item, waive and unwaive each reach their own function", async () => {
    const add = await call({ method: "POST", body: { action: "add_item", client_id: MINE, title: "Business license", note: "n", entity_id: BIZ, subtype: "business_license", need: 1 } }, staffP("owner"));
    assert.deepEqual([add.calls.add[0].title, add.calls.add[0].subtype, add.calls.add[0].entityId, add.calls.add[0].staffId], ["Business license", "business_license", BIZ, STAFF_ID]);
    const retire = await call({ method: "POST", body: { action: "retire_item", client_id: MINE, item_id: "x" } }, staffP("owner"));
    assert.equal(retire.calls.retire[0].itemId, "x");
    const waive = await call({ method: "POST", body: { action: "waive", client_id: MINE, item_key: "ein_letter", entity_id: BIZ, reason: "Sole prop" } }, staffP("owner"));
    assert.deepEqual([waive.calls.waive[0].itemKey, waive.calls.waive[0].entityId, waive.calls.waive[0].reason], ["ein_letter", BIZ, "Sole prop"]);
    const unwaive = await call({ method: "POST", body: { action: "unwaive", client_id: MINE, item_key: "ein_letter" } }, staffP("owner"));
    assert.equal(unwaive.calls.unwaive[0].itemKey, "ein_letter");
  });

  test("an unknown action, a body that is not JSON, and a missing action are 400", async () => {
    const bad = await call({ method: "POST", body: { action: "delete_everything", client_id: MINE } }, staffP("owner"));
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.error, "unknown_action");
    assert.equal((await call({ method: "POST", body: { client_id: MINE } }, staffP("owner"))).res.statusCode, 400);
    assert.equal((await call({ method: "POST", body: "{not json" }, staffP("owner"))).res.statusCode, 400);
  });

  test("the logic's plain refusals come back with their own status and words", async () => {
    const refuse = (code, status, message) => spies({ decideDocument: async () => { throw new VaultError(code, message, status); } });
    const { res } = await call(
      { method: "POST", body: { action: "accept", client_id: MINE, document_id: DOC } },
      staffP("owner"), { s: refuse("unfiled", 409, "send item_key") }
    );
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body, { ok: false, error: "unfiled", message: "send item_key" });
  });

  test("DELETE and PUT are 405", async () => {
    for (const method of ["DELETE", "PUT", "PATCH"]) {
      const { res } = await call({ method, query: {} }, clientP());
      assert.equal(res.statusCode, 405, method);
      assert.equal(res.headers.allow, "GET, POST");
    }
  });
});
