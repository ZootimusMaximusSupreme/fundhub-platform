// Practice test (the REAL api/journeys/run.mjs, the real walker, a stand-in database, fake journeys) for the
// server half of "Test against the code" in batch 14: the part that walks every branch with throwaway
// clients inside a transaction that is always rolled back.
//
// The earlier handler test (src/http/journeys-run-handler.test.mjs) only reaches the exits that leave before a
// walk. A full run on the stand-in database used to end 500 because the stand-in answered no row for the two
// inserts the walk needs (a client and an event). Here the stand-in answers those two, so the run reaches the
// success answer, which is the exit that must still roll back, release the connection, carry every path, and
// mint only marked throwaway clients in the caller's own company.
//
// Expected numbers are worked out from the fake journeys below, not read from the answer. No database,
// no network (fetch is refused).

import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import handler from "../../../../api/journeys/run.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID, OTHER_ORG_ID } from "../../../testing/handler-harness.mjs";

const netCalls = [];
const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = async (url) => { netCalls.push(String(url)); throw new Error("network refused in this test"); }; });
after(() => { globalThis.fetch = realFetch; });

// A question gives two paths, so the Client journey walks two paths and the Setter journey walks one: three.
const CLIENT_NODES = [
  { id: "n1", type: "sms", title: "Text the survey link", cfg: { body: "Hi {{first_name}}. Reply STOP to opt out.", delay: "instant" } },
  {
    id: "n2", type: "condition", title: "Did they finish", cfg: { field: "survey_complete", op: "is true" },
    branches: [
      { label: "Yes", nodes: [{ id: "n3", type: "record", title: "Save a note", cfg: { note: "done" } }] },
      { label: "No", nodes: [{ id: "n4", type: "wait", title: "Wait a day", cfg: { amount: "1", unit: "days" } }] },
    ],
  },
];
const SETTER_NODES = [{ id: "n5", type: "agent", title: "Voice agent calls", cfg: { agent: "Setter Chris", note: "three tries" } }];

const JOURNEY_ROWS = [
  { key: "client", name: "Client", start_when: "A form is filled", end_when: "A result", description: "", nodes: CLIENT_NODES, is_demo: false },
  { key: "setter", name: "Setter", start_when: "A lead lands", end_when: "A call", description: "", nodes: SETTER_NODES, is_demo: false },
  { key: "demo-platform-nurture", name: "Demo", start_when: "x", end_when: "y", description: "", nodes: [], is_demo: true },
  { key: "mystery", name: "Not an editor journey", start_when: "x", end_when: "y", description: "", nodes: [], is_demo: false },
];

/** The rules a walk needs: the session, the journeys read, and the one row each of the two inserts hands back. */
function rules() {
  let clients = 0;
  let events = 0;
  return [
    staffSession(),
    [/FROM journeys WHERE org_id = \$1/, JOURNEY_ROWS],
    [/INSERT INTO clients/, (sql, params) => [{
      id: `cc000000-0000-4000-8000-${String(++clients).padStart(12, "0")}`, org_id: params[0], first_name: params[1], last_name: params[2],
      email: params[3], phone: params[4], custom_fields: JSON.parse(params[5]),
    }]],
    [/INSERT INTO events/, () => [{ id: `ee000000-0000-4000-8000-${String(++events).padStart(12, "0")}` }]],
  ];
}

async function run(body = {}, extraRules = []) {
  const fake = fakeDb([...extraRules, ...rules()]);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(req("POST", { body }), res));
  return { res, fake };
}

const clientInserts = (fake) => fake.find(/INSERT INTO clients/);

test("a full run: 200, every path of every question walked, and the whole run rolled back, never committed", async () => {
  const { res, fake } = await run({});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true, "the success answer says ok");
  assert.equal(res.body.journeySource, "database");
  // the rows this run left out are named, with the reason
  assert.deepEqual(res.body.journeysSkipped.map((s) => s.key).sort(), ["demo-platform-nurture", "mystery"]);
  assert.match(res.body.journeysSkipped.find((s) => s.key === "mystery").reason, /does not own this one/);
  assert.match(res.body.journeysSkipped.find((s) => s.key === "demo-platform-nurture").reason, /Demo Mode/);
  // Client: two paths through the question, Setter: one
  assert.deepEqual(res.body.paths.map((p) => p.pathId), ["client#1", "client#2", "setter#1"]);
  assert.equal(res.body.summary.walked.paths, 3);
  assert.equal(res.body.summary.walked.clients, 3);
  assert.match(res.body.headline, /Walked 3 paths\./);
  const yes = res.body.paths[0].branches.map((b) => b.lane);
  const no = res.body.paths[1].branches.map((b) => b.lane);
  assert.deepEqual([yes, no], [["Yes"], ["No"]], "both lanes of the question were walked, one path each");
  assert.deepEqual(res.body.paths[0].steps.map((s) => s.nodeId), ["n1", "n2", "n3"]);
  assert.deepEqual(res.body.paths[1].steps.map((s) => s.nodeId), ["n1", "n2", "n4"]);
  assert.deepEqual(res.body.paths[2].steps.map((s) => s.nodeId), ["n5"]);
  assert.equal(res.body.paths.every((p) => p.terminal === "complete" && p.failure === null), true);
  assert.equal(res.body.paths.every((p) => typeof p.pathId === "string" && Array.isArray(p.messages) && "messageLedger" in p), true,
    "each path carries what the screen paints from");
  // the whole run is one transaction that is rolled back
  const order = fake.calls.map((c) => c.sql.trim().split(/\s+/).slice(0, 2).join(" "));
  assert.equal(order[order.indexOf("BEGIN") - 0], "BEGIN");
  assert.equal(fake.count("COMMIT"), 0, "a journey run is never committed");
  assert.ok(fake.count("ROLLBACK") >= 1, "and it is rolled back");
  assert.equal(order.lastIndexOf("ROLLBACK"), order.length - 1, "the rollback is the last thing that runs");
  assert.equal(fake.connected, 1);
  assert.equal(fake.released, 1, "the connection goes back to the pool on success too");
  assert.equal(netCalls.length, 0);
});

test("every throwaway client is marked synthetic, carries its run and path, and is minted in the caller's own company", async () => {
  const { res, fake } = await run({ org_id: OTHER_ORG_ID, orgId: OTHER_ORG_ID, runId: "run-chosen-by-caller" });
  assert.equal(res.statusCode, 200);
  const inserts = clientInserts(fake);
  assert.equal(inserts.length, 3, "one client per path walked");
  for (const [index, insert] of inserts.entries()) {
    assert.equal(insert.params[0], ORG_ID, "the company is the session's, whatever the body says");
    const custom = JSON.parse(insert.params[5]);
    assert.equal(custom.synthetic, true, "the marker the live-send fence reads");
    assert.equal(custom.synthetic_run_id, res.body.runId);
    assert.notEqual(res.body.runId, "run-chosen-by-caller", "the run id is the server's own");
    assert.equal(custom.synthetic_journey, index < 2 ? "client" : "setter");
    assert.equal(custom.synthetic_path, res.body.paths[index].pathId);
    assert.match(insert.params[3], /@runner\.fundhub\.invalid$/, "an address that can never reach a real mailbox");
    assert.match(insert.params[4], /^\+1555/, "a number in the reserved fictional block");
  }
  assert.equal(new Set(inserts.map((i) => i.params[3])).size, 3, "three different addresses");
  // nothing anywhere carries the other company's id
  assert.equal(fake.calls.some((c) => (c.params || []).includes(OTHER_ORG_ID)), false);
  // every statement that names a company names the session's
  const journeysRead = fake.find(/FROM journeys WHERE org_id = \$1/);
  assert.equal(journeysRead.length, 1);
  assert.deepEqual(journeysRead[0].params, [ORG_ID]);
  const flip = fake.find(/UPDATE message_channel_routing SET provider = 'memory'/);
  assert.equal(flip.length, 1);
  assert.deepEqual(flip[0].params, [ORG_ID]);
});

test("one journey asked for: only that journey is walked, and an unknown one is refused after the rollback", async () => {
  const one = await run({ journey: "setter" });
  assert.equal(one.res.statusCode, 200);
  assert.deepEqual(one.res.body.paths.map((p) => p.pathId), ["setter#1"]);
  assert.equal(clientInserts(one.fake).length, 1);
  assert.equal(one.fake.count("COMMIT"), 0);
  assert.equal(one.fake.released, 1);

  const none = await run({ journey: "mystery" });
  assert.equal(none.res.statusCode, 400);
  assert.deepEqual(none.res.body.allowed.sort(), ["client", "setter"]);
  assert.equal(clientInserts(none.fake).length, 0);
  assert.ok(none.fake.count("ROLLBACK") >= 1);
  assert.equal(none.fake.released, 1);
});

test("the plain-text report: same walk, same rollback, a text answer", async () => {
  const { res, fake } = await run({ format: "text" });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["content-type"]), /^text\/plain/);
  assert.equal(typeof res.body, "string");
  assert.ok(res.body.length > 50);
  assert.equal(fake.count("COMMIT"), 0);
  assert.ok(fake.count("ROLLBACK") >= 1);
  assert.equal(fake.released, 1);
});

test("a path that fails is reported as failed on that path and the run still answers ok and still rolls back", async () => {
  // The event insert answers no row for a Setter path's client: the walk of that path throws, and says so.
  const { res, fake } = await run({}, [[/INSERT INTO events/, () => []]]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(fake.count("COMMIT"), 0);
  assert.equal(fake.released, 1);
  // the client journey opens with an event, so its paths fail; the answer lists each failed path by id
  assert.ok(res.body.summary.walked.failedPaths.length >= 1);
  assert.ok(res.body.summary.walked.failedPaths.every((f) => typeof f.pathId === "string" && f.failure));
});

test("no network was touched by any run in this file", () => {
  assert.equal(netCalls.length, 0);
});
