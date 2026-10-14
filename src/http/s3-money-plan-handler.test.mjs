// Slice S3 proof: POST /api/money/plan action=mark. Staff mark one plan date
// done, only through the source that owns it. The real handler and the real
// plan sources run. The database is a stand-in that holds two clients' checklist
// rows and answers each statement by the id, company and client its SQL names,
// so a refusal is the product's own and not a flag the test flipped.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import planHandler from "../../api/money/plan.mjs";
import { makeRes } from "../testing/handler-harness.mjs";
import { strictFakeDb as fakeDb } from "../testing/s3-handler-call.mjs";
import {
  gateAs, clientPrincipal, staffPrincipal, FINANCE_OS_ROLES, NOT_FINANCE_OS_ROLES
} from "../testing/s3-mem-tasks-db.mjs";
import { clientsRule, tableRules } from "../testing/s3-scoped-rows.mjs";
import { markPin } from "../finance/plan-sources/index.mjs";

const ORG = "0a000000-0000-4000-8000-000000000001";
const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
const STEP = "a1000000-0000-4000-8000-0000000000a1";
const OTHER_STEP = "a2000000-0000-4000-8000-0000000000a2";
const NOW = () => new Date("2026-10-13T15:00:00Z");

// Both clients carry the same catalog key, as every real file does, so a write
// that lost its client condition would land on the wrong row.
const step = (over = {}) => ({
  id: STEP, org_id: ORG, client_id: CLIENT, key: "open-business-account", title: "Open the business account", detail: null,
  owner_kind: "staff", state: "not_started", due_at: "2026-10-12T00:00:00.000Z", completed_at: null, verify_kind: null, ...over
});

/** One run of the real handler. `steps` is the live checklist table; `clientOrg` is the company the client is in. */
async function mark(body, { principal = staffPrincipal("owner", ORG), clientOrg = ORG, steps = [step(), step({ id: OTHER_STEP, client_id: OTHER_CLIENT })], deps = {} } = {}) {
  const clients = [{ id: CLIENT, org_id: clientOrg }, { id: OTHER_CLIENT, org_id: ORG }];
  const set = (row, params, sql) => {
    if (/state = 'done'/.test(sql)) Object.assign(row, { state: "done", completed_at: "2026-10-13T15:00:00.000Z" });
  };
  const database = fakeDb([clientsRule(clients), ...tableRules("client_waypoints", steps, { set })]);
  const res = makeRes();
  await planHandler({ method: "POST", body: { client_id: CLIENT, action: "mark", source: "waypoints", pin_id: `waypoint:${STEP}`, status: "done", ...body } }, res, {
    db: database, requirePrincipal: gateAs(principal), now: NOW, env: {}, ...deps
  });
  return { res, database, steps };
}
const stateOf = (steps, id) => steps.find((s) => s.id === id).state;
const writes = (database) => database.find(/^\s*UPDATE/i);

describe("POST /api/money/plan action=mark", () => {
  test("a checklist step is closed for this client in this company, and only that client's row changes", async () => {
    const { res, database, steps } = await mark({});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.action, "mark");
    assert.equal(res.body.changed, true);
    assert.equal(res.body.pin.id, `waypoint:${STEP}`);
    assert.equal(res.body.pin.status, "done");
    assert.deepEqual(database.find(/SELECT \* FROM client_waypoints/)[0].params, [STEP, ORG, CLIENT]);
    assert.deepEqual(database.find(/UPDATE client_waypoints\s+SET state = 'done'/)[0].params.slice(0, 3), [ORG, CLIENT, "open-business-account"]);
    assert.equal(stateOf(steps, STEP), "done");
    assert.equal(stateOf(steps, OTHER_STEP), "not_started", "the other client's step with the same key is untouched");
  });

  test("marking a step that is already done changes nothing; a step that closes on the credit report is a 409", async () => {
    const again = await mark({}, { steps: [step({ state: "done", completed_at: "2026-10-12T00:00:00.000Z" })] });
    assert.equal(again.res.statusCode, 200);
    assert.equal(again.res.body.changed, false);
    assert.equal(writes(again.database).length, 0);
    const machine = await mark({}, { steps: [step({ verify_kind: "paydown", owner_kind: "client" })] });
    assert.equal(machine.res.statusCode, 409);
    assert.equal(machine.res.body.error, "closes_on_credit_report");
    assert.equal(stateOf(machine.steps, STEP), "not_started");
    assert.equal(writes(machine.database).length, 0);
  });

  test("a source with no writer is a 409 not_markable, an unknown source a 400, missed is worked out and never typed in", async () => {
    const dues = await mark({ source: "dues", pin_id: "due:abc" });
    assert.equal(dues.res.statusCode, 409);
    assert.equal(dues.res.body.error, "not_markable");
    const nope = await mark({ source: "nothing-here" });
    assert.equal(nope.res.statusCode, 400);
    assert.equal(nope.res.body.error, "unknown_source");
    const missed = await mark({ status: "missed" });
    assert.equal(missed.res.statusCode, 409);
    assert.equal(missed.res.body.error, "missed_is_worked_out");
    assert.equal(stateOf(missed.steps, STEP), "not_started");
    for (const out of [dues, nope, missed]) assert.equal(writes(out.database).length, 0);
  });

  test("another client's step id is a 404 and neither row changes; a client login can never mark", async () => {
    const other = await mark({ pin_id: `waypoint:${OTHER_STEP}` });
    assert.equal(other.res.statusCode, 404);
    assert.equal(stateOf(other.steps, OTHER_STEP), "not_started");
    assert.equal(stateOf(other.steps, STEP), "not_started");
    assert.equal(writes(other.database).length, 0);
    const asClient = await mark({}, { principal: clientPrincipal(CLIENT, ORG) });
    assert.equal(asClient.res.statusCode, 403);
    assert.equal(stateOf(asClient.steps, STEP), "not_started");
    assert.equal(writes(asClient.database).length, 0);
  });

  // The client is in company B. Staff of company A name their id and a real step of it.
  test("staff of another company get a 404 and nothing is written, at the door and in the plan logic alone", async () => {
    const out = await mark({}, { clientOrg: OTHER_ORG, steps: [step({ org_id: OTHER_ORG })] });
    assert.equal(out.res.statusCode, 404);
    assert.equal(out.res.body.error, "not_found");
    assert.equal(stateOf(out.steps, STEP), "not_started");
    assert.equal(writes(out.database).length, 0);
    assert.equal(out.database.find(/FROM client_waypoints/).length, 0, "stopped before the step table was read");

    const reached = [];
    const spy = async (...args) => { reached.push(args); return { ok: true, changed: false, pin: null }; };
    const doorOnly = await mark({}, { clientOrg: OTHER_ORG, steps: [step({ org_id: OTHER_ORG })], deps: { markPin: spy } });
    assert.equal(doorOnly.res.statusCode, 404);
    assert.equal(reached.length, 0, "the handler's own check stops it before the plan logic runs");

    // Already done, so a lookup that forgot the company would answer "nothing to change" with company B's pin.
    for (const state of ["not_started", "done"]) {
      const rows = [step({ org_id: OTHER_ORG, state, completed_at: state === "done" ? "2026-10-12T00:00:00.000Z" : null })];
      const logicOnly = fakeDb(tableRules("client_waypoints", rows, { set: (row) => Object.assign(row, { state: "done" }) }));
      const refused = await markPin(logicOnly, { orgId: ORG, clientId: CLIENT, source: "waypoints", pinId: `waypoint:${STEP}`, status: "done", now: NOW() });
      assert.deepEqual(refused, { ok: false, reason: "not_found" }, state);
      assert.equal(writes(logicOnly).length, 0, state);
    }
  });

  test("only owner, admin, sales manager and closer may mark; any other staff role is a 403 before any lookup", async () => {
    for (const role of FINANCE_OS_ROLES) {
      const { res, steps } = await mark({}, { principal: staffPrincipal(role, ORG) });
      assert.equal(res.statusCode, 200, role);
      assert.equal(stateOf(steps, STEP), "done", role);
    }
    for (const role of NOT_FINANCE_OS_ROLES) {
      const { res, database, steps } = await mark({}, { principal: staffPrincipal(role, ORG) });
      assert.equal(res.statusCode, 403, role);
      assert.equal(res.body.error, "forbidden", role);
      assert.match(res.body.message, /limited to/, role);
      assert.equal(database.calls.length, 0, `${role} is refused before the database is asked anything`);
      assert.equal(stateOf(steps, STEP), "not_started", role);
    }
  });
});
