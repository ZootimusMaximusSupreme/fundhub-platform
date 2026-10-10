// POST /api/dashboard/seed — the real handler, run with no Postgres.
//
// The sample-client tool pushes one made-up client through the REAL event bus:
// lead, survey, booking, a $32 payment, analysis, decision, and (unless the
// tier is repair only) a $3,000 deposit and a sale. On a live database that is
// fake money in the live books, so who may press it matters. No test ever ran
// it. This runs it: the gates, and exactly which events it fires, with which
// sample markers, in which order. Every registered handler runs too, against a
// stand-in database; the network is refused for the whole file.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import handler from "../../api/dashboard/seed.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import {
  fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID
} from "../testing/handler-harness.mjs";

const netCalls = [];
const realFetch = globalThis.fetch;
const hadSecret = Object.prototype.hasOwnProperty.call(process.env, "DASHBOARD_SECRET");
const realSecret = process.env.DASHBOARD_SECRET;
const SECRET = crypto.randomBytes(18).toString("hex");
before(() => {
  globalThis.fetch = async (u) => { netCalls.push(String(u)); throw new Error("network refused in this test"); };
  process.env.DASHBOARD_SECRET = SECRET;
});
after(() => {
  globalThis.fetch = realFetch;
  if (hadSecret) process.env.DASHBOARD_SECRET = realSecret; else delete process.env.DASHBOARD_SECRET;
});

/* Pin the clock: the tool picks the name and the tier from Date.now(). */
async function atStamp(stamp, fn) {
  const realNow = Date.now;
  const quiet = { log: console.log, warn: console.warn, error: console.error };
  Date.now = () => stamp;
  // The real handlers narrate every step; keep the test output readable.
  console.log = console.warn = console.error = () => {};
  try { return await fn(); } finally {
    Date.now = realNow;
    Object.assign(console, quiet);
  }
}

const FULL = 1791600000000;     // % 4 = 0 -> FULL_FUNDING
const REPAIR = 1791600000003;   // % 4 = 3 -> REPAIR_ONLY

function seedRules(extra = []) {
  let n = 0;
  return [
    ...extra,
    [/SELECT id FROM orgs WHERE slug/, [{ id: ORG_ID }]],
    [/INSERT INTO events/, () => [{ id: `e0000000-0000-4000-8000-${String(++n).padStart(12, "0")}` }]],
    [/SELECT id, email, outcome_tier FROM clients WHERE email = \$1/, (_s, p) => [{ id: "c1", email: p[0], outcome_tier: "FULL_FUNDING" }]]
  ];
}

async function call(request, rules, stamp = FULL) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await atStamp(stamp, () => runWithSharedDb(fake, () => handler(request, res)));
  const events = fake.find(/INSERT INTO events/).map((c) => ({ name: c.params[1], key: c.params[3], payload: c.params[5] }));
  return { res, fake, events };
}

describe("POST /api/dashboard/seed", () => {
  test("is routed", () => {
    assert.equal(ROUTES["dashboard/seed"], handler);
  });

  test("GET is refused", async () => {
    const { res, events } = await call(req("GET"), seedRules([staffSession({ role: "admin" })]));
    assert.equal(res.statusCode, 405);
    assert.equal(events.length, 0);
  });

  test("no session and no dashboard key: 401, nothing fired", async () => {
    const { res, events } = await call({ method: "POST", headers: {}, body: {} }, seedRules());
    assert.equal(res.statusCode, 401);
    assert.equal(events.length, 0);
  });

  test("a wrong dashboard key: 401, nothing fired", async () => {
    const { res, events } = await call({ method: "POST", headers: { "x-dashboard-key": "nope" }, body: {} }, seedRules());
    assert.equal(res.statusCode, 401);
    assert.equal(events.length, 0);
  });

  test("a closer cannot make sample money (admin only): 403, nothing fired", async () => {
    const { res, events } = await call(req("POST"), seedRules([staffSession({ role: "closer" })]));
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body.required, ["admin"]);
    assert.equal(events.length, 0);
  });

  test("an admin run fires the ten steps in order, every one marked as a sample", async () => {
    const { res, events } = await call(req("POST"), seedRules([staffSession({ role: "admin" })]), FULL);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.seeded.email, `sample+${FULL}@fundhub.demo`);
    assert.deepEqual(events.map((e) => e.name), [
      "entry.captured", "survey.submitted", "booking.created", "payment.received", "diagnostic.paid",
      "analysis.completed", "decision.rendered", "payment.received", "deposit.paid", "sale.closed"
    ]);
    for (const e of events) {
      assert.equal(e.payload.email, `sample+${FULL}@fundhub.demo`);
      assert.match(e.key, new RegExp(`^seed:${FULL}:`));
    }
    const pays = events.filter((e) => e.name === "payment.received").map((e) => [e.payload.amount, e.payload.providerRef]);
    assert.deepEqual(pays, [[32, `seed_t32_${FULL}`], [3000, `seed_tdep_${FULL}`]]);
    assert.equal(netCalls.length, 0);
  });

  test("a repair-only sample stops at the decision: no $3,000 deposit and no sale", async () => {
    const { res, events } = await call(req("POST"), seedRules([staffSession({ role: "admin" })]), REPAIR);
    assert.equal(res.statusCode, 200);
    const names = events.map((e) => e.name);
    assert.equal(names.length, 7);
    assert.ok(!names.includes("deposit.paid") && !names.includes("sale.closed"));
    assert.equal(events.find((e) => e.name === "analysis.completed").payload.outcomeTier, "REPAIR_ONLY");
  });

  test("the shared dashboard key still works (an operator credential), and fires the same steps", async () => {
    const { res, events } = await call({ method: "POST", headers: { "x-dashboard-key": SECRET }, body: {} }, seedRules(), FULL);
    assert.equal(res.statusCode, 200);
    assert.equal(events.length, 10);
  });

  test("a step that fails stops the run and says so (500), no sale is fired after it", async () => {
    const { res, events } = await call(
      req("POST"),
      seedRules([staffSession({ role: "admin" }), [(sql, p) => /INSERT INTO events/.test(sql) && p[1] === "payment.received", new Error("insert failed")]]),
      FULL
    );
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.ok, false);
    assert.ok(!events.some((e) => e.name === "sale.closed"));
  });
});
