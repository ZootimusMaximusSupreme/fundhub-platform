// src/finance/card-pay-now.mjs — "Pay now" / "I paid" (FinanceOS unit I6).
// Pure rules both ways, then the reads and writes against a stub db. No
// network, no Postgres, no money.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  payLink, isCardPayment, paymentsSeen, claimStatus, buildPayNow, validateCardPaid, addDays,
  cardPayNow, recordCardPaid, withdrawCardPaid,
  SEEN_BEFORE_DAYS, SEEN_AFTER_DAYS, CLAIM_MAX_AGE_DAYS
} from "./card-pay-now.mjs";

const ORG = "a0000000-0000-4000-8000-000000000001";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const CARD = "ca000000-0000-4000-8000-000000000001";
const CARD2 = "ca000000-0000-4000-8000-000000000002";
const CLAIM = "c1a10000-0000-4000-8000-000000000001";
const TODAY = "2026-11-07";

describe("payLink — the card company's website from Plaid", () => {
  test("https with a host → the link and the short site name", () => {
    assert.deepEqual(payLink("https://www.chase.com"), { url: "https://www.chase.com/", site: "chase.com" });
    assert.deepEqual(payLink("https://secure.bankofamerica.com/login"), { url: "https://secure.bankofamerica.com/login", site: "secure.bankofamerica.com" });
  });
  test("anything unsafe or missing → null (no link is drawn)", () => {
    for (const bad of [null, "", "http://www.chase.com", "javascript:alert(1)", "https://user:pw@chase.com", "https://chase com", "https://localhost", "ftp://x.com", "x".repeat(501)]) {
      assert.equal(payLink(bad), null, String(bad).slice(0, 30));
    }
  });
});

describe("isCardPayment — money in on the card that is a payment", () => {
  const row = (o) => ({ amount_cents: 3500, posted_on: "2026-11-05", is_pending: false, category: null, merchant_name: null, ...o });
  test("Plaid's category or the bank's own words say payment", () => {
    assert.equal(isCardPayment(row({ category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" })), true);
    assert.equal(isCardPayment(row({ category: "Payment > Credit Card" })), true);
    assert.equal(isCardPayment(row({ merchant_name: "AUTOPAY PAYMENT - THANK YOU" })), true);
  });
  test("a refund, a reward, money out, a pending row or a plain deposit is not a payment", () => {
    assert.equal(isCardPayment(row({ merchant_name: "PAYMENT REFUND" })), false);
    assert.equal(isCardPayment(row({ category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", merchant_name: "Cash back reward" })), false);
    assert.equal(isCardPayment(row({ amount_cents: -3500, category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" })), false);
    assert.equal(isCardPayment(row({ is_pending: true, category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" })), false);
    assert.equal(isCardPayment(row({ merchant_name: "AMAZON MKTPLACE" })), false);
    assert.equal(isCardPayment(row({ posted_on: null, category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" })), false);
  });
});

describe("paymentsSeen — what Plaid shows for one card", () => {
  test("the liabilities read and the card's own payments, newest first, one per day", () => {
    const seen = paymentsSeen({
      cycle: { raw: { source: "plaid", last_payment_date: "2026-11-05", last_payment_amount_cents: 3500 } },
      transactions: [
        { amount_cents: 3500, posted_on: "2026-11-05", category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" },
        { amount_cents: 7000, posted_on: "2026-10-04", category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }
      ]
    });
    assert.deepEqual(seen.map((s) => s.on), ["2026-11-05", "2026-10-04"]);
    assert.equal(seen[0].amount_cents, 3500);
  });
  test("a cycle row typed by hand is not Plaid; a Plaid amount of 0 is unknown, not $0", () => {
    assert.deepEqual(paymentsSeen({ cycle: { raw: { last_payment_date: "2026-11-05" } } }), []);
    const s = paymentsSeen({ cycle: { raw: { source: "plaid", last_payment_date: "2026-11-05", last_payment_amount_cents: 0 } } });
    assert.equal(s[0].amount_cents, null);
  });
});

describe("claimStatus — Plaid confirms the client's 'I paid'", () => {
  const claim = { paid_on: "2026-11-01" };
  test("a payment inside the window confirms it; the closest one wins", () => {
    const r = claimStatus(claim, [{ on: "2026-11-09", amount_cents: 1 }, { on: "2026-11-03", amount_cents: 3500 }], { today: TODAY, canCheck: true });
    assert.deepEqual(r, { status: "confirmed", seen_on: "2026-11-03", seen_amount_cents: 3500 });
    assert.equal(claimStatus(claim, [{ on: addDays("2026-11-01", -SEEN_BEFORE_DAYS), amount_cents: null }], { today: TODAY, canCheck: true }).status, "confirmed");
  });
  test("nothing seen: waiting inside the window, not_seen after it, cannot_check without Plaid", () => {
    assert.equal(claimStatus(claim, [], { today: TODAY, canCheck: true }).status, "waiting");
    assert.equal(claimStatus(claim, [{ on: "2026-10-20", amount_cents: 5 }], { today: addDays("2026-11-01", SEEN_AFTER_DAYS + 1), canCheck: true }).status, "not_seen");
    assert.equal(claimStatus(claim, [{ on: "2026-11-02", amount_cents: 5 }], { today: TODAY, canCheck: false }).status, "cannot_check");
  });
  test("a payment just outside the window does NOT confirm it", () => {
    const tooEarly = addDays("2026-11-01", -SEEN_BEFORE_DAYS - 1);
    const tooLate = addDays("2026-11-01", SEEN_AFTER_DAYS + 1);
    assert.equal(claimStatus(claim, [{ on: tooEarly, amount_cents: 1 }, { on: tooLate, amount_cents: 1 }], { today: TODAY, canCheck: true }).status, "waiting");
  });
});

describe("buildPayNow — one entry per open card", () => {
  const cards = [
    { account_id: CARD, name: "Chase Freedom", mask: "1234", due_on: "2026-11-21", min_due_cents: 3500, past_due_cents: null },
    { account_id: CARD2, name: "Hand card", mask: null, due_on: "2026-11-25", min_due_cents: null, past_due_cents: null }
  ];
  const accounts = [
    { id: CARD, provider: "plaid", institution_name: "Chase" },
    { id: CARD2, provider: "manual", institution_name: null }
  ];
  test("the link, the claim for THIS bill with Plaid's word on it, and nothing invented", () => {
    const out = buildPayNow({
      today: TODAY, cards, accounts,
      cycles: [{ bank_account_id: CARD, last_statement_date: "2026-10-25", raw: { source: "plaid", last_payment_date: "2026-11-06", last_payment_amount_cents: 3500 } }],
      urls: { [CARD]: "https://www.chase.com" },
      claims: [
        { id: CLAIM, bank_account_id: CARD, due_on: "2026-11-21", paid_on: "2026-11-05", amount_cents: null, created_by_kind: "client" },
        { id: "old", bank_account_id: CARD, due_on: "2026-10-21", paid_on: "2026-10-15", amount_cents: 5000, created_by_kind: "client" }
      ]
    });
    const chase = out.find((c) => c.account_id === CARD);
    assert.equal(chase.pay_url, "https://www.chase.com/");
    assert.equal(chase.pay_site, "chase.com");
    assert.equal(chase.can_check, true);
    assert.equal(chase.claim.id, CLAIM, "last month's claim is not this bill's");
    assert.equal(chase.claim.status, "confirmed");
    assert.equal(chase.claim.seen_on, "2026-11-06");
    assert.equal(chase.claim.amount_cents, null, "no amount typed stays unknown");
    assert.deepEqual(chase.seen, { on: "2026-11-06", amount_cents: 3500 });

    const hand = out.find((c) => c.account_id === CARD2);
    assert.equal(hand.pay_url, null, "no website from Plaid → no link");
    assert.equal(hand.can_check, false);
    assert.equal(hand.claim, null);
    assert.equal(hand.seen, null);
    assert.equal(hand.min_due_cents, null, "unknown minimum stays null, never 0");
  });
  test("a payment before the last statement is not shown as this bill's; no statement date → nothing claimed", () => {
    const before = buildPayNow({
      today: TODAY, cards: [cards[0]], accounts,
      cycles: [{ bank_account_id: CARD, last_statement_date: "2026-10-25", raw: { source: "plaid", last_payment_date: "2026-10-20" } }]
    });
    assert.equal(before[0].seen, null);
    const noStmt = buildPayNow({
      today: TODAY, cards: [cards[0]], accounts,
      cycles: [{ bank_account_id: CARD, raw: { source: "plaid", last_payment_date: "2026-11-06" } }]
    });
    assert.equal(noStmt[0].seen, null);
  });
  test("a due date the bank moved a few days is the same bill; a withdrawn claim is gone", () => {
    const out = buildPayNow({
      today: TODAY, cards: [cards[0]], accounts,
      claims: [
        { id: "moved", bank_account_id: CARD, due_on: "2026-11-23", paid_on: "2026-11-06", created_by_kind: "staff" },
        { id: "gone", bank_account_id: CARD, due_on: "2026-11-21", paid_on: "2026-11-07", withdrawn_at: "2026-11-07T10:00:00Z" }
      ]
    });
    assert.equal(out[0].claim.id, "moved");
    assert.equal(out[0].claim.by, "staff");
    assert.equal(out[0].claim.status, "waiting");
  });
});

describe("validateCardPaid — the 'I paid' input", () => {
  const ok = { account_id: CARD, due_on: "2026-11-21" };
  test("a card, a due date; the day defaults to today; the amount is optional", () => {
    assert.deepEqual(validateCardPaid(ok, { today: TODAY }), { ok: true, accountId: CARD, dueOn: "2026-11-21", paidOn: TODAY, amountCents: null });
    assert.equal(validateCardPaid({ ...ok, paid_on: "2026-11-01", amount_cents: 3500 }, { today: TODAY }).amountCents, 3500);
  });
  test("refused: no card, no due date, a future day, a day too old, a bad amount", () => {
    const code = (b) => validateCardPaid(b, { today: TODAY }).error;
    assert.equal(code({ due_on: "2026-11-21" }), "account_id_required");
    assert.equal(code({ account_id: CARD }), "due_on_required");
    assert.equal(code({ account_id: CARD, due_on: "2027-06-01" }), "due_on_out_of_range");
    assert.equal(code({ ...ok, paid_on: "2026-11-08" }), "paid_on_future");
    assert.equal(code({ ...ok, paid_on: addDays(TODAY, -CLAIM_MAX_AGE_DAYS - 1) }), "paid_on_too_old");
    assert.equal(code({ ...ok, paid_on: "11/07/2026" }), "paid_on_invalid");
    for (const a of [0, -5, 12.5, "35.00", 1e12]) assert.equal(code({ ...ok, amount_cents: a }), "amount_invalid", String(a));
  });
});

function stubDb(tables, seen = []) {
  return {
    query: async (sql, params = []) => {
      seen.push({ sql, params });
      for (const [re, rows] of tables) if (re.test(sql)) return { rows: typeof rows === "function" ? rows(sql, params) : rows };
      return { rows: [] };
    }
  };
}

describe("cardPayNow(db) — the read", () => {
  const ACCOUNT = { id: CARD, name: "Chase Freedom", mask: "1234", provider: "plaid", account_type: "credit", account_subtype: "credit card",
    current_balance_cents: "40000", credit_limit_cents: "800000", entity_kind: "personal", institution_name: "Chase" };
  const tables = (extra = []) => [
    [/FROM clients/, [{ id: CLIENT }]],
    [/FROM bank_accounts a\s+LEFT JOIN plaid_items/, [ACCOUNT]],
    [/FROM account_statement_cycles/, [{ row: { bank_account_id: CARD, payment_due_day: 21, minimum_payment_cents: 3500, raw: { source: "plaid", next_payment_due_date: "2026-11-21" } } }]],
    [/JOIN plaid_items p ON p.id = a.plaid_item_id/, [{ bank_account_id: CARD, plaid_institution_id: "ins_56" }]],
    ...extra,
    [/FROM card_payment_claims/, [{ id: CLAIM, bank_account_id: CARD, due_on: "2026-11-21", paid_on: "2026-11-06", amount_cents: "3500", created_by_kind: "client" }]],
    [/FROM bank_transactions/, [{ bank_account_id: CARD, posted_on: "2026-11-07", amount_cents: "3500", category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }]]
  ];

  test("client not in the org → null", async () => {
    assert.equal(await cardPayNow(stubDb([[/FROM clients/, []]]), { orgId: ORG, clientId: CLIENT, asOf: new Date(`${TODAY}T12:00:00Z`) }), null);
  });

  test("the Overview's due date, Plaid's website, and the claim confirmed by a posted payment; every client query scoped", async () => {
    const seen = [];
    const out = await cardPayNow(stubDb(tables([
      [/to_regclass/, [{ present: true }]],
      [/FROM plaid_institutions/, [{ plaid_institution_id: "ins_56", url: "https://www.chase.com" }]]
    ]), seen), { orgId: ORG, clientId: CLIENT, asOf: new Date(`${TODAY}T12:00:00Z`) });
    assert.equal(out.ok, true);
    assert.equal(out.today, TODAY);
    const c = out.cards[0];
    assert.equal(c.due_on, "2026-11-21");
    assert.equal(c.min_due_cents, 3500);
    assert.equal(c.pay_site, "chase.com");
    assert.equal(c.claim.status, "confirmed");
    assert.equal(c.claim.seen_on, "2026-11-07");
    assert.equal(c.claim.amount_cents, 3500);
    for (const q of seen) {
      if (/to_regclass/.test(q.sql)) continue; // a catalog check, no client data
      assert.ok(q.params.includes(ORG) && q.params.includes(CLIENT), `unscoped query: ${q.sql.slice(0, 70)}`);
    }
    assert.equal(seen.some((q) => /encrypted_access_token/.test(q.sql)), false);
    const tx = seen.find((q) => /FROM bank_transactions/.test(q.sql));
    assert.match(tx.sql, /is_pending = false/);
    assert.deepEqual(tx.params[2], [CARD]);
  });

  test("before unit H's plaid_institutions table exists: no link, and it never asks for that table", async () => {
    const seen = [];
    const out = await cardPayNow(stubDb(tables([[/to_regclass/, [{ present: false }]]]), seen),
      { orgId: ORG, clientId: CLIENT, asOf: new Date(`${TODAY}T12:00:00Z`) });
    assert.equal(out.cards[0].pay_url, null);
    assert.equal(seen.some((q) => /FROM plaid_institutions/.test(q.sql)), false);
  });
});

describe("recordCardPaid / withdrawCardPaid — the writes", () => {
  const today = TODAY;
  test("an open card on this client's file → one upserted row, scoped, with who said it", async () => {
    const seen = [];
    const db = stubDb([
      [/FROM bank_accounts/, [{ id: CARD }]],
      [/INSERT INTO card_payment_claims/, [{ id: CLAIM, due_on: "2026-11-21", paid_on: TODAY, amount_cents: null }]]
    ], seen);
    const r = await recordCardPaid(db, { orgId: ORG, clientId: CLIENT, input: { account_id: CARD, due_on: "2026-11-21" }, byKind: "client", today });
    assert.deepEqual(r, { ok: true, claim: { id: CLAIM, due_on: "2026-11-21", paid_on: TODAY, amount_cents: null } });
    const check = seen.find((q) => /FROM bank_accounts/.test(q.sql));
    assert.match(check.sql, /account_type = 'credit' AND closed_at IS NULL/);
    assert.deepEqual(check.params, [CARD, CLIENT, ORG]);
    const ins = seen.find((q) => /INSERT INTO card_payment_claims/.test(q.sql));
    assert.match(ins.sql, /ON CONFLICT \(org_id, client_id, bank_account_id, due_on\) WHERE withdrawn_at IS NULL/);
    assert.deepEqual(ins.params, [ORG, CLIENT, CARD, "2026-11-21", TODAY, null, "client", null]);
  });

  test("a card that is not this client's (or not a card) → card_not_found, and nothing is written", async () => {
    const seen = [];
    const r = await recordCardPaid(stubDb([[/FROM bank_accounts/, []]], seen),
      { orgId: ORG, clientId: CLIENT, input: { account_id: CARD, due_on: "2026-11-21" }, byKind: "client", today });
    assert.equal(r.error, "card_not_found");
    assert.equal(seen.some((q) => /INSERT/.test(q.sql)), false);
  });

  test("a bad input never reaches the database", async () => {
    const seen = [];
    const r = await recordCardPaid(stubDb([], seen), { orgId: ORG, clientId: CLIENT, input: { account_id: "nope" }, byKind: "client", today });
    assert.equal(r.ok, false);
    assert.equal(seen.length, 0);
  });

  test("staff: the staff id is kept; a client can never carry one", async () => {
    const seen = [];
    const db = stubDb([[/FROM bank_accounts/, [{ id: CARD }]], [/INSERT/, [{ id: CLAIM, due_on: "2026-11-21", paid_on: TODAY, amount_cents: "100" }]]], seen);
    const STAFF = "5aff0000-0000-4000-8000-000000000001";
    await recordCardPaid(db, { orgId: ORG, clientId: CLIENT, input: { account_id: CARD, due_on: "2026-11-21", amount_cents: 100 }, byKind: "staff", staffId: STAFF, today });
    await recordCardPaid(db, { orgId: ORG, clientId: CLIENT, input: { account_id: CARD, due_on: "2026-11-21" }, byKind: "client", staffId: STAFF, today });
    const ins = seen.filter((q) => /INSERT/.test(q.sql));
    assert.deepEqual(ins[0].params.slice(5), [100, "staff", STAFF]);
    assert.deepEqual(ins[1].params.slice(6), ["client", null]);
  });

  test("Undo keeps the row (withdrawn_at), scoped; an unknown id is claim_not_found", async () => {
    const seen = [];
    const ok = await withdrawCardPaid(stubDb([[/UPDATE card_payment_claims/, [{ id: CLAIM }]]], seen), { orgId: ORG, clientId: CLIENT, claimId: CLAIM });
    assert.deepEqual(ok, { ok: true });
    assert.match(seen[0].sql, /SET withdrawn_at = now\(\)/);
    assert.doesNotMatch(seen[0].sql, /DELETE/);
    assert.deepEqual(seen[0].params, [CLAIM, CLIENT, ORG]);
    assert.equal((await withdrawCardPaid(stubDb([]), { orgId: ORG, clientId: CLIENT, claimId: CLAIM })).error, "claim_not_found");
    assert.equal((await withdrawCardPaid(stubDb([]), { orgId: ORG, clientId: CLIENT, claimId: "x" })).error, "claim_id_required");
  });
});
