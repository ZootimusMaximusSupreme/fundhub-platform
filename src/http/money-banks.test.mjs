// /api/money/banks — the gate for both callers and every staff action. Stubbed
// principal, db and store; no network, no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/money/banks.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { BankStrategyInputError } from "../finance/bank-strategy.mjs";

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
const REL = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
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

function spies(over = {}) {
  const calls = {};
  const spy = (name, ret) => async (_db, args) => {
    (calls[name] ||= []).push(args);
    if (typeof ret === "function") return ret(args);
    return ret;
  };
  return {
    calls,
    deps: {
      bankStrategy: spy("read", { ok: true, client: { id: MINE, name: "Sam" }, recommended_banks: [] }),
      planBank: spy("plan", { ok: true, id: REL, state: "open" }),
      openAccount: spy("open", { ok: true, id: REL }),
      recordDeposit: spy("deposit", { ok: true, id: "dep-1" }),
      setRelationshipState: spy("state", { ok: true, todo: { id: REL, state: "skipped" } }),
      setNextRoundDate: spy("nextDate", { ok: true, readyDate: "2026-12-01" }),
      ...over
    }
  };
}
const NOW = () => new Date("2026-10-06T12:00:00Z");

async function call(req, principal, { inOrg, s = spies() } = {}) {
  const res = makeRes();
  await handler(req, res, { db: db(inOrg), requirePrincipal: gateAs(principal), now: NOW, ...s.deps });
  return { res, calls: s.calls };
}

describe("GET /api/money/banks", () => {
  test("is routed", () => {
    assert.equal(typeof ROUTES["money/banks"], "function");
  });

  test("a client reads their own file; ?client_id is never read", async () => {
    const { res, calls } = await call({ method: "GET", query: { client_id: OTHER } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.equal(calls.read[0].clientId, MINE);
    assert.equal(calls.read[0].orgId, ORG);
    assert.equal(calls.read[0].asOf.toISOString(), "2026-10-06T12:00:00.000Z");
  });

  test("a login with no client file is refused", async () => {
    const { res, calls } = await call({ method: "GET", query: {} }, clientP(null));
    assert.equal(res.statusCode, 403);
    assert.equal(calls.read, undefined);
  });

  test("staff FINANCE with a client in their org reads it; outside the org is 404; no client_id is 400", async () => {
    for (const role of ["owner", "admin", "sales_manager"]) {
      const ok = await call({ method: "GET", query: { client_id: MINE } }, staffP(role));
      assert.equal(ok.res.statusCode, 200, role);
    }
    const outside = await call({ method: "GET", query: { client_id: OTHER } }, staffP("admin"));
    assert.equal(outside.res.statusCode, 404);
    assert.equal(outside.calls.read, undefined);
    const none = await call({ method: "GET", query: {} }, staffP("owner"));
    assert.equal(none.res.statusCode, 400);
  });

  test("a staff role outside FINANCE is refused", async () => {
    for (const role of ["setter", "funding_advisor", "csm", "setter"]) {
      const { res, calls } = await call({ method: "GET", query: { client_id: MINE } }, staffP(role));
      assert.equal(res.statusCode, 403, role);
      assert.equal(calls.read, undefined);
    }
  });

  test("no session → 401; PUT → 405", async () => {
    assert.equal((await call({ method: "GET", query: {} }, null)).res.statusCode, 401);
    const put = await call({ method: "PUT", query: {} }, clientP());
    assert.equal(put.res.statusCode, 405);
    assert.equal(put.res.headers.allow, "GET, POST");
  });

  test("the file math's staff flags are for staff: a client's read carries none, a staff read keeps them", async () => {
    const shared = () => {
      const next = { date: null, suggestion: { flags: [{ id: "staff_date_before_suggestion", text: "x" }], confidence: "computed" } };
      return { ok: true, client: { id: MINE }, next_sequence: next, next_round: next };
    };
    const asClient = await call({ method: "GET", query: {} }, clientP(), { s: spies({ bankStrategy: async () => shared() }) });
    assert.deepEqual(asClient.res.body.next_sequence.suggestion.flags, []);
    assert.deepEqual(asClient.res.body.next_round.suggestion.flags, [], "the alias is the same object");
    assert.equal(asClient.res.body.next_sequence.suggestion.confidence, "computed", "the rest of the answer is untouched");
    const asStaff = await call({ method: "GET", query: { client_id: MINE } }, staffP("admin"), { s: spies({ bankStrategy: async () => shared() }) });
    assert.equal(asStaff.res.body.next_sequence.suggestion.flags.length, 1);
    /* an answer with no suggestion (its reads failed) passes through as it is */
    const none = await call({ method: "GET", query: {} }, clientP(), { s: spies({ bankStrategy: async () => ({ ok: true, next_sequence: { suggestion: null } }) }) });
    assert.equal(none.res.statusCode, 200);
  });

  test("a client the read cannot find is 404", async () => {
    const s = spies({ bankStrategy: async () => null });
    const { res } = await call({ method: "GET", query: {} }, clientP(), { s });
    assert.equal(res.statusCode, 404);
  });
});

describe("POST /api/money/banks", () => {
  test("a client can never change the plan", async () => {
    for (const action of ["plan_bank", "open_account", "record_deposit", "set_state", "set_next_sequence_date", "set_next_round_date"]) {
      const { res, calls } = await call({ method: "POST", body: { action, client_id: MINE } }, clientP());
      assert.equal(res.statusCode, 403, action);
      assert.match(res.body.message, /Only Fundhub staff/);
      assert.equal(Object.keys(calls).length, 0, `${action} reached the store`);
    }
  });

  test("staff plan a bank: the body goes through, pinned to the client in the body and the staff's org", async () => {
    const body = { action: "plan_bank", client_id: MINE, bank: "Chase", planned_open_on: "2026-10-20", planned_deposit_cents: 1000000 };
    const { res, calls } = await call({ method: "POST", body }, staffP("admin"));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, "plan_bank");
    assert.equal(calls.plan[0].clientId, MINE);
    assert.equal(calls.plan[0].orgId, ORG);
    assert.equal(calls.plan[0].input.planned_deposit_cents, 1000000);
  });

  test("open an account and record a deposit: today and the staff id travel with them", async () => {
    const open = await call({ method: "POST", body: { action: "open_account", client_id: MINE, relationship_id: REL, opened_on: "2026-10-01" } }, staffP("owner"));
    assert.equal(open.res.statusCode, 200);
    assert.equal(open.calls.open[0].today, "2026-10-06");
    const dep = await call({ method: "POST", body: { action: "record_deposit", client_id: MINE, relationship_id: REL, amount_cents: 500000, deposited_on: "2026-10-02" } }, staffP("owner"));
    assert.equal(dep.res.statusCode, 201);
    assert.equal(dep.calls.deposit[0].staffId, STAFF_ID);
    assert.equal(dep.calls.deposit[0].today, "2026-10-06");
  });

  test("a staff body for another org's client is 404 before any write", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "plan_bank", client_id: OTHER, bank: "Chase" } }, staffP("admin"));
    assert.equal(res.statusCode, 404);
    assert.equal(calls.plan, undefined);
  });

  test("unknown action is 400; a bad body is 400", async () => {
    const u = await call({ method: "POST", body: { action: "move_money", client_id: MINE } }, staffP("admin"));
    assert.equal(u.res.statusCode, 400);
    assert.equal(u.res.body.error, "unknown_action");
    const bad = await call({ method: "POST", body: "{not json", query: {} }, staffP("admin"));
    assert.equal(bad.res.statusCode, 400);
  });

  test("a refused input answers 400 with the plain sentence", async () => {
    const s = spies({ recordDeposit: async () => { throw new BankStrategyInputError("deposit_before_open", "A deposit cannot be dated before the account was opened."); } });
    const { res } = await call({ method: "POST", body: { action: "record_deposit", client_id: MINE, relationship_id: REL } }, staffP("admin"), { s });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "deposit_before_open");
    assert.match(res.body.message, /before the account was opened/);
  });

  test("a relationship that is not this client's is 404, in words", async () => {
    const s = spies({ openAccount: async () => ({ ok: false, error: "not_found" }) });
    const { res } = await call({ method: "POST", body: { action: "open_account", client_id: MINE, relationship_id: REL, opened_on: "2026-10-01" } }, staffP("admin"), { s });
    assert.equal(res.statusCode, 404);
    assert.match(res.body.message, /not on this client's plan/);
  });

  test("the next funding sequence date is Blueprint only: a non-buyer is 403 in words", async () => {
    const s = spies({ setNextRoundDate: async () => ({ ok: false, error: "not_blueprint_buyer" }) });
    const { res } = await call({ method: "POST", body: { action: "set_next_sequence_date", client_id: MINE, ready_date: "2026-12-01" } }, staffP("admin"), { s });
    assert.equal(res.statusCode, 403);
    assert.match(res.body.message, /next funding sequence date is part of the Capital Blueprint/);
    assert.doesNotMatch(res.body.message, /round/i);
  });

  test("a bad date is 400 in the new words", async () => {
    const s = spies({ setNextRoundDate: async () => ({ ok: false, error: "invalid_ready_date" }) });
    const { res } = await call({ method: "POST", body: { action: "set_next_sequence_date", client_id: MINE, ready_date: "soon" } }, staffP("admin"), { s });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /next funding sequence date must be a date like 2026-12-01/);
  });

  test("set_next_sequence_date and its old name set_next_round_date reach the same writer; the new dep name wins", async () => {
    const neu = spies();
    const a = await call({ method: "POST", body: { action: "set_next_sequence_date", client_id: MINE, ready_date: "2026-12-01" } }, staffP("admin"), { s: neu });
    assert.equal(a.res.statusCode, 200);
    assert.equal(a.res.body.action, "set_next_sequence_date");
    assert.equal(neu.calls.nextDate[0].input.ready_date, "2026-12-01");
    const old = spies();
    const b = await call({ method: "POST", body: { action: "set_next_round_date", client_id: MINE, ready_date: "2026-12-02" } }, staffP("admin"), { s: old });
    assert.equal(b.res.statusCode, 200);
    assert.equal(b.res.body.action, "set_next_round_date");
    assert.equal(old.calls.nextDate[0].input.ready_date, "2026-12-02");
    const both = spies({ setNextSequenceDate: async (_db, args) => ({ ok: true, readyDate: args.input.ready_date, via: "new" }) });
    const c = await call({ method: "POST", body: { action: "set_next_round_date", client_id: MINE, ready_date: "2026-12-03" } }, staffP("admin"), { s: both });
    assert.equal(c.res.body.via, "new");
  });
});
