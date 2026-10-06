// src/finance/containers.mjs — stubbed db, no network, no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert";

import {
  listContainers, createContainer, renameContainer, assignAccount, unassignAccount,
  containerBilling, readPricePerContainer, slotFor
} from "./containers.mjs";

const ORG = "org-1";
const CLIENT = "11111111-2222-3333-4444-555555555555";
const OTHER_CLIENT = "99999999-2222-3333-4444-555555555555";
const PERSONAL = "aaaaaaaa-0000-0000-0000-000000000001";
const BUSINESS = "aaaaaaaa-0000-0000-0000-000000000002";
const ACCT = "bbbbbbbb-0000-0000-0000-000000000001";

/** A db that answers by matching SQL, and records every call. */
function fakeDb(routes) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      for (const [re, rows] of routes) {
        if (re.test(sql)) return { rows: typeof rows === "function" ? rows(sql, params) : rows };
      }
      return { rows: [] };
    }
  };
}

describe("listContainers", () => {
  test("groups accounts, cards, loans and bills; unassigned rows land in unassigned", async () => {
    const db = fakeDb([
      [/FROM entities/, [
        { id: PERSONAL, kind: "personal", name: "Chris", archived_at: null },
        { id: BUSINESS, kind: "business", name: "Fundhub LLC", archived_at: null }
      ]],
      [/FROM bank_accounts/, [
        { id: "a1", name: "Personal Checking", account_type: "depository", entity_kind: "personal",
          entity_kind_source: "staff_reviewed", entity_id: PERSONAL, current_balance_cents: "421055",
          available_balance_cents: null, plaid_item_id: "item-1" },
        { id: "a2", name: "Business Amex", account_type: "credit", entity_kind: "business",
          entity_kind_source: "staff_reviewed", entity_id: BUSINESS, current_balance_cents: "540000",
          credit_limit_cents: "2500000", plaid_item_id: "item-1" },
        { id: "a3", name: "Car Loan", account_type: "loan", entity_kind: "unknown", entity_id: null,
          current_balance_cents: null }
      ]],
      [/FROM tradelines/, [
        { id: "t1", lender: "Chase", kind: "revolving", entity_id: BUSINESS, balance_cents: "1000" }
      ]],
      [/FROM recurring_bills/, [
        { id: "r1", merchant_display: "Rent", typical_amount_cents: "-250000", cadence: "monthly",
          next_expected_on: "2026-11-01", container_id: PERSONAL }
      ]]
    ]);
    const { containers, unassigned } = await listContainers(db, { orgId: ORG, clientId: CLIENT });
    const [p, b] = containers;
    assert.equal(p.accounts[0].current_cents, 421055);
    assert.equal(p.accounts[0].available_cents, null, "unknown stays null, never 0");
    assert.equal(p.accounts[0].provider, "plaid");
    assert.equal(p.bills[0].amount_cents, 250000);
    assert.equal(b.cards.length, 2, "Plaid card + tradeline");
    assert.equal(b.cards[0].limit_cents, 2500000);
    assert.equal(unassigned.loans[0].id, "a3");
    assert.equal(unassigned.loans[0].current_cents, null);
    for (const c of db.calls) assert.deepEqual(c.params.slice(0, 2), [ORG, CLIENT], "every read is org + client scoped");
  });

  test("refuses a non-uuid client id before any query", async () => {
    const db = fakeDb([]);
    await assert.rejects(listContainers(db, { orgId: ORG, clientId: "nope" }), TypeError);
    assert.equal(db.calls.length, 0);
  });

  test("slotFor", () => {
    assert.equal(slotFor("credit"), "cards");
    assert.equal(slotFor("loan"), "loans");
    assert.equal(slotFor("depository"), "accounts");
    assert.equal(slotFor(null), "accounts");
  });
});

describe("createContainer / renameContainer", () => {
  test("create inserts kind + name under the session org", async () => {
    const db = fakeDb([
      [/FROM clients/, [{ "?column?": 1 }]],
      [/INSERT INTO entities/, (_s, p) => [{ id: BUSINESS, client_id: p[1], kind: p[2], name: p[3] }]]
    ]);
    const r = await createContainer(db, { orgId: ORG, clientId: CLIENT, kind: "Business", name: "  Fundhub LLC " });
    assert.equal(r.ok, true);
    const ins = db.calls.find((c) => /INSERT/.test(c.sql));
    assert.deepEqual(ins.params, [ORG, CLIENT, "business", "Fundhub LLC"]);
  });

  test("create refuses a bad kind and an empty name", async () => {
    const db = fakeDb([]);
    await assert.rejects(createContainer(db, { orgId: ORG, clientId: CLIENT, kind: "trust", name: "X" }), /kind/);
    await assert.rejects(createContainer(db, { orgId: ORG, clientId: CLIENT, kind: "personal", name: " " }), /name/);
    assert.equal(db.calls.length, 0);
  });

  test("create for a client outside the org writes nothing", async () => {
    const db = fakeDb([[/FROM clients/, []]]);
    const r = await createContainer(db, { orgId: ORG, clientId: CLIENT, kind: "personal", name: "Chris" });
    assert.deepEqual(r, { ok: false, reason: "client_not_found" });
    assert.equal(db.calls.some((c) => /INSERT/.test(c.sql)), false);
  });

  test("rename of a missing container is container_not_found", async () => {
    const db = fakeDb([[/UPDATE entities/, []]]);
    const r = await renameContainer(db, { orgId: ORG, containerId: PERSONAL, name: "New" });
    assert.equal(r.reason, "container_not_found");
  });
});

describe("assignAccount", () => {
  const acct = (over = {}) => ({ id: ACCT, client_id: CLIENT, entity_id: null, entity_kind: "unknown",
    entity_kind_source: null, entity_kind_set_at: null, ...over });
  const ent = (over = {}) => ({ id: BUSINESS, client_id: CLIENT, kind: "business", archived_at: null, ...over });

  test("sets entity_id AND entity_kind together, stamped staff_reviewed", async () => {
    const db = fakeDb([
      [/FROM bank_accounts/, [acct()]],
      [/FROM entities/, [ent()]],
      [/UPDATE bank_accounts/, (_s, p) => [{ id: p[0], client_id: CLIENT, entity_id: p[2], entity_kind: p[3] }]]
    ]);
    const r = await assignAccount(db, { orgId: ORG, accountId: ACCT, containerId: BUSINESS, at: "2026-10-06T12:00:00.000Z" });
    assert.equal(r.ok, true);
    assert.equal(r.kind, "business");
    const up = db.calls.find((c) => /UPDATE bank_accounts/.test(c.sql));
    assert.deepEqual(up.params, [ACCT, ORG, BUSINESS, "business", "staff_reviewed", "2026-10-06T12:00:00.000Z"]);
  });

  test("same kind with an existing basis keeps the basis and its date", async () => {
    const db = fakeDb([
      [/FROM bank_accounts/, [acct({ entity_kind: "business", entity_kind_source: "document_verified", entity_kind_set_at: "2026-01-01T00:00:00Z" })]],
      [/FROM entities/, [ent()]],
      [/UPDATE bank_accounts/, (_s, p) => [{ id: p[0], client_id: CLIENT, entity_id: p[2], entity_kind: p[3] }]]
    ]);
    await assignAccount(db, { orgId: ORG, accountId: ACCT, containerId: BUSINESS });
    const up = db.calls.find((c) => /UPDATE bank_accounts/.test(c.sql));
    assert.equal(up.params[4], "document_verified");
    assert.equal(up.params[5], "2026-01-01T00:00:00Z");
  });

  test("already in this container with the same kind → no write", async () => {
    const db = fakeDb([
      [/FROM bank_accounts/, [acct({ entity_id: BUSINESS, entity_kind: "business", entity_kind_source: "staff_reviewed" })]],
      [/FROM entities/, [ent()]]
    ]);
    const r = await assignAccount(db, { orgId: ORG, accountId: ACCT, containerId: BUSINESS });
    assert.equal(r.changed, false);
    assert.equal(db.calls.some((c) => /UPDATE/.test(c.sql)), false);
  });

  test("a container from another client is refused, nothing written", async () => {
    const db = fakeDb([
      [/FROM bank_accounts/, [acct()]],
      [/FROM entities/, [ent({ client_id: OTHER_CLIENT })]]
    ]);
    const r = await assignAccount(db, { orgId: ORG, accountId: ACCT, containerId: BUSINESS });
    assert.equal(r.reason, "container_belongs_to_another_client");
    assert.equal(db.calls.some((c) => /UPDATE/.test(c.sql)), false);
  });

  test("an archived container is refused", async () => {
    const db = fakeDb([
      [/FROM bank_accounts/, [acct()]],
      [/FROM entities/, [ent({ archived_at: "2026-10-01T00:00:00Z" })]]
    ]);
    const r = await assignAccount(db, { orgId: ORG, accountId: ACCT, containerId: BUSINESS });
    assert.equal(r.reason, "container_archived");
  });

  test("missing account / container", async () => {
    let r = await assignAccount(fakeDb([]), { orgId: ORG, accountId: ACCT, containerId: BUSINESS });
    assert.equal(r.reason, "account_not_found");
    r = await assignAccount(fakeDb([[/FROM bank_accounts/, [acct()]]]), { orgId: ORG, accountId: ACCT, containerId: BUSINESS });
    assert.equal(r.reason, "container_not_found");
  });
});

describe("unassignAccount", () => {
  test("clears entity_id and sends kind back to unknown with no provenance", async () => {
    const db = fakeDb([[/UPDATE bank_accounts/, [{ id: ACCT, client_id: CLIENT }]]]);
    const r = await unassignAccount(db, { orgId: ORG, accountId: ACCT });
    assert.equal(r.ok, true);
    const sql = db.calls[0].sql;
    assert.match(sql, /entity_id = NULL/);
    assert.match(sql, /entity_kind = 'unknown'/);
    assert.match(sql, /entity_kind_source = NULL/);
    assert.match(sql, /entity_kind_set_at = NULL/);
    assert.doesNotMatch(sql, /DELETE/);
  });
});

describe("billing", () => {
  test("price unset → null price and null monthly, never $0", async () => {
    const db = fakeDb([[/count\(\*\)/, [{ n: 2 }]]]);
    const b = await containerBilling(db, { orgId: ORG, clientId: CLIENT, env: {} });
    assert.deepEqual(b, { containers: 2, price_per_container_cents: null, monthly_cents: null });
  });

  test("price set → count × price in integer cents", async () => {
    const db = fakeDb([[/count\(\*\)/, [{ n: 2 }]]]);
    const b = await containerBilling(db, { orgId: ORG, clientId: CLIENT, env: { FINANCE_OS_PRICE_PER_CONTAINER_CENTS: "4900" } });
    assert.deepEqual(b, { containers: 2, price_per_container_cents: 4900, monthly_cents: 9800 });
  });

  test("count only non-archived containers holding an open account or a tradeline", async () => {
    const db = fakeDb([[/count\(\*\)/, [{ n: 0 }]]]);
    await containerBilling(db, { orgId: ORG, clientId: CLIENT, env: {} });
    const sql = db.calls[0].sql;
    assert.match(sql, /archived_at IS NULL/);
    assert.match(sql, /closed_at IS NULL/);
    assert.match(sql, /FROM tradelines/);
  });

  test("readPricePerContainer refuses anything that is not whole cents", () => {
    assert.equal(readPricePerContainer({}), null);
    assert.equal(readPricePerContainer({ FINANCE_OS_PRICE_PER_CONTAINER_CENTS: "" }), null);
    assert.equal(readPricePerContainer({ FINANCE_OS_PRICE_PER_CONTAINER_CENTS: "49.00" }), null);
    assert.equal(readPricePerContainer({ FINANCE_OS_PRICE_PER_CONTAINER_CENTS: "-5" }), null);
    assert.equal(readPricePerContainer({ FINANCE_OS_PRICE_PER_CONTAINER_CENTS: " 2500 " }), 2500);
    assert.equal(readPricePerContainer({ FINANCE_OS_PRICE_PER_CONTAINER_CENTS: "0" }), 0);
  });
});
