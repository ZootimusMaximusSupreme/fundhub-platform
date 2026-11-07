// The organized Alerts board (unit AL2): Personal and each business, each with
// Payments due, Bills and Smart alerts. Pure: the money overview is the real
// builder over fixed rows; everything else is handed in. Each rule has a case that
// passes and a case that would fail if it broke.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildAlertBoard, seasoningRows, scopeKeyOf } from "./board.mjs";
import { PAY_BY_DAYS_BEFORE } from "./bundle-common.mjs";
import { payByList } from "./pay-by.mjs";
import { cardRule } from "./card-over-10.mjs";
import { buildMoneyOverview } from "../money-overview.mjs";
import { debtsFromOverview } from "../payment-strategy.mjs";

const TODAY = "2026-10-12";
const ACME = "a0000000-0000-4000-8000-0000000000a1";
const BETA = "a0000000-0000-4000-8000-0000000000b2";
const GONE = "a0000000-0000-4000-8000-0000000000c3";

const acct = (over) => ({
  id: "x", name: "x", official_name: null, mask: null, provider: "plaid", account_type: "credit", account_subtype: "credit card",
  available_balance_cents: null, current_balance_cents: 0, credit_limit_cents: null, entity_kind: "personal",
  entity_kind_source: "staff_reviewed", entity_kind_set_at: null, entity_id: null, closed_at: null, institution_name: "Sample Bank", ...over
});

/* Two businesses. Acme: checking $1,000, a card $3,000 of $10,000 closing the 15th, a $500 loan payment.
   Beta: checking $20,000, a card $400 of $10,000 closing the 20th. Personal: checking $9,000, a card with
   no close day. One business card in no company yet, and one account not sorted. */
function world({ accounts: extraAccounts = [], cycles: extraCycles = [] } = {}) {
  const accounts = [
    acct({ id: "p-chk", name: "Personal Checking", account_type: "depository", account_subtype: "checking", current_balance_cents: 900000 }),
    acct({ id: "p-visa", name: "Personal Visa", mask: "3303", current_balance_cents: 200000, credit_limit_cents: 800000 }),
    acct({ id: "a-chk", name: "Acme Checking", entity_id: ACME, entity_kind: "business", account_type: "depository", account_subtype: "checking", current_balance_cents: 100000 }),
    acct({ id: "a-card", name: "Acme Card", mask: "4404", entity_id: ACME, entity_kind: "business", current_balance_cents: 300000, credit_limit_cents: 1000000 }),
    acct({ id: "a-loan", name: "Acme Loan", entity_id: ACME, entity_kind: "business", account_type: "loan", account_subtype: null, current_balance_cents: 2000000 }),
    acct({ id: "b-chk", name: "Beta Checking", entity_id: BETA, entity_kind: "business", account_type: "depository", account_subtype: "checking", current_balance_cents: 2000000 }),
    acct({ id: "b-card", name: "Beta Card", mask: "5505", entity_id: BETA, entity_kind: "business", current_balance_cents: 40000, credit_limit_cents: 1000000 }),
    ...extraAccounts
  ];
  const cycles = [
    { bank_account_id: "a-card", statement_close_day: 15, payment_due_day: 25, minimum_payment_cents: 9000, raw: {} },
    { bank_account_id: "a-loan", statement_close_day: null, payment_due_day: 1, minimum_payment_cents: 50000, raw: {} },
    { bank_account_id: "b-card", statement_close_day: 20, payment_due_day: 28, minimum_payment_cents: 4000, raw: {} },
    { bank_account_id: "p-visa", statement_close_day: null, payment_due_day: 30, minimum_payment_cents: 6000, raw: {} },
    ...extraCycles
  ];
  const overview = buildMoneyOverview({
    client: { id: "c", first_name: "S", last_name: "C" }, asOf: `${TODAY}T12:00:00.000Z`, accounts,
    entities: [{ id: ACME, kind: "business", name: "Acme LLC" }, { id: BETA, kind: "business", name: "Beta Co" }],
    cycles
  });
  const cycleByAccount = new Map(cycles.map((c) => [c.bank_account_id, c]));
  const snap = { overview, cycleByAccount, debts: debtsFromOverview(overview), meta: [], clarityPlans: [], asOf: `${TODAY}T12:00:00.000Z` };
  const cards = overview.debt.cards.map((c) => ({ account_id: c.account_id, statement_close_day: cycleByAccount.get(c.account_id)?.statement_close_day ?? null,
    pay_before: { next_close_on: null } }));
  const on = { on: true };
  const phone = {
    kinds: { card_due: on, statement_close: on, important_bill: on, loan_due: on, credit_line_due: on, plan_due: on, custom_alert: on, custom_bill: on },
    cards: [], loans: [], plans: []
  };
  return { snap, cards, phone };
}
const scopeOf = (board, key) => board.scopes.find((s) => s.key === key);

describe("scopes — Personal and each business", () => {
  test("personal first, then each business by name; an empty named business still shows so alerts can go there", () => {
    const { snap, cards, phone } = world();
    const b = buildAlertBoard({ today: TODAY, snap, cards, phone });
    assert.deepEqual(b.scopes.map((s) => [s.key, s.name]), [["personal", "Personal"], [`biz:${ACME}`, "Acme LLC"], [`biz:${BETA}`, "Beta Co"]]);
    assert.equal(b.default_scope, "personal");
    assert.equal(scopeKeyOf("business", null), "business");
    assert.equal(scopeKeyOf("personal", ACME), "personal");
    assert.equal(scopeKeyOf(undefined, null), "unknown");
  });

  test("the loose piles show only when they hold something: a business card in no company, an account not sorted", () => {
    const { snap, cards, phone } = world({
      accounts: [acct({ id: "loose", name: "Loose Card", entity_kind: "business" }), acct({ id: "odd", name: "Odd Loan", entity_kind: null, account_type: "loan" })]
    });
    const b = buildAlertBoard({ today: TODAY, snap, cards, phone });
    assert.deepEqual(b.scopes.map((s) => s.key), ["personal", `biz:${ACME}`, `biz:${BETA}`, "business", "unknown"]);
    assert.deepEqual(scopeOf(b, "business").payments.map((p) => p.account_id), ["loose"]);
    assert.deepEqual(scopeOf(b, "unknown").payments.map((p) => p.account_id), ["odd"]);
    assert.deepEqual(world().snap.overview.debt.cards.length, 3, "the base world has no loose card");
  });
});

describe("payments due and bills", () => {
  test("cards and loans go to their own business; a plan owed to Fundhub is personal; soonest first", () => {
    const { snap, cards, phone } = world();
    snap.clarityPlans = [{ plan_id: "p", installment_id: "i", label: null, owed_to: "Fundhub LLC", due_on: "2026-10-03", left_cents: 65000 }];
    const b = buildAlertBoard({ today: TODAY, snap, cards, phone });
    const acme = scopeOf(b, `biz:${ACME}`).payments;
    assert.deepEqual(acme.map((p) => [p.type, p.name, p.due_on, p.amount_cents]), [
      ["card", "Acme Card ending 4404", "2026-10-25", 9000],
      ["loan", "Acme Loan", "2026-11-01", 50000]
    ]);
    const personal = scopeOf(b, "personal").payments;
    assert.deepEqual(personal.map((p) => p.type), ["plan", "card"]);
    assert.equal(personal[0].late, true, "an unpaid installment past its date is late");
    assert.equal(personal[1].needs_close_day, true, "the Visa has no close day");
    assert.ok(!scopeOf(b, `biz:${BETA}`).payments.some((p) => p.account_id === "a-card"), "Acme's card is not in Beta");
  });

  test("an alert the client added goes to its business; one whose business is gone goes to Business; a bill goes to Bills", () => {
    const { snap, cards, phone } = world();
    const custom = [
      { id: "1", kind: "alert", name: "Payroll", amount_cents: 400000, cadence: "monthly", scope: "business", entity_id: ACME, phone_alert: true, next_on: "2026-10-15", phone: { alert_on: TODAY, reason: null, sent: null } },
      { id: "2", kind: "alert", name: "Old", amount_cents: null, cadence: "once", scope: "business", entity_id: GONE, phone_alert: false, next_on: "2026-10-20", phone: { alert_on: null, reason: "phone_alert_off", sent: null } },
      { id: "3", kind: "bill", name: "Rent", amount_cents: 120000, cadence: "monthly", scope: "personal", entity_id: null, phone_alert: true, next_on: "2026-11-01", phone: { alert_on: "2026-10-29", reason: "not_yet", sent: null } }
    ];
    const b = buildAlertBoard({ today: TODAY, snap, cards, phone, custom });
    assert.deepEqual(scopeOf(b, `biz:${ACME}`).payments[0], {
      id: "custom:1", type: "alert", name: "Payroll", account_id: null, item_id: "1", institution: null, logo: null, due_on: "2026-10-15",
      amount_cents: 400000, amount_is: "amount", cadence: "monthly", close_on: null, needs_close_day: false, late: false,
      phone_alert: true, phone: { on: true, alert_on: TODAY, reason: null, sent: null }
    });
    assert.deepEqual(scopeOf(b, "business").payments.map((p) => [p.name, p.phone.on]), [["Old", false]]);
    assert.deepEqual(scopeOf(b, "personal").bills.map((x) => [x.source, x.name, x.next_on]), [["added", "Rent", "2026-11-01"]]);
  });

  test("a found bill goes where its own entity says, else where the account that pays it is; the phone follows Important", () => {
    const { snap, cards, phone } = world();
    const bills = [
      { id: "b1", name: "Adobe", typical_cents: 5999, cadence: "monthly", next_expected_on: "2026-10-20", important: true, bank_account_id: "p-chk", phone: { alert_on: "2026-10-17", reason: "not_yet", sent: null } },
      { id: "b2", name: "Slack", typical_cents: 800, cadence: "monthly", next_expected_on: "2026-10-14", important: false, bank_account_id: "a-chk", phone: { alert_on: null, reason: null, sent: null } }
    ];
    const billRows = [{ id: "b1", entity_id: BETA, bank_account_id: "p-chk" }, { id: "b2", entity_id: null, bank_account_id: "a-chk" }];
    const b = buildAlertBoard({ today: TODAY, snap, cards, phone, bills, billRows });
    assert.deepEqual(scopeOf(b, `biz:${BETA}`).bills.map((x) => [x.name, x.phone.on]), [["Adobe", true]], "its entity wins");
    assert.deepEqual(scopeOf(b, `biz:${ACME}`).bills.map((x) => [x.name, x.phone.on]), [["Slack", false]], "not Important, no phone");
    assert.deepEqual(scopeOf(b, "personal").bills, []);
    phone.kinds.important_bill = { on: false };
    assert.equal(scopeOf(buildAlertBoard({ today: TODAY, snap, cards, phone, bills, billRows }), `biz:${BETA}`).bills[0].phone.on, false,
      "phone alerts off means off, even for an Important bill");
  });
});

describe("smart alerts — real data only", () => {
  /* The alerts bundle's "Pay by" and its over-10% rule are folded in here (unit AL): one
     pay_by per card that owes money, dated by AL's payBy() and priced by AL's cardRule(). */
  const payBys = (b, key) => scopeOf(b, key).smart.filter((s) => s.kind === "pay_by");

  test("pay_by: a card over 10% is told the difference and a day two before the close or the due date, whichever comes first", () => {
    const { snap, cards, phone } = world();
    const b = buildAlertBoard({ today: TODAY, snap, cards, phone });
    assert.equal(PAY_BY_DAYS_BEFORE, 2);
    assert.equal(b.pay_by_days_before, PAY_BY_DAYS_BEFORE, "one number, AL's, not a second copy");
    const acme = payBys(b, `biz:${ACME}`);
    assert.equal(acme.length, 1);
    // Closes Oct 15, due Oct 25: the close comes first.
    assert.deepEqual([acme[0].name, acme[0].for, acme[0].close_on, acme[0].due_on, acme[0].on, acme[0].over, acme[0].pay_cents, acme[0].target_cents, acme[0].tight],
      ["Acme Card ending 4404", "statement_close", "2026-10-15", "2026-10-25", "2026-10-13", true, 200000, 100000, false]);
    // The Visa has no close day, so its day comes from its due date (Oct 30); no close is made up.
    const visa = payBys(b, "personal");
    assert.deepEqual(visa.map((s) => [s.account_id, s.for, s.close_on, s.due_on, s.on, s.over, s.pay_cents]),
      [["p-visa", "due_date", null, "2026-10-30", "2026-10-28", true, 120000]]);
  });

  test("pay_by: a card under 10% still gets its day, with nothing to pay down", () => {
    const { snap, cards, phone } = world();
    const beta = payBys(buildAlertBoard({ today: TODAY, snap, cards, phone }), `biz:${BETA}`);
    assert.deepEqual(beta.map((s) => [s.name, s.for, s.on, s.over, s.pay_cents, s.used_pct]),
      [["Beta Card ending 5505", "statement_close", "2026-10-18", false, null, 4]], "Beta's card is at 4%: a day, no amount");
  });

  test("pay_by: with the close tomorrow, pay today, and say it is tight; no limit on file means a day but no amount; nothing owed or no date means none", () => {
    const { snap, cards, phone } = world({
      accounts: [
        acct({ id: "tight", name: "Tight Card", current_balance_cents: 50000, credit_limit_cents: 100000 }),
        acct({ id: "nolimit", name: "No Limit", current_balance_cents: 50000 }),
        acct({ id: "zero", name: "Zero Card", current_balance_cents: 0, credit_limit_cents: 100000 }),
        acct({ id: "nodate", name: "No Date", current_balance_cents: 90000, credit_limit_cents: 100000 })
      ],
      cycles: [
        { bank_account_id: "tight", statement_close_day: 13, raw: {} },
        { bank_account_id: "nolimit", statement_close_day: 13, raw: {} },
        { bank_account_id: "zero", statement_close_day: 13, raw: {} }
      ]
    });
    const s = payBys(buildAlertBoard({ today: TODAY, snap, cards, phone }), "personal");
    assert.deepEqual(s.filter((x) => x.account_id !== "p-visa").map((x) => [x.account_id, x.on, x.tight, x.over, x.pay_cents]).sort(),
      [["nolimit", TODAY, true, false, null], ["tight", TODAY, true, true, 40000]]);
    assert.ok(!s.some((x) => x.account_id === "zero"), "nothing owed, nothing to pay by");
    assert.ok(!s.some((x) => x.account_id === "nodate"), "no close day and no due date: no guess");
  });

  test("pay_by: every day and amount is the bundle's own — payBy() and cardRule() — so the two can never disagree", () => {
    const { snap, cards, phone } = world();
    const b = buildAlertBoard({ today: TODAY, snap, cards, phone });
    const debtCards = snap.overview.debt.cards;
    const cycleOf = (c) => snap.cycleByAccount.get(String(c.account_id)) ?? null;
    const al = new Map(payByList(debtCards, cycleOf, { today: TODAY }).map((r) => [String(r.account_id), r]));
    const all = b.scopes.flatMap((x) => x.smart.filter((y) => y.kind === "pay_by"));
    assert.equal(all.length, 3);
    for (const s of all) {
      const row = al.get(s.account_id);
      assert.deepEqual([s.on, s.for, s.tight, s.close_on, s.due_on], [row.pay_by_on, row.for, row.tight, row.closes_on, row.due_on], s.name);
      const rule = cardRule(debtCards.find((c) => String(c.account_id) === s.account_id), cycleOf({ account_id: s.account_id }), { today: TODAY });
      assert.equal(s.pay_cents, rule.state === "over" ? rule.pay_to_target_cents : null, s.name);
    }
  });

  test("cash_low: personal is the cash text's own verdict; each business is judged on its own and never added", () => {
    const { snap, cards, phone } = world();
    const reserve = { personal: { state: "below", months: 6, cash_cents: 421055, need_cents: 429612, short_cents: 8557, minimums_is_floor: false } };
    const b = buildAlertBoard({ today: TODAY, snap, cards, phone, reserve });
    assert.deepEqual(scopeOf(b, "personal").smart.find((s) => s.kind === "cash_low").short_cents, 8557);
    // Acme: $1,000 cash against 6 x ($90 + $500) = $3,540. Beta: $20,000 against 6 x $40 = $240.
    const acme = scopeOf(b, `biz:${ACME}`).smart.find((s) => s.kind === "cash_low");
    assert.deepEqual([acme.cash_cents, acme.need_cents, acme.short_cents], [100000, 354000, 254000]);
    assert.equal(scopeOf(b, `biz:${BETA}`).smart.find((s) => s.kind === "cash_low"), undefined, "Beta is covered");
    const all = JSON.stringify(b);
    assert.ok(!all.includes("2100000"), "Acme + Beta cash ($21,000) is never one number");
    const ok = buildAlertBoard({ today: TODAY, snap, cards, phone, reserve: { personal: { state: "ok" } } });
    assert.equal(scopeOf(ok, "personal").smart.find((s) => s.kind === "cash_low"), undefined);
  });

  test("price_up and charged_twice: the bill cleanup's flags, placed by the account that pays, named as the bill is shown", () => {
    const { snap, cards, phone } = world();
    const billRows = [{ id: "b9", bank_account_id: "a-chk", merchant_key: "adobe", merchant_display: "Adobe Creative Cloud" }];
    const cleanup = { ok: true, flags: [
      { key: "price_jump:a-chk:adobe:2026-09-20", kind: "price_jump", name: "adobe", merchant_key: "adobe", bank_account_id: "a-chk", money_kind: "business",
        on: "2026-09-20", from_cents: 5499, to_cents: 5999, change_cents: 500 },
      { key: "double_charge:p-chk:gym:2026-10-03", kind: "double_charge", name: "gym", merchant_key: "gym", bank_account_id: "p-chk", money_kind: "personal",
        on: "2026-10-02", amount_cents: 4000, charges: [{}, {}] },
      { key: "other", kind: "something_new", bank_account_id: "p-chk", on: "2026-10-01" }
    ] };
    const b = buildAlertBoard({ today: TODAY, snap, cards, phone, billRows, cleanup });
    assert.deepEqual(scopeOf(b, `biz:${ACME}`).smart.filter((s) => s.kind === "price_up").map((s) => [s.name, s.from_cents, s.to_cents]),
      [["Adobe Creative Cloud", 5499, 5999]]);
    assert.deepEqual(scopeOf(b, "personal").smart.filter((s) => s.kind === "charged_twice").map((s) => [s.name, s.amount_cents, s.times]), [["gym", 4000, 2]]);
    assert.equal(b.checks.bill_cleanup, true);
    assert.ok(!JSON.stringify(b).includes("something_new"), "a flag kind it does not know is left out");
    const none = buildAlertBoard({ today: TODAY, snap, cards, phone, billRows, cleanup: { ok: false, reason: "read_failed" } });
    assert.equal(none.checks.bill_cleanup, false);
    assert.ok(none.scopes.every((s) => !s.smart.some((x) => x.kind === "price_up" || x.kind === "charged_twice")));
  });

  test("seasoning: an account still counting says how many days are left, in its own business; a seasoned one says nothing", () => {
    const { snap, cards, phone } = world();
    const clock = (over) => ({ bank: "Chase", milestone: "seasoning", day: 12, target_days: 30, seasoned_on: "2026-10-30", opened_on: "2026-09-30", ...over });
    const seasoning = seasoningRows([
      { id: "r1", bank: "Chase", container_id: ACME, account_kind: "business" },
      { id: "r2", bank: "Bank of America", container_id: null, account_kind: "personal" },
      { id: "r3", bank: "Wells Fargo", container_id: null, account_kind: "business" }
    ], (rel) => (rel.id === "r1" ? clock() : rel.id === "r2" ? clock({ bank: "Bank of America", milestone: "seasoned", day: 40 }) : null), TODAY);
    assert.equal(seasoning.length, 2, "a relationship with no clock is skipped");
    const b = buildAlertBoard({ today: TODAY, snap, cards, phone, seasoning });
    assert.deepEqual(scopeOf(b, `biz:${ACME}`).smart.filter((s) => s.kind === "seasoning").map((s) => [s.name, s.days_left, s.on]), [["Chase", 18, "2026-10-30"]]);
    assert.deepEqual(scopeOf(b, "personal").smart.filter((s) => s.kind === "seasoning"), []);
    assert.deepEqual(seasoningRows([{ id: "r1" }], null, TODAY), [], "no clock handed in, no rows");
    assert.equal(buildAlertBoard({ today: TODAY, snap, cards, phone }).checks.seasoning, false);
  });

  test("the order inside a scope: charged twice, pay by, cash low, price up, seasoning", () => {
    const { snap, cards, phone } = world();
    const cleanup = { ok: true, flags: [
      { key: "p", kind: "price_jump", bank_account_id: "a-chk", merchant_key: "x", name: "X", on: "2026-09-01", from_cents: 1, to_cents: 200, change_cents: 199 },
      { key: "d", kind: "double_charge", bank_account_id: "a-chk", merchant_key: "y", name: "Y", on: "2026-09-02", amount_cents: 100 }
    ] };
    const seasoning = [{ relationship_id: "r", bank: "Chase", container_id: ACME, clock: { milestone: "seasoning", day: 1, target_days: 30, seasoned_on: "2026-11-10" } }];
    const b = buildAlertBoard({ today: TODAY, snap, cards, phone, cleanup, seasoning });
    assert.deepEqual(scopeOf(b, `biz:${ACME}`).smart.map((s) => s.kind), ["charged_twice", "pay_by", "cash_low", "price_up", "seasoning"]);
  });
});
