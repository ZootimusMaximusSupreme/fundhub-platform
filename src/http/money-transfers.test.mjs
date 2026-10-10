// GET/POST /api/money/transfers — the gate and the actions (FinanceOS wave 5,
// W7). Stubbed principal; the engine runs on the in-memory store with a
// stand-in provider. No network, no Postgres.
//
// What this pins: a client only ever touches their own file; staff need the
// FINANCE role and a client in their org; ONLY the client approves (staff and
// authorized reps are refused); staff can propose and cancel; a client cannot
// propose; off means off.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import handler from "../../api/money/transfers.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { memoryStore } from "../finance/money-transfers-store.mjs";

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const ORG = "11111111-1111-4111-8111-111111111111";
const MINE = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const LOGIN = "44444444-4444-4444-8444-444444444444";
const STAFF_ID = "55555555-5555-4555-8555-555555555555";
const PC = "aaaaaaaa-0000-4000-8000-000000001101";
const BC = "aaaaaaaa-0000-4000-8000-000000002202";
const NOW = () => new Date("2026-10-07T15:00:00Z");

const ENV = Object.freeze({
  PLAID_ENV: "sandbox", PLAID_CLIENT_ID: "cid", PLAID_SECRET: "sec",
  PLAID_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64"),
  FINANCE_OS_TRANSFER_MAX_CENTS: "250000", FINANCE_OS_TRANSFER_DAILY_MAX_CENTS: "500000"
});

const clientP = (over = {}) => ({ kind: "client", accountId: LOGIN, orgId: ORG, clientId: MINE, ...over });
const staffP = (role = "owner") => ({ kind: "staff", role, orgId: ORG, staff: { id: STAFF_ID, role, org_id: ORG } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};
const orgDb = (inOrg = [MINE]) => ({
  query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: inOrg.includes(params[0]) ? [{ "?column?": 1 }] : [] } : { rows: [] })
});

function acct(id, over = {}) {
  return {
    id, org_id: ORG, client_id: MINE, name: "Account", mask: "0000", account_type: "depository", account_subtype: "checking",
    entity_kind: "personal", closed_at: null, is_demo: false, plaid_account_id: `p-${id.slice(-4)}`, available_balance_cents: 100000,
    item: { plaid_item_id: "item-1", encrypted_access_token: "v1:x:y:z", link_state: "active", consent_granted_at: "2026-10-01T00:00:00Z" },
    ...over
  };
}

function world() {
  const store = memoryStore({
    now: NOW,
    clients: [{ id: MINE, org_id: ORG, first_name: "Test", last_name: "Test" }],
    accounts: [acct(PC, { name: "Personal Checking", mask: "1101" }), acct(BC, { name: "Business Checking", mask: "2202" })]
  });
  const task = store.insertTask({
    org_id: ORG, client_id: MINE, task_key: `move:${crypto.randomUUID()}`, kind: "deposit", title: "Deposit to build banking history",
    source: "staff", amount_cents: 2000, to_kind: "bank_account", to_account_id: BC, due_on: "2026-10-07", requested_by_kind: "staff",
    created_at: NOW().toISOString()
  });
  const calls = [];
  const provider = {
    async authorizeLeg(a) { calls.push(["authorize", a.type]); return { ok: true, authorizationId: `auth-${a.idempotencyKey}`, decision: "approved" }; },
    async createLeg(a) { calls.push(["create"]); return { ok: true, transferId: `tr-${a.authorizationId}`, status: "pending" }; },
    async getLeg(id) { return { ok: true, transfer: { id, cancellable: true } }; },
    async cancelLeg() { calls.push(["cancel"]); return { ok: true }; },
    async eventsPage(after) { return { ok: true, events: [], hasMore: false, lastId: after }; }
  };
  return { store, task, provider, calls };
}

async function call(method, { principal, body, query = {}, deps = {}, env = ENV, inOrg } = {}) {
  const res = makeRes();
  await handler({ method, query, body }, res, { db: orgDb(inOrg), requirePrincipal: gateAs(principal), now: NOW, env, ...deps });
  return res;
}

const approveBody = (task, over = {}) => ({
  action: "approve", proposal_id: task.id, amount_cents: 2000, from_account_id: PC, to_account_id: BC, scheduled_for: "2026-10-07", ...over
});

describe("routing and methods", () => {
  test("the route exists", () => {
    assert.equal(ROUTES["money/transfers"], handler);
  });
  test("PUT is 405", async () => {
    const res = await call("PUT", { principal: clientP() });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "GET, POST");
  });
  test("no session is 401", async () => {
    assert.equal((await call("GET", {})).statusCode, 401);
  });
});

describe("GET — who sees what", () => {
  test("a client reads their own file; a client_id in the URL is ignored", async () => {
    const seen = [];
    const view = async (_s, args) => { seen.push(args); return { ok: true }; };
    const res = await call("GET", { principal: clientP(), query: { client_id: OTHER }, deps: { moneyTransfersView: view } });
    assert.equal(res.statusCode, 200);
    assert.equal(seen[0].clientId, MINE);
    assert.equal(seen[0].orgId, ORG);
  });
  test("a client login with no client file is refused", async () => {
    assert.equal((await call("GET", { principal: clientP({ clientId: null }) })).statusCode, 403);
  });
  test("staff need FINANCE, a client_id, and that client in their org", async () => {
    const view = async () => ({ ok: true });
    assert.equal((await call("GET", { principal: staffP("setter"), query: { client_id: MINE }, deps: { moneyTransfersView: view } })).statusCode, 403);
    assert.equal((await call("GET", { principal: staffP(), deps: { moneyTransfersView: view } })).statusCode, 400);
    assert.equal((await call("GET", { principal: staffP(), query: { client_id: OTHER }, deps: { moneyTransfersView: view } })).statusCode, 404);
    assert.equal((await call("GET", { principal: staffP(), query: { client_id: MINE }, deps: { moneyTransfersView: view } })).statusCode, 200);
  });
  test("the real read on the memory store", async () => {
    const w = world();
    const res = await call("GET", { principal: clientP(), deps: { store: w.store } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.waiting.length, 1);
    assert.equal(res.body.mode.environment, "sandbox");
  });
});

describe("approve — the client's own login only", () => {
  test("the client says yes: approved, sent at once because it is dated today", async () => {
    const w = world();
    const res = await call("POST", { principal: clientP(), body: approveBody(w.task), deps: { store: w.store, provider: w.provider } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.words, "Move $20.00 from Personal Checking ••1101 to Business Checking ••2202 on Oct 7, 2026");
    assert.equal(res.body.transfer.status, "submitted");
    assert.deepEqual(res.body.sent, { ok: true, step: "submitted", reason: null });
    const t = w.store.snapshot().transfers[0];
    assert.equal(t.approved_by_kind, "client");
    assert.equal(t.approved_by_account_id, LOGIN, "the login on the session, not anything in the body");
  });

  test("staff are refused, whatever the body says", async () => {
    const w = world();
    const res = await call("POST", { principal: staffP(), body: { ...approveBody(w.task), client_id: MINE }, deps: { store: w.store, provider: w.provider } });
    assert.equal(res.statusCode, 403);
    assert.equal(w.store.snapshot().transfers.length, 0);
    assert.equal(w.calls.length, 0);
  });

  test("an authorized representative is refused", async () => {
    const w = world();
    const res = await call("POST", { principal: clientP({ authorizedRep: true, accountKind: "authorized_rep" }), body: approveBody(w.task), deps: { store: w.store, provider: w.provider } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "owner_only");
    assert.equal(w.store.snapshot().transfers.length, 0);
  });

  test("a changed amount is refused in plain words", async () => {
    const w = world();
    const res = await call("POST", { principal: clientP(), body: approveBody(w.task, { amount_cents: 2500 }), deps: { store: w.store, provider: w.provider } });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.message, "That money move changed. Reload the page and look again.");
  });

  test("off: refused, nothing sent", async () => {
    const w = world();
    const off = { ...ENV };
    delete off.FINANCE_OS_TRANSFER_MAX_CENTS;
    const res = await call("POST", { principal: clientP(), env: off, body: approveBody(w.task), deps: { store: w.store, provider: w.provider } });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.message, "Money moves are off right now.");
    assert.equal(w.calls.length, 0);
  });

  test("another client's proposal id is not found", async () => {
    const w = world();
    const res = await call("POST", { principal: clientP({ clientId: OTHER }), body: approveBody(w.task), deps: { store: w.store, provider: w.provider } });
    assert.equal(res.statusCode, 404);
  });
});

describe("cancel — client or staff", () => {
  test("the client says not now", async () => {
    const w = world();
    const res = await call("POST", { principal: clientP(), body: { action: "cancel", proposal_id: w.task.id }, deps: { store: w.store, provider: w.provider } });
    assert.equal(res.statusCode, 200);
    assert.equal(w.store.snapshot().tasks[0].status, "cancelled");
  });
  test("staff take it off the list", async () => {
    const w = world();
    const res = await call("POST", { principal: staffP(), body: { action: "cancel", proposal_id: w.task.id, client_id: MINE }, deps: { store: w.store, provider: w.provider } });
    assert.equal(res.statusCode, 200);
    assert.equal(w.store.snapshot().log[0].actor, "staff");
  });
});

describe("propose — staff only, through the 464 seam", () => {
  const body = (over = {}) => ({ action: "propose", client_id: MINE, to_kind: "bank_account", to_account_id: BC, suggested_from_account_id: PC,
    amount_cents: 200000, due_on: "2026-10-20", title: "Deposit to build banking history", ...over });

  test("staff set up a move: proposeTransfer gets a staff request and a move: task key", async () => {
    const w = world();
    const seen = [];
    const propose = async (_db, p) => { seen.push(p); return { ok: true, created: true, proposalId: "p1", status: "needs_approval" }; };
    const res = await call("POST", { principal: staffP(), body: body(), deps: { store: w.store, proposeTransfer: propose } });
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.equal(seen[0].requestedByKind, "staff");
    assert.equal(seen[0].requestedByStaffId, STAFF_ID);
    assert.match(seen[0].taskKey, /^move:[0-9a-f-]{36}$/);
    assert.equal(seen[0].kind, "deposit");
    assert.equal(seen[0].amountCents, 200000);
    assert.deepEqual(seen[0].detail, { proposed_by: "staff", suggested_from_account_id: PC });
  });

  test("a client cannot propose", async () => {
    const res = await call("POST", { principal: clientP(), body: body() });
    assert.equal(res.statusCode, 403);
  });

  test("over the per-move cap, a past date, or a destination that cannot receive money is refused", async () => {
    const w = world();
    const propose = async () => { throw new Error("must not be called"); };
    const deps = { store: w.store, proposeTransfer: propose };
    assert.equal((await call("POST", { principal: staffP(), body: body({ amount_cents: 250001 }), deps })).body.error, "over_transfer_limit");
    assert.equal((await call("POST", { principal: staffP(), body: body({ due_on: "2026-10-01" }), deps })).body.error, "bad_date");
    assert.equal((await call("POST", { principal: staffP(), body: body({ to_account_id: crypto.randomUUID() }), deps })).body.error, "destination_not_found");
    assert.equal((await call("POST", { principal: staffP(), body: body({ title: "  " }), deps })).body.error, "bad_title");
  });
});
