// Slice S3 proof: POST /api/closer-deck action=log_disposition. The closer
// records how the call ended; the real handler and real logic run, the
// database is a stand-in and the event bus insert is answered by it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import deckHandler from "../../api/closer-deck.mjs";
import { makeRes, fakeDb, ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";

async function log(body, { role = "closer", extra = [] } = {}) {
  const database = fakeDb([
    ...extra,
    [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, [{ "?column?": 1 }]],
    [/SELECT id, custom_fields FROM clients WHERE id = \$1 AND org_id = \$2/, [{ id: CLIENT, custom_fields: {} }]],
    [/INSERT INTO call_outcomes/, (_s, p) => [{ id: "co1", org_id: p[0], client_id: p[1], staff_id: p[2], task_id: p[3], outcome: p[5], cash_collected_cents: p[7], notes: p[11] }]],
    [/INSERT INTO events/, [{ id: "ev1" }]]
  ]);
  const res = makeRes();
  await deckHandler({ method: "POST", body: { client_id: CLIENT, ...body } }, res, {
    db: database, requireAuth: async () => ({ id: STAFF_ID, role, org_id: ORG_ID })
  });
  return { res, database };
}

describe("POST /api/closer-deck action=log_disposition", () => {
  test("records the call outcome for the offer pitched, with the deck's route, temperature and belief count, and stamps the file", async () => {
    const { res, database } = await log({ action: "log_disposition", offer_key: "FUNDING_DFY", route: "direct", temperature: 8, beliefs_count: 3, cost_of_inaction: "$4,000 a month" });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.action, "log_disposition");
    assert.equal(res.body.created, true);
    const [ins] = database.find(/INSERT INTO call_outcomes/);
    assert.deepEqual(ins.params.slice(0, 3), [ORG_ID, CLIENT, STAFF_ID]);
    assert.equal(ins.params[5], "deposit");
    const notes = JSON.parse(ins.params[11]);
    assert.equal(notes.closer_deck.offer_key, "FUNDING_DFY");
    assert.equal(notes.closer_deck.route, "direct");
    assert.equal(notes.closer_deck.temperature, 8);
    assert.equal(notes.closer_deck.beliefs_count, 3);
    assert.equal(notes.closer_deck.cost_of_inaction, "$4,000 a month");
    const [stamp] = database.find(/UPDATE clients SET custom_fields = custom_fields \|\|/);
    assert.equal(stamp.params[0], CLIENT);
    assert.equal(JSON.parse(stamp.params[1]).closer_deck_disposition.offer_key, "FUNDING_DFY");
    assert.equal(database.find(/INSERT INTO events/)[0].params[1], "call.completed");
  });

  test("any other offer is logged as a downsell, and an offer that does not exist is refused with nothing saved", async () => {
    const ok = await log({ action: "log_disposition", offer_key: "REPAIR_DFY" });
    assert.equal(ok.res.statusCode, 201);
    assert.equal(ok.database.find(/INSERT INTO call_outcomes/)[0].params[5], "downsell");
    const bad = await log({ action: "log_disposition", offer_key: "NOT_AN_OFFER" });
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.error, "unknown_offer");
    assert.equal(bad.database.find(/INSERT INTO call_outcomes/).length, 0);
  });

  test("a client from another company is a 404 and a setter cannot log", async () => {
    const database = fakeDb([[/SELECT 1 FROM clients/, []]]);
    const res = makeRes();
    await deckHandler({ method: "POST", body: { client_id: CLIENT, action: "log_disposition", offer_key: "FUNDING_DFY" } }, res, {
      db: database, requireAuth: async () => ({ id: STAFF_ID, role: "closer", org_id: ORG_ID })
    });
    assert.equal(res.statusCode, 404);
    assert.equal(database.find(/INSERT INTO call_outcomes/).length, 0);
    const setter = await log({ action: "log_disposition", offer_key: "FUNDING_DFY" }, { role: "setter" });
    assert.equal(setter.res.statusCode, 403);
  });
});
