// POST /api/blueprint/staff-actions — the next funding sequence actions.
//
// WHY THIS FILE LIVES IN src/http/ AND NOT api/: `npm test`'s glob is src/** and
// scripts/** only. A test under api/ would pass forever without running.
//
// The handler takes its session check and the planner as arguments (the same
// seams api/money/banks.mjs has), so the gate, the org scope and the answer are
// all exercised without a database. The role gate and the org gate are the real
// ones (requireRole, requireClientInOrg).
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/blueprint/staff-actions.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const MINE = "029964c5-4d8e-47ed-88c9-53ac13863fd4";
const OTHER = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const NOW = () => new Date("2026-10-06T12:00:00Z");

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const asStaff = (role = "closer") => async () => ({ id: "5aff0000-0000-4000-8000-000000000001", role, org_id: ORG });
const noSession = async (_req, res) => { res.status(401).json({ ok: false, error: "unauthorized" }); return null; };

/* A db that knows one client in the org, whether they bought the Blueprint, and
   records every write. */
function makeDb({ buyer = true } = {}) {
  const writes = [];
  return {
    writes,
    query: async (sql, params) => {
      const s = sql.replace(/\s+/g, " ");
      if (/^\s*(UPDATE|INSERT|DELETE)/i.test(s)) { writes.push({ sql: s, params }); return { rows: [], rowCount: 1 }; }
      if (/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/.test(s)) {
        return { rows: params[0] === MINE && params[1] === ORG ? [{ "?column?": 1 }] : [] };
      }
      if (/FROM transactions t JOIN products p/.test(s)) return { rows: buyer ? [{ x: 1 }] : [] };
      return { rows: [] };
    }
  };
}

const PLAN = {
  ok: true, as_of: "2026-10-06", suggested_date: "2027-03-21", not_before: "2027-03-21", confidence: "computed", ready: false,
  reasons: [{ factor: "new_credit", status: "waiting", ready_on: "2027-03-21", source: { label: "x", ref: "y" } }],
  blockers: [], staff_date: null, effective_date: "2027-03-21", effective_source: "suggested", flags: [],
  after_funding: { alert_key: "r1" }, blueprint_buyer: true
};

async function call(body, { auth = asStaff(), db = makeDb(), plan } = {}) {
  const res = makeRes();
  const calls = [];
  const compute = plan || (async (_db, args) => { calls.push(args); return PLAN; });
  await handler({ method: "POST", headers: {}, body }, res, {
    db, requireAuth: auth, computeNextSequenceDate: compute, now: NOW
  });
  return { res, calls, db };
}

describe("get_next_sequence_plan", () => {
  test("is routed (a handler file is not a route)", () => {
    assert.equal(typeof ROUTES["blueprint/staff-actions"], "function");
  });

  test("staff read the plan for a client in their org: the planner's answer and one plain line", async () => {
    const { res, calls } = await call({ action: "get_next_sequence_plan", client_id: MINE });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.plan, PLAN);
    assert.equal(res.body.summary, "The file math says the file is ready for the next funding sequence on 2027-03-21.");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].orgId, ORG, "the org comes off the session");
    assert.equal(calls[0].clientId, MINE);
    assert.equal(calls[0].asOf.toISOString(), "2026-10-06T12:00:00.000Z");
  });

  test("it only reads: no write reaches the database", async () => {
    const { db } = await call({ action: "get_next_sequence_plan", client_id: MINE });
    assert.deepEqual(db.writes, []);
  });

  test("a client in another org is 404 before the planner runs", async () => {
    const { res, calls } = await call({ action: "get_next_sequence_plan", client_id: OTHER });
    assert.equal(res.statusCode, 404);
    assert.equal(calls.length, 0);
  });

  test("no session is 401, a role outside the staff set is 403, and neither reaches the planner", async () => {
    const none = await call({ action: "get_next_sequence_plan", client_id: MINE }, { auth: noSession });
    assert.equal(none.res.statusCode, 401);
    assert.equal(none.calls.length, 0);
    for (const role of ["affiliate", "partner", "client", "recruiter"]) {
      const out = await call({ action: "get_next_sequence_plan", client_id: MINE }, { auth: asStaff(role) });
      assert.equal(out.res.statusCode, 403, role);
      assert.equal(out.calls.length, 0, role);
    }
    for (const role of ["owner", "admin", "closer", "csm", "funding_advisor", "sales_manager"]) {
      assert.equal((await call({ action: "get_next_sequence_plan", client_id: MINE }, { auth: asStaff(role) })).res.statusCode, 200, role);
    }
  });

  test("a bad client id is 400; the planner answering nothing is 404", async () => {
    assert.equal((await call({ action: "get_next_sequence_plan", client_id: "nope" })).res.statusCode, 400);
    const gone = await call({ action: "get_next_sequence_plan", client_id: MINE }, { plan: async () => null });
    assert.equal(gone.res.statusCode, 404);
  });

  test("it reads for a client who did not buy the Blueprint too, and says so in the answer", async () => {
    const { res } = await call({ action: "get_next_sequence_plan", client_id: MINE }, {
      db: makeDb({ buyer: false }), plan: async () => ({ ...PLAN, blueprint_buyer: false })
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.plan.blueprint_buyer, false);
  });

  test("POST only", async () => {
    const res = makeRes();
    await handler({ method: "GET", headers: {}, query: {} }, res, { db: makeDb(), requireAuth: asStaff(), now: NOW });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "POST");
  });
});

describe("set_next_sequence_date is unchanged: the staff date is still how a date is set", () => {
  test("a Blueprint buyer: the date is saved on the client", async () => {
    const { res, db } = await call({ action: "set_next_sequence_date", client_id: MINE, ready_date: "2026-12-01" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, readyDate: "2026-12-01" });
    assert.equal(db.writes.length, 1);
    assert.match(db.writes[0].sql, /UPDATE clients SET custom_fields/);
    assert.equal(JSON.parse(db.writes[0].params[1]).blueprint_next_sequence_ready_date, "2026-12-01");
  });

  test("not a buyer is 403; a bad date is 400; neither writes", async () => {
    const non = await call({ action: "set_next_sequence_date", client_id: MINE, ready_date: "2026-12-01" }, { db: makeDb({ buyer: false }) });
    assert.equal(non.res.statusCode, 403);
    assert.equal(non.res.body.error, "not_blueprint_buyer");
    assert.deepEqual(non.db.writes, []);
    const bad = await call({ action: "set_next_sequence_date", client_id: MINE, ready_date: "Dec 1" });
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.error, "invalid_ready_date");
    assert.deepEqual(bad.db.writes, []);
  });

  test("an unknown action is still 400", async () => {
    const { res } = await call({ action: "move_money", client_id: MINE });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "unknown_action");
  });
});
