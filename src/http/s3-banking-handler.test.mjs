// Slice S3 proofs: the banking doors. Hand-entered bank accounts, card cycles
// and holdings (/api/banking/accounts), and the Plaid card-bill pull
// (/api/banking/sync-liabilities) run through the real logic. The only stand-ins
// are the database and the one outbound Plaid call.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import accountsHandler from "../../api/banking/accounts.mjs";
import syncHandler from "../../api/banking/sync-liabilities.mjs";
import revokeHandler from "../../api/banking/revoke.mjs";
import { tableRules } from "../testing/s3-scoped-rows.mjs";
import { encryptPlaidToken } from "../banking/plaid.mjs";
import { makeRes, fakeDb, staffSession, req, ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const ACCOUNT = "a1000000-0000-4000-8000-0000000000a1";
const inOrg = [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, [{ "?column?": 1 }]];
const notInOrg = [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, []];

/** Column name -> value for an INSERT whose column list is in the SQL text. */
function byColumn(call) {
  const cols = /\(([^)]+)\)\s+VALUES/.exec(call.sql)[1].split(",").map((c) => c.trim());
  return Object.fromEntries(cols.map((c, i) => [c, call.params[i]]));
}

describe("GET /api/banking/accounts", () => {
  test("lists this client's accounts, cycles and holdings with the due date worked out on the server", async () => {
    const { res, fake } = await callShared(accountsHandler, req("GET", { query: { client_id: CLIENT } }), [
      staffSession({ role: "closer" }), inOrg,
      [/FROM bank_accounts\s+WHERE org_id = \$1 AND client_id = \$2/, [{ id: ACCOUNT, name: "Chase Ink", account_type: "credit", mask: "4242" }]],
      [/FROM account_statement_cycles c/, [{ bank_account_id: ACCOUNT, statement_close_day: 15, payment_due_day: 10, minimum_payment_cents: 3500 }]],
      [/FROM investment_holdings h/, []]
    ]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.accounts.length, 1);
    assert.equal(res.body.accounts[0].name, "Chase Ink");
    assert.equal(res.body.cycles[0].payment_due_day, 10);
    assert.match(res.body.cycles[0].next_due.dueOn, /^\d{4}-\d{2}-10$/);
    assert.equal(res.body.cycles[0].next_due.unknownReason, null);
    assert.deepEqual(res.body.holdings, []);
    assert.deepEqual(fake.find(/FROM bank_accounts\s+WHERE org_id/)[0].params, [ORG_ID, CLIENT]);
  });

  test("a client from another company reads nothing", async () => {
    const { res, fake } = await callShared(accountsHandler, req("GET", { query: { client_id: CLIENT } }), [staffSession(), notInOrg]);
    assert.equal(res.statusCode, 404);
    assert.equal(fake.find(/FROM bank_accounts/).length, 0);
  });
});

describe("POST /api/banking/accounts (hand entry)", () => {
  const post = (body, rules) => callShared(accountsHandler, req("POST", { body: { client_id: CLIENT, ...body } }), [staffSession(), inOrg, ...rules]);

  test("create_account saves one account for this client with dollars turned into whole cents and marks it business", async () => {
    const { res, fake } = await post(
      { action: "create_account", name: "Chase Ink", mask: "xxxx 4242", account_type: "credit", entity_kind: "business", credit_limit: "15000", current_balance: "1200.50" },
      [
        [/INSERT INTO bank_accounts/, (_s, p) => [{ id: ACCOUNT, org_id: p[0], client_id: p[1], name: p[4], account_type: p[7] }]],
        [/UPDATE bank_accounts\s+SET entity_kind = \$2/, [{ id: ACCOUNT, entity_kind: "business", entity_kind_source: "staff_reviewed" }]]
      ]
    );
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.account.entity_kind, "business");
    const row = byColumn(fake.find(/INSERT INTO bank_accounts/)[0]);
    assert.equal(row.org_id, ORG_ID);
    assert.equal(row.client_id, CLIENT);
    assert.equal(row.mask, "4242");
    assert.equal(row.credit_limit_cents, 1500000);
    assert.equal(row.current_balance_cents, 120050);
    assert.equal(row.plaid_item_id, null);
    assert.deepEqual(fake.find(/UPDATE bank_accounts\s+SET entity_kind/)[0].params, [ACCOUNT, "business"]);
    assert.equal(fake.count("BEGIN"), 1);
    assert.equal(fake.count("COMMIT"), 1);
  });

  test("a blank amount is stored as unknown (NULL), never as 0", async () => {
    const created = await post({ action: "create_account", name: "Chase Ink", account_type: "credit", credit_limit: "", current_balance: "" }, [
      [/INSERT INTO bank_accounts/, (_s, p) => [{ id: ACCOUNT, org_id: p[0], client_id: p[1], name: p[4], account_type: p[7] }]]
    ]);
    assert.equal(created.res.statusCode, 201);
    const row = byColumn(created.fake.find(/INSERT INTO bank_accounts/)[0]);
    assert.equal(row.credit_limit_cents, null);
    assert.equal(row.current_balance_cents, null);
    const own = [/SELECT account_type FROM bank_accounts WHERE id = \$1 AND org_id = \$2 AND client_id = \$3/, [{ account_type: "credit" }]];
    const cycle = await post({ action: "set_cycle", bank_account_id: ACCOUNT, statement_close_day: 15, payment_due_day: 10, minimum_payment: "" }, [
      own, [/INSERT INTO account_statement_cycles/, (_s, p) => [{ id: "cyc1", bank_account_id: p[2] }]]
    ]);
    assert.equal(cycle.res.statusCode, 200);
    const cyc = byColumn(cycle.fake.find(/INSERT INTO account_statement_cycles/)[0]);
    assert.equal(cyc.minimum_payment_cents, null);
    assert.equal(cyc.last_statement_balance_cents, null);
  });

  test("set_cycle stores the card's close day, due day and minimum for a credit account only", async () => {
    const own = [/SELECT account_type FROM bank_accounts WHERE id = \$1 AND org_id = \$2 AND client_id = \$3/, [{ account_type: "credit" }]];
    const { res, fake } = await post(
      { action: "set_cycle", bank_account_id: ACCOUNT, statement_close_day: 15, payment_due_day: 10, minimum_payment: "35.00", last_statement_balance: "1200.50", apr: 0.2499 },
      [own, [/INSERT INTO account_statement_cycles/, (_s, p) => [{ id: "cyc1", bank_account_id: p[2] }]]]
    );
    assert.equal(res.statusCode, 200);
    const row = byColumn(fake.find(/INSERT INTO account_statement_cycles/)[0]);
    assert.equal(row.bank_account_id, ACCOUNT);
    assert.equal(row.statement_close_day, 15);
    assert.equal(row.payment_due_day, 10);
    assert.equal(row.minimum_payment_cents, 3500);
    assert.equal(row.last_statement_balance_cents, 120050);
    assert.equal(row.source, "manual");

    const bank = await post({ action: "set_cycle", bank_account_id: ACCOUNT, statement_close_day: 15, payment_due_day: 10 }, [
      [/SELECT account_type FROM bank_accounts/, [{ account_type: "depository" }]]
    ]);
    assert.equal(bank.res.statusCode, 400);
    assert.equal(bank.fake.find(/INSERT INTO account_statement_cycles/).length, 0);
  });

  test("replace_holdings swaps an investment account's whole holdings list inside one transaction", async () => {
    const own = [/SELECT account_type FROM bank_accounts WHERE id = \$1/, [{ account_type: "investment" }]];
    const { res, fake } = await post(
      { action: "replace_holdings", bank_account_id: ACCOUNT, holdings: [{ symbol: " vti ", quantity: "10", current_value: "2500.00" }, { symbol: "BND", current_value: "500" }] },
      [own]
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, replaced: 2 });
    const order = fake.calls.map((c) => c.sql.trim().split(/\s+/).slice(0, 3).join(" "));
    assert.ok(order.includes("DELETE FROM investment_holdings"), "the old list is removed");
    assert.ok(order.indexOf("DELETE FROM investment_holdings") < order.indexOf("INSERT INTO investment_holdings"));
    const inserts = fake.find(/INSERT INTO investment_holdings/);
    assert.deepEqual(inserts.map((c) => [c.params[3], c.params[7]]), [["VTI", 250000], ["BND", 50000]]);
    assert.equal(fake.count("COMMIT"), 1);
  });

  test("a holdings list for a card account, and an unknown action, are refused and write nothing", async () => {
    const card = await post({ action: "replace_holdings", bank_account_id: ACCOUNT, holdings: [] }, [[/SELECT account_type FROM bank_accounts/, [{ account_type: "credit" }]]]);
    assert.equal(card.res.statusCode, 400);
    assert.equal(card.fake.find(/DELETE FROM investment_holdings/).length, 0);
    const odd = await post({ action: "wire_money" }, []);
    assert.equal(odd.res.statusCode, 400);
    assert.equal(odd.res.body.error, "unknown action");
  });
});

describe("POST /api/banking/sync-liabilities", () => {
  const PLAID_ITEM = "plaid-item-abc";
  let realFetch;
  let plaidCalls;
  beforeEach(() => {
    realFetch = globalThis.fetch;
    plaidCalls = [];
    globalThis.fetch = async (url, init) => {
      plaidCalls.push({ url: String(url), body: JSON.parse(init.body) });
      if (!/plaid\.com\/liabilities\/get$/.test(String(url))) throw new Error(`unexpected call ${url}`);
      return new Response(JSON.stringify({
        accounts: [], item: { item_id: PLAID_ITEM },
        liabilities: { credit: [{
          account_id: "plaid-acc-card", next_payment_due_date: "2026-11-10", minimum_payment_amount: 35,
          last_statement_balance: 1200.5, last_statement_issue_date: "2026-10-15", is_overdue: false,
          aprs: [{ apr_type: "purchase_apr", apr_percentage: 24.99 }]
        }], mortgage: [], student: [] }
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const env = () => ({
    PLAID_CLIENT_ID: "client-id-test", PLAID_SECRET: "secret-test", PLAID_ENV: "sandbox",
    PLAID_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64"), ADAPTERS_DRY_RUN: "0"
  });

  async function sync(body, rules, environment = env()) {
    const database = fakeDb([...rules]);
    const res = makeRes();
    await syncHandler({ method: "POST", body }, res, {
      db: database, env: environment, now: () => new Date("2026-10-13T12:00:00Z"),
      requireAuth: async () => ({ id: STAFF_ID, role: "owner", org_id: ORG_ID })
    });
    return { res, database };
  }

  test("pulls each linked login's card bills and writes one statement cycle per stored card, moving no money", async () => {
    const environment = env();
    const token = encryptPlaidToken("access-sandbox-test", { itemId: PLAID_ITEM, env: environment });
    const { res, database } = await sync({ client_id: CLIENT }, [
      inOrg,
      [/FROM plaid_items/, [{ id: "item-row-1", plaid_item_id: PLAID_ITEM, encrypted_access_token: token, institution_name: "Chase" }]],
      [/SELECT id, plaid_account_id, account_type, name, mask\s+FROM bank_accounts/, [{ id: ACCOUNT, plaid_account_id: "plaid-acc-card", account_type: "credit", name: "Chase Ink", mask: "4242" }]],
      [/SELECT account_type FROM bank_accounts WHERE id = \$1/, [{ account_type: "credit" }]],
      [/INSERT INTO account_statement_cycles/, [{ id: "cyc1" }]]
    ], environment);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.written, 1);
    assert.deepEqual(res.body.items.map((i) => [i.item_id, i.ok, i.written]), [["item-row-1", true, 1]]);
    assert.equal(plaidCalls.length, 1);
    assert.equal(plaidCalls[0].body.access_token, "access-sandbox-test");
    const row = byColumn(database.find(/INSERT INTO account_statement_cycles/)[0]);
    assert.equal(row.org_id, ORG_ID);
    assert.equal(row.client_id, CLIENT);
    assert.equal(row.bank_account_id, ACCOUNT);
    assert.equal(row.payment_due_day, 10);
    assert.equal(row.minimum_payment_cents, 3500);
    assert.equal(row.last_statement_balance_cents, 120050);
    assert.equal(row.apr, 0.2499);
    assert.equal(row.source, "provider");
    assert.equal(JSON.stringify(res.body).includes("access-sandbox-test"), false);
  });

  test("a card Plaid names that is not stored is skipped and reported, never created", async () => {
    const environment = env();
    const token = encryptPlaidToken("access-sandbox-test", { itemId: PLAID_ITEM, env: environment });
    const { res, database } = await sync({ client_id: CLIENT }, [
      inOrg,
      [/FROM plaid_items/, [{ id: "item-row-1", plaid_item_id: PLAID_ITEM, encrypted_access_token: token }]],
      [/SELECT id, plaid_account_id, account_type, name, mask\s+FROM bank_accounts/, []]
    ], environment);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.written, 0);
    assert.deepEqual(res.body.items[0].skipped, [{ plaidAccountId: "plaid-acc-card", reason: "account_not_stored" }]);
    assert.equal(database.find(/INSERT INTO (account_statement_cycles|bank_accounts)/).length, 0);
  });

  test("Plaid keys missing is a 503 that names them, a client of another company a 404; Plaid is never called", async () => {
    const missing = await sync({ client_id: CLIENT }, [inOrg], {});
    assert.equal(missing.res.statusCode, 503);
    assert.ok(missing.res.body.missing.includes("PLAID_SECRET"));
    const other = await sync({ client_id: CLIENT }, [notInOrg]);
    assert.equal(other.res.statusCode, 404);
    assert.equal(plaidCalls.length, 0);
  });
});

// Two companies each hold a bank login. The stand-in tables answer every statement by the id and
// company its SQL names, so the 404 and the untouched rows are the product's own scoping.
describe("POST /api/banking/revoke {item_id, reason}", () => {
  const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
  const ITEM = "d1000000-0000-4000-8000-0000000000d1";
  const OTHER_ITEM = "d2000000-0000-4000-8000-0000000000d2";
  const REASON = "client asked us to disconnect their Chase login";
  const world = () => {
    const items = [
      { id: ITEM, org_id: ORG_ID, client_id: CLIENT, institution_name: "Chase", link_state: "active", has_access_token: true },
      { id: OTHER_ITEM, org_id: OTHER_ORG, client_id: "c2000000-0000-4000-8000-000000000002", institution_name: "Wells", link_state: "active", has_access_token: true }
    ];
    const accounts = [
      { id: "ac1", plaid_item_id: ITEM, org_id: ORG_ID },
      { id: "ac2", plaid_item_id: OTHER_ITEM, org_id: OTHER_ORG }
    ];
    const audit = [];
    const rules = [
      staffSession({ role: "owner" }),
      ...tableRules("plaid_items", items),
      ...tableRules("bank_accounts", accounts),
      [/subject_client_id IS NULL/i, [{ n: "0" }]],
      [/count\(\*\)[\s\S]*bank_transactions/i, [{ n: "12" }]],
      [/INSERT INTO erasure_requests/i, (_sql, p) => { audit.push({ org: p[0], client: p[1], item: p[2] }); return [{ id: "audit-1", created_at: "2026-10-13T00:00:00Z" }]; }]
    ];
    return { items, audit, rules };
  };
  const revoke = (itemId, rules) => callShared(revokeHandler, req("POST", { body: { item_id: itemId, reason: REASON } }), rules);

  test("disconnects this company's login only, with one audit row naming its client", async () => {
    const { items, audit, rules } = world();
    const { res } = await revoke(ITEM, rules);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.revoked, true);
    assert.deepEqual(items.map((i) => i.id), [OTHER_ITEM], "only the named login is deleted");
    assert.deepEqual(audit, [{ org: ORG_ID, client: CLIENT, item: ITEM }]);
  });

  test("another company's login is a 404 and nothing is deleted or audited", async () => {
    const { items, audit, rules } = world();
    const { res, fake } = await revoke(OTHER_ITEM, rules);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(items.map((i) => i.id), [ITEM, OTHER_ITEM]);
    assert.deepEqual(audit, []);
    assert.equal(fake.find(/DELETE FROM/).length, 0);
  });
});
