// /api/money/accounts — business gas cards (Finance OS wave 4, unit GAS). The
// view carries fuel_cards; POST track_fuel_card and set_fuel_card. Stubbed
// principal, db and gas card rules; no network, no Postgres. The rules are
// tested in src/finance/fuel-cards.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/money/accounts.mjs";

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const ORG = "org-1";
const MINE = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const CARD = "f1000000-0000-4000-8000-000000000001";
const BIZ = "e1000000-0000-4000-8000-000000000001";
const LENDER = "87d7af03-247d-4f79-8f5c-f0e1c8adc144";
const BLOCK = { ok: true, viewer: "client", risk: "Miss a payment and it hurts your business credit.", count: 1, by_business: {} };

const clientP = () => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId: MINE });
const staffP = (role = "admin") => ({ kind: "staff", role, orgId: ORG, staff: { id: "5aff0000-0000-4000-8000-000000000001", role, org_id: ORG } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};
/* The clients table answers for both; every other read is empty, so the
   accounts view is an empty file. */
const db = { query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: [MINE, OTHER].includes(params[0]) ? [{ "?column?": 1 }] : [] } : { rows: [] }) };

function spies(over = {}) {
  const calls = { read: [], track: [], set: [] };
  return {
    calls,
    deps: {
      readFuelCards: async (_db, args) => { calls.read.push(args); return { ...BLOCK, viewer: args.viewer }; },
      trackFuelCard: over.trackFuelCard || (async (_db, args) => { calls.track.push(args); return { ok: true, account_id: "acct-new" }; }),
      setFuelCard: over.setFuelCard || (async (_db, args) => { calls.set.push(args); return { ok: true, card: { id: CARD, lender_id: args.lenderId, active: args.active } }; })
    }
  };
}
async function call(req, principal, s = spies()) {
  const res = makeRes();
  await handler(req, res, { db, requirePrincipal: gateAs(principal), now: () => new Date("2026-11-07T12:00:00Z"), env: {}, ...s.deps });
  return { res, calls: s.calls };
}

describe("GET /api/money/accounts — fuel_cards", () => {
  test("a client's view carries the gas card list for their own file, as the client", async () => {
    const { res, calls } = await call({ method: "GET", query: { client_id: OTHER } }, clientP());
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.fuel_cards.risk, "Miss a payment and it hurts your business credit.");
    assert.equal(calls.read[0].clientId, MINE);
    assert.equal(calls.read[0].orgId, ORG);
    assert.equal(calls.read[0].viewer, "client");
    assert.ok(Array.isArray(res.body.containers), "the accounts view is unchanged");
  });

  test("staff read the client they named, as staff", async () => {
    const { res, calls } = await call({ method: "GET", query: { client_id: MINE } }, staffP());
    assert.equal(res.statusCode, 200);
    assert.equal(calls.read[0].viewer, "staff");
  });

  test("a gas card read that throws leaves the accounts standing", async () => {
    const s = spies();
    s.deps.readFuelCards = async () => { throw new Error("down"); };
    const { res } = await call({ method: "GET", query: {} }, clientP(), s);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.fuel_cards, { ok: false, reason: "read_failed" });
  });
});

describe("POST track_fuel_card", () => {
  test("a client tracks a gas card in their own business; client_id in the body is never read", async () => {
    const body = { action: "track_fuel_card", fuel_card_id: CARD, container_id: BIZ, due_day: "15", limit: "1,500", client_id: OTHER };
    const { res, calls } = await call({ method: "POST", body }, clientP());
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.action, "track_fuel_card");
    assert.equal(res.body.account_id, "acct-new");
    assert.ok(res.body.fuel_cards, "answers with the whole view again");
    const args = calls.track[0];
    assert.equal(args.clientId, MINE);
    assert.equal(args.orgId, ORG);
    assert.equal(args.fuelCardId, CARD);
    assert.equal(args.containerId, BIZ);
    assert.equal(args.input.due_day, "15");
    assert.deepEqual(args.by, { kind: "client", id: "acc-1" });
  });

  test("refusals keep their status: not on the list 404, already tracked 409, a bad field 400 in words", async () => {
    let s = spies({ trackFuelCard: async () => ({ ok: false, reason: "fuel_card_not_found" }) });
    assert.equal((await call({ method: "POST", body: { action: "track_fuel_card" } }, clientP(), s)).res.statusCode, 404);
    s = spies({ trackFuelCard: async () => ({ ok: false, reason: "already_tracked" }) });
    assert.equal((await call({ method: "POST", body: { action: "track_fuel_card" } }, clientP(), s)).res.statusCode, 409);
    s = spies({ trackFuelCard: async () => { throw new TypeError("due day is required — the day of the month this card is due, 1 to 31"); } });
    const r = await call({ method: "POST", body: { action: "track_fuel_card" } }, clientP(), s);
    assert.equal(r.res.statusCode, 400);
    assert.match(r.res.body.error, /due day is required/);
  });

  test("a full account number is refused before the rules run", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "track_fuel_card", account_number: "4111111111111111" } }, clientP());
    assert.equal(res.statusCode, 400);
    assert.equal(calls.track.length, 0);
  });
});

describe("POST set_fuel_card", () => {
  test("a client cannot change the list", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "set_fuel_card", lender_id: LENDER } }, clientP());
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "staff_only");
    assert.equal(calls.set.length, 0);
  });
  test("staff put a bank-book row on the list or take it off", async () => {
    const on = await call({ method: "POST", body: { action: "set_fuel_card", lender_id: LENDER, client_id: MINE } }, staffP());
    assert.equal(on.res.statusCode, 200);
    assert.equal(on.calls.set[0].active, true);
    assert.equal(on.calls.set[0].orgId, ORG);
    const off = await call({ method: "POST", body: { action: "set_fuel_card", lender_id: LENDER, active: false, client_id: MINE } }, staffP());
    assert.equal(off.calls.set[0].active, false);
    const s = spies({ setFuelCard: async () => ({ ok: false, reason: "lender_not_found" }) });
    assert.equal((await call({ method: "POST", body: { action: "set_fuel_card", lender_id: LENDER, client_id: MINE } }, staffP(), s)).res.statusCode, 404);
  });
});
