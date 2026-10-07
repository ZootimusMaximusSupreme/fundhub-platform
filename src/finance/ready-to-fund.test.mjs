// "Ready to get funded" (src/finance/ready-to-fund.mjs) — the press runs the
// Capital Blueprint's OWN closing-prep step, once while one is open, and the
// upsell / side-sell between the two products. In-memory db that keeps the
// tasks table's dedupe and money_agent_log's idempotency key.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  roundBody, roundOfBody, readyStatus, readyToFundStatus, requestReadyToFund, productOffers,
  READY_STATUSES, FINANCEOS_SETUP_URL
} from "./ready-to-fund.mjs";
import {
  CSM_PREP_SOURCE, CSM_PREP_TITLE, PREP_CALL_DEDUPE, evaluateBlueprintCloserReady
} from "../blueprint/closer-ready.mjs";
import { BOOK_CALL_URL } from "../deliverables/chrome.mjs";

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const CSM = "c5c50000-0000-4000-8000-000000000001";

/* tasks + money_agent_log + one clients row, enough for the real
   createBlueprintCsmPrepCallTask, createTask and logMoneyAction to run. */
function memDb({ assignedCsm = null, inOrg = true } = {}) {
  const state = { tasks: [], log: [], inserts: [] };
  let n = 0;
  const db = {
    state,
    async query(sql, params = []) {
      if (/LEFT JOIN tasks t/.test(sql)) {
        if (!inOrg) return { rows: [] };
        const mine = state.tasks.filter((t) => t.source_workflow === params[2] && (t.body === params[3] || String(t.body).startsWith(params[3] + ":r")));
        if (!mine.length) return { rows: [{ assigned_csm_staff_id: assignedCsm, id: null }] };
        return { rows: mine.map((t) => ({ assigned_csm_staff_id: assignedCsm, ...t })) };
      }
      if (/SELECT assigned_csm_staff_id\s+FROM clients/.test(sql)) return { rows: [{ assigned_csm_staff_id: assignedCsm }] };
      if (/SELECT id FROM tasks/.test(sql)) {
        const hit = state.tasks.find((t) => t.client_id === params[0] && t.source_workflow === params[1] && t.body === params[2]);
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      if (/INSERT INTO tasks/.test(sql)) {
        const [orgId, clientId, title, body, dueAt, source, role, staffId] = params;
        if (state.tasks.some((t) => t.client_id === clientId && t.source_workflow === source && t.body === body)) return { rows: [] };
        const row = {
          id: `task-${++n}`, org_id: orgId, client_id: clientId, title, body, due_at: dueAt, source_workflow: source,
          assignee_role: role, assignee_staff_id: staffId, done: false,
          created_at: new Date(Date.UTC(2026, 9, 7, 12, n)).toISOString(), updated_at: new Date(Date.UTC(2026, 9, 7, 12, n)).toISOString()
        };
        state.tasks.push(row);
        state.inserts.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (/INSERT INTO money_agent_log/.test(sql)) {
        const key = params[13];
        if (state.log.some((r) => r.idempotency_key === key)) return { rows: [] };
        const row = { id: `log-${state.log.length + 1}`, item_kind: params[2], item_id: params[3], action: params[6], actor: params[7], brain: params[8], reason: params[9], idempotency_key: key, detail: params[14] };
        state.log.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (/UPDATE money_agent_log SET task_id/.test(sql)) {
        const r = state.log.find((x) => x.id === params[0]);
        if (r) r.task_id = params[1];
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
  return db;
}

describe("rounds and status", () => {
  test("round 1 is the Blueprint's own key; later rounds add :r<n>", () => {
    assert.equal(roundBody(1), PREP_CALL_DEDUPE);
    assert.equal(roundBody(1), "blueprint-csm-prep-call");
    assert.equal(roundBody(3), "blueprint-csm-prep-call:r3");
    assert.equal(roundOfBody("blueprint-csm-prep-call"), 1);
    assert.equal(roundOfBody("blueprint-csm-prep-call:r2"), 2);
    assert.equal(roundOfBody("blueprint-closer-funding-ready"), null);
  });

  test("none → requested → csm_assigned → done, read off the newest round's task", () => {
    assert.deepEqual([...READY_STATUSES], ["none", "requested", "csm_assigned", "done"]);
    assert.equal(readyStatus([]).status, "none");
    const t1 = { id: "t1", body: PREP_CALL_DEDUPE, done: false, assignee_staff_id: null, created_at: "2026-10-07T12:00:00Z" };
    assert.equal(readyStatus([t1]).status, "requested");
    assert.equal(readyStatus([t1], { assignedCsm: CSM }).status, "csm_assigned", "the CSM on the file holds it");
    assert.equal(readyStatus([{ ...t1, assignee_staff_id: CSM }]).status, "csm_assigned", "a CSM claimed it");
    const done = readyStatus([{ ...t1, done: true, updated_at: "2026-10-09T15:00:00Z" }]);
    assert.equal(done.status, "done");
    assert.equal(done.done_at, "2026-10-09T15:00:00.000Z");
    const r2 = readyStatus([{ ...t1, done: true }, { id: "t2", body: "blueprint-csm-prep-call:r2", done: false }]);
    assert.equal(r2.round, 2);
    assert.equal(r2.status, "requested");
  });
});

describe("the press runs the Capital Blueprint's own step", () => {
  test("it opens the Blueprint closing prep call — same title, source, role, CSM and key", async () => {
    const db = memDb({ assignedCsm: CSM });
    const r = await requestReadyToFund(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-07" });
    assert.equal(r.created, true);
    assert.equal(r.status, "csm_assigned");
    assert.equal(db.state.inserts.length, 1);
    const t = db.state.inserts[0];
    assert.equal(t.title, CSM_PREP_TITLE);
    assert.equal(t.title, "Blueprint closing prep call");
    assert.equal(t.source_workflow, CSM_PREP_SOURCE);
    assert.equal(t.source_workflow, "blueprint-csm-prep");
    assert.equal(t.assignee_role, "csm");
    assert.equal(t.assignee_staff_id, CSM, "the CSM on the client's file, exactly as for a Blueprint buyer");
    assert.equal(t.body, PREP_CALL_DEDUPE);
  });

  test("idempotent while one is open: a second press writes no task and no log row", async () => {
    const db = memDb();
    const first = await requestReadyToFund(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-07" });
    const again = await requestReadyToFund(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-07" });
    assert.equal(first.created, true);
    assert.equal(first.status, "requested");
    assert.equal(again.created, false);
    assert.equal(again.task_id, first.task_id);
    assert.equal(db.state.tasks.length, 1);
    assert.equal(db.state.log.length, 1);
  });

  test("the press is one money_agent_log row: action ready_to_fund, keyed per round, linked to the task", async () => {
    const db = memDb();
    await requestReadyToFund(db, { orgId: ORG, clientId: CLIENT, actor: "staff", todayIso: "2026-10-07" });
    const row = db.state.log[0];
    assert.equal(row.action, "ready_to_fund");
    assert.equal(row.item_kind, "client");
    assert.equal(row.actor, "staff");
    assert.equal(row.brain, null);
    assert.equal(row.idempotency_key, `ready-to-fund:${CLIENT}:r1`);
    assert.equal(row.task_id, db.state.tasks[0].id);
  });

  test("after the CSM marks the call done, a new press opens round 2", async () => {
    const db = memDb();
    await requestReadyToFund(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-07" });
    db.state.tasks[0].done = true;
    const r = await requestReadyToFund(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-11-07" });
    assert.equal(r.created, true);
    assert.equal(r.round, 2);
    assert.equal(db.state.tasks[1].body, "blueprint-csm-prep-call:r2");
    assert.equal(db.state.log[1].idempotency_key, `ready-to-fund:${CLIENT}:r2`);
  });

  test("a client outside the org is null (the endpoint answers 404) and nothing is written", async () => {
    const db = memDb({ inOrg: false });
    assert.equal(await requestReadyToFund(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-07" }), null);
    assert.equal(await readyToFundStatus(db, { orgId: ORG, clientId: CLIENT }), null);
    assert.equal(db.state.tasks.length + db.state.log.length, 0);
  });

  test("for a Blueprint buyer, the Blueprint gate reads the FinanceOS press as its own prep call", async () => {
    // closer-ready.test.mjs's shape: the gate finds the prep call by (source, body).
    // A round-1 press writes exactly that pair, so once the CSM marks it done the
    // hourly gate goes straight to the closer alert instead of opening a second call.
    const pressed = { [`${CSM_PREP_SOURCE}:${roundBody(1)}`]: { id: "prep-from-financeos", done: true } };
    const state = { tasks: { ...pressed } };
    const db = {
      async query(sql, params) {
        if (/FROM transactions/i.test(sql) && /products/i.test(sql)) return { rows: [{ x: 1 }] };
        if (/client_waypoints/i.test(sql) && /open_count/i.test(sql)) return { rows: [{ total: 2, open_count: 0 }] };
        if (/FROM crs_results/i.test(sql)) return { rows: [{ result: { scores: { ex: 720, eq: 705, tu: 710 } }, created_at: "2026-10-01T00:00:00Z" }] };
        if (/FROM tradelines/i.test(sql)) return { rows: [{ id: "11111111-1111-4111-8111-111111111111", org_id: ORG, client_id: CLIENT, lender: "Chase", kind: "revolving", credit_limit_cents: 1_000_000, balance_cents: 250_000, apr: "0.1899", closed_at: null }] };
        if (/FROM card_liabilities|FROM businesses/i.test(sql)) return { rows: [] };
        if (/FROM clients/i.test(sql) && /custom_fields/i.test(sql)) return { rows: [{ custom_fields: { crs_negative_items_count: 0 } }] };
        if (/FROM tasks/i.test(sql) && /source_workflow/i.test(sql)) {
          const row = state.tasks[`${params[1]}:${params[2]}`];
          return { rows: row ? [row] : [] };
        }
        if (/INSERT INTO tasks/i.test(sql)) {
          state.tasks[`${params[5]}:${params[3]}`] = { id: "closer-1", done: false };
          return { rows: [{ id: "closer-1" }] };
        }
        return { rows: [] };
      }
    };
    const res = await evaluateBlueprintCloserReady(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(res.branch, "closer_alert", JSON.stringify(res));
  });
});

describe("upsell and side-sell — which door the client owns", () => {
  const offers = (blueprint, entitled) => productOffers({}, {
    orgId: ORG, clientId: CLIENT,
    isBlueprint: async () => blueprint,
    entitlement: async () => ({ entitled, subscriptionId: entitled ? "sub-1" : null })
  });

  test("no Blueprint → FinanceOS shows the Blueprint card, sold the way it is sold today: a call", async () => {
    const o = await offers(false, true);
    assert.equal(o.blueprint.owned, false);
    assert.deepEqual(o.blueprint.sell, { how: "call", url: BOOK_CALL_URL });
    assert.equal(BOOK_CALL_URL, "https://apply.fundhub.ai/schedule/phonecall");
    assert.equal(o.financeos.entitled, true);
    assert.equal(o.financeos.setup_url, null);
  });

  test("Blueprint without FinanceOS → the portal gets FinanceOS setup", async () => {
    const o = await offers(true, false);
    assert.equal(o.blueprint.owned, true);
    assert.equal(o.blueprint.sell, null, "never sell the Blueprint to someone who has it");
    assert.equal(o.financeos.entitled, false);
    assert.equal(o.financeos.setup_url, FINANCEOS_SETUP_URL);
    assert.equal(FINANCEOS_SETUP_URL, "/app/financeos.html#setup");
  });

  test("both owned → no card either way", async () => {
    const o = await offers(true, true);
    assert.equal(o.blueprint.sell, null);
    assert.equal(o.financeos.setup_url, null);
  });
});
