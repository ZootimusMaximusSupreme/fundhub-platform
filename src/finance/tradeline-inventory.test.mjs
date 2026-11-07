// Tradeline inventory and bank relationships (Finance OS wave 4, unit TL).
// Pure rules first, then the reads through a stand-in database that answers
// each statement by its own WHERE clause (src/testing/s3-scoped-rows.mjs), so
// a dropped org_id or client_id lets another client's rows in and goes red.
// Sample data only. No network, no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  KNOWN_BANKS, nameKey, bankIdentity, productTokens, isNamedProduct, lineProducts, namedFromProductWords,
  holdsProduct, trailingLast4, reportItems, businessReportItems, accountItems, buildGroups, mergeItems,
  buildInventory, holdingsOf, applyHoldingsToBankPlan, applyHoldingsToApplyGate, existingFirst,
  readTradelineEntry, addTradelineEntry, readTradelineInventory, tradelineView, bankStrategyWithHoldings,
  ENTITIES_SQL, BUSINESSES_SQL, ACCOUNTS_SQL, STAFF_LINES_SQL, ENTRIES_SQL, BOOK_SQL
} from "./tradeline-inventory.mjs";
import { CRS_SQL } from "./bank-strategy.mjs";
import { assertBind, rowsWhere } from "../testing/s3-scoped-rows.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const ORG2 = "00000000-0000-4000-8000-000000000002";
const MINE = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";
const ME_BOX = "aaaaaaaa-0000-4000-8000-000000000001";
const ACME = "aaaaaaaa-0000-4000-8000-000000000002";
const THEIRS = "aaaaaaaa-0000-4000-8000-000000000003";
const OLD_BIZ = "aaaaaaaa-0000-4000-8000-000000000004";
const L = {
  chase: "cccccccc-0000-4000-8000-000000000001", amex: "cccccccc-0000-4000-8000-000000000002",
  cit: "cccccccc-0000-4000-8000-000000000003", nfcu: "cccccccc-0000-4000-8000-000000000004",
  tru: "cccccccc-0000-4000-8000-000000000005", wf: "cccccccc-0000-4000-8000-000000000006",
  bofa: "cccccccc-0000-4000-8000-000000000007", other: "cccccccc-0000-4000-8000-000000000008"
};

/* ------------------------------------------------------------------ *
 * Sample file: one person, one credit file (sample-clients-consistent).
 * ------------------------------------------------------------------ */

const line = (over) => ({
  sourceType: "Experian", accountType: "Revolving", loanType: "CreditCard", accountOwnershipType: "Individual",
  accountStatusType: "Open", ...over
});

const NEW_PULL = {
  id: "c2", org_id: ORG, client_id: MINE, created_at: "2026-10-01T12:00:00Z",
  result: {
    environment: "production",
    bureausPulled: ["EX"],
    tradelines: [
      line({ creditorName: "JPMCB CARD SERVICES", accountIdentifier: "XXXXXXXXXXXX4417", creditLimitAmount: 5000,
        currentBalanceAmount: 400, accountOpenedDate: "2019-04-12", accountReportedDate: "2026-09-28" }),
      line({ creditorName: "AMEX", accountOwnershipType: "AuthorizedUser", creditLimitAmount: 20000, accountOpenedDate: "2015-01-03" }),
      line({ creditorName: "CAPITAL ONE", creditLimitAmount: 1500, accountOpenedDate: "2021-06-01" }),
      line({ creditorName: "CITIZENS BANK", creditLimitAmount: 3000, accountOpenedDate: "2020-02-02" }),
      line({ creditorName: "CHASE AUTO FINANCE", accountType: "Installment", loanType: "Automobile", accountStatusType: "Closed",
        accountClosedDate: "2024-05-01", highBalanceAmount: 9000, accountOpenedDate: "2020-01-15" }),
      line({ creditorName: "MIDLAND CREDIT MGMT", accountType: "Open", loanType: "CollectionAgencyAttorney", currentBalanceAmount: 400 })
    ],
    businessReports: [{
      name: "Acme LLC", state: "AZ", ageMonths: 30,
      report: { tradePaymentExperiences: [
        { businessName: "AMERICAN EXPRESS", accountType: "Credit Card", accountStatus: "Open", creditLimitAmount: 15000, dateOpened: "2022-02-01" },
        { accountType: "Net 30", accountStatus: "Open" }
      ] }
    }]
  }
};

const OLD_PULL = {
  id: "c1", org_id: ORG, client_id: MINE, created_at: "2026-08-01T12:00:00Z",
  result: {
    environment: "production",
    bureausPulled: ["EX", "TU", "EQ"],
    tradelines: [
      /* An Experian line from an OLDER pull: Experian's newest file no longer has it. */
      line({ creditorName: "BK OF AMER", creditLimitAmount: 7000, accountOpenedDate: "2018-03-03" }),
      line({ sourceType: "TransUnion", creditorName: "CHASE CARD", creditLimitAmount: 5000, accountOpenedDate: "2019-04-12",
        accountReportedDate: "2026-07-30" }),
      line({ sourceType: "Equifax", creditorName: "JPMCB CARD", creditLimitAmount: 5000, accountOpenedDate: "2019-04-12",
        accountReportedDate: "2026-07-29" })
    ]
  }
};

const THEIR_PULL = {
  id: "c9", org_id: ORG, client_id: OTHER, created_at: "2026-10-02T12:00:00Z",
  result: { environment: "production", tradelines: [line({ creditorName: "WELLS FARGO CARD SER", creditLimitAmount: 9900, accountOpenedDate: "2017-07-07" })] }
};

const ENTITIES = [
  { id: ME_BOX, org_id: ORG, client_id: MINE, kind: "personal", name: "Alex Sample (personal)", archived_at: null, created_at: "2026-09-01" },
  { id: ACME, org_id: ORG, client_id: MINE, kind: "business", name: "Acme LLC", archived_at: null, created_at: "2026-09-02" },
  { id: OLD_BIZ, org_id: ORG, client_id: MINE, kind: "business", name: "Old Shell LLC", archived_at: "2026-09-20", created_at: "2026-09-03" },
  { id: THEIRS, org_id: ORG, client_id: OTHER, kind: "business", name: "Theirs LLC", archived_at: null, created_at: "2026-09-04" }
];

const BUSINESSES = [
  { id: "b1", org_id: ORG, client_id: MINE, name: "Acme LLC", created_at: "2026-09-02",
    entity_data: { source: "finance_os", entity_id: ACME, state: "AZ" } },
  { id: "b2", org_id: ORG, client_id: MINE, name: "Beta Builders LLC", created_at: "2026-09-05",
    entity_data: { source: "slo", state: "AZ" } },
  { id: "b9", org_id: ORG, client_id: OTHER, name: "Theirs LLC", created_at: "2026-09-06", entity_data: { source: "slo", state: "TX" } }
];

const ACCOUNTS = [
  { id: "p1", org_id: ORG, client_id: MINE, name: "Ink Business Cash", official_name: "Ink Business Cash Credit Card", mask: "9001",
    account_type: "credit", account_subtype: "credit card", credit_limit_cents: 1000000, entity_kind: "business", entity_id: ACME,
    plaid_item_id: "it1", closed_at: null, plaid_institution_id: "ins_56", institution_name: "Chase", created_at: "2026-09-10" },
  { id: "p2", org_id: ORG, client_id: MINE, name: "Total Business Checking", mask: "1101", account_type: "depository",
    account_subtype: "checking", entity_kind: "business", entity_id: ACME, plaid_item_id: "it1", closed_at: null,
    plaid_institution_id: "ins_56", institution_name: "Chase", created_at: "2026-09-10" },
  { id: "p3", org_id: ORG, client_id: MINE, name: "Chase Freedom Unlimited", mask: "4417", account_type: "credit",
    account_subtype: "credit card", credit_limit_cents: 500000, entity_kind: "personal", entity_id: ME_BOX, plaid_item_id: "it1",
    closed_at: null, plaid_institution_id: "ins_56", institution_name: "Chase", created_at: "2026-09-10" },
  { id: "p4", org_id: ORG, client_id: MINE, name: "Everyday Checking", mask: "2202", account_type: "depository",
    account_subtype: "checking", entity_kind: "personal", entity_id: null, plaid_item_id: "it2", closed_at: "2026-10-03",
    plaid_institution_id: "ins_4", institution_name: "Wells Fargo", created_at: "2026-09-11" },
  { id: "h1", org_id: ORG, client_id: MINE, name: "Navy Federal cashRewards", mask: null, account_type: "credit",
    account_subtype: "credit card", credit_limit_cents: 300000, entity_kind: "unknown", entity_id: null, plaid_item_id: null,
    closed_at: null, entered_by: "client", created_at: "2026-09-12" },
  { id: "p9", org_id: ORG, client_id: OTHER, name: "Ink Business Preferred", mask: "7777", account_type: "credit",
    account_subtype: "credit card", credit_limit_cents: 2000000, entity_kind: "business", entity_id: THEIRS, plaid_item_id: "it9",
    closed_at: null, plaid_institution_id: "ins_56", institution_name: "Chase", created_at: "2026-09-13" }
];

const STAFF_LINES = [
  { id: "t1", org_id: ORG, client_id: MINE, source: "manual", lender: "PNC Cash Rewards", kind: "revolving",
    credit_limit_cents: 200000, opened_on: "2016-05-20", last4: null, entity_id: null, closed_at: null, created_at: "2026-09-14" },
  { id: "t8", org_id: ORG, client_id: MINE, source: "crs", lender: "JPMCB CARD", kind: "revolving",
    credit_limit_cents: 500000, opened_on: "2019-04-12", last4: null, entity_id: null, closed_at: null, created_at: "2026-09-14" }
];

const ENTRIES = [
  { id: "e1", org_id: ORG, client_id: MINE, creditor: "Chase", product: "Ink Unlimited", account_type: "credit_card",
    limit_cents: null, opened_month: "2024-05", scope: "business", entity_id: ACME, business_name: null, entered_by: "client", created_at: "2026-10-04" },
  { id: "e2", org_id: ORG, client_id: MINE, creditor: "Truist", product: null, account_type: "checking", limit_cents: null,
    opened_month: null, scope: "business", entity_id: null, business_name: "Beta Builders LLC", entered_by: "client", created_at: "2026-10-05" },
  { id: "e9", org_id: ORG, client_id: OTHER, creditor: "Chase", product: "Ink Preferred", account_type: "credit_card",
    limit_cents: null, opened_month: null, scope: "personal", entity_id: null, business_name: null, entered_by: "client", created_at: "2026-10-05" }
];

const BOOK = [
  { id: L.chase, org_id: ORG, active: true, name: "Chase", product_name: "Business Ink Cash / Ink Unlimited / Ink Preferred",
    lender_table: "InBranchBizCC", logo_path: "/assets/lenders/chase.png" },
  { id: L.amex, org_id: ORG, active: true, name: "American Express", product_name: "Business Gold / Blue Business Cash / Blue Business Plus",
    lender_table: "OnlineBizCC", logo_path: "/assets/lenders/american-express.png" },
  { id: L.cit, org_id: ORG, active: true, name: "Citizens Bank", product_name: null, lender_table: "OnlineBizCC", logo_path: "/assets/lenders/citizens-bank.png" },
  { id: L.nfcu, org_id: ORG, active: true, name: "Navy Federal Credit Union", product_name: "Navy Federal Personal Expense Loan",
    lender_table: "PersonalLoans", logo_path: "/assets/lenders/navy-federal-credit-union.png" },
  { id: L.tru, org_id: ORG, active: true, name: "Truist", product_name: null, lender_table: "OnlineBizCC", logo_path: "/assets/lenders/truist.png" },
  { id: L.wf, org_id: ORG, active: true, name: "Wells Fargo", product_name: null, lender_table: "OnlineBizCC", logo_path: "/assets/lenders/wells-fargo.png" },
  { id: L.bofa, org_id: ORG, active: true, name: "Bank of America", product_name: null, lender_table: "OnlineBizCC", logo_path: "/assets/lenders/bank-of-america.png" },
  { id: L.other, org_id: ORG2, active: true, name: "Capital One", product_name: null, lender_table: "PersonalCC", logo_path: null }
];

function inventoryOf(over = {}) {
  const pick = (rows) => rows.filter((r) => r.client_id === MINE && r.org_id === ORG);
  return buildInventory({
    entities: pick(ENTITIES), businesses: pick(BUSINESSES), crsRows: [NEW_PULL, OLD_PULL],
    accounts: pick(ACCOUNTS), staffLines: pick(STAFF_LINES).filter((r) => r.source === "manual"),
    entries: pick(ENTRIES), lenders: BOOK.filter((l) => l.org_id === ORG), ...over
  });
}
const groupNamed = (inv, name) => inv.groups.find((g) => g.name === name);
const itemsIn = (inv, name) => (groupNamed(inv, name) || { items: [] }).items;

/* ------------------------------------------------------------------ *
 * Bank names: certain or nothing
 * ------------------------------------------------------------------ */

describe("bank names: a match must be certain", () => {
  test("bureau and Plaid spellings of one bank are that bank", () => {
    assert.equal(bankIdentity("JPMCB CARD SERVICES").key, "chase");
    assert.equal(bankIdentity("CHASE CARD").key, "chase");
    assert.equal(bankIdentity("BK OF AMER").key, "bank_of_america");
    assert.equal(bankIdentity("BB&T").key, "truist");
    assert.equal(bankIdentity("Navy Federal Credit Union").key, "navy_federal");
    assert.equal(bankIdentity("Chase Ink").key, "chase", "a distinctive start followed by more words");
  });

  test("an uncertain name gives no match", () => {
    assert.equal(bankIdentity("CITIZENS BANK"), null, "many banks are called Citizens Bank");
    assert.equal(bankIdentity("First National Bank"), null);
    assert.equal(bankIdentity("SYNCB/AMAZON"), null);
    assert.equal(bankIdentity("Chasewood Credit Union"), null, "starting with the same letters is not the same bank");
    assert.equal(bankIdentity("Elan Credit Union"), null, "only the full 'Elan Financial' start is trusted");
    assert.equal(bankIdentity(""), null);
  });

  test("the bank book's own names are trusted only for the book", () => {
    assert.equal(bankIdentity("Citizens Bank", { book: true }).key, "citizens");
    assert.equal(bankIdentity("PNC Bank (0% BT only)", { book: true }).key, "pnc", "a parenthetical is commentary");
    assert.equal(bankIdentity("Flagstar Bank, National Association", { book: true }).key, "flagstar");
  });

  test("no name belongs to two banks", () => {
    const seen = new Map();
    for (const b of KNOWN_BANKS) {
      for (const n of [...b.exact, ...b.book]) {
        assert.equal(nameKey(n), n, `${n} is written as its own key`);
        assert.ok(!seen.has(n) || seen.get(n) === b.key, `${n} is listed for ${seen.get(n)} and ${b.key}`);
        seen.set(n, b.key);
      }
    }
  });
});

describe("products: what counts as already held", () => {
  test("product words drop the bank's name and filler words", () => {
    assert.deepEqual([...productTokens("Chase Ink Business Cash® Credit Card", "chase")], ["ink", "business", "cash"]);
    assert.equal(isNamedProduct("Business Cards", "truist"), false, "a generic label names no product");
    assert.equal(isNamedProduct("Business Ink Cash", "chase"), true);
  });

  test("a line's named products, never E's generic product words", () => {
    assert.deepEqual(lineProducts("Business Ink Cash / Ink Unlimited / Ink Preferred", [], "chase"),
      ["Business Ink Cash", "Ink Unlimited", "Ink Preferred"]);
    assert.deepEqual(lineProducts("Business credit card (apply online)", [], "wells_fargo"), []);
    assert.deepEqual(namedFromProductWords(["Business credit card (apply in a branch): Business Ink Cash / Ink Unlimited"], "chase"),
      ["Business Ink Cash", "Ink Unlimited"]);
    assert.deepEqual(namedFromProductWords(["Business credit card (apply online)"], "wells_fargo"), []);
  });

  test("held means every word of the product's name, at that bank, of that kind", () => {
    const bank = { key: "american_express", accounts: [
      { type: "card", scope: "personal", tokens: new Set(["blue", "cash", "everyday", "personal"]) }
    ] };
    assert.equal(holdsProduct(bank, "Blue Business Cash", { family: "card" }), false, "a personal Blue Cash card is not the business one");
    bank.accounts.push({ type: "card", scope: "business", tokens: new Set(["blue", "business", "cash"]) });
    assert.equal(holdsProduct(bank, "Blue Business Cash", { family: "card" }), true);
    assert.equal(holdsProduct(bank, "Blue Business Plus", { family: "card" }), false);
    assert.equal(holdsProduct(bank, "Blue Business Cash", { family: "loan" }), false, "a card is not a loan");
  });

  test("a business card never holds a personal product with the same words, nor the other way round", () => {
    const amex = { key: "american_express", accounts: [{ type: "card", scope: "business", tokens: new Set(["blue", "business", "cash"]) }] };
    assert.equal(holdsProduct(amex, "American Express Blue Cash", { family: "card", scope: "personal" }), false,
      "Blue Business Cash is not the personal Blue Cash");
    assert.equal(holdsProduct(amex, "Blue Business Cash", { family: "card", scope: "business" }), true);
    const unsorted = { key: "american_express", accounts: [{ type: "card", scope: null, tokens: new Set(["blue", "business", "cash"]) }] };
    assert.equal(holdsProduct(unsorted, "American Express Blue Cash", { family: "card", scope: "personal" }), false,
      "an unsorted card whose own name says business is on the business side");
    const personal = { key: "chase", accounts: [{ type: "card", scope: "personal", tokens: new Set(["ink", "cash", "personal"]) }] };
    assert.equal(holdsProduct(personal, "Ink Cash", { family: "card", scope: "business" }), false);
  });

  test("an unnamed book product is never called held, even with a business card at that bank", () => {
    const truist = { key: "truist", accounts: [{ type: "card", scope: "business", tokens: new Set(["business"]) }] };
    assert.equal(holdsProduct(truist, "Business Cards", { family: "card" }), false);
    assert.equal(holdsProduct(truist, "", { family: "card" }), false);
  });

  test("a report's last 4 only when the number ends in four digits", () => {
    assert.equal(trailingLast4("XXXXXXXXXXXX4417"), "4417");
    assert.equal(trailingLast4("426684XXXXXX"), null, "the first six digits are not the last four");
  });
});

/* ------------------------------------------------------------------ *
 * The inventory
 * ------------------------------------------------------------------ */

describe("the inventory: every source, one row per account", () => {
  test("each bureau's newest file is read; a line that dropped off is not shown; collections are left out", () => {
    const items = reportItems([NEW_PULL, OLD_PULL]);
    const names = items.map((i) => i.creditor);
    assert.ok(!names.includes("BK OF AMER"), "Experian's newest pull no longer has Bank of America");
    assert.ok(names.includes("CHASE CARD"), "TransUnion's newest file is the older pull");
    assert.ok(!names.some((n) => /MIDLAND/.test(n)), "a collection is not an account the client holds");
  });

  test("the same card on three bureaus and on Plaid is one row with every source", () => {
    const inv = inventoryOf();
    const chase = itemsIn(inv, "Personal").filter((i) => i.bank && i.bank.key === "chase");
    assert.equal(chase.length, 1, "one Chase card, not four");
    assert.deepEqual(chase[0].sources, ["report", "plaid"]);
    assert.deepEqual(chase[0].bureaus.sort(), ["EQ", "EX", "TU"]);
    assert.equal(chase[0].name, "Chase Freedom Unlimited", "Plaid's own name is the most specific");
    assert.equal(chase[0].limit_cents, 500000);
    assert.equal(chase[0].opened, "2019-04");
  });

  test("grouped Personal, each business, and Not sorted yet", () => {
    const inv = inventoryOf();
    assert.deepEqual(inv.groups.map((g) => g.name), ["Personal", "Acme LLC", "Beta Builders LLC", "Not sorted yet"],
      "the archived business with nothing in it is not shown");
    const acme = itemsIn(inv, "Acme LLC");
    assert.deepEqual(acme.map((i) => i.name).sort(),
      ["American Express", "Ink Business Cash", "Ink Unlimited", "Total Business Checking"]);
    assert.ok(acme.find((i) => i.name === "American Express").business_report, "the Experian Business line lands on its business");
    assert.equal(itemsIn(inv, "Beta Builders LLC")[0].name, "Truist", "an entry for a business with no container");
    assert.equal(itemsIn(inv, "Not sorted yet")[0].name, "Navy Federal cashRewards");
    assert.equal(groupNamed(inv, "Personal").closed, 2, "the closed auto loan and the closed checking are counted, not listed");
  });

  test("two different cards at one bank never merge, even with nothing else to tell them apart", () => {
    const acme = itemsIn(inventoryOf(), "Acme LLC");
    const ink = acme.filter((i) => i.bank && i.bank.key === "chase" && i.type === "card");
    assert.equal(ink.length, 2, "Ink Business Cash (Plaid) and Ink Unlimited (typed) stay two rows");
    assert.deepEqual(ink.map((i) => i.sources[0]).sort(), ["plaid", "you"]);
  });

  test("a typed card with no details joins the one matching card in its group; with two it stays apart", () => {
    const typed = { id: "e5", org_id: ORG, client_id: MINE, creditor: "Chase", product: "Freedom", account_type: "credit_card",
      limit_cents: null, opened_month: null, scope: "personal", entity_id: null, business_name: null, entered_by: "client" };
    const one = itemsIn(inventoryOf({ entries: [typed] }), "Personal").filter((i) => i.bank && i.bank.key === "chase");
    assert.equal(one.length, 1);
    assert.deepEqual(one[0].sources, ["report", "plaid", "you"]);

    const secondCard = { ...ACCOUNTS[2], id: "p5", name: "Chase Freedom Flex", mask: "5555", credit_limit_cents: 250000 };
    const two = itemsIn(inventoryOf({ entries: [typed], accounts: [...ACCOUNTS.filter((a) => a.client_id === MINE), secondCard] }), "Personal")
      .filter((i) => i.bank && i.bank.key === "chase");
    assert.equal(two.filter((i) => i.sources.includes("you")).length, 1);
    assert.equal(two.length, 3, "the typed card cannot tell which Freedom it is, so it stays its own row");
  });

  test("a limit match alone is not enough when two cards share that limit", () => {
    const items = [
      ...reportItems([{ id: "r", created_at: "2026-10-01", result: { tradelines: [line({ creditorName: "JPMCB CARD", creditLimitAmount: 5000,
        accountIdentifier: "XXXX", accountOpenedDate: "2023-01-01" })] } }]),
      ...accountItems([
        { id: "a", name: "Card A", account_type: "credit", credit_limit_cents: 500000, mask: "1111", plaid_item_id: "i", institution_name: "Chase" },
        { id: "b", name: "Card B", account_type: "credit", credit_limit_cents: 500000, mask: "2222", plaid_item_id: "i", institution_name: "Chase" }
      ])
    ];
    assert.equal(mergeItems(items).length, 3, "which of the two the report means is not plain, so none merge");
    const single = mergeItems(items.slice(0, 2));
    assert.equal(single.length, 1, "with one card at that limit, they merge");
  });

  test("an account that disagrees (a different limit) is a different account", () => {
    const typed = { id: "e6", org_id: ORG, client_id: MINE, creditor: "Capital One", product: null, account_type: "credit_card",
      limit_cents: 999900, opened_month: null, scope: "personal", entity_id: null, business_name: null, entered_by: "client" };
    const capOne = itemsIn(inventoryOf({ entries: [typed] }), "Personal").filter((i) => /capital one/i.test(i.creditor));
    assert.equal(capOne.length, 2);
  });

  test("another client's rows never appear (the pure half is handed scoped rows; the read below proves the scope)", () => {
    const inv = inventoryOf();
    const all = inv.groups.flatMap((g) => g.items);
    assert.ok(!all.some((i) => /Ink Business Preferred|WELLS FARGO CARD SER|Theirs/.test(i.name + i.creditor)));
  });
});

describe("existing relationships", () => {
  test("an open account at a bank on Giovanni's list is an existing relationship", () => {
    const inv = inventoryOf();
    assert.deepEqual(inv.relationships.map((r) => r.bank),
      ["American Express", "Chase", "Navy Federal Credit Union", "Truist"]);
    const chase = inv.relationships.find((r) => r.key === "chase");
    assert.deepEqual(chase.lender_ids, [L.chase]);
    assert.deepEqual(chase.scopes.sort(), ["business", "personal"]);
  });

  test("an authorized-user line, a closed account, a bank off the list and an uncertain name are not", () => {
    const onlyAu = inventoryOf({ crsRows: [{ id: "x", created_at: "2026-10-01", result: { tradelines: [
      line({ creditorName: "AMEX", accountOwnershipType: "AuthorizedUser", creditLimitAmount: 20000, accountOpenedDate: "2015-01-03" }),
      line({ creditorName: "BK OF AMER", accountStatusType: "Closed", creditLimitAmount: 7000, accountOpenedDate: "2018-03-03" }),
      line({ creditorName: "CITIZENS BANK", creditLimitAmount: 3000, accountOpenedDate: "2020-02-02" })
    ] } }], accounts: [], entries: [], staffLines: [], businesses: [] });
    assert.deepEqual(onlyAu.relationships, []);
    const pnc = inventoryOf();
    assert.ok(!pnc.relationships.some((r) => r.key === "pnc"), "PNC is a real bank but not on this book");
  });
});

/* ------------------------------------------------------------------ *
 * The bank plan
 * ------------------------------------------------------------------ */

function samplePlan() {
  const bank = (name, table, products, extra = {}) => ({ lender_id: `id-${name}`, name, kind: "bank", lender_table: table, products,
    minimum_deposit_cents: null, seasoning_days: null, relationship_steps: [], why: [], logo: null, ...extra });
  return {
    ok: true, client: { id: MINE }, relationships: [],
    recommended_banks: [
      bank("Wells Fargo", "OnlineBizCC", ["Business credit card (apply online)"]),
      bank("Citizens Bank", "OnlineBizCC", ["Business credit card (apply online)"]),
      bank("Chase", "InBranchBizCC", ["Business credit card (apply in a branch): Business Ink Cash / Ink Unlimited / Ink Preferred"]),
      bank("Truist", "OnlineBizCC", ["Business credit card (apply online)"])
    ],
    card_stacking: {
      items: [
        { order: 1, issuer: "Bank of America", lender_id: L.bofa, kind: "personal", card: "Personal credit card", other_cards: [] },
        { order: 2, issuer: "American Express", lender_id: L.amex, kind: "personal", card: "Blue Cash Everyday", other_cards: [] },
        { order: 3, issuer: "Wells Fargo", lender_id: L.wf, kind: "business", card: "Business credit card (apply online)", other_cards: [] },
        { order: 4, issuer: "American Express", lender_id: L.amex, kind: "business", card: "Business Gold / Blue Business Cash / Blue Business Plus", other_cards: [] },
        { order: 5, issuer: "Chase", lender_id: L.chase, kind: "business", card: "Business Ink Cash / Ink Unlimited / Ink Preferred", other_cards: [] }
      ],
      shown: 5
    },
    deposit_plan: [{ name: "Wells Fargo" }]
  };
}

describe("the bank plan: existing relationships first, no overlap", () => {
  const holdings = holdingsOf(inventoryOf());

  test("an existing relationship is ranked first; everything else keeps its order", () => {
    const out = applyHoldingsToBankPlan(samplePlan(), holdings);
    assert.deepEqual(out.recommended_banks.map((b) => b.name), ["Chase", "Truist", "Wells Fargo", "Citizens Bank"]);
    assert.equal(out.recommended_banks[0].existing_relationship.text, "Existing relationship");
    assert.equal(out.recommended_banks[2].existing_relationship, null);
    assert.equal(out.recommended_banks[0].has_account, true, "Acme LLC already has a Chase business checking account");
  });

  test("an uncertain name match gives no match: a CITIZENS BANK report line does not tag Giovanni's Citizens Bank", () => {
    const out = applyHoldingsToBankPlan(samplePlan(), holdings);
    assert.equal(out.recommended_banks.find((b) => b.name === "Citizens Bank").existing_relationship, null);
  });

  test("an overlap is excluded: the Chase line moves past the two Ink cards the client holds", () => {
    const out = applyHoldingsToBankPlan(samplePlan(), holdings);
    const chase = out.card_stacking.items.find((i) => i.issuer === "Chase");
    assert.deepEqual(chase.you_have, ["Business Ink Cash", "Ink Unlimited"]);
    assert.equal(chase.card, "Ink Preferred");
    assert.equal(chase.next_product, "Ink Preferred");
    assert.deepEqual(chase.other_cards, []);
    const bank = out.recommended_banks.find((b) => b.name === "Chase");
    assert.deepEqual(bank.you_have, ["Business Ink Cash", "Ink Unlimited"]);
    assert.equal(bank.next_product, "Ink Preferred");
  });

  test("a line whose every product is held leaves the apply order and the order is renumbered", () => {
    const all = holdingsOf(inventoryOf({ entries: [...ENTRIES.filter((e) => e.client_id === MINE),
      { id: "e7", org_id: ORG, client_id: MINE, creditor: "Chase", product: "Ink Business Preferred", account_type: "credit_card",
        limit_cents: 2500000, opened_month: null, scope: "business", entity_id: ACME, business_name: null, entered_by: "client" }] }));
    const out = applyHoldingsToBankPlan(samplePlan(), all);
    assert.ok(!out.card_stacking.items.some((i) => i.issuer === "Chase"), "nothing left to apply for at Chase");
    assert.equal(out.card_stacking.already_have.length, 1);
    assert.equal(out.card_stacking.already_have[0].text, "You already have this");
    assert.deepEqual(out.card_stacking.items.map((i) => i.order), [1, 2, 3, 4]);
    assert.equal(out.card_stacking.shown, 4);
  });

  test("personal before business still holds; inside each, existing relationships first", () => {
    const out = applyHoldingsToBankPlan(samplePlan(), holdings);
    assert.deepEqual(out.card_stacking.items.map((i) => `${i.kind}:${i.issuer}`), [
      "personal:American Express", "personal:Bank of America",
      "business:American Express", "business:Chase", "business:Wells Fargo"
    ]);
    const amexPersonal = out.card_stacking.items[0];
    assert.deepEqual(amexPersonal.you_have, [], "an authorized-user Amex and a business Amex do not hold Blue Cash Everyday");
    assert.equal(amexPersonal.card, "Blue Cash Everyday");
  });

  test("an unnamed product is never called held", () => {
    const out = applyHoldingsToBankPlan(samplePlan(), holdings);
    const wells = out.card_stacking.items.find((i) => i.issuer === "Wells Fargo");
    assert.deepEqual(wells.you_have, []);
    assert.equal(wells.already_have, false);
  });

  test("the deposit plan is rebuilt in the ranked order and says where an account is already open", () => {
    const out = applyHoldingsToBankPlan(samplePlan(), holdings);
    assert.deepEqual(out.deposit_plan.map((r) => r.name), ["Chase", "Truist", "Wells Fargo", "Citizens Bank"]);
    assert.equal(out.deposit_plan[0].existing_relationship.text, "Existing relationship");
    assert.equal(out.deposit_plan[0].has_account, true);
    assert.equal(out.deposit_plan[2].has_account, false);
  });

  test("with no holdings the plan keeps its order and every tag is empty", () => {
    const out = applyHoldingsToBankPlan(samplePlan(), holdingsOf(null));
    assert.deepEqual(out.recommended_banks.map((b) => b.name), ["Wells Fargo", "Citizens Bank", "Chase", "Truist"]);
    assert.ok(out.recommended_banks.every((b) => b.existing_relationship === null));
    assert.equal(out.card_stacking.items.find((i) => i.issuer === "Chase").card, "Business Ink Cash / Ink Unlimited / Ink Preferred");
  });

  test("approval odds put existing relationships first and keep every bank", () => {
    const gate = { ok: true, view: "apply_gate", odds: [
      { bank: "Wells Fargo", products: [], status: "ready" },
      { bank: "Chase", products: ["Business Ink Cash / Ink Unlimited / Ink Preferred"], status: "wait" },
      { bank: "Bank of America", products: [], status: "ready" },
      { bank: "Truist", products: [], status: "not_yet" }
    ] };
    const out = applyHoldingsToApplyGate(gate, holdings);
    assert.deepEqual(out.odds.map((o) => o.bank), ["Chase", "Truist", "Wells Fargo", "Bank of America"]);
    assert.deepEqual(out.odds[0].you_have, ["Business Ink Cash", "Ink Unlimited"]);
    assert.equal(out.odds[0].next_product, "Ink Preferred");
    assert.equal(out.odds[0].status, "wait", "the gate's own answer is untouched");
  });

  test("existingFirst is stable", () => {
    const rows = [{ n: 1 }, { n: 2, existing_relationship: {} }, { n: 3 }, { n: 4, existing_relationship: {} }];
    assert.deepEqual(existingFirst(rows).map((r) => r.n), [2, 4, 1, 3]);
  });
});

/* ------------------------------------------------------------------ *
 * "Add an account"
 * ------------------------------------------------------------------ */

describe("Add an account: the checks", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  test("a good entry is read in full", () => {
    assert.deepEqual(readTradelineEntry({ creditor: " Chase ", product: "Ink Business Cash", type: "credit_card", limit: "10,000",
      opened: "2021-03", belongs_to: `entity:${ACME}` }, { now }),
    { creditor: "Chase", product: "Ink Business Cash", type: "credit_card", limit: 1000000, opened: "2021-03", scope: "business", entityId: ACME });
    assert.deepEqual(readTradelineEntry({ creditor: "Truist", type: "checking", belongs_to: "business:Beta Builders LLC" }, { now }),
      { creditor: "Truist", product: null, type: "checking", limit: null, opened: null, scope: "business", businessKey: "beta builders llc" });
    assert.equal(readTradelineEntry({ creditor: "Navy Federal", type: "loan" }, { now }).scope, "personal");
  });

  test("each bad field is refused by name", () => {
    const bad = (body, re) => assert.throws(() => readTradelineEntry(body, { now }), re);
    bad({ type: "credit_card" }, /bank or lender is required/);
    bad({ creditor: "Chase", type: "brokerage" }, /type must be one of/);
    bad({ creditor: "Chase", type: "checking", limit: "500" }, /only for a credit card or a line of credit/);
    bad({ creditor: "Chase", type: "credit_card", limit: "0" }, /more than \$0/);
    bad({ creditor: "Chase", type: "credit_card", limit: "ten" }, /dollar amount/);
    bad({ creditor: "Chase", type: "credit_card", opened: "2027-01" }, /future/);
    bad({ creditor: "Chase", type: "credit_card", opened: "March" }, /month/);
    bad({ creditor: "Chase", type: "credit_card", belongs_to: "entity:not-a-uuid" }, /belongs to/);
  });
});

/* ------------------------------------------------------------------ *
 * The reads and the write, through a stand-in database
 * ------------------------------------------------------------------ */

function scopedDb({ failOn = null, plaid = [] } = {}) {
  const entries = ENTRIES.map((e) => ({ ...e }));
  const tables = {
    entities: ENTITIES, businesses: BUSINESSES, crs_results: [NEW_PULL, OLD_PULL, THEIR_PULL], bank_accounts: ACCOUNTS,
    tradelines: STAFF_LINES, finance_tradeline_entries: entries, lenders: BOOK
  };
  const log = [];
  const db = {
    log, entries,
    async query(sql, params = []) {
      assertBind(sql, params);
      log.push({ sql, params });
      if (failOn && failOn.test(sql)) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
      if (/^\s*INSERT INTO finance_tradeline_entries/i.test(sql)) {
        const cols = /\(([^)]*)\)\s*VALUES/i.exec(sql)[1].split(",").map((c) => c.trim());
        const row = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
        row.id = `new-${entries.length + 1}`;
        row.created_at = "2026-11-07T12:00:00Z";
        entries.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (/FROM plaid_institutions/.test(sql)) {
        return { rows: plaid.filter((r) => (params[0] || []).includes(r.plaid_institution_id) || (params[1] || []).includes(r.name_key)) };
      }
      const m = /\bFROM\s+(\w+)/i.exec(sql);
      const table = m ? m[1] : null;
      if (!tables[table]) throw new Error(`unexpected statement: ${sql.slice(0, 80)}`);
      let rows = rowsWhere(tables[table], sql.replace(/\bba\./g, "").replace(/LEFT JOIN[\s\S]*?(?=WHERE)/i, ""), params);
      if (table === "lenders" && /logo_path IS NOT NULL/.test(sql)) {
        rows = BOOK.filter((l) => l.org_id === params[0] && l.logo_path && (params[1] || []).includes(l.id))
          .map((l) => ({ id: l.id, name_key: l.name.toLowerCase().replace(/[^a-z0-9]+/g, ""), logo_path: l.logo_path }));
      }
      return { rows: rows.map((r) => ({ ...r })) };
    }
  };
  return db;
}

describe("the reads: scoped to the org and the client", () => {
  test("every statement names org_id and the client's id, and nothing of the other client comes back", async () => {
    const db = scopedDb();
    const inv = await readTradelineInventory(db, { orgId: ORG, clientId: MINE });
    for (const sql of [ENTITIES_SQL, BUSINESSES_SQL, ACCOUNTS_SQL, STAFF_LINES_SQL, ENTRIES_SQL]) {
      const call = db.log.find((c) => c.sql === sql);
      assert.ok(call, "each read ran");
      assert.deepEqual(call.params, [ORG, MINE]);
      assert.match(sql, /org_id = \$1 AND (ba\.)?client_id = \$2/);
    }
    assert.deepEqual(db.log.find((c) => c.sql === CRS_SQL).params, [MINE, ORG]);
    assert.deepEqual(db.log.find((c) => c.sql === BOOK_SQL).params, [ORG]);
    assert.match(BOOK_SQL, /active = true/, "Giovanni's active list only");
    const text = JSON.stringify(inv.groups);
    assert.ok(!/Ink Business Preferred|Theirs LLC|WELLS FARGO CARD SER/.test(text), "the other client's rows stay out");
    assert.equal(inv.relationships.length, 4);
  });

  test("the view carries each bank's logo in H's order and the add-form choices", async () => {
    const view = await tradelineView(scopedDb(), { orgId: ORG, clientId: MINE });
    assert.equal(view.view, "tradelines");
    const chase = view.relationships.find((r) => r.key === "chase");
    assert.equal(chase.logo, "/assets/lenders/chase.png", "no Plaid logo saved, so the bank book's file");
    assert.equal(chase.logo_source, "bank_book");
    const capOne = view.groups[0].items.find((i) => /CAPITAL ONE/.test(i.creditor));
    assert.equal(capOne.logo, null, "a bank we cannot name shows its name only");
    assert.deepEqual(view.add.belongs_to.map((b) => b.label), ["Personal", "Acme LLC", "Beta Builders LLC"]);
    assert.deepEqual(view.add.types.map((t) => t.value), ["credit_card", "line_of_credit", "loan", "checking", "savings"]);
    const card = view.groups.find((g) => g.name === "Acme LLC").items.find((i) => i.name === "Ink Business Cash");
    assert.deepEqual(card.source_words, ["Plaid"]);
    assert.equal(card.type_words, "Credit card");
  });

  test("Plaid's own logo wins over the bank book's when one is saved for that bank", async () => {
    const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const view = await tradelineView(scopedDb({ plaid: [{ plaid_institution_id: "ins_56", name_key: "chase", logo_base64: PNG }] }),
      { orgId: ORG, clientId: MINE });
    const chase = view.relationships.find((r) => r.key === "chase");
    assert.equal(chase.logo, `data:image/png;base64,${PNG}`);
    assert.equal(chase.logo_source, "plaid");
    const ink = view.groups.find((g) => g.name === "Acme LLC").items.find((i) => i.name === "Ink Business Cash");
    assert.equal(ink.logo_source, "plaid", "the Plaid card shows its bank's Plaid logo");
    const amex = view.relationships.find((r) => r.key === "american_express");
    assert.equal(amex.logo_source, "bank_book", "a bank with no Plaid logo still shows the book's file");
  });

  test("a loan's high credit is never shown as a limit", async () => {
    const view = await tradelineView(scopedDb(), { orgId: ORG, clientId: MINE });
    const all = view.groups.flatMap((g) => g.items);
    for (const it of all) if (!["card", "line"].includes(it.type)) assert.equal(it.limit_cents, null, it.name);
    assert.ok(all.some((i) => i.type === "card" && i.limit_cents > 0));
  });
});

describe("Add an account: saved, scoped", () => {
  test("a manual add persists and shows on the next read for this client only", async () => {
    const db = scopedDb();
    const input = readTradelineEntry({ creditor: "Bank of America", product: "Business Advantage Cash Rewards", type: "credit_card",
      limit: "8,000", opened: "2025-01", belongs_to: `entity:${ACME}` }, { now: new Date("2026-11-07") });
    const r = await addTradelineEntry(db, { orgId: ORG, clientId: MINE, input, by: { kind: "client", id: null } });
    assert.equal(r.ok, true);
    const saved = db.entries.at(-1);
    assert.equal(saved.org_id, ORG);
    assert.equal(saved.client_id, MINE);
    assert.equal(saved.entity_id, ACME);
    assert.equal(saved.limit_cents, 800000);
    assert.equal(saved.entered_by, "client");

    const mine = await readTradelineInventory(db, { orgId: ORG, clientId: MINE });
    const bofa = itemsIn(mine, "Acme LLC").find((i) => i.bank && i.bank.key === "bank_of_america");
    assert.ok(bofa, "the new account is in Acme LLC");
    assert.deepEqual(bofa.sources, ["you"]);
    assert.ok(mine.relationships.some((x) => x.key === "bank_of_america"), "and Bank of America is now an existing relationship");

    const theirs = await readTradelineInventory(db, { orgId: ORG, clientId: OTHER });
    assert.ok(!theirs.items.some((i) => i.bank && i.bank.key === "bank_of_america"), "another client never sees it");
    const otherOrg = await readTradelineInventory(db, { orgId: ORG2, clientId: MINE });
    assert.equal(otherOrg.items.length, 0, "another org never sees it");
  });

  test("another client's business is refused, before anything is written", async () => {
    const db = scopedDb();
    const before = db.entries.length;
    const input = readTradelineEntry({ creditor: "Chase", type: "credit_card", belongs_to: `entity:${THEIRS}` });
    const r = await addTradelineEntry(db, { orgId: ORG, clientId: MINE, input });
    assert.deepEqual(r, { ok: false, reason: "business_not_found" });
    assert.equal(db.entries.length, before);
  });

  test("an archived business and a personal container are refused", async () => {
    const db = scopedDb();
    const archived = await addTradelineEntry(db, { orgId: ORG, clientId: MINE,
      input: readTradelineEntry({ creditor: "Chase", type: "credit_card", belongs_to: `entity:${OLD_BIZ}` }) });
    assert.equal(archived.reason, "container_archived");
    const personalBox = await addTradelineEntry(db, { orgId: ORG, clientId: MINE,
      input: readTradelineEntry({ creditor: "Chase", type: "credit_card", belongs_to: `entity:${ME_BOX}` }) });
    assert.equal(personalBox.reason, "not_a_business_container");
  });

  test("a business with no container is saved by its name; a linked one by its container", async () => {
    const db = scopedDb();
    await addTradelineEntry(db, { orgId: ORG, clientId: MINE,
      input: readTradelineEntry({ creditor: "Truist", type: "savings", belongs_to: "business:beta builders llc" }) });
    assert.equal(db.entries.at(-1).business_name, "Beta Builders LLC");
    assert.equal(db.entries.at(-1).entity_id, null);
    await addTradelineEntry(db, { orgId: ORG, clientId: MINE,
      input: readTradelineEntry({ creditor: "Chase", type: "savings", belongs_to: "business:acme llc" }) });
    assert.equal(db.entries.at(-1).entity_id, ACME, "Acme LLC has a container, so the entry uses it");
    assert.equal(db.entries.at(-1).business_name, null);
    const missing = await addTradelineEntry(db, { orgId: ORG, clientId: MINE,
      input: readTradelineEntry({ creditor: "Chase", type: "savings", belongs_to: "business:theirs llc" }) });
    assert.equal(missing.reason, "business_not_found", "another client's business name is not this client's");
  });
});

describe("the bank plan wrapper", () => {
  test("if the inventory read fails, the bank plan still answers, untouched", async () => {
    const db = scopedDb({ failOn: /finance_tradeline_entries/ });
    const plan = samplePlan();
    const orig = console.error;
    const said = [];
    console.error = (...a) => said.push(a.join(" "));
    try {
      const out = await bankStrategyWithHoldings(db, { orgId: ORG, clientId: MINE }, { read: async () => plan });
      assert.equal(out, plan, "the same payload, not a half-tagged copy");
      assert.equal(out.recommended_banks[0].name, "Wells Fargo");
    } finally {
      console.error = orig;
    }
    assert.match(said.join(" "), /tradeline inventory skipped/);
  });

  test("with the read working, the plan is ranked and a line that left the order keeps its bank's logo", async () => {
    const db = scopedDb();
    db.entries.push({ id: "e7", org_id: ORG, client_id: MINE, creditor: "Chase", product: "Ink Business Preferred", account_type: "credit_card",
      limit_cents: 2500000, opened_month: null, scope: "business", entity_id: ACME, business_name: null, entered_by: "client" });
    const out = await bankStrategyWithHoldings(db, { orgId: ORG, clientId: MINE }, { read: async () => samplePlan() });
    assert.equal(out.recommended_banks[0].name, "Chase");
    assert.equal(out.card_stacking.already_have[0].issuer, "Chase");
    assert.equal(out.card_stacking.already_have[0].logo, "/assets/lenders/chase.png");
    const passThrough = await bankStrategyWithHoldings(db, { orgId: ORG, clientId: MINE }, { read: async () => null });
    assert.equal(passThrough, null, "a client not in the org stays a 404 upstream");
  });
});
