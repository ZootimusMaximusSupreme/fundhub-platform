// /api/money/accounts?view=tradelines and POST add_tradeline (Finance OS wave 4,
// unit TL). The gate: a client reads and writes only their own file (the
// session decides, never the query or the body); staff need FINANCE_OS and a
// client in their org. The rules themselves are in
// src/finance/tradeline-inventory.test.mjs. Stand-in database, no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import handler from "../../api/money/accounts.mjs";
import { assertBind, rowsWhere } from "../testing/s3-scoped-rows.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const MINE = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";
const MY_BIZ = "aaaaaaaa-0000-4000-8000-000000000001";
const THEIR_BIZ = "aaaaaaaa-0000-4000-8000-000000000002";

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}
const clientP = (clientId = MINE) => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId });
const staffP = (role) => ({ kind: "staff", role, orgId: ORG, staff: { id: "s1", role, org_id: ORG } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};

function db() {
  const entities = [
    { id: MY_BIZ, org_id: ORG, client_id: MINE, kind: "business", name: "Mine LLC", archived_at: null, created_at: "2026-09-01" },
    { id: THEIR_BIZ, org_id: ORG, client_id: OTHER, kind: "business", name: "Theirs LLC", archived_at: null, created_at: "2026-09-02" }
  ];
  const entries = [];
  const writes = [];
  return {
    entries, writes,
    async query(sql, p = []) {
      assertBind(sql, p);
      if (/^\s*INSERT INTO finance_tradeline_entries/i.test(sql)) {
        const cols = /\(([^)]*)\)\s*VALUES/i.exec(sql)[1].split(",").map((c) => c.trim());
        const row = Object.fromEntries(cols.map((c, i) => [c, p[i]]));
        row.id = `entry-${entries.length + 1}`;
        row.created_at = "2026-11-07T12:00:00Z";
        entries.push(row);
        writes.push({ sql, p });
        return { rows: [{ id: row.id }] };
      }
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) { writes.push({ sql, p }); return { rows: [] }; }
      if (/FROM clients/.test(sql)) return { rows: [MINE, OTHER].includes(p[0]) ? [{ "?column?": 1 }] : [] };
      if (/FROM entities/.test(sql)) return { rows: rowsWhere(entities, sql, p) };
      if (/FROM finance_tradeline_entries/.test(sql)) return { rows: rowsWhere(entries, sql, p) };
      return { rows: [] };
    }
  };
}

const NOW = () => new Date("2026-11-07T12:00:00Z");
async function call(principal, req, database = db(), extra = {}) {
  const res = makeRes();
  await handler({ query: {}, ...req }, res, { db: database, requirePrincipal: gateAs(principal), env: {}, now: NOW, ...extra });
  return { res, database };
}

describe("GET ?view=tradelines", () => {
  test("a client reads their own inventory; a client_id in the query is never read", async () => {
    const seen = [];
    const tradelineView = async (_db, args) => { seen.push(args); return { view: "tradelines", groups: [] }; };
    const { res } = await call(clientP(), { method: "GET", query: { view: "tradelines", client_id: OTHER } }, db(), { tradelineView });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.view, "tradelines");
    assert.deepEqual(seen, [{ orgId: ORG, clientId: MINE }]);
  });

  test("staff need FINANCE_OS and a client_id in their org", async () => {
    const tradelineView = async (_db, args) => ({ view: "tradelines", client_id: args.clientId, groups: [] });
    const ok = await call(staffP("admin"), { method: "GET", query: { view: "tradelines", client_id: MINE } }, db(), { tradelineView });
    assert.equal(ok.res.statusCode, 200);
    assert.equal(ok.res.body.client_id, MINE);
    const none = await call(staffP("admin"), { method: "GET", query: { view: "tradelines" } }, db(), { tradelineView });
    assert.equal(none.res.statusCode, 400);
    const outside = await call(staffP("admin"), { method: "GET", query: { view: "tradelines", client_id: "22222222-2222-4222-8222-222222222222" } }, db(), { tradelineView });
    assert.equal(outside.res.statusCode, 404);
    const setter = await call(staffP("setter"), { method: "GET", query: { view: "tradelines", client_id: MINE } }, db(), { tradelineView });
    assert.equal(setter.res.statusCode, 403, "a role outside FINANCE_OS is turned away");
  });

  test("an unknown view is refused, and no view is still the Accounts page", async () => {
    const bad = await call(clientP(), { method: "GET", query: { view: "everything" } });
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.error, "unknown_view");
    const page = await call(clientP(), { method: "GET", query: {} });
    assert.equal(page.res.statusCode, 200);
    assert.ok(Array.isArray(page.res.body.containers), "the Accounts page's own read is unchanged");
  });

  test("the real read answers through the stand-in with every query scoped", async () => {
    const { res } = await call(clientP(), { method: "GET", query: { view: "tradelines" } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.groups.map((g) => g.name), ["Personal", "Mine LLC"]);
    assert.deepEqual(res.body.add.belongs_to.map((b) => b.label), ["Personal", "Mine LLC"]);
  });
});

describe("POST add_tradeline", () => {
  const good = { action: "add_tradeline", creditor: "Chase", product: "Ink Business Cash", type: "credit_card",
    limit: "10,000", opened: "2021-03", belongs_to: `entity:${MY_BIZ}` };

  test("a client adds an account to their own business; the answer is the new inventory", async () => {
    const { res, database } = await call(clientP(), { method: "POST", body: { ...good, client_id: OTHER } });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.action, "add_tradeline");
    assert.equal(res.body.view, "tradelines");
    assert.equal(database.entries.length, 1);
    const row = database.entries[0];
    assert.equal(row.client_id, MINE, "the session's client, never the body's");
    assert.equal(row.org_id, ORG);
    assert.equal(row.entity_id, MY_BIZ);
    assert.equal(row.limit_cents, 1000000);
    assert.equal(row.opened_month, "2021-03");
    assert.equal(row.entered_by, "client");
    const mine = res.body.groups.find((g) => g.name === "Mine LLC");
    assert.equal(mine.items.length, 1);
    assert.deepEqual(mine.items[0].source_words, ["Added by you"]);
    assert.equal(mine.items[0].name, "Ink Business Cash");
  });

  test("another client's business is not this client's: 404, nothing written", async () => {
    const { res, database } = await call(clientP(), { method: "POST", body: { ...good, belongs_to: `entity:${THEIR_BIZ}` } });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "business_not_found");
    assert.equal(database.entries.length, 0);
  });

  test("staff add for a client in their org, marked as staff", async () => {
    const { res, database } = await call(staffP("admin"), { method: "POST", body: { ...good, client_id: MINE } });
    assert.equal(res.statusCode, 201);
    assert.equal(database.entries[0].entered_by, "staff");
    assert.equal(database.entries[0].entered_by_id, null, "a staff id that is not a uuid is not stored");
  });

  test("a bad field is a 400 that names it; an account number or an org id is refused outright", async () => {
    const type = await call(clientP(), { method: "POST", body: { ...good, type: "brokerage" } });
    assert.equal(type.res.statusCode, 400);
    assert.match(type.res.body.error, /type must be one of/);
    const limit = await call(clientP(), { method: "POST", body: { ...good, type: "checking" } });
    assert.equal(limit.res.statusCode, 400);
    assert.match(limit.res.body.error, /only for a credit card or a line of credit/);
    const number = await call(clientP(), { method: "POST", body: { ...good, account_number: "4111111111111111" } });
    assert.equal(number.res.statusCode, 400);
    assert.equal(number.res.body.error, "account_number_not_accepted");
    const org = await call(clientP(), { method: "POST", body: { ...good, org_id: ORG } });
    assert.equal(org.res.statusCode, 400);
    assert.equal(org.res.body.error, "org_id_not_accepted");
    for (const r of [type, limit, number, org]) assert.equal(r.database.entries.length, 0);
  });
});

describe("the bank plan reads through the holdings", () => {
  test("GET /api/money/banks and the Blueprint plan both read bankStrategyWithHoldings by default", () => {
    const banks = fs.readFileSync(new URL("../../api/money/banks.mjs", import.meta.url), "utf8");
    // The apply gate view imports TL's holdings helpers from the same module (root patch 2).
    assert.match(banks, /import \{[^}]*\bbankStrategyWithHoldings\b[^}]*\} from "\.\.\/\.\.\/src\/finance\/tradeline-inventory\.mjs";/);
    assert.match(banks, /read: deps\.bankStrategy \|\| bankStrategyWithHoldings,/);
    const plan = fs.readFileSync(new URL("../blueprint/client-plan.mjs", import.meta.url), "utf8");
    assert.match(plan, /import \{ bankStrategyWithHoldings as readBankStrategy \} from "\.\.\/finance\/tradeline-inventory\.mjs";/);
  });
});
