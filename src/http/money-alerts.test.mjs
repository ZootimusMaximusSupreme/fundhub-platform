// /api/money/alerts — the gate for both callers, the read, and the three writes.
// Stubbed principal, db and logic; no network, no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler, { ACTIONS } from "../../api/money/alerts.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { FileAlertInputError } from "../finance/file-alerts/store.mjs";

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
const CARD = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
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
const NOW = () => new Date("2026-10-07T12:00:00Z");

function spies(over = {}) {
  const calls = {};
  const note = (name) => (_db, args) => { (calls[name] ||= []).push(args); return undefined; };
  return {
    calls,
    deps: {
      fileAlertsPayload: async (_db, args) => { (calls.read ||= []).push(args); return { ok: true, cards: [], alerts: [] }; },
      setAlertEnabled: async (d, a) => { note("alert")(d, a); },
      setPromo: async (d, a) => { note("promo")(d, a); return { cleared: a.endsOn === null, promo: a.endsOn === null ? null : { ends_on: a.endsOn, apr: a.aprFraction, source: a.by, set_at: "t" } }; },
      setStatementCloseDay: async (d, a) => { note("close")(d, a); return { statement_close_day: a.day }; },
      ...over
    }
  };
}

async function call(req, principal, { inOrg, s = spies(), extra = {} } = {}) {
  const res = makeRes();
  await handler(req, res, { db: db(inOrg), requirePrincipal: gateAs(principal), now: NOW, env: {}, ...s.deps, ...extra });
  return { res, calls: s.calls };
}

describe("GET /api/money/alerts", () => {
  test("is routed", () => {
    assert.equal(typeof ROUTES["money/alerts"], "function");
  });

  test("a client reads their own file; ?client_id is never read", async () => {
    const { res, calls } = await call({ method: "GET", query: { client_id: OTHER } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.equal(calls.read[0].clientId, MINE);
    assert.equal(calls.read[0].orgId, ORG);
    assert.equal(calls.read[0].now.toISOString(), "2026-10-07T12:00:00.000Z");
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

  test("staff outside FINANCE (a closer, a CSM, an advisor) are refused", async () => {
    for (const role of ["setter", "csm", "funding_advisor"]) {
      const { res, calls } = await call({ method: "GET", query: { client_id: MINE } }, staffP(role));
      assert.equal(res.statusCode, 403, role);
      assert.equal(calls.read, undefined, role);
    }
  });

  test("a client the read cannot find is 404", async () => {
    const s = spies({ fileAlertsPayload: async () => null });
    const { res } = await call({ method: "GET", query: {} }, clientP(), { s });
    assert.equal(res.statusCode, 404);
  });

  test("PUT is 405", async () => {
    const { res } = await call({ method: "PUT", query: {} }, clientP());
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "GET, POST");
  });
});

describe("POST set_alert — which kinds are on", () => {
  test("a client switches a kind off on their own file; client_id in the body is ignored", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "set_alert", kind: "promo_end", enabled: false, client_id: OTHER } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, action: "set_alert", saved: { kind: "promo_end", enabled: false } });
    assert.deepEqual(calls.alert[0], { orgId: ORG, clientId: MINE, kind: "promo_end", enabled: false, by: "client" });
  });

  test("staff switch one on for a client in their org, stamped 'staff'", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "set_alert", kind: "cash_reserve", enabled: true, client_id: MINE } }, staffP("owner"));
    assert.equal(res.statusCode, 200);
    assert.equal(calls.alert[0].by, "staff");
    assert.equal(calls.alert[0].clientId, MINE);
  });

  test("a kind that does not exist, or a non-boolean, is a 400 and nothing is written", async () => {
    for (const body of [
      { action: "set_alert", kind: "round_two", enabled: true },
      { action: "set_alert", kind: "constructor", enabled: true },
      { action: "set_alert", enabled: true },
      { action: "set_alert", kind: "new_credit", enabled: "yes" },
      { action: "set_alert", kind: "new_credit" }
    ]) {
      const { res, calls } = await call({ method: "POST", body }, clientP());
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.equal(res.body.error, "invalid_input");
      assert.equal(calls.alert, undefined);
    }
  });
});

describe("POST set_promo — a card's promo end date and rate", () => {
  test("a client puts a promo on a card; the day is read against today's UTC date", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "set_promo", account_id: CARD, ends_on: "2026-12-06", apr_pct: 0 } }, clientP());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls.promo[0], { orgId: ORG, clientId: MINE, accountId: CARD, endsOn: "2026-12-06", aprFraction: 0, by: "client" });
    assert.deepEqual(res.body, {
      ok: true, action: "set_promo",
      saved: { account_id: CARD, cleared: false, promo: { ends_on: "2026-12-06", apr: 0, source: "client", set_at: "t" } }
    });
  });

  test("a null end date clears the promo", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "set_promo", account_id: CARD, ends_on: null } }, clientP());
    assert.equal(res.statusCode, 200);
    assert.equal(calls.promo[0].endsOn, null);
    assert.equal(res.body.saved.cleared, true);
    assert.equal(res.body.saved.promo, null);
  });

  test("staff may set it for a client in their org, stamped 'staff'", async () => {
    const { calls } = await call({ method: "POST", body: { action: "set_promo", account_id: CARD, ends_on: "2026-12-06", apr_pct: 2.99, client_id: MINE } }, staffP("admin"));
    assert.equal(calls.promo[0].by, "staff");
    assert.equal(calls.promo[0].aprFraction, 0.0299);
  });

  test("a bad date or rate is a 400 that names the field; nothing is written", async () => {
    const cases = [
      [{ account_id: CARD, ends_on: "2026-10-01" }, "ends_on"],
      [{ account_id: CARD, ends_on: "2026-02-30" }, "ends_on"],
      [{ account_id: CARD, ends_on: "2026-12-06", apr_pct: 250 }, "apr_pct"],
      [{ account_id: "not-a-uuid", ends_on: "2026-12-06" }, "account_id"],
      [{ ends_on: "2026-12-06" }, "account_id"]
    ];
    for (const [rest, field] of cases) {
      const { res, calls } = await call({ method: "POST", body: { action: "set_promo", ...rest } }, clientP());
      assert.equal(res.statusCode, 400, JSON.stringify(rest));
      assert.equal(res.body.field, field);
      assert.equal(calls.promo, undefined);
    }
  });

  test("a card that is not theirs is a 404 from the store, not a 400 and not a hint the id is real", async () => {
    const s = spies({ setPromo: async () => { throw new FileAlertInputError("account_id", "no such card", 404); } });
    const { res } = await call({ method: "POST", body: { action: "set_promo", account_id: CARD, ends_on: "2026-12-06" } }, clientP(), { s });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "invalid_input");
  });
});

describe("POST set_statement_close_day", () => {
  test("a day, or null to clear it", async () => {
    const a = await call({ method: "POST", body: { action: "set_statement_close_day", account_id: CARD, day: 15 } }, clientP());
    assert.equal(a.res.statusCode, 200);
    assert.deepEqual(a.res.body, { ok: true, action: "set_statement_close_day", saved: { account_id: CARD, statement_close_day: 15 } });
    assert.deepEqual(a.calls.close[0], { orgId: ORG, clientId: MINE, accountId: CARD, day: 15 });
    const b = await call({ method: "POST", body: { action: "set_statement_close_day", account_id: CARD, day: null } }, clientP());
    assert.equal(b.res.body.saved.statement_close_day, null);
  });

  test("day 0, day 32, a word: a 400 that names the day", async () => {
    for (const day of [0, 32, "fifteenth", 2.5]) {
      const { res, calls } = await call({ method: "POST", body: { action: "set_statement_close_day", account_id: CARD, day } }, clientP());
      assert.equal(res.statusCode, 400, String(day));
      assert.equal(res.body.field, "day");
      assert.equal(calls.close, undefined);
    }
  });
});

describe("POST — shape", () => {
  test("the actions are the three, and an unknown one is a 400 that lists them", async () => {
    assert.deepEqual([...ACTIONS], ["set_alert", "set_promo", "set_statement_close_day"]);
    const { res } = await call({ method: "POST", body: { action: "send_all_texts_now" } }, clientP());
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "unknown_action");
    assert.deepEqual(res.body.actions, [...ACTIONS]);
  });

  test("a body that is not JSON is a 400; staff outside FINANCE cannot write", async () => {
    const bad = await call({ method: "POST", body: "{not json" }, clientP());
    assert.equal(bad.res.statusCode, 400);
    const closer = await call({ method: "POST", body: { action: "set_alert", kind: "new_credit", enabled: false, client_id: MINE } }, staffP("setter"));
    assert.equal(closer.res.statusCode, 403);
    assert.equal(closer.calls.alert, undefined);
  });

  test("a staff POST with no client_id is a 400", async () => {
    const { res } = await call({ method: "POST", body: { action: "set_alert", kind: "new_credit", enabled: false } }, staffP("owner"));
    assert.equal(res.statusCode, 400);
  });
});
