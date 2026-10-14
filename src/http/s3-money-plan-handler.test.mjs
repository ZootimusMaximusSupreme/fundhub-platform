// Slice S3 proof: POST /api/money/plan action=mark. Staff mark one plan date
// done, only through the source that owns it. The real handler and the real
// plan sources run; the database is a stand-in.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import planHandler from "../../api/money/plan.mjs";
import { makeRes, fakeDb } from "../testing/handler-harness.mjs";
import { gateAs, clientPrincipal, staffPrincipal } from "../testing/s3-mem-tasks-db.mjs";

const ORG = "0a000000-0000-4000-8000-000000000001";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const STEP = "a1000000-0000-4000-8000-0000000000a1";
const NOW = () => new Date("2026-10-13T15:00:00Z");

const step = (over = {}) => ({
  id: STEP, key: "open-business-account", title: "Open the business account", detail: null, owner_kind: "staff",
  state: "not_started", due_at: "2026-10-12T00:00:00.000Z", completed_at: null, verify_kind: null, ...over
});

async function mark(body, { rules = [], principal = staffPrincipal("owner", ORG) } = {}) {
  const database = fakeDb([[/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, [{ "?column?": 1 }]], ...rules]);
  const res = makeRes();
  await planHandler({ method: "POST", body: { client_id: CLIENT, action: "mark", source: "waypoints", pin_id: `waypoint:${STEP}`, status: "done", ...body } }, res, {
    db: database, requirePrincipal: gateAs(principal), now: NOW, env: {}
  });
  return { res, database };
}

describe("POST /api/money/plan action=mark", () => {
  test("a checklist step is closed for this client in this company and the pin comes back done", async () => {
    const { res, database } = await mark({}, { rules: [
      [/SELECT \* FROM client_waypoints\s+WHERE id = \$1::uuid AND org_id = \$2::uuid AND client_id = \$3::uuid/, [step()]],
      [/UPDATE client_waypoints\s+SET state = 'done'/, [step({ state: "done", completed_at: "2026-10-13T15:00:00.000Z" })]]
    ] });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.action, "mark");
    assert.equal(res.body.changed, true);
    assert.equal(res.body.pin.id, `waypoint:${STEP}`);
    assert.equal(res.body.pin.status, "done");
    assert.deepEqual(database.find(/SELECT \* FROM client_waypoints/)[0].params, [STEP, ORG, CLIENT]);
    assert.deepEqual(database.find(/UPDATE client_waypoints\s+SET state = 'done'/)[0].params.slice(0, 3), [ORG, CLIENT, "open-business-account"]);
  });

  test("marking a step that is already done changes nothing; a step that closes on the credit report is a 409", async () => {
    const again = await mark({}, { rules: [[/SELECT \* FROM client_waypoints/, [step({ state: "done", completed_at: "2026-10-12T00:00:00.000Z" })]]] });
    assert.equal(again.res.statusCode, 200);
    assert.equal(again.res.body.changed, false);
    assert.equal(again.database.find(/UPDATE client_waypoints/).length, 0);
    const machine = await mark({}, { rules: [[/SELECT \* FROM client_waypoints/, [step({ verify_kind: "paydown", owner_kind: "client" })]]] });
    assert.equal(machine.res.statusCode, 409);
    assert.equal(machine.res.body.error, "closes_on_credit_report");
    assert.equal(machine.database.find(/UPDATE client_waypoints/).length, 0);
  });

  test("a source with no writer is a 409 not_markable, an unknown source a 400, missed is worked out and never typed in", async () => {
    const dues = await mark({ source: "dues", pin_id: "due:abc" });
    assert.equal(dues.res.statusCode, 409);
    assert.equal(dues.res.body.error, "not_markable");
    const nope = await mark({ source: "nothing-here" });
    assert.equal(nope.res.statusCode, 400);
    assert.equal(nope.res.body.error, "unknown_source");
    const missed = await mark({ status: "missed" }, { rules: [[/SELECT \* FROM client_waypoints/, [step()]]] });
    assert.equal(missed.res.statusCode, 409);
    assert.equal(missed.res.body.error, "missed_is_worked_out");
    assert.equal(missed.database.find(/UPDATE client_waypoints/).length, 0);
  });

  test("a step that is not this client's is a 404, and a client login can never mark", async () => {
    const other = await mark({}, { rules: [[/SELECT \* FROM client_waypoints/, []]] });
    assert.equal(other.res.statusCode, 404);
    const asClient = await mark({}, { principal: clientPrincipal(CLIENT, ORG), rules: [[/SELECT \* FROM client_waypoints/, [step()]]] });
    assert.equal(asClient.res.statusCode, 403);
    assert.equal(asClient.database.find(/UPDATE client_waypoints/).length, 0);
  });
});
