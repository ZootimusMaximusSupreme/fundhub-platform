// POST /api/ai-bureau-config — the real handler, run with no Postgres.
//
// The Save on the Lenders desk bureau row writes the number and the phone-menu
// path the AI inquiry caller is meant to dial with a client's details. Only the
// read side was ever tested. This runs the write door.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/ai-bureau-config.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import {
  fakeDb, makeRes, req, staffSession, ORG_ID, OTHER_ORG_ID
} from "../testing/handler-harness.mjs";

const ROW_ID = "b0000000-0000-4000-8000-000000000001";

async function call(request, rules) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await handler(request, res, { db: fake });
  return { res, fake };
}

describe("POST /api/ai-bureau-config", () => {
  test("is routed", () => {
    assert.equal(ROUTES["ai-bureau-config"], handler);
  });

  test("GET is refused", async () => {
    const { res } = await call(req("GET"), [staffSession()]);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "POST");
  });

  test("no session: 401, nothing written", async () => {
    const { res, fake } = await call(req("POST", { body: { action: "save", id: ROW_ID } }), []);
    assert.equal(res.statusCode, 401);
    assert.equal(fake.find(/ai_bureau_config/).length, 0);
  });

  test("a closer cannot change the number the AI dials", async () => {
    const { res, fake } = await call(
      req("POST", { body: { action: "save", id: ROW_ID, patch: { service_number: "+18005551212" } } }),
      [staffSession({ role: "closer" })]
    );
    assert.equal(res.statusCode, 403);
    assert.equal(fake.find(/ai_bureau_config/).length, 0);
  });

  test("Save on a row: only the editable fields change, inside the staff member's company", async () => {
    const { res, fake } = await call(
      req("POST", {
        body: {
          action: "save", id: ROW_ID,
          patch: { service_number: "+18005551212", menu_path: "1,3,2", org_id: OTHER_ORG_ID, id: "evil", retry_limit: "4" }
        }
      }),
      [staffSession({ role: "funding_advisor" }),
        [/UPDATE ai_bureau_config/, (_s, p) => [{ id: ROW_ID, org_id: p[0], bureau_code: "EX", service_number: p[2], menu_path: p[3], retry_limit: "4", active: true }]]]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.config.service_number, "+18005551212");
    assert.equal(res.body.config.retry_limit, 4);
    const [upd] = fake.find(/UPDATE ai_bureau_config/);
    assert.match(upd.sql, /service_number = \$3, menu_path = \$4, retry_limit = \$5/);
    assert.doesNotMatch(upd.sql, /org_id = \$\d+,/);
    assert.match(upd.sql, /WHERE org_id = \$1::uuid AND id = \$2::uuid/);
    assert.deepEqual(upd.params, [ORG_ID, ROW_ID, "+18005551212", "1,3,2", 4]);
  });

  test("Save on a row that is not in this company: 404", async () => {
    const { res } = await call(
      req("POST", { body: { action: "save", id: ROW_ID, patch: { menu_path: "9" } } }),
      [staffSession(), [/UPDATE ai_bureau_config/, []]]
    );
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "not_found");
  });

  test("upsert a new bureau: the code is upper-cased and the company comes from the session", async () => {
    const { res, fake } = await call(
      req("POST", { body: { bureau_code: "tu", bureau_name: "TransUnion", service_number: "+18008884213", org_id: OTHER_ORG_ID } }),
      [staffSession(),
        [/SELECT id FROM ai_bureau_config/, []],
        [/INSERT INTO ai_bureau_config/, (_s, p) => [{ id: ROW_ID, org_id: p[0], bureau_code: p[1], bureau_name: p[2], service_number: p[3], active: true }]]]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.config.bureau_code, "TU");
    const [ins] = fake.find(/INSERT INTO ai_bureau_config/);
    assert.equal(ins.params[0], ORG_ID);
    assert.equal(ins.params[1], "TU");
    assert.equal(ins.params[3], "+18008884213");
    assert.equal(ins.params[13], "Olive Owner");
  });

  test("upsert an existing bureau updates that row instead of adding a second", async () => {
    const { res, fake } = await call(
      req("POST", { body: { action: "upsert", bureau_code: "EX", bureau_name: "Experian", menu_path: "2,2" } }),
      [staffSession(),
        [/SELECT id FROM ai_bureau_config/, [{ id: ROW_ID }]],
        [/UPDATE ai_bureau_config/, (_s, p) => [{ id: p[1], bureau_code: "EX", menu_path: "2,2" }]]]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(fake.find(/INSERT INTO ai_bureau_config/).length, 0);
    assert.equal(fake.find(/UPDATE ai_bureau_config/)[0].params[1], ROW_ID);
  });

  test("upsert with no bureau code or name: 400, nothing written", async () => {
    const { res, fake } = await call(
      req("POST", { body: { action: "upsert", bureau_name: "" } }),
      [staffSession()]
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "bureau_required");
    assert.equal(fake.find(/ai_bureau_config/).length, 0);
  });
});
