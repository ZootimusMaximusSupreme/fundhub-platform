// /api/money/payments — gate and actions for both callers. Stubbed principal,
// db and store; no network, no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler, { paymentsPayload } from "../../api/money/payments.mjs";
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
const PLAN = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORG = "org-1";

const clientP = (clientId = MINE) => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId });
const staffP = (role) => ({ kind: "staff", role, orgId: ORG, staff: { id: "5aff0000-0000-4000-8000-000000000001", role, org_id: ORG } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};
const db = (inOrg = [MINE]) => ({
  query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: inOrg.includes(params[0]) ? [{ "?column?": 1 }] : [] } : { rows: [] })
});

function spies() {
  const calls = {};
  const spy = (name, ret) => async (_db, args) => { (calls[name] ||= []).push(args); return typeof ret === "function" ? ret(args) : ret; };
  return {
    calls,
    deps: {
      listClarityPayments: spy("list", []),
      moneyOverview: spy("overview", { ok: true, client: { id: MINE, name: "Sam" }, upcoming: [] }),
      readMoneyLog: spy("readLog", []),
      readUnmatchedPayments: spy("readUnmatched", [{ id: "u1", decided_on: "2026-10-06", reason: "amount_does_not_match", amount_cents: 20000, via: "commas", payment_id: "pay_x" }]),
      addClarityPayment: spy("add", { id: PLAN, plan: { kind: "clarity", owed_to: "Fundhub LLC", label: null, original_cents: 150000, installments: [1, 2, 3] } }),
      recordClarityPayment: spy("record", { ok: true, settled: false, moves: [], plan: { kind: "clarity" } }),
      settleClarityPayment: spy("settle", { ok: true, plan: { kind: "clarity" } }),
      logMoneyAction: spy("log", { created: true }),
      askForPerson: spy("ask", { ok: true, created: true })
    }
  };
}
const NOW = () => new Date("2026-10-06T12:00:00Z");

async function call(req, principal, { inOrg, s = spies() } = {}) {
  const res = makeRes();
  await handler(req, res, { db: db(inOrg), requirePrincipal: gateAs(principal), now: NOW, env: {}, ...s.deps });
  return { res, calls: s.calls };
}

describe("GET /api/money/payments", () => {
  test("is routed", () => {
    assert.equal(typeof ROUTES["money/payments"], "function");
  });

  test("a client reads their own file; ?client_id is never read", async () => {
    const { res, calls } = await call({ method: "GET", query: { client_id: OTHER } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.equal(calls.list[0].clientId, MINE);
    assert.equal(calls.readLog[0].clientId, MINE);
    assert.equal(res.body.agent.brain, "rules");
  });

  test("a login with no client file is refused", async () => {
    const { res, calls } = await call({ method: "GET", query: {} }, clientP(null));
    assert.equal(res.statusCode, 403);
    assert.equal(calls.list, undefined);
  });

  test("staff FINANCE with a client in their org reads it; outside the org is 404; no client_id is 400", async () => {
    const ok = await call({ method: "GET", query: { client_id: MINE } }, staffP("admin"));
    assert.equal(ok.res.statusCode, 200);
    const outside = await call({ method: "GET", query: { client_id: OTHER } }, staffP("admin"));
    assert.equal(outside.res.statusCode, 404);
    const none = await call({ method: "GET", query: {} }, staffP("owner"));
    assert.equal(none.res.statusCode, 400);
  });

  test("unmatched Commas payments: listed for staff, never read or sent for a client", async () => {
    const staff = await call({ method: "GET", query: { client_id: MINE } }, staffP("admin"));
    assert.equal(staff.res.body.unmatched_payments.length, 1);
    assert.equal(staff.res.body.unmatched_payments[0].reason, "amount_does_not_match");
    assert.equal(staff.calls.readUnmatched[0].clientId, MINE);
    const client = await call({ method: "GET", query: {} }, clientP());
    assert.equal("unmatched_payments" in client.res.body, false);
    assert.equal(client.calls.readUnmatched, undefined);
  });

  test("a staff role outside FINANCE is refused", async () => {
    const { res } = await call({ method: "GET", query: { client_id: MINE } }, staffP("setter"));
    assert.equal(res.statusCode, 403);
  });

  test("no session → 401", async () => {
    const { res } = await call({ method: "GET", query: {} }, null);
    assert.equal(res.statusCode, 401);
  });

  test("PUT is 405", async () => {
    const { res } = await call({ method: "PUT", query: {} }, clientP());
    assert.equal(res.statusCode, 405);
  });
});

describe("POST /api/money/payments", () => {
  test("a client can ask for a person — for their own file only", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "ask_for_person", client_id: OTHER } }, clientP());
    assert.equal(res.statusCode, 200);
    assert.equal(calls.ask[0].clientId, MINE);
    assert.equal(calls.ask[0].todayIso, "2026-10-06");
  });

  test("a client can NOT add a plan, record a payment or settle", async () => {
    for (const action of ["add_plan", "record_payment", "mark_settled"]) {
      const { res, calls } = await call({ method: "POST", body: { action, plan_id: PLAN, amount_cents: 1 } }, clientP());
      assert.equal(res.statusCode, 403, action);
      assert.equal(calls.add || calls.record || calls.settle, undefined);
    }
  });

  test("staff adds a plan for a client in their org, and it is logged as a staff step", async () => {
    const body = { action: "add_plan", client_id: MINE, kind: "clarity", installments: [{ due_on: "2026-11-01", amount_cents: 50000 }] };
    const { res, calls } = await call({ method: "POST", body }, staffP("admin"));
    assert.equal(res.statusCode, 201);
    assert.equal(calls.add[0].clientId, MINE);
    assert.equal(calls.log[0].action, "plan_added");
    assert.equal(calls.log[0].actor, "staff");
  });

  test("staff records a payment; the amount goes through as cents", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "record_payment", client_id: MINE, plan_id: PLAN, amount_cents: 50000 } }, staffP("owner"));
    assert.equal(res.statusCode, 200);
    assert.equal(calls.record[0].amountCents, 50000);
    assert.equal(calls.log[0].action, "payment_recorded");
  });

  test("staff marks a plan settled; a plan id that is not a uuid is 400", async () => {
    const ok = await call({ method: "POST", body: { action: "mark_settled", client_id: MINE, plan_id: PLAN } }, staffP("admin"));
    assert.equal(ok.res.statusCode, 200);
    const bad = await call({ method: "POST", body: { action: "mark_settled", client_id: MINE, plan_id: "x" } }, staffP("admin"));
    assert.equal(bad.res.statusCode, 400);
  });

  test("another client's plan → 404; a closed plan → 409", async () => {
    const s1 = spies();
    s1.deps.recordClarityPayment = async () => ({ ok: false, error: "not_found" });
    const nf = await call({ method: "POST", body: { action: "record_payment", client_id: MINE, plan_id: PLAN, amount_cents: 1 } }, staffP("admin"), { s: s1 });
    assert.equal(nf.res.statusCode, 404);
    const s2 = spies();
    s2.deps.settleClarityPayment = async () => ({ ok: false, error: "plan_not_open" });
    const closed = await call({ method: "POST", body: { action: "mark_settled", client_id: MINE, plan_id: PLAN } }, staffP("admin"), { s: s2 });
    assert.equal(closed.res.statusCode, 409);
  });

  test("an unknown action and a body that is not JSON are 400", async () => {
    assert.equal((await call({ method: "POST", body: { action: "wire_money" } }, clientP())).res.statusCode, 400);
    assert.equal((await call({ method: "POST", body: "{not json" }, clientP())).res.statusCode, 400);
  });
});

describe("paymentsPayload", () => {
  test("late installments stay on the plan; the next unpaid one inside 30 days goes in Payments due, by date", async () => {
    const plan = {
      id: PLAN, name: "Fundhub payment plan", status: "open", left_cents: 100000, late_cents: 50000, is_late: true,
      installments: [
        { seq: 2, due_on: "2026-10-02", left_cents: 50000, state: "late" },
        { seq: 3, due_on: "2026-11-02", left_cents: 50000, state: "upcoming" }
      ]
    };
    const p = await paymentsPayload(null, {
      orgId: ORG, clientId: MINE, asOf: new Date("2026-10-06T12:00:00Z"), env: {},
      list: async () => [plan],
      overview: async () => ({ client: { id: MINE }, upcoming: [{ type: "card_due", name: "Amex", on: "2026-10-21", amount_cents: 13500 }] }),
      readLog: async () => []
    });
    assert.deepEqual(p.upcoming.map((u) => [u.type, u.on]), [["card_due", "2026-10-21"], ["clarity", "2026-11-02"]]);
    assert.deepEqual(p.owed, { open_count: 1, left_cents: 100000, late_cents: 50000, late_count: 1 });
  });
});

describe("paymentsPayload — phone alerts on each plan (unit D2)", () => {
  const plan = (over = {}) => ({
    id: PLAN, name: "Fundhub payment plan", status: "open", left_cents: 100000, late_cents: 0, is_late: false,
    next: { seq: 3, due_on: "2026-11-02", left_cents: 50000, state: "upcoming" },
    installments: [{ id: "inst-3", seq: 3, due_on: "2026-11-02", left_cents: 50000, state: "upcoming" }], ...over
  });
  const build = (plans, summary, asOf = "2026-10-06T12:00:00Z") => paymentsPayload(null, {
    orgId: ORG, clientId: MINE, asOf: new Date(asOf), env: {},
    list: async () => plans, readLog: async () => [],
    overview: async () => ({ client: { id: MINE }, upcoming: [] }),
    phone: async () => summary
  });
  const ON = { enabled: true, opted_out: false, has_phone: true, days_before: 3, sent: [] };

  test("the alert day is 3 days before the next payment; inside the window it is today; a sent alert says so", async () => {
    assert.deepEqual((await build([plan()], ON)).phone.plans[PLAN], { due_on: "2026-11-02", alert_on: "2026-10-30", reason: null, sent: null });
    assert.equal((await build([plan()], ON, "2026-10-31T12:00:00Z")).phone.plans[PLAN].alert_on, "2026-10-31");
    const sent = { ...ON, sent: [{ kind: "plan_due", subject_id: "inst-3", about_on: "2026-11-02", state: "sent" }] };
    assert.equal((await build([plan()], sent)).phone.plans[PLAN].sent, "sent");
  });

  test("switched off, STOP or a late payment: no alert day, and the reason", async () => {
    assert.deepEqual((await build([plan()], { ...ON, enabled: false })).phone.plans[PLAN],
      { due_on: "2026-11-02", alert_on: null, reason: "phone_alerts_off", sent: null });
    assert.equal((await build([plan()], { ...ON, opted_out: true })).phone.plans[PLAN].reason, "opted_out");
    const late = plan({ next: { seq: 2, due_on: "2026-10-02", left_cents: 50000, state: "late" } });
    assert.deepEqual((await build([late], ON)).phone.plans[PLAN], { due_on: "2026-10-02", alert_on: null, reason: "late", sent: null });
  });

  test("a failed phone read is null, never a made-up answer; a settled plan has no line", async () => {
    const two = [plan(), plan({ id: "settled-1", status: "settled", next: null })];
    const p = await paymentsPayload(null, {
      orgId: ORG, clientId: MINE, asOf: new Date("2026-10-06T12:00:00Z"), env: {},
      list: async () => two, readLog: async () => [],
      overview: async () => ({ client: { id: MINE }, upcoming: [] }),
      phone: async () => { throw new Error("db down"); }
    });
    assert.equal(p.phone, null);
    assert.deepEqual(Object.keys((await build(two, ON)).phone.plans), [PLAN]);
  });
});

describe("paymentsPayload — Whop plans (unit W)", () => {
  const ON = { enabled: true, opted_out: false, has_phone: true, days_before: 3, sent: [] };
  const whopRow = (over = {}) => ({
    id: "d1000000-0000-4000-8000-000000000001", product_title: "Consulting Services Package", status: "active",
    renewal_cents: 50000, billing_period_days: 30, split_pay_required: null, split_pay_paid: null,
    cancel_at_period_end: false, period_end_on: "2026-10-20", matched_by: "email",
    synced_at: "2026-10-06T07:01:00.000Z", unlinked_at: null, ...over
  });
  const build = (whop, summary = ON) => paymentsPayload(null, {
    orgId: ORG, clientId: MINE, asOf: new Date("2026-10-06T12:00:00Z"), env: {},
    list: async () => [], readLog: async () => [],
    overview: async () => ({ client: { id: MINE }, upcoming: [{ type: "card_due", name: "Amex", on: "2026-10-21", amount_cents: 13500 }] }),
    phone: async () => summary, whop
  });

  test("the client's Whop plans come back with their phone alert day; the next charge joins Payments due by date", async () => {
    const asked = [];
    const p = await build(async (_db, args) => { asked.push(args); return [whopRow()]; });
    assert.deepEqual(asked, [{ orgId: ORG, clientId: MINE }]);
    assert.equal(p.whop.count, 1);
    assert.deepEqual(p.whop.plans[0].next, { due_on: "2026-10-20", amount_cents: 50000, days_away: 14 });
    assert.equal(p.whop.plans[0].phone.alert_on, "2026-10-17");
    assert.deepEqual(p.upcoming.map((u) => [u.type, u.on, u.amount_cents]), [["whop", "2026-10-20", 50000], ["card_due", "2026-10-21", 13500]]);
  });

  test("a failed Whop read is null, never a made-up 'no plans'; the rest of Payments still answers", async () => {
    const p = await build(async () => { throw new Error("relation whop_memberships does not exist"); });
    assert.equal(p.whop, null);
    assert.equal(p.ok, true);
    assert.deepEqual(p.upcoming.map((u) => u.type), ["card_due"]);
  });

  test("the handler reads the Whop plans of the signed-in client only", async () => {
    const s = spies();
    s.deps.listWhopPlans = async (_db, args) => { (s.calls.whop ||= []).push(args); return []; };
    const { res, calls } = await call({ method: "GET", query: { client_id: OTHER } }, clientP(), { s });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls.whop, [{ orgId: ORG, clientId: MINE }]);
    assert.deepEqual(res.body.whop.plans, []);
  });
});
