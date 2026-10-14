// Slice S3 proofs: the repair desk's exceptions door. The held-for-a-person
// list, and a person confirming what a bureau response said. Real handler and
// real parse-loop logic against a stand-in database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import exceptionsHandler from "../../api/repair/exceptions.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";
import { req, staffSession, ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";

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

  test("the typed outcomes win over what the machine read", async () => {
    const { res, fake } = await callShared(exceptionsHandler, req("POST", { body: { action: "confirm_parse", responseId: RESPONSE, outcomes: [{ itemId: ITEM, outcome: "verified" }] } }), rules());
    assert.equal(res.statusCode, 200);
    const [moved] = fake.find(/UPDATE dispute_items SET status = \$2/);
    assert.deepEqual([moved.params[1], moved.params[2]], ["escalated", "R2"]);
  });
});
