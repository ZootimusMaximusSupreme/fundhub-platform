// /api/money/banks?view=apply_gate and POST set_apply_override — the gate for
// both callers. Stubbed principal, db and store; no network, no Postgres.
// The rules are tested in src/finance/apply-gate.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/money/banks.mjs";
import { ApplyGateInputError } from "../finance/apply-gate.mjs";

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
const NOW = () => new Date("2026-11-07T12:00:00Z");

function spies(over = {}) {
  const calls = {};
  const spy = (name, ret) => async (_db, args) => {
    (calls[name] ||= []).push(args);
    return typeof ret === "function" ? ret(args) : ret;
  };
  return {
    calls,
    deps: {
      bankStrategy: spy("read", { ok: true, client: { id: MINE } }),
      applyGate: spy("gate", { ok: true, view: "apply_gate", gate: { status: "locked" } }),
      setApplyOverride: spy("override", { ok: true, id: "ov-1", bank_key: "bank of america", allow_more: true }),
      ...over
    }
  };
}

async function call(req, principal, { inOrg, s = spies() } = {}) {
  const res = makeRes();
  await handler(req, res, { db: db(inOrg), requirePrincipal: gateAs(principal), now: NOW, ...s.deps });
  return { res, calls: s.calls };
}

describe("GET /api/money/banks?view=apply_gate", () => {
  test("a client reads their own gate; ?client_id is never read; the bank plan read does not run", async () => {
    const { res, calls } = await call({ method: "GET", query: { view: "apply_gate", client_id: OTHER } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.view, "apply_gate");
    assert.equal(calls.gate[0].clientId, MINE);
    assert.equal(calls.gate[0].orgId, ORG);
    assert.equal(calls.gate[0].viewer, "client");
    assert.equal(calls.gate[0].asOf.toISOString(), "2026-11-07T12:00:00.000Z");
    assert.equal(calls.read, undefined);
  });

  test("staff FINANCE read the client in their org as staff; outside the org is 404", async () => {
    const ok = await call({ method: "GET", query: { view: "apply_gate", client_id: MINE } }, staffP("admin"));
    assert.equal(ok.res.statusCode, 200);
    assert.equal(ok.calls.gate[0].viewer, "staff");
    const outside = await call({ method: "GET", query: { view: "apply_gate", client_id: OTHER } }, staffP("admin"));
    assert.equal(outside.res.statusCode, 404);
    assert.equal(outside.calls.gate, undefined);
  });

  test("a staff role outside FINANCE is refused before any read", async () => {
    const { res, calls } = await call({ method: "GET", query: { view: "apply_gate", client_id: MINE } }, staffP("setter"));
    assert.equal(res.statusCode, 403);
    assert.equal(calls.gate, undefined);
  });

  test("no file for that client → 404; an unknown view → 400; no view → the bank plan as before", async () => {
    const none = await call({ method: "GET", query: { view: "apply_gate" } }, clientP(), { s: spies({ applyGate: async () => null }) });
    assert.equal(none.res.statusCode, 404);
    const bad = await call({ method: "GET", query: { view: "everything" } }, clientP());
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.error, "unknown_view");
    assert.equal(bad.calls.read, undefined);
    const plain = await call({ method: "GET", query: {} }, clientP());
    assert.equal(plain.res.statusCode, 200);
    assert.equal(plain.calls.read.length, 1);
    assert.equal(plain.calls.gate, undefined);
  });
});

describe("POST set_apply_override", () => {
  test("staff FINANCE save it for the client in their org, with their staff id", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "set_apply_override", client_id: MINE, bank: "Bank of America", allow_more: true } }, staffP("owner"));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, "set_apply_override");
    assert.equal(calls.override[0].clientId, MINE);
    assert.equal(calls.override[0].orgId, ORG);
    assert.equal(calls.override[0].staffId, STAFF_ID);
    assert.equal(calls.override[0].input.bank, "Bank of America");
  });

  test("a client can never set it", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "set_apply_override", bank: "Bank of America", allow_more: true } }, clientP());
    assert.equal(res.statusCode, 403);
    assert.equal(calls.override, undefined);
  });

  test("a bank outside the book is 404 in plain words; a bad input is 400", async () => {
    const missing = await call({ method: "POST", body: { action: "set_apply_override", client_id: MINE, bank: "Made Up", allow_more: true } },
      staffP("admin"), { s: spies({ setApplyOverride: async () => ({ ok: false, error: "not_found" }) }) });
    assert.equal(missing.res.statusCode, 404);
    assert.match(missing.res.body.message, /not in the bank book/);
    const bad = await call({ method: "POST", body: { action: "set_apply_override", client_id: MINE, bank: "Chase" } },
      staffP("admin"), { s: spies({ setApplyOverride: async () => { throw new ApplyGateInputError("allow_more_required", "Say yes or no."); } }) });
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.error, "allow_more_required");
  });
});
