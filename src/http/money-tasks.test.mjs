// /api/money/tasks — the gate for both callers, the read, and the do_task
// press. Stubbed principal, db and logic; no network, no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler, { PINS_PROVIDER, PIN_SOURCES } from "../../api/money/tasks.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const MINE = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const ORG = "org-1";
const STAFF_ID = "5aff0000-0000-4000-8000-000000000001";

const clientP = (clientId = MINE) => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId });
const staffP = (role) => ({ kind: "staff", role, orgId: ORG, staff: { id: STAFF_ID, role, org_id: ORG } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};
const db = (inOrg = [MINE]) => ({
  query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: inOrg.includes(params[0]) ? [{ "?column?": 1 }] : [] } : { rows: [] })
});

function spies({ doTaskReturns = { ok: true, created: true, task: { id: "clarity:x", assignment: { status: "needs_approval" } } } } = {}) {
  const calls = {};
  return {
    calls,
    deps: {
      moneyTasks: async (_db, args) => { (calls.read ||= []).push(args); return { ok: true, tasks: [], sources: [] }; },
      doTask: async (_db, args) => { (calls.press ||= []).push(args); return doTaskReturns; }
    }
  };
}
const NOW = () => new Date("2026-10-07T12:00:00Z");

async function call(req, principal, { inOrg, s = spies(), extra = {} } = {}) {
  const res = makeRes();
  await handler(req, res, { db: db(inOrg), requirePrincipal: gateAs(principal), now: NOW, env: {}, ...s.deps, ...extra });
  return { res, calls: s.calls };
}

describe("GET /api/money/tasks", () => {
  test("is routed", () => {
    assert.equal(typeof ROUTES["money/tasks"], "function");
  });

  test("a client reads their own file; ?client_id is never read", async () => {
    const { res, calls } = await call({ method: "GET", query: { client_id: OTHER } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.equal(calls.read[0].clientId, MINE);
    assert.equal(calls.read[0].orgId, ORG);
  });

  test("a login with no client file is refused; no login is 401", async () => {
    const a = await call({ method: "GET", query: {} }, clientP(null));
    assert.equal(a.res.statusCode, 403);
    assert.equal(a.calls.read, undefined);
    const b = await call({ method: "GET", query: {} }, null);
    assert.equal(b.res.statusCode, 401);
  });

  test("staff FINANCE with a client in their org reads it; outside the org is 404; no client_id is 400", async () => {
    const ok = await call({ method: "GET", query: { client_id: MINE } }, staffP("owner"));
    assert.equal(ok.res.statusCode, 200);
    assert.equal(ok.calls.read[0].clientId, MINE);
    const out = await call({ method: "GET", query: { client_id: OTHER } }, staffP("admin"));
    assert.equal(out.res.statusCode, 404);
    assert.equal(out.calls.read, undefined);
    const none = await call({ method: "GET", query: {} }, staffP("sales_manager"));
    assert.equal(none.res.statusCode, 400);
  });

  test("staff outside FINANCE (a closer, a CSM) are refused", async () => {
    for (const role of ["setter", "csm", "funding_advisor"]) {
      const { res, calls } = await call({ method: "GET", query: { client_id: MINE } }, staffP(role));
      assert.equal(res.statusCode, 403, role);
      assert.equal(calls.read, undefined, role);
    }
  });

  test("a client the read cannot find is 404", async () => {
    const s = spies();
    s.deps.moneyTasks = async () => null;
    const { res } = await call({ method: "GET", query: {} }, clientP(), { s });
    assert.equal(res.statusCode, 404);
  });

  test("plan pins: W1's registry minus the three sources the list reads itself, passed to the read", async () => {
    assert.deepEqual(PIN_SOURCES.map((x) => x.name), ["bank-strategy", "funding-rounds", "payoff", "agent"]);
    const on = await call({ method: "GET", query: {} }, clientP());
    assert.equal(on.calls.read[0].pins, PINS_PROVIDER);
    // The provider runs allPins over those sources only. An empty database answers empty, not an error.
    const out = await PINS_PROVIDER({ query: async () => ({ rows: [] }) }, { orgId: ORG, clientId: MINE, from: "2026-08-08", to: "2026-10-21", today: "2026-10-07" });
    assert.deepEqual(out.sources.map((x) => x.name), ["bank-strategy", "funding-rounds", "payoff", "agent"]);
    assert.deepEqual(out.pins, []);
    const fn = async () => ({ pins: [] });
    const swapped = await call({ method: "GET", query: {} }, clientP(), { extra: { pins: fn } });
    assert.equal(swapped.calls.read[0].pins, fn);
  });

  test("PUT is 405", async () => {
    const { res } = await call({ method: "PUT", query: {} }, clientP());
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "GET, POST");
  });
});

describe("POST /api/money/tasks — do_task", () => {
  test("a client presses Do task on their own file; client_id in the body is ignored", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "do_task", task_id: " clarity:x ", client_id: OTHER } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.created, true);
    assert.equal(res.body.task.assignment.status, "needs_approval");
    const p = calls.press[0];
    assert.equal(p.clientId, MINE);
    assert.equal(p.taskId, "clarity:x");
    assert.equal(p.actor, "client");
    assert.equal(p.staffId, null);
  });

  test("staff FINANCE press on a client's behalf: actor staff, their staff id", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "do_task", task_id: "clarity:x", client_id: MINE } }, staffP("admin"));
    assert.equal(res.statusCode, 200);
    assert.equal(calls.press[0].actor, "staff");
    assert.equal(calls.press[0].staffId, STAFF_ID);
    assert.equal(calls.press[0].clientId, MINE);
  });

  test("the press never takes a title or an amount from the body", async () => {
    const { calls } = await call({ method: "POST", body: { action: "do_task", task_id: "clarity:x", amount_cents: 1, title: "x", transfer: {} } }, clientP());
    const keys = Object.keys(calls.press[0]).sort();
    assert.deepEqual(keys, ["actor", "asOf", "clientId", "env", "orgId", "pins", "staffId", "taskId"]);
  });

  test("refusals answer in words with the right code", async () => {
    const cases = [
      ["self_task", 409, /Only you can do this step/],
      ["task_not_found", 404, /not on your list/],
      ["bad_task_id", 400, /not a task id/],
      ["proposal_refused", 409, /could not set up that payment/]
    ];
    for (const [error, code, words] of cases) {
      const s = spies({ doTaskReturns: { ok: false, error } });
      const { res } = await call({ method: "POST", body: { action: "do_task", task_id: "clarity:x" } }, clientP(), { s });
      assert.equal(res.statusCode, code, error);
      assert.equal(res.body.error, error);
      assert.match(res.body.message, words);
    }
  });

  test("an unknown action is 400; a body that is not JSON is 400", async () => {
    const a = await call({ method: "POST", body: { action: "move_money_now" } }, clientP());
    assert.equal(a.res.statusCode, 400);
    assert.equal(a.res.body.error, "unknown_action");
    assert.equal(a.calls.press, undefined);
    const b = await call({ method: "POST", body: "{nope" }, clientP());
    assert.equal(b.res.statusCode, 400);
  });
});
