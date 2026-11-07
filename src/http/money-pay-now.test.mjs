// /api/money/payments — the "Pay now" / "I paid" parts (FinanceOS unit I6).
// GET ?part=pay_now and POST card_paid / card_paid_undo. Stubbed principal, db
// and store; no network, no Postgres, no money.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/money/payments.mjs";

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
const CARD = "ca000000-0000-4000-8000-000000000001";
const CLAIM = "c1a10000-0000-4000-8000-000000000001";
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

const PAY = { ok: true, as_of: "2026-11-07T12:00:00.000Z", today: "2026-11-07", cards: [{ account_id: CARD, pay_url: "https://www.chase.com/", pay_site: "chase.com", claim: null }] };

function spies(over = {}) {
  const calls = {};
  const spy = (name, ret) => async (_db, args) => { (calls[name] ||= []).push(args); return typeof ret === "function" ? ret(args) : ret; };
  return {
    calls,
    deps: {
      listClarityPayments: spy("list", []),
      moneyOverview: spy("overview", { ok: true, client: { id: MINE, name: "Sam" }, upcoming: [] }),
      readMoneyLog: spy("readLog", []),
      readUnmatchedPayments: spy("readUnmatched", []),
      cardPayNow: spy("payNow", over.payNow === undefined ? PAY : over.payNow),
      recordCardPaid: spy("record", over.record || { ok: true, claim: { id: CLAIM, due_on: "2026-11-21", paid_on: "2026-11-07", amount_cents: null } }),
      withdrawCardPaid: spy("withdraw", over.withdraw || { ok: true })
    }
  };
}
const NOW = () => new Date("2026-11-07T12:00:00Z");

async function call(req, principal, { inOrg, s = spies() } = {}) {
  const res = makeRes();
  await handler(req, res, { db: db(inOrg), requirePrincipal: gateAs(principal), now: NOW, env: {}, ...s.deps });
  return { res, calls: s.calls };
}

describe("GET /api/money/payments?part=pay_now", () => {
  test("a client reads only their own cards; ?client_id is never read; the heavy page read is skipped", async () => {
    const { res, calls } = await call({ method: "GET", query: { part: "pay_now", client_id: OTHER } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, pay_now: PAY });
    assert.equal(calls.payNow[0].clientId, MINE);
    assert.equal(calls.payNow[0].orgId, ORG);
    assert.equal(calls.overview, undefined, "the overview is not rebuilt for this part");
  });

  test("staff: FINANCE role + a client in their org; outside the org is 404; a non-finance role is refused", async () => {
    const ok = await call({ method: "GET", query: { part: "pay_now", client_id: MINE } }, staffP("admin"));
    assert.equal(ok.res.statusCode, 200);
    assert.equal(ok.calls.payNow[0].clientId, MINE);
    const out = await call({ method: "GET", query: { part: "pay_now", client_id: OTHER } }, staffP("admin"));
    assert.equal(out.res.statusCode, 404);
    assert.equal(out.calls.payNow, undefined);
    const setter = await call({ method: "GET", query: { part: "pay_now", client_id: MINE } }, staffP("setter"));
    assert.equal(setter.res.statusCode, 403);
    assert.equal(setter.calls.payNow, undefined);
  });

  test("no client file behind the read → 404; signed out → 401", async () => {
    const gone = await call({ method: "GET", query: { part: "pay_now" } }, clientP(), { s: spies({ payNow: null }) });
    assert.equal(gone.res.statusCode, 404);
    const anon = await call({ method: "GET", query: { part: "pay_now" } }, null);
    assert.equal(anon.res.statusCode, 401);
  });

  test("without part the page read is unchanged (no pay_now key)", async () => {
    const { res, calls } = await call({ method: "GET", query: {} }, clientP());
    assert.equal(res.statusCode, 200);
    assert.equal("pay_now" in res.body, false);
    assert.equal(calls.payNow, undefined);
  });
});

describe("POST /api/money/payments card_paid / card_paid_undo", () => {
  test("a client says 'I paid': saved for their own file, as the client, and the fresh pay_now comes back", async () => {
    const body = { action: "card_paid", account_id: CARD, due_on: "2026-11-21", client_id: OTHER };
    const { res, calls } = await call({ method: "POST", body }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, "card_paid");
    assert.equal(res.body.claim.id, CLAIM);
    assert.deepEqual(res.body.pay_now, PAY);
    assert.equal(calls.record[0].clientId, MINE, "the body's client_id is never read for a client");
    assert.equal(calls.record[0].byKind, "client");
    assert.equal(calls.record[0].staffId, null);
    assert.equal(calls.record[0].today, "2026-11-07");
    assert.equal(calls.record[0].input.account_id, CARD);
  });

  test("staff can mark it for a client in their org, with their staff id", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "card_paid", account_id: CARD, due_on: "2026-11-21", client_id: MINE } }, staffP("admin"));
    assert.equal(res.statusCode, 200);
    assert.equal(calls.record[0].byKind, "staff");
    assert.equal(calls.record[0].staffId, STAFF_ID);
  });

  test("a refused input is 400 with plain words; a card that is not theirs is 404; nothing is re-read", async () => {
    const bad = await call({ method: "POST", body: { action: "card_paid" } }, clientP(),
      { s: spies({ record: { ok: false, error: "account_id_required", message: "Pick the card you paid." } }) });
    assert.equal(bad.res.statusCode, 400);
    assert.deepEqual(bad.res.body, { ok: false, error: "account_id_required", message: "Pick the card you paid." });
    assert.equal(bad.calls.payNow, undefined);
    const notMine = await call({ method: "POST", body: { action: "card_paid", account_id: CARD, due_on: "2026-11-21" } }, clientP(),
      { s: spies({ record: { ok: false, error: "card_not_found", message: "We could not find that card on your file." } }) });
    assert.equal(notMine.res.statusCode, 404);
  });

  test("Undo: scoped to the caller's file; unknown → 404", async () => {
    const ok = await call({ method: "POST", body: { action: "card_paid_undo", claim_id: CLAIM } }, clientP());
    assert.equal(ok.res.statusCode, 200);
    assert.equal(ok.calls.withdraw[0].clientId, MINE);
    assert.equal(ok.calls.withdraw[0].claimId, CLAIM);
    const gone = await call({ method: "POST", body: { action: "card_paid_undo", claim_id: CLAIM } }, clientP(),
      { s: spies({ withdraw: { ok: false, error: "claim_not_found", message: "That payment note is already gone." } }) });
    assert.equal(gone.res.statusCode, 404);
  });

  test("the plan actions stay staff only (unchanged)", async () => {
    const { res } = await call({ method: "POST", body: { action: "record_payment", plan_id: CLAIM, amount_cents: 100 } }, clientP());
    assert.equal(res.statusCode, 403);
  });
});
