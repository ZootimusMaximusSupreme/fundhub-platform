// POST /api/marketing-flags — the real handler, run with no Postgres.
//
// The Sales dashboard's "flag this objection" button stores a pattern for the
// marketing side. Only a mocked browser call ever touched it. This runs the door.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/marketing-flags.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { fakeDb, makeRes, req, staffSession, ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";

async function call(request, rules) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await handler(request, res, { db: fake });
  return { res, fake };
}

const GOOD = {
  belief: "cost", lead_source: "meta", setter_label: "Josh", outcome_count: "4",
  period_start: "2026-10-01", period_end: "2026-10-07", note: "price came up on 4 calls"
};

describe("POST /api/marketing-flags", () => {
  test("is routed", () => {
    assert.equal(ROUTES["marketing-flags"], handler);
  });

  test("GET is refused", async () => {
    const { res } = await call(req("GET"), [staffSession()]);
    assert.equal(res.statusCode, 405);
  });

  test("no session: 401", async () => {
    const { res, fake } = await call(req("POST", { body: GOOD }), []);
    assert.equal(res.statusCode, 401);
    assert.equal(fake.find(/marketing_flags/).length, 0);
  });

  test("a closer cannot file a flag (FINANCE gate)", async () => {
    const { res, fake } = await call(req("POST", { body: GOOD }), [staffSession({ role: "closer" })]);
    assert.equal(res.statusCode, 403);
    assert.equal(fake.find(/marketing_flags/).length, 0);
  });

  test("a good flag is stored for this company and this person: 201", async () => {
    const { res, fake } = await call(
      req("POST", { body: GOOD }),
      [staffSession({ role: "sales_manager" }),
        [/INSERT INTO marketing_flags/, (_s, p) => [{ id: "f1", org_id: p[0], flagged_by: p[1], belief: p[2] }]]]
    );
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.flag.belief, "cost");
    const [ins] = fake.find(/INSERT INTO marketing_flags/);
    assert.deepEqual(ins.params, [ORG_ID, STAFF_ID, "cost", "meta", "Josh", 4, "2026-10-01", "2026-10-07", "price came up on 4 calls"]);
  });

  test("a belief that is not on the list is refused: 400, nothing stored", async () => {
    const { res, fake } = await call(
      req("POST", { body: { ...GOOD, belief: "astrology" } }),
      [staffSession()]
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "bad_request");
    assert.equal(fake.find(/INSERT INTO marketing_flags/).length, 0);
  });

  test("no period: 400, nothing stored", async () => {
    const { res, fake } = await call(
      req("POST", { body: { ...GOOD, period_end: "" } }),
      [staffSession()]
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /period_start and period_end/);
    assert.equal(fake.find(/INSERT INTO marketing_flags/).length, 0);
  });

  // The page can offer a belief with no calls behind it ("pain this period 0 vs last 0",
  // no lead source, no setter). Such a flag can never match a real call, so it is refused.
  const NO_CALLS = "There are no calls behind this belief yet, so there is nothing to flag.";
  for (const [label, patch] of [
    ["an outcome count of 0", { outcome_count: 0 }],
    ["an outcome count of 0 sent as text", { outcome_count: "0" }],
    ["no outcome count", { outcome_count: undefined }],
    ["a count that is not a number", { outcome_count: "many" }],
    ["a negative count", { outcome_count: -3 }],
    ["no lead source", { lead_source: undefined }],
    ["an empty lead source", { lead_source: "   " }],
    ["no setter", { setter_label: undefined }],
    ["an empty setter", { setter_label: "" }]
  ]) {
    test(`a flag with ${label} is refused: 400, nothing stored`, async () => {
      const { res, fake } = await call(
        req("POST", { body: { ...GOOD, ...patch } }),
        [staffSession({ role: "sales_manager" }),
          [/INSERT INTO marketing_flags/, () => [{ id: "f1" }]]]
      );
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.message, NO_CALLS);
      assert.equal(fake.find(/INSERT INTO marketing_flags/).length, 0);
    });
  }

  test("a flag with one real call, a lead source and a setter is stored: 201", async () => {
    const { res, fake } = await call(
      req("POST", { body: { ...GOOD, outcome_count: 1 } }),
      [staffSession({ role: "sales_manager" }),
        [/INSERT INTO marketing_flags/, (_s, p) => [{ id: "f2", org_id: p[0], flagged_by: p[1], belief: p[2] }]]]
    );
    assert.equal(res.statusCode, 201);
    assert.equal(fake.find(/INSERT INTO marketing_flags/).length, 1);
  });
});
