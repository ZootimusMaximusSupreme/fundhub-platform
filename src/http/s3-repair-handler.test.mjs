// Slice S3 proofs: the repair desk's exceptions door. The held-for-a-person
// list, and a person confirming what a bureau response said. Real handler and
// real parse-loop logic against a stand-in database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import exceptionsHandler from "../../api/repair/exceptions.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";
import { tableRules, assertSqlHas } from "../testing/s3-scoped-rows.mjs";
import { req, staffSession, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const CASE = "1e000000-0000-4000-8000-000000000001";
const ITEM = "10000000-0000-4000-8000-000000000001";
const RESPONSE = "9e000000-0000-4000-8000-000000000001";

describe("GET /api/repair/exceptions", () => {
  test("lists this company's stalled repair cards and the bureau answers held for a person", async () => {
    const stalled = [{ card_id: "k1", client_id: CLIENT, email: "dana@example.test", stage_key: "stalled", updated_at: "2026-10-10T00:00:00.000Z" }];
    const held = [{ id: RESPONSE, case_id: CASE, client_id: CLIENT, confidence: 0.6, confirmed: false, created_at: "2026-10-12T00:00:00.000Z", held_for_escalation: false }];
    const { res, fake } = await callShared(exceptionsHandler, req("GET"), [
      staffSession({ role: "inquiry_specialist" }),
      [/FROM cards c\s+JOIN pipeline_stages ps/, stalled],
      [/FROM dispute_responses\s+WHERE org_id = \$1 AND COALESCE\(confirmed, false\) = false/, held]
    ]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, stalled, lowConfidenceParses: held });
    assert.deepEqual(fake.find(/FROM cards c/)[0].params, [ORG_ID]);
    assert.deepEqual(fake.find(/FROM dispute_responses/)[0].params, [ORG_ID]);
    assert.match(fake.find(/FROM dispute_responses/)[0].sql, /confidence < 0\.85/);
    assertSqlHas(fake.find(/FROM cards c/)[0].sql, {
      "only optimization pipelines": "JOIN pipelines p ON p.id = c.pipeline_id AND p.key = 'optimization'",
      "this company, the stalled stage, newest first, a page": "WHERE c.org_id = $1 AND ps.key = 'stalled' ORDER BY c.updated_at DESC LIMIT 100"
    });
    assertSqlHas(fake.find(/FROM dispute_responses/)[0].sql, {
      "this company, not yet confirmed": "WHERE org_id = $1 AND COALESCE(confirmed, false) = false",
      "says which are held for a person": "= 'true' AS held_for_escalation",
      "unsure, or held for a person to cross into R4": "AND ( (confidence IS NOT NULL AND confidence < 0.85) OR COALESCE(parse_json->>'heldForEscalation', 'false') = 'true' )",
      "newest first, a page": "ORDER BY created_at DESC LIMIT 100"
    });
  });

  test("a closer is refused and nothing is read", async () => {
    const { res, fake } = await callShared(exceptionsHandler, req("GET"), [staffSession({ role: "closer" }), [/FROM cards c/, [{ card_id: "k1" }]]]);
    assert.equal(res.statusCode, 403);
    assert.equal(fake.find(/FROM cards c/).length, 0);
  });
});

describe("POST /api/repair/exceptions action=confirm_parse", () => {
  const response = (over = {}) => ({
    id: RESPONSE, org_id: ORG_ID, client_id: CLIENT, case_id: CASE, confirmed: false, confidence: 0.6,
    parse_json: { outcomes: [{ itemId: ITEM, outcome: "deleted" }], confidence: 0.6, needsConfirm: true }, ...over
  });
  const item = { id: ITEM, case_id: CASE, org_id: ORG_ID, client_id: CLIENT, creditor: "Midland", account_last4: "4521", round: "R1", status: "sent", bureau: "EX" };
  const rules = (over = {}) => [
    staffSession({ role: "inquiry_specialist" }),
    [/SELECT \* FROM dispute_responses WHERE id = \$1 AND org_id = \$2/, over.response ?? [response()]],
    [/FROM dispute_items di\s+JOIN dispute_cases dc/, over.items ?? [item]]
  ];

  test("a person's confirmation moves the item, marks the response confirmed by them, and nothing else is touched", async () => {
    const { res, fake } = await callShared(exceptionsHandler, req("POST", { body: { action: "confirm_parse", responseId: RESPONSE } }), rules());
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, "advanced");
    assert.equal(res.body.responseId, RESPONSE);
    assertSqlHas(fake.find(/FROM dispute_items di\s+JOIN dispute_cases dc/)[0].sql, {
      "this company's, this client's open items, oldest first": "WHERE di.org_id = $1 AND di.client_id = $2 AND di.status = ANY($3::text[]) ORDER BY di.created_at ASC"
    });
    const [moved] = fake.find(/UPDATE dispute_items SET status = \$2/);
    assert.equal(moved.params[0], ITEM);
    assert.equal(moved.params[1], "deleted");
    const [confirm] = fake.find(/UPDATE dispute_responses SET confirmed = true/);
    assert.deepEqual(confirm.params, [RESPONSE, STAFF_ID, ORG_ID]);
  });

  test("an answer already confirmed is not applied twice, and an id from another company is refused", async () => {
    const again = await callShared(exceptionsHandler, req("POST", { body: { action: "confirm_parse", responseId: RESPONSE } }), rules({ response: [response({ confirmed: true })] }));
    assert.equal(again.res.statusCode, 200);
    assert.equal(again.res.body.status, "already_confirmed");
    assert.equal(again.fake.find(/UPDATE dispute_items/).length, 0);
    const other = await callShared(exceptionsHandler, req("POST", { body: { action: "confirm_parse", responseId: RESPONSE } }), rules({ response: [] }));
    assert.equal(other.res.statusCode, 400);
    assert.equal(other.res.body.error, "not_found");
    assert.equal(other.fake.find(/UPDATE dispute_items|UPDATE dispute_responses/).length, 0);
  });

  // Two bureau answers with their own ids in two companies. The stand-in table answers by id and
  // company, so the refusal and the untouched row come from the product's own SQL.
  test("an answer of another company is not found and stays unconfirmed; this company's is confirmed alone", async () => {
    const answers = [response(), response({ id: "9e000000-0000-4000-8000-000000000002", org_id: OTHER_ORG_ID })];
    const run = (id) => callShared(exceptionsHandler, req("POST", { body: { action: "confirm_parse", responseId: id } }), [
      staffSession({ role: "inquiry_specialist" }),
      [/FROM dispute_items di\s+JOIN dispute_cases dc/, [item]],
      ...tableRules("dispute_responses", answers, { set: (row) => { row.confirmed = true; } })
    ]);
    const foreign = await run("9e000000-0000-4000-8000-000000000002");
    assert.equal(foreign.res.statusCode, 400);
    assert.equal(foreign.res.body.error, "not_found");
    assert.deepEqual(answers.map((a) => a.confirmed), [false, false]);
    assert.equal(foreign.fake.find(/UPDATE dispute_items/).length, 0);
    const own = await run(RESPONSE);
    assert.equal(own.res.statusCode, 200);
    assert.deepEqual(answers.map((a) => a.confirmed), [true, false]);
  });

  test("the typed outcomes win over what the machine read", async () => {
    const { res, fake } = await callShared(exceptionsHandler, req("POST", { body: { action: "confirm_parse", responseId: RESPONSE, outcomes: [{ itemId: ITEM, outcome: "verified" }] } }), rules());
    assert.equal(res.statusCode, 200);
    const [moved] = fake.find(/UPDATE dispute_items SET status = \$2/);
    assert.deepEqual([moved.params[1], moved.params[2]], ["escalated", "R2"]);
  });
});
