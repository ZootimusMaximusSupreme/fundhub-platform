// Plaid liabilities: the /liabilities/get parser, the Plaid → statement cycle
// mapping, and the per-client sync. Stubbed db and Plaid; no network.
import { test, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";

import { fetchLiabilities } from "./providers/plaid-http.mjs";
import { toCycleInput, toLoanCycleInput, syncClientLiabilities } from "./plaid-liabilities.mjs";
import { loanDueOn } from "./card-due-reminders.mjs";
import { encryptPlaidToken } from "./plaid.mjs";

const ENV = {
  PLAID_CLIENT_ID: "cid",
  PLAID_SECRET: "sec",
  PLAID_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64"),
  PLAID_ENV: "sandbox",
  ADAPTERS_DRY_RUN: "0"
};

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

/* Shaped like Plaid's documented sandbox answer for a credit card. */
const PLAID_CREDIT = {
  account_id: "plaid-acc-card",
  aprs: [
    { apr_percentage: 15.24, apr_type: "balance_transfer_apr", balance_subject_to_apr: 1562.32, interest_charge_amount: 130.22 },
    { apr_percentage: 27.95, apr_type: "purchase_apr", balance_subject_to_apr: 56.22, interest_charge_amount: 14.81 }
  ],
  is_overdue: false,
  last_payment_amount: 168.25,
  last_payment_date: "2019-05-22",
  last_statement_issue_date: "2019-05-28",
  last_statement_balance: 1708.77,
  minimum_payment_amount: 20,
  next_payment_due_date: "2020-05-28"
};

describe("fetchLiabilities (plaid-http)", () => {
  test("posts the access token to /liabilities/get and parses credit rows with Plaid's field names", async () => {
    let url, sent;
    const r = await fetchLiabilities("access-sandbox-x", {
      environment: "sandbox", clientId: "cid", secret: "sec", env: ENV,
      fetchImpl: async (u, init) => {
        url = u; sent = JSON.parse(init.body);
        return json({ accounts: [], item: { item_id: "i1" }, liabilities: { credit: [PLAID_CREDIT], mortgage: [], student: [] } });
      }
    });
    assert.equal(url, "https://sandbox.plaid.com/liabilities/get");
    assert.equal(sent.access_token, "access-sandbox-x");
    assert.equal(r.ok, true);
    assert.equal(r.credit.length, 1);
    const c = r.credit[0];
    assert.equal(c.account_id, "plaid-acc-card");
    assert.equal(c.next_payment_due_date, "2020-05-28");
    assert.equal(c.minimum_payment_amount, 20);
    assert.equal(c.last_statement_balance, 1708.77);
    assert.equal(c.is_overdue, false);
    assert.equal(c.aprs[1].apr_type, "purchase_apr");
    assert.equal(JSON.stringify(r).includes("access-sandbox-x"), false, "token never echoed");
  });

  test("credit: null is an empty list (no cards), not an error", async () => {
    const r = await fetchLiabilities("t", {
      environment: "sandbox", clientId: "c", secret: "s", env: ENV,
      fetchImpl: async () => json({ liabilities: { credit: null, mortgage: null, student: null } })
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.credit, []);
  });

  test("an Item without the product comes back ok:false with Plaid's error code", async () => {
    const r = await fetchLiabilities("t", {
      environment: "sandbox", clientId: "c", secret: "s", env: ENV,
      fetchImpl: async () => json({
        error_type: "ITEM_ERROR", error_code: "PRODUCTS_NOT_SUPPORTED",
        error_message: "the following products are not supported by this institution: [\"liabilities\"]"
      }, 400)
    });
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, "PRODUCTS_NOT_SUPPORTED");
  });

  test("nulls stay null — an unknown minimum is not $0", async () => {
    const r = await fetchLiabilities("t", {
      environment: "sandbox", clientId: "c", secret: "s", env: ENV,
      fetchImpl: async () => json({ liabilities: { credit: [{ account_id: "a", minimum_payment_amount: null, next_payment_due_date: null }] } })
    });
    assert.equal(r.credit[0].minimum_payment_amount, null);
    assert.equal(r.credit[0].next_payment_due_date, null);
  });
});

/* Shaped like Plaid's sandbox answer at ins_109508 (user_good, products
   ["liabilities"]), read live 2026-10-06. Field names are Plaid's own. */
const PLAID_STUDENT = {
  account_id: "plaid-acc-student",
  disbursement_dates: ["2002-08-28"],
  expected_payoff_date: "2032-07-28",
  guarantor: "DEPT OF ED",
  interest_rate_percentage: 5.25,
  is_overdue: false,
  last_payment_amount: 138.05,
  last_payment_date: "2019-04-22",
  last_statement_balance: 138.05,
  last_statement_issue_date: "2019-04-28",
  loan_name: "Consolidation",
  loan_status: { end_date: "2032-07-28", type: "repayment" },
  minimum_payment_amount: 25,
  next_payment_due_date: "2019-05-28",
  origination_principal_amount: 25000,
  outstanding_interest_amount: 6227.36,
  repayment_plan: { description: "Standard Repayment", type: "standard" }
};
const PLAID_MORTGAGE = {
  account_id: "plaid-acc-mortgage",
  current_late_fee: 25,
  escrow_balance: 1200,
  interest_rate: { percentage: 3.99, type: "fixed" },
  last_payment_amount: 3141.54,
  last_payment_date: "2019-08-01",
  loan_term: "30 year",
  maturity_date: "2045-07-31",
  next_monthly_payment: 3141.54,
  next_payment_due_date: "2019-11-15",
  origination_principal_amount: 425000,
  past_due_amount: 2304
};
const PLAID_LOAN_ACCOUNTS = [
  { account_id: "plaid-acc-student", type: "loan", subtype: "student", balances: { current: 65262, available: null, limit: null } },
  { account_id: "plaid-acc-mortgage", type: "loan", subtype: "mortgage", balances: { current: 56302.06, available: null, limit: null } }
];

describe("fetchLiabilities — student loans and mortgages (wave 4, H2)", () => {
  const read = (body) => fetchLiabilities("t", {
    environment: "sandbox", clientId: "c", secret: "s", env: ENV, fetchImpl: async () => json(body)
  });

  test("reads student + mortgage with Plaid's field names; payment from the right field per kind; balance from accounts[]", async () => {
    const r = await read({
      accounts: PLAID_LOAN_ACCOUNTS,
      liabilities: { credit: [PLAID_CREDIT], student: [PLAID_STUDENT], mortgage: [PLAID_MORTGAGE] }
    });
    assert.equal(r.ok, true);
    assert.equal(r.credit.length, 1, "cards still read");
    assert.equal(r.loans.length, 2);
    const [s, m] = r.loans;
    assert.equal(s.kind, "student");
    assert.equal(s.account_id, "plaid-acc-student");
    assert.equal(s.next_payment_due_date, "2019-05-28");
    assert.equal(s.payment_amount, 25);
    assert.equal(s.payment_field, "minimum_payment_amount");
    assert.equal(s.current_balance, 65262);
    assert.equal(s.last_statement_balance, 138.05);
    assert.equal(s.interest_rate_percentage, 5.25);
    assert.equal(s.is_overdue, false);
    assert.equal(s.loan_name, "Consolidation");
    assert.equal(m.kind, "mortgage");
    assert.equal(m.next_payment_due_date, "2019-11-15");
    assert.equal(m.payment_amount, 3141.54);
    assert.equal(m.payment_field, "next_monthly_payment");
    assert.equal(m.current_balance, 56302.06);
    assert.equal(m.past_due_amount, 2304);
    assert.equal(m.interest_rate_percentage, 3.99);
    assert.equal(m.last_statement_balance, null, "a mortgage row has no statement balance");
    assert.equal(m.is_overdue, null);
  });

  test("student/mortgage null is no loans, not an error; unknown figures stay null", async () => {
    const none = await read({ liabilities: { credit: null, student: null, mortgage: null } });
    assert.equal(none.ok, true);
    assert.deepEqual(none.loans, []);
    const holes = await read({ accounts: [], liabilities: { student: [{ account_id: "x", minimum_payment_amount: null, next_payment_due_date: null }] } });
    assert.equal(holes.loans[0].payment_amount, null);
    assert.equal(holes.loans[0].next_payment_due_date, null);
    assert.equal(holes.loans[0].current_balance, null, "no matching account → unknown balance, not $0");
  });
});

describe("toLoanCycleInput (wave 4, H2)", () => {
  test("student: dollars → cents, due date → due day, exact date and balance in raw, no APR", async () => {
    const r = await fetchLiabilities("t", {
      environment: "sandbox", clientId: "c", secret: "s", env: ENV,
      fetchImpl: async () => json({ accounts: PLAID_LOAN_ACCOUNTS, liabilities: { student: [PLAID_STUDENT], mortgage: [PLAID_MORTGAGE] } })
    });
    const s = toLoanCycleInput(r.loans[0], { asOf: "2026-10-06T12:00:00.000Z" });
    assert.equal(s.payment_due_day, 28);
    assert.equal(s.statement_close_day, 28);
    assert.equal(s.minimum_payment_cents, 2500);
    assert.equal(s.last_statement_balance_cents, 13805);
    assert.equal(s.last_statement_date, "2019-04-28");
    assert.equal(s.apr, null, "an interest rate is not an APR");
    assert.equal(s.source, "provider");
    assert.equal(s.raw.loan_kind, "student");
    assert.equal(s.raw.next_payment_due_date, "2019-05-28");
    assert.equal(s.raw.current_balance_cents, 6526200);
    assert.equal(s.raw.interest_rate_percentage, 5.25);

    const m = toLoanCycleInput(r.loans[1], { asOf: "2026-10-06T12:00:00.000Z" });
    assert.equal(m.payment_due_day, 15);
    assert.equal(m.statement_close_day, null);
    assert.equal(m.minimum_payment_cents, 314154);
    assert.equal(m.last_statement_balance_cents, null);
    assert.equal(m.raw.loan_kind, "mortgage");
    assert.equal(m.raw.next_payment_due_date, "2019-11-15");
    assert.equal(m.raw.current_balance_cents, 5630206);
    assert.equal(m.raw.past_due_amount_cents, 230400);
  });

  test("no due date and no payment → nothing to write; a due date alone still writes with a null payment", () => {
    assert.equal(toLoanCycleInput({ kind: "student", account_id: "a", next_payment_due_date: null, payment_amount: null }), null);
    const row = toLoanCycleInput({ kind: "mortgage", account_id: "a", next_payment_due_date: "2026-11-01", payment_amount: null });
    assert.equal(row.payment_due_day, 1);
    assert.equal(row.minimum_payment_cents, null);
    assert.equal(row.raw.current_balance_cents, null);
  });
});

describe("toCycleInput", () => {
  test("dollars become cents, due date becomes due day, purchase APR becomes a fraction", () => {
    const row = toCycleInput(PLAID_CREDIT, { asOf: "2026-10-06T12:00:00.000Z" });
    assert.equal(row.payment_due_day, 28);
    assert.equal(row.statement_close_day, 28);
    assert.equal(row.last_statement_date, "2019-05-28");
    assert.equal(row.last_statement_balance_cents, 170877);
    assert.equal(row.minimum_payment_cents, 2000);
    assert.equal(row.apr, 0.2795);
    assert.equal(row.source, "provider");
    assert.equal(row.raw.next_payment_due_date, "2020-05-28");
    assert.equal(row.raw.last_payment_amount_cents, 16825);
    assert.equal(row.raw.last_payment_date, "2019-05-22");
    assert.equal(row.raw.is_overdue, false);
  });

  test("unknown figures stay null", () => {
    const row = toCycleInput({ account_id: "a", next_payment_due_date: "2026-10-21", minimum_payment_amount: null, aprs: [] });
    assert.equal(row.minimum_payment_cents, null);
    assert.equal(row.last_statement_balance_cents, null);
    assert.equal(row.apr, null);
    assert.equal(row.raw.last_payment_amount_cents, null);
  });

  test("no due date and no minimum → nothing to write", () => {
    assert.equal(toCycleInput({ account_id: "a", next_payment_due_date: null, minimum_payment_amount: null }), null);
  });

  test("a 0.5% APR stays 0.5%, not 50%", () => {
    const row = toCycleInput({ account_id: "a", next_payment_due_date: "2026-10-21", aprs: [{ apr_type: "purchase_apr", apr_percentage: 0.5 }] });
    assert.equal(row.apr, 0.005);
  });
});

describe("syncClientLiabilities", () => {
  const ORG = "org-1", CLIENT = "client-1";
  const ITEM_ROW = "item-row-1", PLAID_ITEM = "plaid-item-abc";

  function stubDb({ items, accounts }) {
    const writes = [];
    return {
      writes,
      async query(sql, params) {
        if (/FROM plaid_items/.test(sql)) return { rows: items };
        if (/SELECT id, plaid_account_id/.test(sql)) return { rows: accounts };
        if (/SELECT account_type FROM bank_accounts/.test(sql)) {
          const a = accounts.find((x) => x.id === params[0]);
          return { rows: a ? [{ account_type: a.account_type }] : [] };
        }
        if (/INSERT INTO account_statement_cycles/.test(sql)) {
          writes.push({ sql, params });
          return { rows: [{ id: "cycle-1" }] };
        }
        throw new Error(`unexpected sql: ${sql}`);
      }
    };
  }

  test("refuses with names when Plaid is not configured", async () => {
    const r = await syncClientLiabilities({ query: () => assert.fail("no db") },
      { orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T00:00:00Z", env: {} });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_configured");
    assert.ok(r.missing.includes("PLAID_SECRET"));
  });

  test("decrypts with Plaid's item id, reads liabilities, writes the card's cycle", async () => {
    const enc = encryptPlaidToken("access-sandbox-real", { itemId: PLAID_ITEM, env: ENV });
    const db = stubDb({
      items: [{ id: ITEM_ROW, plaid_item_id: PLAID_ITEM, encrypted_access_token: enc }],
      accounts: [{ id: "ba-card", plaid_account_id: "plaid-acc-card", account_type: "credit", name: "Plaid Credit Card", mask: "3333" }]
    });
    let tokenSeen;
    const r = await syncClientLiabilities(db, {
      orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T12:00:00.000Z", env: ENV,
      fetchLiabilities: async (token, opts) => {
        tokenSeen = token;
        assert.equal(opts.environment, "sandbox");
        return { ok: true, credit: [PLAID_CREDIT, { ...PLAID_CREDIT, account_id: "not-stored" }] };
      }
    });
    assert.equal(tokenSeen, "access-sandbox-real");
    assert.equal(r.ok, true);
    assert.equal(r.written, 1);
    assert.equal(r.items[0].ok, true);
    assert.deepEqual(r.items[0].skipped, [{ plaidAccountId: "not-stored", reason: "account_not_stored" }]);
    assert.equal(db.writes.length, 1);
    const { sql, params } = db.writes[0];
    const cols = sql.match(/\(([^)]+)\)\s*VALUES/)[1].split(",").map((s) => s.trim());
    const v = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
    assert.equal(v.org_id, ORG);
    assert.equal(v.bank_account_id, "ba-card");
    assert.equal(v.payment_due_day, 28);
    assert.equal(v.minimum_payment_cents, 2000);
    assert.equal(v.source, "provider");
    assert.equal(JSON.parse(v.raw).next_payment_due_date, "2020-05-28");
    assert.equal(JSON.stringify(r).includes("access-sandbox-real"), false, "token never in the result");
  });

  test("an Item Plaid refuses is recorded and the next Item still runs", async () => {
    const enc1 = encryptPlaidToken("tok-1", { itemId: "p1", env: ENV });
    const enc2 = encryptPlaidToken("tok-2", { itemId: "p2", env: ENV });
    const db = stubDb({
      items: [
        { id: "row-1", plaid_item_id: "p1", encrypted_access_token: enc1 },
        { id: "row-2", plaid_item_id: "p2", encrypted_access_token: enc2 }
      ],
      accounts: [{ id: "ba-card", plaid_account_id: "plaid-acc-card", account_type: "credit" }]
    });
    const r = await syncClientLiabilities(db, {
      orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T00:00:00Z", env: ENV,
      fetchLiabilities: async (token) => (token === "tok-1"
        ? { ok: false, errorCode: "PRODUCTS_NOT_SUPPORTED", error: "not supported" }
        : { ok: true, credit: [PLAID_CREDIT] })
    });
    assert.equal(r.ok, true);
    assert.equal(r.items[0].ok, false);
    assert.equal(r.items[0].errorCode, "PRODUCTS_NOT_SUPPORTED");
    assert.equal(r.items[1].ok, true);
    assert.equal(r.written, 1);
  });

  test("a token bound to another item fails to decrypt and is recorded, not thrown", async () => {
    const enc = encryptPlaidToken("tok", { itemId: "other-item", env: ENV });
    const db = stubDb({ items: [{ id: "row-1", plaid_item_id: "p1", encrypted_access_token: enc }], accounts: [] });
    const r = await syncClientLiabilities(db, {
      orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T00:00:00Z", env: ENV,
      fetchLiabilities: async () => assert.fail("must not call Plaid")
    });
    assert.equal(r.items[0].errorCode, "token_decrypt_failed");
  });

  test("a non-credit account is skipped by the store's own refusal", async () => {
    const enc = encryptPlaidToken("tok", { itemId: "p1", env: ENV });
    const db = stubDb({
      items: [{ id: "row-1", plaid_item_id: "p1", encrypted_access_token: enc }],
      accounts: [{ id: "ba-chk", plaid_account_id: "plaid-acc-card", account_type: "depository" }]
    });
    const r = await syncClientLiabilities(db, {
      orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T00:00:00Z", env: ENV,
      fetchLiabilities: async () => ({ ok: true, credit: [PLAID_CREDIT] })
    });
    assert.equal(r.written, 0);
    assert.match(r.items[0].skipped[0].reason, /credit account/);
  });

  test("student loan and mortgage are written onto their loan accounts' cycles (wave 4, H2)", async () => {
    const enc = encryptPlaidToken("tok", { itemId: "p1", env: ENV });
    const db = stubDb({
      items: [{ id: "row-1", plaid_item_id: "p1", encrypted_access_token: enc }],
      accounts: [
        { id: "ba-card", plaid_account_id: "plaid-acc-card", account_type: "credit" },
        { id: "ba-student", plaid_account_id: "plaid-acc-student", account_type: "loan" },
        { id: "ba-mortgage", plaid_account_id: "plaid-acc-mortgage", account_type: "loan" }
      ]
    });
    const parsed = await fetchLiabilities("t", {
      environment: "sandbox", clientId: "c", secret: "s", env: ENV,
      fetchImpl: async () => json({
        accounts: PLAID_LOAN_ACCOUNTS,
        liabilities: { credit: [PLAID_CREDIT], student: [PLAID_STUDENT], mortgage: [PLAID_MORTGAGE, { ...PLAID_MORTGAGE, account_id: "not-stored" }] }
      })
    });
    const r = await syncClientLiabilities(db, {
      orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T00:00:00Z", env: ENV,
      fetchLiabilities: async () => parsed
    });
    assert.equal(r.written, 3);
    assert.equal(r.items[0].loansWritten, 2);
    assert.deepEqual(r.items[0].skipped, [{ plaidAccountId: "not-stored", reason: "account_not_stored" }]);
    const rows = db.writes.map(({ sql, params }) => {
      const cols = sql.match(/\(([^)]+)\)\s*VALUES/)[1].split(",").map((s) => s.trim());
      return Object.fromEntries(cols.map((c, i) => [c, params[i]]));
    });
    const mortgage = rows.find((v) => v.bank_account_id === "ba-mortgage");
    assert.equal(mortgage.payment_due_day, 15);
    assert.equal(mortgage.minimum_payment_cents, 314154);
    assert.equal(mortgage.source, "provider");
    const raw = JSON.parse(mortgage.raw);
    assert.equal(raw.next_payment_due_date, "2019-11-15");
    // The reminder job and the overview read the due date with loanDueOn — the
    // stored row must give it the exact Plaid date while it has not passed.
    assert.equal(loanDueOn({ payment_due_day: mortgage.payment_due_day, raw }, "2019-11-10"), "2019-11-15");
    const student = rows.find((v) => v.bank_account_id === "ba-student");
    assert.equal(student.minimum_payment_cents, 2500);
    assert.equal(JSON.parse(student.raw).current_balance_cents, 6526200);
  });

  test("a Plaid loan on an account stored as depository is refused by the store, not written (wave 4, H2)", async () => {
    const enc = encryptPlaidToken("tok", { itemId: "p1", env: ENV });
    const db = stubDb({
      items: [{ id: "row-1", plaid_item_id: "p1", encrypted_access_token: enc }],
      accounts: [{ id: "ba-x", plaid_account_id: "plaid-acc-student", account_type: "depository" }]
    });
    const r = await syncClientLiabilities(db, {
      orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T00:00:00Z", env: ENV,
      fetchLiabilities: async () => ({ ok: true, credit: [], loans: [{ kind: "student", account_id: "plaid-acc-student", next_payment_due_date: "2026-11-01", payment_amount: 25 }] })
    });
    assert.equal(r.written, 0);
    assert.equal(db.writes.length, 0);
    assert.match(r.items[0].skipped[0].reason, /credit account or a loan/);
  });
});
