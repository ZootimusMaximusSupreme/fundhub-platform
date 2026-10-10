// POST /api/journeys/run — the real handler's safety rails, run with no Postgres.
//
// A journey run drives the real event bus inside ONE transaction that must
// always roll back, so a pretend client never lands next to a real one. The
// handler says "every exit passes through the rollback"; no test ever checked
// it. This one does, on every exit it can reach without walking a journey:
// the bad-journey refusal, a read that fails mid-run, and a pool that cannot
// hand out a connection. It also checks that demo rows never replace the six
// real journeys, and that nothing is ever committed.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/journeys/run.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { SEED_JOURNEYS } from "../journeys/seed-journeys.mjs";
import {
  fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID
} from "../testing/handler-harness.mjs";

const netCalls = [];
const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = async (u) => { netCalls.push(String(u)); throw new Error("network refused in this test"); }; });
after(() => { globalThis.fetch = realFetch; });

async function call(request, rules, opts) {
  const fake = fakeDb(rules, opts);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

const demoRowsOnly = [/FROM journeys WHERE org_id = \$1/, [
  { key: "demo-platform-nurture", name: "Demo nurture", nodes: [], is_demo: true },
  { key: "demo-platform-funding", name: "Demo funding", nodes: [], is_demo: true },
  { key: "mystery", name: "Not an editor journey", nodes: [], is_demo: false }
]];

describe("POST /api/journeys/run", () => {
  test("is routed", () => {
    assert.equal(ROUTES["journeys/run"], handler);
  });

  test("no session: 401, no connection opened", async () => {
    const { res, fake } = await call(req("POST", { body: {} }), []);
    assert.equal(res.statusCode, 401);
    assert.equal(fake.connected, 0);
  });

  test("a closer cannot start a run (owner, admin, sales manager only)", async () => {
    const { res, fake } = await call(req("POST", { body: {} }), [staffSession({ role: "closer" })]);
    assert.equal(res.statusCode, 403);
    assert.equal(fake.connected, 0);
  });

  test("GET is refused after the gate", async () => {
    const { res, fake } = await call(req("GET"), [staffSession()]);
    assert.equal(res.statusCode, 405);
    assert.equal(fake.connected, 0);
  });

  test("a session with no company cannot run (it would mint clients into nobody's company)", async () => {
    const { res, fake } = await call(req("POST", { body: {} }), [staffSession({ org_id: null })]);
    assert.equal(res.statusCode, 403);
    assert.equal(fake.connected, 0);
  });

  test("an unknown journey: 400, the routing flip happened inside the transaction, and it rolled back", async () => {
    const { res, fake } = await call(
      req("POST", { body: { journey: "nope" } }),
      [staffSession(), [/FROM journeys WHERE org_id = \$1/, []]]
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "unknown_journey");
    const order = fake.calls.map((c) => c.sql.trim().split(/\s+/).slice(0, 2).join(" "));
    const begin = order.indexOf("BEGIN");
    const flip = fake.calls.findIndex((c) => /UPDATE message_channel_routing SET provider = 'memory'/.test(c.sql));
    assert.ok(begin >= 0 && flip > begin, "the provider flip must come after BEGIN");
    assert.deepEqual(fake.calls[flip].params, [ORG_ID]);
    assert.ok(fake.count("ROLLBACK") >= 1);
    assert.equal(fake.count("COMMIT"), 0);
    assert.equal(fake.released, 1);
  });

  test("demo rows and unknown keys never replace the six real journeys (falls back to the seeded six)", async () => {
    const { res } = await call(
      req("POST", { body: { journey: "demo-platform-nurture" } }),
      [staffSession(), demoRowsOnly]
    );
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body.allowed.sort(), Object.keys(SEED_JOURNEYS).sort());
    assert.ok(!res.body.allowed.includes("demo-platform-nurture"));
  });

  test("a read that fails mid-run: 500 run_failed, still rolled back, never committed, connection released", async () => {
    const { res, fake } = await call(
      req("POST", { body: {} }),
      [staffSession(), [/FROM journeys WHERE org_id = \$1/, new Error("relation \"journeys\" does not exist")]]
    );
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, "run_failed");
    assert.ok(fake.count("ROLLBACK") >= 1);
    assert.equal(fake.count("COMMIT"), 0);
    assert.equal(fake.released, 1);
  });

  test("the pool cannot hand out a connection: 503, db down", async () => {
    const err = new Error("timeout exceeded when trying to connect");
    const { res } = await call(req("POST", { body: {} }), [staffSession()], { connectError: err });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.db, "down");
  });

  test("nothing in this file went on the wire", () => {
    assert.equal(netCalls.length, 0);
  });
});
