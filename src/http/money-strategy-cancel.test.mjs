// /api/money/strategy — "Cancel it for me" (Finance OS wave 4, unit CANCEL).
// The GET carries bill_cancel; POST cancel_bill and set_cancel_link. Stubbed
// principal, db and readers; no network, no Postgres, no real task.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/money/strategy.mjs";

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
const BILL = "b1000000-0000-4000-8000-000000000001";
const BLOCK = { ok: true, viewer: "client", bills: [{ id: BILL, name: "Sample Streaming", cancel: { state: "none", can_ask: true } }], counts: { requested: 0, working: 0, cancelled: 0 } };

const clientP = () => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId: MINE });
const staffP = (role = "admin") => ({ kind: "staff", role, orgId: ORG, staff: { id: STAFF_ID, role, org_id: ORG } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};
const db = { query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: [MINE, OTHER].includes(params[0]) ? [{ "?column?": 1 }] : [] } : { rows: [] }) };

function deps(over = {}) {
  const calls = {};
  const push = (k, v) => { (calls[k] ||= []).push(v); };
  return {
    calls,
    deps: {
      strategyPayload: async (_db, args) => ({ ok: true, client: { id: args.clientId }, inputs: { debts: [] } }),
      readBillCancel: async (_db, args) => { push("read", args); return BLOCK; },
      requestBillCancel: async (_db, args) => { push("ask", args); return { ok: true, created: true, bill_cancel: BLOCK }; },
      setCancelLink: async (_db, args) => { push("link", args); return { ok: true, link: { url: args.url }, bill_cancel: BLOCK }; },
      ...over
    }
  };
}
const NOW = () => new Date("2026-11-07T12:00:00Z");

async function call(req, principal, s = deps()) {
  const res = makeRes();
  await handler(req, res, { db, requirePrincipal: gateAs(principal), now: NOW, env: {}, ...s.deps });
  return { res, calls: s.calls };
}

describe("GET /api/money/strategy carries the repeat bills block", () => {
  test("a client reads their own bills, as the client", async () => {
    const { res, calls } = await call({ method: "GET", query: { client_id: OTHER } }, clientP());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.bill_cancel, BLOCK);
    assert.equal(calls.read[0].clientId, MINE);
    assert.equal(calls.read[0].orgId, ORG);
    assert.equal(calls.read[0].viewer, "client");
    assert.equal(res.body.ok, true, "the plan's own fields are still there");
  });

  test("staff read the client they named, as staff", async () => {
    const { res, calls } = await call({ method: "GET", query: { client_id: MINE } }, staffP());
    assert.equal(res.statusCode, 200);
    assert.equal(calls.read[0].viewer, "staff");
    assert.equal(calls.read[0].clientId, MINE);
  });

  test("a bills read that throws leaves the plan standing", async () => {
    const s = deps({ readBillCancel: async () => { throw new Error("down"); } });
    const { res } = await call({ method: "GET", query: {} }, clientP(), s);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.bill_cancel, { ok: false, reason: "read_failed" });
    assert.equal(res.body.ok, true);
  });
});

describe("POST cancel_bill", () => {
  test("a client's press opens the ask on their own file; a client_id in the body is never read", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "cancel_bill", bill_id: BILL, client_id: OTHER } }, clientP());
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.action, "cancel_bill");
    assert.equal(res.body.created, true);
    assert.deepEqual(res.body.bill_cancel, BLOCK);
    assert.equal(calls.ask[0].clientId, MINE);
    assert.equal(calls.ask[0].billId, BILL);
    assert.equal(calls.ask[0].actor, "client");
    assert.equal(calls.ask[0].now.toISOString(), "2026-11-07T12:00:00.000Z");
  });

  test("staff press for the client they named, as staff", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "cancel_bill", bill_id: BILL, client_id: MINE } }, staffP());
    assert.equal(res.statusCode, 200);
    assert.equal(calls.ask[0].actor, "staff");
    assert.equal(calls.ask[0].staffId, STAFF_ID);
  });

  test("a bad bill id is 400 and opens nothing", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "cancel_bill", bill_id: "nope" } }, clientP());
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "bad_bill_id");
    assert.equal(calls.ask, undefined);
  });

  test("a bill not on file is 404 with plain words; a failed save is 500", async () => {
    let s = deps({ requestBillCancel: async () => ({ ok: false, error: "bill_not_found" }) });
    let r = await call({ method: "POST", body: { action: "cancel_bill", bill_id: BILL } }, clientP(), s);
    assert.equal(r.res.statusCode, 404);
    assert.match(r.res.body.message, /not on your file/);
    s = deps({ requestBillCancel: async () => ({ ok: false, error: "task_not_saved" }) });
    r = await call({ method: "POST", body: { action: "cancel_bill", bill_id: BILL } }, clientP(), s);
    assert.equal(r.res.statusCode, 500);
    assert.equal(r.res.body.error, "task_not_saved");
  });
});

describe("POST set_cancel_link", () => {
  test("a client cannot save a cancel link", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "set_cancel_link", bill_id: BILL, url: "https://example.com/c" } }, clientP());
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "staff_only");
    assert.equal(calls.link, undefined);
  });

  test("staff save it for the client they named", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "set_cancel_link", bill_id: BILL, url: "https://example.com/c", client_id: MINE } }, staffP());
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, "set_cancel_link");
    assert.deepEqual(calls.link[0], { orgId: ORG, clientId: MINE, billId: BILL, url: "https://example.com/c", staffId: STAFF_ID });
  });

  test("a bad link is 400 in plain words", async () => {
    const s = deps({ setCancelLink: async () => ({ ok: false, error: "bad_url" }) });
    const { res } = await call({ method: "POST", body: { action: "set_cancel_link", bill_id: BILL, url: "http://x", client_id: MINE } }, staffP(), s);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /https:\/\//);
  });
});

test("any other action is still unknown", async () => {
  const { res } = await call({ method: "POST", body: { action: "cancel_everything" } }, clientP());
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "unknown_action");
});
