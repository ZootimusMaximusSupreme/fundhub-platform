// /api/money/alerts — the gate for both callers, the read, and the nine writes.
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
const BILL = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
const ORG = "org-1";
const STAFF_ID = "5aff0000-0000-4000-8000-000000000001";
const ITEM = "c0a1e2d3-4b5c-4d6e-8f70-81a2b3c4d5e1";
const BIZ = "5b0c7e1a-3d2f-4a6b-9c8d-7e6f5a4b3c21";

const clientP = (clientId = MINE) => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId });
const staffP = (role, orgId = ORG) => ({ kind: "staff", role, orgId, staff: { id: STAFF_ID, role, org_id: orgId } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};
// A client is in a company when BOTH the client id ($1) and the company ($2) match.
const db = (inOrg = [MINE]) => ({
  query: async (sql, params) => (/FROM clients/.test(sql)
    ? { rows: inOrg.includes(params[0]) && params[1] === ORG ? [{ "?column?": 1 }] : [] }
    : { rows: [] })
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
      setBillImportant: async (d, a) => { note("bill")(d, a); return { bill_id: a.billId, important: a.important }; },
      setPhoneAlerts: async (d, a) => { note("phone")(d, a); },
      customKindOf: async (d, a) => { note("kindOf")(d, a); return "alert"; },
      addCustomItem: async (d, a) => { note("add")(d, a); return { id: ITEM, ...a.input, created_by: a.by }; },
      updateCustomItem: async (d, a) => { note("update")(d, a); return { id: a.id, ...a.input, created_by: "client" }; },
      setCustomPhone: async (d, a) => { note("customPhone")(d, a); return { id: a.id, phone_alert: a.enabled }; },
      removeCustomItem: async (d, a) => { note("remove")(d, a); return { id: a.id, removed: true }; },
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

  test("only the FinanceOS roles may read: owner, admin, sales manager and closer; every other staff role is refused", async () => {
    const ALLOWED = ["owner", "admin", "sales_manager", "closer"];
    const REFUSED = ["funding_advisor", "inquiry_specialist", "setter", "csm"];
    for (const role of ALLOWED) {
      const { res, calls } = await call({ method: "GET", query: { client_id: MINE } }, staffP(role));
      assert.equal(res.statusCode, 200, role);
      assert.equal(calls.read[0].clientId, MINE, role);
    }
    for (const role of REFUSED) {
      const { res, calls } = await call({ method: "GET", query: { client_id: MINE } }, staffP(role));
      assert.equal(res.statusCode, 403, role);
      assert.equal(calls.read, undefined, role);
    }
  });

  test("staff of another company cannot read or change this company's client: 404, nothing read, nothing written", async () => {
    const stranger = staffP("owner", "org-2");
    const read = await call({ method: "GET", query: { client_id: MINE } }, stranger);
    assert.equal(read.res.statusCode, 404);
    assert.equal(read.calls.read, undefined);
    for (const body of [
      { action: "set_alert", kind: "new_credit", enabled: false, client_id: MINE },
      { action: "set_promo", account_id: CARD, ends_on: "2026-12-06", apr_pct: 2.99, client_id: MINE },
      { action: "set_statement_close_day", account_id: CARD, day: 12, client_id: MINE },
    ]) {
      const w = await call({ method: "POST", body }, stranger);
      assert.equal(w.res.statusCode, 404, body.action);
      assert.deepEqual(w.calls, {}, body.action);
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

describe("POST set_bill_important — a repeat bill the client cares about", () => {
  test("a client marks their own bill Important; client_id in the body is ignored", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "set_bill_important", bill_id: BILL, important: true, client_id: OTHER } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, action: "set_bill_important", saved: { bill_id: BILL, important: true } });
    assert.deepEqual(calls.bill[0], { orgId: ORG, clientId: MINE, billId: BILL, important: true, by: "client" });
  });

  test("staff unmark a bill for a client in their org, stamped 'staff'; outside the org nothing is written", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "set_bill_important", bill_id: BILL, important: false, client_id: MINE } }, staffP("owner"));
    assert.equal(res.statusCode, 200);
    assert.deepEqual([calls.bill[0].important, calls.bill[0].by, calls.bill[0].clientId], [false, "staff", MINE]);
    const out = await call({ method: "POST", body: { action: "set_bill_important", bill_id: BILL, important: true, client_id: OTHER } }, staffP("owner"));
    assert.equal(out.res.statusCode, 404);
    assert.equal(out.calls.bill, undefined);
  });

  test("a bad bill id or a non-boolean is a 400 that names the field; nothing is written", async () => {
    for (const [body, field] of [
      [{ action: "set_bill_important", important: true }, "bill_id"],
      [{ action: "set_bill_important", bill_id: "not-a-uuid", important: true }, "bill_id"],
      [{ action: "set_bill_important", bill_id: BILL, important: "yes" }, "important"],
      [{ action: "set_bill_important", bill_id: BILL }, "important"]
    ]) {
      const { res, calls } = await call({ method: "POST", body }, clientP());
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.equal(res.body.field, field);
      assert.equal(calls.bill, undefined);
    }
  });

  test("a bill that is not theirs is a 404 from the store, not a hint the id is real", async () => {
    const s = spies({ setBillImportant: async () => { throw new FileAlertInputError("bill_id", "no such bill", 404); } });
    const { res } = await call({ method: "POST", body: { action: "set_bill_important", bill_id: BILL, important: true } }, clientP(), { s });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.field, "bill_id");
  });
});

describe("POST set_phone_alerts — the one switch for every phone alert", () => {
  test("a client switches phone alerts off on their own file", async () => {
    const { res, calls } = await call({ method: "POST", body: { action: "set_phone_alerts", enabled: false, client_id: OTHER } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, action: "set_phone_alerts", saved: { phone_alerts: false } });
    assert.deepEqual(calls.phone[0], { orgId: ORG, clientId: MINE, enabled: false, by: "client" });
  });

  test("a non-boolean is a 400 and nothing is written", async () => {
    for (const body of [{ action: "set_phone_alerts" }, { action: "set_phone_alerts", enabled: "off" }]) {
      const { res, calls } = await call({ method: "POST", body }, clientP());
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.field, "enabled");
      assert.equal(calls.phone, undefined);
    }
  });
});

describe("POST — shape", () => {
  test("the actions are the ten, and an unknown one is a 400 that lists them", async () => {
    assert.deepEqual([...ACTIONS], ["set_alert", "set_promo", "set_statement_close_day", "set_bill_important", "set_phone_alerts",
      "set_bundle_alert", "add_custom", "update_custom", "set_custom_phone", "remove_custom"]);
    const { res } = await call({ method: "POST", body: { action: "send_all_texts_now" } }, clientP());
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "unknown_action");
    assert.deepEqual(res.body.actions, [...ACTIONS]);
  });

  test("a body that is not JSON is a 400; staff outside the FinanceOS roles cannot write, and the roles inside can", async () => {
    const bad = await call({ method: "POST", body: "{not json" }, clientP());
    assert.equal(bad.res.statusCode, 400);
    const write = { action: "set_alert", kind: "new_credit", enabled: false, client_id: MINE };
    for (const role of ["owner", "admin", "sales_manager", "closer"]) {
      const { res, calls } = await call({ method: "POST", body: write }, staffP(role));
      assert.equal(res.statusCode, 200, role);
      assert.equal(calls.alert[0].by, "staff", role);
    }
    for (const role of ["funding_advisor", "inquiry_specialist", "setter", "csm"]) {
      const { res, calls } = await call({ method: "POST", body: write }, staffP(role));
      assert.equal(res.statusCode, 403, role);
      assert.equal(calls.alert, undefined, role);
    }
  });

  test("a staff POST with no client_id is a 400", async () => {
    const { res } = await call({ method: "POST", body: { action: "set_alert", kind: "new_credit", enabled: false } }, staffP("owner"));
    assert.equal(res.statusCode, 400);
  });
});

/* AL2 (2026-11-07): the client's own alerts and repeat bills. */
describe("POST — the client's own alerts and bills", () => {
  test("add_custom saves a client's monthly alert on their own file, stamped client, and answers the item", async () => {
    const { res, calls } = await call({ method: "POST", body: {
      action: "add_custom", kind: "alert", name: "  Move   money to savings ", cadence: "monthly", day_of_month: 14,
      scope: "personal", client_id: OTHER
    } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const a = calls.add[0];
    assert.equal(a.clientId, MINE, "a client never names another file");
    assert.equal(a.orgId, ORG);
    assert.equal(a.by, "client");
    assert.deepEqual(a.input, { kind: "alert", name: "Move money to savings", amount_cents: null, cadence: "monthly",
      day_of_month: 14, start_on: null, scope: "personal", entity_id: null, phone_alert: true });
    assert.equal(res.body.saved.next_on, "2026-10-14");
    assert.equal(res.body.saved.name, "Move money to savings");
  });

  test("add_custom: a bill for one business, by staff, with its amount in cents", async () => {
    const { res, calls } = await call({ method: "POST", body: {
      action: "add_custom", kind: "bill", name: "Office rent", amount_cents: 120000, cadence: "annual", start_on: "2026-03-01",
      scope: "business", entity_id: BIZ, phone_alert: false, client_id: MINE
    } }, staffP("owner"));
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(calls.add[0].by, "staff");
    assert.equal(calls.add[0].input.entity_id, BIZ);
    assert.equal(calls.add[0].input.amount_cents, 120000);
    assert.equal(res.body.saved.next_on, "2027-03-01");
  });

  test("add_custom refuses what is wrong, by field, and saves nothing", async () => {
    const base = { action: "add_custom", kind: "bill", name: "Rent", amount_cents: 1000, cadence: "monthly", day_of_month: 1, scope: "personal" };
    for (const [over, field] of [
      [{ kind: "reminder" }, "kind"],
      [{ name: "   " }, "name"],
      [{ name: "x".repeat(81) }, "name"],
      [{ amount_cents: null }, "amount_cents"],
      [{ amount_cents: 12.5 }, "amount_cents"],
      [{ amount_cents: -5 }, "amount_cents"],
      [{ cadence: "once" }, "cadence"],
      [{ day_of_month: 32 }, "day_of_month"],
      [{ cadence: "weekly", day_of_month: null, start_on: "2026-02-31" }, "start_on"],
      [{ scope: "family" }, "scope"],
      [{ entity_id: BIZ }, "entity_id"],
      [{ scope: "business", entity_id: "not-a-uuid" }, "entity_id"],
      [{ phone_alert: "yes" }, "phone_alert"],
      [{ kind: "alert", cadence: "once", day_of_month: null, start_on: "2026-10-06" }, "start_on"]
    ]) {
      const { res, calls } = await call({ method: "POST", body: { ...base, ...over } }, clientP());
      assert.equal(res.statusCode, 400, JSON.stringify(over));
      assert.equal(res.body.field, field, JSON.stringify(over));
      assert.equal(calls.add, undefined);
    }
  });

  test("update_custom keeps the row's own kind; a row that is not theirs is a 404", async () => {
    const { res, calls } = await call({ method: "POST", body: {
      action: "update_custom", id: ITEM, kind: "bill", name: "Savings", cadence: "once", start_on: "2026-12-01", scope: "personal"
    } }, clientP());
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(calls.kindOf[0], { orgId: ORG, clientId: MINE, id: ITEM });
    assert.equal(calls.update[0].input.kind, "alert", "the kind comes from the saved row, not the body");
    const missing = await call({ method: "POST", body: { action: "update_custom", id: ITEM, name: "x", cadence: "monthly", day_of_month: 1, scope: "personal" } },
      clientP(), { s: spies({ customKindOf: async () => { throw new FileAlertInputError("id", "no such alert or bill", 404); } }) });
    assert.equal(missing.res.statusCode, 404);
    assert.equal(missing.calls.update, undefined);
  });

  test("set_custom_phone and remove_custom need an id; remove answers removed", async () => {
    const on = await call({ method: "POST", body: { action: "set_custom_phone", id: ITEM, enabled: false } }, clientP());
    assert.equal(on.res.statusCode, 200);
    assert.deepEqual(on.calls.customPhone[0], { orgId: ORG, clientId: MINE, id: ITEM, enabled: false, by: "client" });
    const bad = await call({ method: "POST", body: { action: "set_custom_phone", id: ITEM, enabled: "no" } }, clientP());
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.field, "enabled");
    const gone = await call({ method: "POST", body: { action: "remove_custom", id: ITEM } }, clientP());
    assert.equal(gone.res.statusCode, 200);
    assert.deepEqual(gone.res.body.saved, { id: ITEM, removed: true });
    for (const action of ["remove_custom", "set_custom_phone", "update_custom"]) {
      const r = await call({ method: "POST", body: { action, id: "nope", enabled: true } }, clientP());
      assert.equal(r.res.statusCode, 400, action);
      assert.equal(r.res.body.field, "id", action);
    }
  });
});
