// src/finance/money-overview.mjs — the Finance OS dashboard read. Stubbed db, no
// network, no Postgres. The rules under test are the contract's: cents, null for
// unknown, floors, cash never combined, debt may combine.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildMoneyOverview, moneyOverview, pickTip, readPricePerContainer
} from "./money-overview.mjs";

const FIXTURE = JSON.parse(readFileSync(new URL("./money-overview.fixture.json", import.meta.url), "utf8"));

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT = { id: "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e", first_name: "Test", last_name: "Test", custom_fields: {} };
const AS_OF = "2026-10-06T12:00:00.000Z";
const BIZ = { id: "e-biz", kind: "business", name: "Fundhub LLC" };
const PER = { id: "e-per", kind: "personal", name: "Chris (personal)" };
const SANDBOX = "First Platypus Bank (Plaid sandbox — test data)";

const acct = (o) => ({
  provider: "plaid", entity_kind: "unknown", entity_id: null, closed_at: null,
  available_balance_cents: null, credit_limit_cents: null, institution_name: SANDBOX, ...o
});

/* The four sandbox accounts on the live test client, as pg hands them back
   (bigint as strings). */
const FOUR = [
  acct({ id: "a1", name: "Personal Checking", mask: "1101", account_type: "depository", account_subtype: "checking", current_balance_cents: "421055", entity_id: "e-per" }),
  acct({ id: "a2", name: "Business Checking", mask: "2202", account_type: "depository", account_subtype: "checking", current_balance_cents: "1875000", entity_id: "e-biz" }),
  acct({ id: "a3", name: "Personal Visa", mask: "3303", account_type: "credit", account_subtype: "credit card", current_balance_cents: "132040", credit_limit_cents: "800000", entity_id: "e-per" }),
  acct({ id: "a4", name: "Business Amex", mask: "4404", account_type: "credit", account_subtype: "credit card", current_balance_cents: "540000", credit_limit_cents: "2500000", entity_id: "e-biz" })
];

function keysDeep(v) {
  if (Array.isArray(v)) return "array";
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, keysDeep(v[k])]));
  }
  return null;
}

describe("buildMoneyOverview — empty client", () => {
  const out = buildMoneyOverview({ client: CLIENT, asOf: AS_OF });

  test("every number is null, never 0", () => {
    for (const k of ["personal", "business", "unknown"]) {
      assert.deepEqual(out.cash[k], { cents: null, is_floor: false, accounts: 0 });
      assert.equal(out.debt.by_kind[k], null);
    }
    assert.equal(out.debt.total_cents, null);
    assert.equal(out.debt.is_floor, false);
  });

  test("lists are empty, not fake rows", () => {
    assert.deepEqual(out.accounts, []);
    assert.deepEqual(out.containers, []);
    assert.deepEqual(out.debt.cards, []);
    assert.deepEqual(out.debt.by_container, []);
    assert.deepEqual(out.cashflow, { has_transactions: false, months: [] });
    assert.deepEqual(out.bills, []);
    assert.deepEqual(out.upcoming, []);
    assert.equal(out.sandbox, false);
    assert.deepEqual(out.billing, { containers: 0, price_per_container_cents: null });
    assert.equal(out.tip, null);
    assert.equal(out.client.name, "Test Test");
    assert.equal(out.as_of, AS_OF);
  });
});

describe("buildMoneyOverview — full client", () => {
  const out = buildMoneyOverview({
    client: CLIENT,
    asOf: AS_OF,
    accounts: FOUR,
    entities: [BIZ, PER],
    txMonths: [
      { bank_account_id: "a1", month: "2026-09", in_cents: "500000", out_cents: "310000" },
      { bank_account_id: "a2", month: "2026-09", in_cents: "1200000", out_cents: "800000" },
      { bank_account_id: "a2", month: "2026-07", in_cents: null, out_cents: "1000" },
      // A card's own rows are not cashflow — paying it from checking would count twice.
      { bank_account_id: "a4", month: "2026-09", in_cents: "50000", out_cents: "90000" },
      // An account we do not hold (closed / someone else's) is ignored.
      { bank_account_id: "zz", month: "2026-09", in_cents: "1", out_cents: "1" }
    ],
    bills: [
      { bank_account_id: "a1", merchant_key: "rent", merchant_display: "Rent", cadence: "monthly",
        typical_amount_cents: "-250000", next_expected_on: "2026-11-01", confidence_label: "high" },
      { bank_account_id: "a2", merchant_key: "guess", cadence: "monthly",
        typical_amount_cents: "-100", next_expected_on: "2026-10-10", confidence_label: "low" }
    ],
    cycles: [{ bank_account_id: "a4", payment_due_day: 21, minimum_payment_cents: 13500 }],
    liabilities: [],
    pricePerContainerCents: null,
    tip: "Lower your revolving utilization below ~30% for optimal approval odds and limit assignments."
  });

  test("matches the contract shape the page is built against", () => {
    assert.deepEqual(keysDeep(out), keysDeep(FIXTURE));
    for (const k of ["cards", "by_container"]) {
      assert.deepEqual(keysDeep(out.debt[k][0]), keysDeep(FIXTURE.debt[k][0]));
    }
    assert.deepEqual(keysDeep(out.accounts[0]), keysDeep(FIXTURE.accounts[0]));
    assert.deepEqual(keysDeep(out.containers[0]), keysDeep(FIXTURE.containers[0]));
    // The live fixture has no bills, dues or months yet; these keys are the board's.
    assert.deepEqual(Object.keys(out.bills[0]).sort(),
      ["amount_cents", "cadence", "container_id", "kind", "name", "next_on"]);
    assert.deepEqual(Object.keys(out.upcoming[0]).sort(), ["amount_cents", "name", "on", "type"]);
    assert.deepEqual(keysDeep(out.cashflow.months[0]), {
      business: { in_cents: null, out_cents: null }, month: null,
      personal: { in_cents: null, out_cents: null }, unknown: { in_cents: null, out_cents: null }
    });
  });

  test("cash per kind, from the container's kind", () => {
    assert.deepEqual(out.cash.personal, { cents: 421055, is_floor: false, accounts: 1 });
    assert.deepEqual(out.cash.business, { cents: 1875000, is_floor: false, accounts: 1 });
    assert.deepEqual(out.cash.unknown, { cents: null, is_floor: false, accounts: 0 });
  });

  test("debt three ways", () => {
    assert.equal(out.debt.total_cents, 672040);
    assert.deepEqual(out.debt.by_kind, { personal: 132040, business: 540000, unknown: null });
    assert.deepEqual(out.debt.by_container.map((c) => [c.container_id, c.owed_cents]),
      [["e-biz", 540000], ["e-per", 132040]]);
    const amex = out.debt.cards.find((c) => c.mask === "4404");
    assert.deepEqual(amex, {
      account_id: "a4", name: "Business Amex", mask: "4404", container_id: "e-biz", kind: "business",
      balance_cents: 540000, limit_cents: 2500000, room_cents: 1960000, used_pct: 21.6,
      due_on: "2026-10-21", min_due_cents: 13500, past_due_cents: null
    });
    const visa = out.debt.cards.find((c) => c.mask === "3303");
    assert.equal(visa.due_on, null, "no cycle row → no due date, never a guess");
    assert.equal(visa.min_due_cents, null);
  });

  test("containers and the billing count", () => {
    assert.deepEqual(out.containers, [
      { id: "e-biz", kind: "business", name: "Fundhub LLC", accounts: 2 },
      { id: "e-per", kind: "personal", name: "Chris (personal)", accounts: 2 }
    ]);
    assert.deepEqual(out.billing, { containers: 2, price_per_container_cents: null });
  });

  test("cashflow: depository only, kinds apart, a missing side is null", () => {
    assert.equal(out.cashflow.has_transactions, true);
    assert.deepEqual(out.cashflow.months.map((m) => m.month), ["2026-07", "2026-08", "2026-09", "2026-10"]);
    const sep = out.cashflow.months.find((m) => m.month === "2026-09");
    assert.deepEqual(sep.personal, { in_cents: 500000, out_cents: 310000 });
    assert.deepEqual(sep.business, { in_cents: 1200000, out_cents: 800000 });
    assert.deepEqual(sep.unknown, { in_cents: null, out_cents: null });
    const jul = out.cashflow.months.find((m) => m.month === "2026-07");
    assert.deepEqual(jul.business, { in_cents: null, out_cents: 1000 }, "no deposits is a dash, not $0");
    const aug = out.cashflow.months.find((m) => m.month === "2026-08");
    assert.deepEqual(aug.business, { in_cents: null, out_cents: null }, "a hole month stays a hole");
  });

  test("bills: weak guesses stay off, amount is the size", () => {
    assert.deepEqual(out.bills, [{
      name: "Rent", amount_cents: 250000, cadence: "monthly", next_on: "2026-11-01", kind: "personal", container_id: "e-per"
    }]);
  });

  test("upcoming: the next 30 days, by date", () => {
    assert.deepEqual(out.upcoming, [
      { type: "card_due", name: "Business Amex", on: "2026-10-21", amount_cents: 13500 },
      { type: "bill", name: "Rent", on: "2026-11-01", amount_cents: 250000 }
    ]);
  });

  test("sandbox is said out loud; tip is passed through verbatim", () => {
    assert.equal(out.sandbox, true);
    assert.equal(out.tip, "Lower your revolving utilization below ~30% for optimal approval odds and limit assignments.");
  });
});

describe("buildMoneyOverview — holes and the never-combine rule", () => {
  test("a missing balance makes that kind's cash a floor", () => {
    const out = buildMoneyOverview({
      client: CLIENT, asOf: AS_OF,
      accounts: [
        acct({ id: "b1", account_type: "depository", entity_kind: "business", current_balance_cents: "1000" }),
        acct({ id: "b2", account_type: "depository", entity_kind: "business", current_balance_cents: null })
      ]
    });
    assert.deepEqual(out.cash.business, { cents: 1000, is_floor: true, accounts: 2 });
  });

  test("a card with no balance makes debt a floor, and its pile a floor", () => {
    const out = buildMoneyOverview({
      client: CLIENT, asOf: AS_OF,
      accounts: [
        acct({ id: "c1", name: "A", account_type: "credit", entity_kind: "personal", current_balance_cents: "5000", credit_limit_cents: "10000" }),
        acct({ id: "c2", name: "B", account_type: "credit", entity_kind: "personal", current_balance_cents: null, credit_limit_cents: "0" })
      ]
    });
    assert.equal(out.debt.total_cents, 5000);
    assert.equal(out.debt.is_floor, true);
    assert.deepEqual(out.debt.by_container, [
      { container_id: null, name: "Personal", kind: "personal", owed_cents: 5000, is_floor: true }
    ]);
    const b = out.debt.cards.find((c) => c.account_id === "c2");
    assert.equal(b.room_cents, null);
    assert.equal(b.used_pct, null, "$0 or unknown limit gives no percent");
  });

  test("cash is never added across kinds — there is no combined cash field", () => {
    const out = buildMoneyOverview({
      client: CLIENT, asOf: AS_OF,
      accounts: [
        acct({ id: "p", account_type: "depository", entity_kind: "personal", current_balance_cents: "100" }),
        acct({ id: "b", account_type: "depository", entity_kind: "business", current_balance_cents: "200" }),
        acct({ id: "u", account_type: "depository", entity_kind: "unknown", current_balance_cents: "300" })
      ]
    });
    assert.deepEqual(Object.keys(out.cash).sort(), ["business", "personal", "unknown"]);
    assert.equal(out.cash.personal.cents, 100);
    assert.equal(out.cash.business.cents, 200);
    assert.equal(out.cash.unknown.cents, 300, "unknown is never folded into personal");
    assert.equal(JSON.stringify(out).includes("600"), false, "no 100+200+300 anywhere");
  });

  test("a card's available is headroom, not cash; closed accounts are left out", () => {
    const out = buildMoneyOverview({
      client: CLIENT, asOf: AS_OF,
      accounts: [
        acct({ id: "c", account_type: "credit", entity_kind: "personal", current_balance_cents: "100", available_balance_cents: "9900", credit_limit_cents: "10000" }),
        acct({ id: "x", account_type: "depository", entity_kind: "personal", current_balance_cents: "777", closed_at: "2026-01-01" })
      ]
    });
    assert.equal(out.cash.personal.cents, null);
    assert.equal(out.accounts.length, 1);
  });

  test("a long mask is cut to the last four", () => {
    const out = buildMoneyOverview({
      client: CLIENT, asOf: AS_OF,
      accounts: [acct({ id: "m", account_type: "depository", mask: "123456789012", current_balance_cents: "1" })]
    });
    assert.equal(out.accounts[0].mask, "9012");
  });

  test("a provider due date and past-due on a liability linked to the account win", () => {
    const out = buildMoneyOverview({
      client: CLIENT, asOf: AS_OF,
      accounts: [acct({ id: "c", name: "Card", account_type: "credit", current_balance_cents: "100", credit_limit_cents: "1000" })],
      cycles: [{ bank_account_id: "c", payment_due_day: 2, minimum_payment_cents: 25 }],
      liabilities: [
        { bank_account_id: "c", payment_due_date: "2026-10-09", minimum_payment_cents: 3500, past_due_cents: 1200 },
        { bank_account_id: "c", payment_due_date: "2026-09-09", minimum_payment_cents: 1 }
      ]
    });
    const c = out.debt.cards[0];
    assert.equal(c.due_on, "2026-10-09");
    assert.equal(c.min_due_cents, 3500);
    assert.equal(c.past_due_cents, 1200);
  });

  test("Plaid's exact due date on the statement-cycle row beats the due day", () => {
    const out = buildMoneyOverview({
      client: CLIENT, asOf: AS_OF,
      accounts: [acct({ id: "c", name: "Personal Visa", account_type: "credit", current_balance_cents: "132040", credit_limit_cents: "800000" })],
      cycles: [{ bank_account_id: "c", payment_due_day: 6, minimum_payment_cents: 6602, source: "provider",
                 raw: { next_payment_due_date: "2026-11-06" } }]
    });
    assert.equal(out.debt.cards[0].due_on, "2026-11-06");
    assert.equal(out.debt.cards[0].min_due_cents, 6602);
    assert.equal(out.upcoming.length, 0, "31 days out is past the 30-day window");
  });

  test("an account sitting in no container shows in a loose pile by kind", () => {
    const out = buildMoneyOverview({
      client: CLIENT, asOf: AS_OF,
      accounts: [acct({ id: "u", account_type: "depository", current_balance_cents: "1" })]
    });
    assert.deepEqual(out.containers, [{ id: null, kind: "unknown", name: "Not sorted yet", accounts: 1 }]);
    assert.equal(out.billing.containers, 0);
  });
});

describe("pickTip", () => {
  test("pay-down first, verbatim", () => {
    assert.equal(pickTip([
      { text: "Your LLC is seasoning well. Once it matures past 12–24 months, business approvals increase even more.", topic: "llc", recognised: true, restsOnMissingData: false },
      { text: "Lower your revolving utilization below ~30% for optimal approval odds and limit assignments.", topic: "utilization", recognised: true, restsOnMissingData: false }
    ]), "Lower your revolving utilization below ~30% for optimal approval odds and limit assignments.");
  });

  test("a sentence resting on missing data, or a fallback line, is not a tip", () => {
    assert.equal(pickTip([
      { text: "x", topic: "utilization", recognised: true, restsOnMissingData: true },
      { text: "You're close to approval. A few targeted improvements will push you into approval range.", topic: "fallback", recognised: true, restsOnMissingData: false }
    ]), null);
    assert.equal(pickTip([]), null);
  });
});

describe("readPricePerContainer", () => {
  test("whole cents or null", () => {
    assert.equal(readPricePerContainer({}), null);
    assert.equal(readPricePerContainer({ FINANCE_OS_PRICE_PER_CONTAINER_CENTS: "4900" }), 4900);
    assert.equal(readPricePerContainer({ FINANCE_OS_PRICE_PER_CONTAINER_CENTS: "49.00" }), null);
  });
});

describe("moneyOverview(db) — the reads", () => {
  function stubDb(tables, seen = []) {
    return {
      query: async (sql, params) => {
        seen.push({ sql, params });
        for (const [re, rows] of tables) if (re.test(sql)) return { rows: typeof rows === "function" ? rows(sql, params) : rows };
        return { rows: [] };
      }
    };
  }

  test("client not in the org → null", async () => {
    const out = await moneyOverview(stubDb([[/FROM clients/, []]]), { orgId: ORG, clientId: CLIENT.id, env: {}, asOf: AS_OF });
    assert.equal(out, null);
  });

  test("empty tables → the empty shape, no throw", async () => {
    const out = await moneyOverview(stubDb([[/FROM clients/, [CLIENT]]]), { orgId: ORG, clientId: CLIENT.id, env: {}, asOf: AS_OF });
    assert.equal(out.ok, true);
    assert.equal(out.debt.total_cents, null);
    assert.equal(out.tip, null, "no credit file → no sentence");
  });

  test("full tables, every query scoped to org AND client, price from env", async () => {
    const seen = [];
    const db = stubDb([
      [/FROM clients/, [CLIENT]],
      [/FROM bank_accounts/, FOUR],
      [/FROM entities/, [BIZ, PER]],
      [/FROM bank_transactions/, [{ bank_account_id: "a1", month: "2026-09", in_cents: "500000", out_cents: "310000" }]],
      [/FROM recurring_bills/, []],
      [/FROM account_statement_cycles/, [{ row: { bank_account_id: "a4", payment_due_day: 21, minimum_payment_cents: 13500 } }]]
    ], seen);
    const out = await moneyOverview(db, {
      orgId: ORG, clientId: CLIENT.id, env: { FINANCE_OS_PRICE_PER_CONTAINER_CENTS: "2500" }, asOf: AS_OF
    });
    assert.equal(out.debt.total_cents, 672040);
    assert.equal(out.debt.cards.find((c) => c.mask === "4404").due_on, "2026-10-21");
    assert.equal(out.billing.price_per_container_cents, 2500);
    assert.equal(out.cashflow.months.at(-1).month, "2026-10");
    for (const q of seen) {
      assert.ok(q.params.includes(ORG) && q.params.includes(CLIENT.id), `unscoped query: ${q.sql.slice(0, 60)}`);
    }
    const tx = seen.find((q) => /FROM bank_transactions/.test(q.sql));
    assert.match(tx.sql, /is_pending = false/);
    assert.deepEqual(tx.params.slice(2), ["2025-11-01", "2026-10-06"]);
    assert.equal(seen.some((q) => /encrypted_access_token|SELECT \* FROM plaid_items/.test(q.sql)), false);
  });
});
