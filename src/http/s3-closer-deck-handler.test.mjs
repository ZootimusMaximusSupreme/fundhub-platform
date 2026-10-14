// Slice S3 proof: POST /api/closer-deck action=log_disposition. The closer
// records how the call ended; the real handler and real logic run, the
// database is a stand-in and the event bus insert is answered by it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import deckHandler from "../../api/closer-deck.mjs";
import readDeck from "../../api/read/closer-deck.mjs";
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

describe("GET /api/read/closer-deck (the payload Present draws)", () => {
  async function read(rules, query = { client_id: CLIENT }, role = "closer") {
    const database = fakeDb([
      ...rules,
      [/FROM clients c\s+LEFT JOIN businesses b/, [{ id: CLIENT, first_name: "Dana", last_name: "Whitfield", outcome_tier: null, custom_fields: { total_funding_estimate: "199350" }, business_name: "Whitfield LLC" }]],
      [/FROM businesses\s+WHERE client_id = \$1 AND org_id = \$2/, [{ id: "b1", name: "Whitfield LLC", age_months: 30, incorporated_date: "2024-04" }]]
    ]);
    const res = makeRes();
    await readDeck({ method: "GET", query }, res, { db: database, requireAuth: async () => ({ id: STAFF_ID, role, org_id: ORG_ID }) });
    return { res, database };
  }
  const crs = [/FROM crs_results\s+WHERE client_id = \$1 AND org_id = \$2/, [{
    result: { outcome: "FULL_FUNDING", fundingEstimate: 150000, scores: { experian: 720, transunion: 711, equifax: 705 } },
    outcome_tier: "FULL_FUNDING", created_at: "2026-10-10T00:00:00.000Z"
  }]];

  test("the engine numbers come from the stored pull, the pre-approval is the one stored figure, and the company list is this client's", async () => {
    const { res, database } = await read([crs]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.client_id, CLIENT);
    assert.equal(res.body.engine.available, true);
    assert.deepEqual(res.body.engine.fico, { ex: 720, tu: 711, eq: 705 });
    assert.equal(res.body.engine.total, 199350);
    assert.equal(res.body.engine.totalBasis, "personal_plus_business");
    assert.equal(res.body.engine.totalSource, "stored engine estimate");
    assert.equal(res.body.survey.name, "Dana Whitfield");
    assert.deepEqual(res.body.businesses, [{ id: "b1", name: "Whitfield LLC", age_months: 30, incorporated_date: "2024-04" }]);
    assert.ok(res.body.offers.some((o) => o.key === "FUNDING_DFY"));
    assert.ok(res.body.soft_pull && typeof res.body.soft_pull === "object");
    for (const q of database.find(/FROM (clients c|crs_results|businesses)/)) assert.ok(q.params.includes(ORG_ID), q.sql);
  });

  test("a client from another company is a 404 and a setter is refused", async () => {
    const database = fakeDb([[/FROM clients c\s+LEFT JOIN businesses b/, []]]);
    const res = makeRes();
    await readDeck({ method: "GET", query: { client_id: CLIENT } }, res, { db: database, requireAuth: async () => ({ id: STAFF_ID, role: "closer", org_id: ORG_ID }) });
    assert.equal(res.statusCode, 404);
    const setter = await read([crs], { client_id: CLIENT }, "setter");
    assert.equal(setter.res.statusCode, 403);
    assert.equal(setter.database.find(/FROM clients c/).length, 0);
  });
});
