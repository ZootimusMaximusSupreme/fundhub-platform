// Phone alerts in the daily pass (step 5) — through the REAL snapshot reader and the
// REAL planners, with stubs for the phone read, the bill read and the queue. Nothing
// is written, nothing transmits, no database is touched.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runFileAlerts } from "./run.mjs";
import {
  planBillPush, planCardDuePush, planPhoneAlerts, billDay, eventDateOfKey, subjectIdOfKey, kindOfTemplate,
  PUSH_TEMPLATES, PUSH_KINDS, BILL_PUSH_DAYS_BEFORE
} from "./phone-alerts.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { ACCOUNT_SQL } from "../money-overview.mjs";
import { APPROVED_BODIES, PUSH_KINDS as PAYLOAD_KINDS } from "../../push/payload.mjs";
import { REMIND_DAYS_BEFORE } from "../../banking/card-due-reminders.mjs";

const ORG = "org-1";
const CLIENT = "client-1";
const T = (iso) => new Date(iso);
/* The pass's own hour: 07:30 UTC. Oct 12 2026. */
const PASS = "2026-10-12T07:30:00.000Z";

const acct = (over) => ({
  id: "x", name: "x", official_name: null, mask: null, provider: "plaid",
  account_type: "credit", account_subtype: "credit card",
  available_balance_cents: null, current_balance_cents: 0, credit_limit_cents: null,
  entity_kind: "personal", entity_kind_source: "staff_reviewed", entity_kind_set_at: null, entity_id: null,
  closed_at: null, institution_name: "First Platypus Bank (Plaid sandbox — test data)", ...over
});

/* Business Amex closes on the 15th (3 days out) and Plaid says its payment is due Oct 14
   (2 days out, nothing paid since the Sep 15 statement). Personal Visa is due Oct 30. */
/* every: true adds the D2 payments (owner-set 2026-11-07): an SBA loan due Oct 13 (typed in by hand, due
   day 13), a business line of credit due Oct 14 (Plaid's subtype "line of credit"), and a payment plan owed
   to Fundhub whose next installment is due Oct 14. */
function world({ settings = {}, hasPhone = true, optedOut = false, bills, smsOptedOut = false, every = false, plans, custom = [] } = {}) {
  const accounts = [
    acct({ id: "amex", name: "Business Amex", mask: "4404", entity_kind: "business", current_balance_cents: 540000, credit_limit_cents: 2500000 }),
    acct({ id: "visa", name: "Personal Visa", mask: "3303", current_balance_cents: 132040, credit_limit_cents: 800000 }),
    acct({ id: "pchk", name: "Personal Checking", mask: "1101", account_type: "depository", account_subtype: "checking", current_balance_cents: 421055 }),
    ...(every ? [
      acct({ id: "sba", name: "SBA Loan", provider: "manual", entity_kind: "business", account_type: "loan", account_subtype: "business", current_balance_cents: 4800000 }),
      acct({ id: "loc", name: "Business Line", mask: "7707", entity_kind: "business", account_type: "loan", account_subtype: "line of credit", current_balance_cents: 900000 })
    ] : [])
  ];
  const cycles = [
    { bank_account_id: "amex", statement_close_day: 15, payment_due_day: 14, minimum_payment_cents: 27000, last_statement_balance_cents: 510000,
      last_statement_date: "2026-09-15", source: "provider", raw: { next_payment_due_date: "2026-10-14", last_payment_date: "2026-09-02" } },
    { bank_account_id: "visa", statement_close_day: 25, payment_due_day: 30, minimum_payment_cents: 6602, last_statement_balance_cents: 120000,
      last_statement_date: "2026-09-25", source: "provider", raw: { next_payment_due_date: "2026-10-30" } },
    ...(every ? [
      { bank_account_id: "sba", statement_close_day: null, payment_due_day: 13, minimum_payment_cents: 105000, source: "manual", raw: {} },
      { bank_account_id: "loc", statement_close_day: null, payment_due_day: 14, minimum_payment_cents: 25000, source: "provider", raw: { next_payment_due_date: "2026-10-14" } }
    ] : [])
  ];
  const planRows = plans ?? (every ? [
    { plan_id: "plan-1", installment_id: "inst-2", kind: "clarity", owed_to: "Fundhub LLC", label: null, seq: 2, due_on: "2026-10-14", left_cents: 65000 }
  ] : []);
  const w = {
    queued: [], dedupe: new Map(), sends: [], custom,
    bills: bills ?? [
      { id: "bill-gws", important: true, merchant_display: "Google Workspace", confidence_label: "high", next_expected_on: "2026-10-14" },
      { id: "bill-qbo", important: false, merchant_display: "QuickBooks Online", confidence_label: "medium", next_expected_on: "2026-10-13" },
      { id: "bill-ads", important: true, merchant_display: "Meta Ads", confidence_label: "high", next_expected_on: "2026-10-20" }
    ]
  };
  w.store = createMemoryStore({ settings });
  w.conn = {
    async query(sql, params) {
      const s = String(sql);
      if (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(s)) return { rows: [{ id: CLIENT, first_name: "Test", last_name: "Client" }] };
      if (/item_created_at/.test(s)) return { rows: [] };
      if (s === ACCOUNT_SQL) { assert.deepEqual(params, [CLIENT, ORG]); return { rows: accounts }; }
      if (/FROM entities/.test(s)) return { rows: [] };
      if (/FROM account_statement_cycles s/.test(s)) return { rows: cycles.map((row) => ({ row })) };
      if (/FROM card_liabilities l/.test(s)) return { rows: [] };
      if (/FROM clarity_payments p/.test(s)) return { rows: planRows };
      throw new Error(`unexpected sql: ${s.slice(0, 100)}`);
    }
  };
  w.deps = () => ({
    store: w.store,
    send: async (_c, a) => { w.sends.push(a); return { sent: true, messageId: `msg-${w.sends.length}` }; },
    createTask: async () => ({ created: true, id: "t" }),
    isOptedOut: async () => smsOptedOut,
    isBlueprint: async () => false,
    loadLatestPulls: async () => null,
    // The alerts bundle (unit AL) has its own test: src/finance/file-alerts/run-bundle.test.mjs.
    planBundleAlerts: async () => ({ plans: [], skipped: [] }),
    phone: {
      state: async (_c, args) => { assert.deepEqual(args, { orgId: ORG, clientId: CLIENT }); return { hasPhone, optedOut }; },
      listBills: async (_c, args) => { assert.deepEqual(args, { orgId: ORG, clientId: CLIENT }); return w.bills; },
      listCustom: async (_c, args) => { assert.deepEqual(args, { orgId: ORG, clientId: CLIENT }); return w.custom; },
      /* The unique (org_id, provider_ref) index, reduced: the second queue of a key writes nothing. */
      queue: async (_c, q) => {
        assert.deepEqual([q.orgId, q.clientId], [ORG, CLIENT]);
        if (w.dedupe.has(q.plan.key)) return { queued: false, messageId: null, reason: "already_queued" };
        w.dedupe.set(q.plan.key, `push-${w.dedupe.size + 1}`);
        w.queued.push(q);
        return { queued: true, messageId: w.dedupe.get(q.plan.key) };
      }
    }
  });
  w.run = (iso = PASS) => runFileAlerts(w.conn, { orgId: ORG, clientId: CLIENT, now: T(iso), env: {} }, w.deps());
  return w;
}
const keys = (w) => w.queued.map((q) => q.plan.key).sort();

describe("the daily pass queues one phone alert per card or bill per cycle", () => {
  test("the card due in 2 days, the card statement closing in 3, and the Important bill charging in 2 are each queued once", async () => {
    const w = world();
    const r = await w.run();
    assert.deepEqual(r.errors, []);
    assert.deepEqual(keys(w), ["bill:bill-gws:2026-10-14", "card-due:amex:2026-10-14", "fpa:pay:amex:2026-10-15"]);
    assert.deepEqual(w.queued.map((q) => q.plan.kind).sort(), ["card_due", "important_bill", "statement_close"]);
    assert.equal(r.phone.queued.length, 3);
  });

  test("the next day's pass, and the one after, find the same keys and queue nothing new", async () => {
    const w = world();
    await w.run();
    const r2 = await w.run("2026-10-13T07:30:00.000Z");
    const r3 = await w.run("2026-10-14T07:30:00.000Z");
    assert.equal(w.queued.length, 3, "still the three from the first pass");
    assert.equal(r2.phone.queued.length + r3.phone.queued.length, 0);
    assert.ok(r2.phone.already.length >= 3);
  });

  test("a bill NOT marked Important gets no phone alert, even on the day before it charges", async () => {
    const w = world();
    await w.run();
    assert.ok(!keys(w).some((k) => k.includes("bill-qbo")));
    // Marked, it would have been owed: the only difference is the mark.
    const marked = world({ bills: [{ id: "bill-qbo", important: true, confidence_label: "medium", merchant_display: "QuickBooks Online", next_expected_on: "2026-10-13" }] });
    await marked.run();
    assert.ok(keys(marked).includes("bill:bill-qbo:2026-10-13"));
  });

  test("an Important bill 8 days out is not yet owed; on its window day it is", async () => {
    const w = world();
    await w.run();
    assert.ok(!keys(w).some((k) => k.includes("bill-ads")));
    await w.run("2026-10-17T07:30:00.000Z");
    assert.ok(keys(w).includes("bill:bill-ads:2026-10-20"));
  });
});

describe("every payment, not only cards (D2, owner-set 2026-11-07)", () => {
  test("a business card, a loan, a line of credit and a plan installment are each queued once, with their own kind", async () => {
    const w = world({ every: true });
    const r = await w.run();
    assert.deepEqual(r.errors, []);
    const byKey = Object.fromEntries(w.queued.map((q) => [q.plan.key, q.plan.kind]));
    assert.equal(byKey["card-due:amex:2026-10-14"], "card_due", "the Business Amex is a business card");
    assert.equal(byKey["loan-due:sba:2026-10-13"], "loan_due");
    assert.equal(byKey["loan-due:loc:2026-10-14"], "credit_line_due");
    assert.equal(byKey["plan:inst-2:2026-10-14"], "plan_due");
    await w.run("2026-10-13T07:30:00.000Z");
    assert.equal(w.queued.length, Object.keys(byKey).length, "the next pass queues nothing new");
  });

  test("a loan already paid off, a paid installment and a late one get no phone alert", async () => {
    const w = world({ every: true, plans: [
      { plan_id: "plan-1", installment_id: "inst-1", seq: 1, due_on: "2026-10-01", left_cents: 65000 },
      { plan_id: "plan-2", installment_id: "inst-9", seq: 4, due_on: "2026-10-13", left_cents: 0 }
    ] });
    const r = await w.run();
    assert.ok(!keys(w).some((k) => k.startsWith("plan:")));
    assert.deepEqual(r.phone.skipped.filter((x) => x.kind === "plan_due").map((x) => x.reason).sort(), ["late", "paid"]);
  });

  test("the same opt-outs stop every new kind", async () => {
    for (const opts of [{ optedOut: true }, { settings: { phone_alerts: false } }, { hasPhone: false }]) {
      const w = world({ every: true, ...opts });
      await w.run();
      assert.equal(w.queued.length, 0, JSON.stringify(opts));
    }
  });
});

describe("Whop plans ride the plan push (unit W, owner ask 2026-11-07)", () => {
  const WHOP = "d1000000-0000-4000-8000-000000000001";
  const whopPlan = (over = {}) => ({
    id: WHOP, product_title: "Consulting Services Package", status: "active", renewal_cents: 50000,
    cancel_at_period_end: false, split_pay_required: null, split_pay_paid: null,
    period_end_on: "2026-10-14", unlinked_at: null, ...over
  });
  const runWith = (w, listWhop, iso = PASS) => {
    const deps = w.deps();
    deps.phone.listWhop = listWhop;
    return runFileAlerts(w.conn, { orgId: ORG, clientId: CLIENT, now: T(iso), env: {} }, deps);
  };

  test("a Whop plan Whop charges in 2 days is queued once, as a plan push, read for this client only", async () => {
    const w = world();
    const asked = [];
    const r = await runWith(w, async (_c, args) => { asked.push(args); return [whopPlan()]; });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(asked, [{ orgId: ORG, clientId: CLIENT }]);
    const q = w.queued.find((x) => x.plan.key === `whop:${WHOP}:2026-10-14`);
    assert.ok(q, keys(w).join(", "));
    assert.equal(q.plan.kind, "plan_due");
    assert.equal(q.plan.label, "Consulting Services Package");
    await runWith(w, async () => [whopPlan()], "2026-10-13T07:30:00.000Z");
    assert.equal(w.queued.filter((x) => x.plan.key.startsWith("whop:")).length, 1, "one push per charge");
  });

  test("ending, late, paid off and far-off Whop plans are not queued, each with its reason", async () => {
    const w = world();
    const r = await runWith(w, async () => [
      whopPlan({ cancel_at_period_end: true }),
      whopPlan({ status: "past_due" }),
      whopPlan({ split_pay_required: 3, split_pay_paid: 3 }),
      whopPlan({ period_end_on: "2026-10-30" })
    ]);
    assert.ok(!keys(w).some((k) => k.startsWith("whop:")));
    assert.deepEqual(r.phone.skipped.filter((x) => x.kind === "plan_due").map((x) => x.reason).sort(),
      ["ending", "late", "not_yet", "paid_off"]);
  });

  test("a Whop read that fails is recorded and costs only the Whop pushes", async () => {
    const w = world();
    const r = await runWith(w, async () => { throw new Error("relation whop_memberships does not exist"); });
    assert.deepEqual(r.errors.map((e) => e.kind), ["phone_alerts_whop"]);
    assert.deepEqual(keys(w), ["bill:bill-gws:2026-10-14", "card-due:amex:2026-10-14", "fpa:pay:amex:2026-10-15"]);
  });

  test("the same opt-outs stop a Whop push", async () => {
    for (const opts of [{ optedOut: true }, { settings: { phone_alerts: false } }, { hasPhone: false }]) {
      const w = world(opts);
      await runWith(w, async () => [whopPlan()]);
      assert.equal(w.queued.length, 0, JSON.stringify(opts));
    }
  });
});

/* AL2 (2026-11-07): the alerts and repeat bills the client added by hand. */
const SAVINGS = { id: "c0a1e2d3-4b5c-4d6e-8f70-81a2b3c4d5e1", kind: "alert", name: "Move money to savings", cadence: "monthly",
  day_of_month: 14, start_on: null, phone_alert: true, archived_at: null };
const RENT = { id: "c0a1e2d3-4b5c-4d6e-8f70-81a2b3c4d5e2", kind: "bill", name: "Office rent", amount_cents: 120000, cadence: "weekly",
  day_of_month: null, start_on: "2026-09-15", phone_alert: true, archived_at: null };

describe("alerts and bills the client added (AL2)", () => {
  test("a monthly alert two days out and a weekly bill tomorrow are each queued once, with their own kind and key", async () => {
    const w = world({ bills: [], custom: [SAVINGS, RENT] });
    const r = await w.run();
    assert.deepEqual(r.errors, []);
    const mine = w.queued.filter((q) => q.plan.key.startsWith("custom:")).map((q) => [q.plan.kind, q.plan.key]).sort();
    assert.deepEqual(mine, [
      ["custom_alert", `custom:${SAVINGS.id}:2026-10-14`],
      ["custom_bill", `custom:${RENT.id}:2026-10-13`]
    ]);
    await w.run("2026-10-13T07:30:00.000Z");
    assert.equal(w.queued.filter((q) => q.plan.key.startsWith("custom:")).length, 2, "the next pass finds the same keys");
  });

  test("phone alert off, removed, five days out, or a one-time date that passed: no row", async () => {
    const w = world({ bills: [], custom: [
      { ...SAVINGS, phone_alert: false },
      { ...RENT, archived_at: "2026-10-01T00:00:00.000Z" },
      { ...SAVINGS, id: "c0a1e2d3-4b5c-4d6e-8f70-81a2b3c4d5e3", day_of_month: 17 },
      { ...SAVINGS, id: "c0a1e2d3-4b5c-4d6e-8f70-81a2b3c4d5e4", cadence: "once", day_of_month: null, start_on: "2026-10-11" }
    ] });
    const r = await w.run();
    assert.deepEqual(r.errors, []);
    assert.equal(w.queued.filter((q) => q.plan.key.startsWith("custom:")).length, 0);
    const reasons = r.phone.skipped.filter((x) => x.kind.startsWith("custom_")).map((x) => x.reason).sort();
    assert.deepEqual(reasons, ["date_passed", "not_yet", "removed"]);
  });

  test("the same opt-outs stop them: phone alerts off, or STOP", async () => {
    for (const opts of [{ settings: { phone_alerts: false } }, { optedOut: true }]) {
      const w = world({ bills: [], custom: [SAVINGS, RENT], ...opts });
      await w.run();
      assert.equal(w.queued.length, 0, JSON.stringify(opts));
    }
  });
});

describe("opt-outs and switches: no row at all", () => {
  for (const [name, opts, reason] of [
    ["a client who said STOP (opted out)", { optedOut: true }, "opted_out"],
    ["a client who switched phone alerts off", { settings: { phone_alerts: false } }, "switched_off"],
    ["a client with no phone set up for alerts", { hasPhone: false }, "no_phone_on_file"]
  ]) {
    test(`${name} gets none`, async () => {
      const w = world(opts);
      const r = await w.run();
      assert.equal(w.queued.length, 0);
      assert.deepEqual(r.phone.held, [{ reason }]);
      assert.deepEqual(r.errors, []);
    });
  }

  test("the pay-before-close switch off stops that push, and only that push", async () => {
    const w = world({ settings: { payment_timing: false } });
    await w.run();
    assert.deepEqual(keys(w), ["bill:bill-gws:2026-10-14", "card-due:amex:2026-10-14"]);
  });

  test("the texts go on exactly as before: the push step never calls send", async () => {
    const withPhone = world();
    const without = world({ hasPhone: false });
    await withPhone.run();
    await without.run();
    assert.deepEqual(withPhone.sends, without.sends);
    for (const s of withPhone.sends) assert.equal(s.channel, "sms");
  });
});

describe("the planners", () => {
  test("planBillPush: marked, sure, dated and 0 to 3 days out — or a reason", () => {
    const bill = (over) => ({ id: "b", important: true, confidence_label: "high", merchant_display: "Slack", next_expected_on: "2026-10-14", ...over });
    assert.equal(planBillPush(bill(), { today: "2026-10-12" }).push, true);
    assert.equal(planBillPush(bill(), { today: "2026-10-14" }).push, true, "the day itself still counts");
    assert.equal(planBillPush(bill(), { today: "2026-10-10" }).reason, "not_yet");
    assert.equal(planBillPush(bill(), { today: "2026-10-15" }).reason, "expected_date_passed");
    assert.equal(planBillPush(bill({ important: false }), { today: "2026-10-12" }).reason, "not_marked_important");
    assert.equal(planBillPush(bill({ confidence_label: "low" }), { today: "2026-10-12" }).reason, "not_a_sure_bill");
    assert.equal(planBillPush(bill({ next_expected_on: null, next_expected_unknown_reason: "two_occurrences_is_a_guess_not_a_cadence" }), { today: "2026-10-12" }).reason,
      "two_occurrences_is_a_guess_not_a_cadence", "no date is never rolled forward to a guess");
    assert.equal(BILL_PUSH_DAYS_BEFORE, REMIND_DAYS_BEFORE);
  });

  test("a date column read back as local midnight is the stored day on any machine", () => {
    assert.equal(billDay(new Date(2026, 9, 14)), "2026-10-14");
    assert.equal(billDay("2026-10-14"), "2026-10-14");
    assert.equal(billDay("not a date"), null);
  });

  test("the card-due push uses the card-due text's own planner and key", () => {
    const card = { account_id: "amex", name: "Business Amex", mask: "4404" };
    const cycle = { raw: { next_payment_due_date: "2026-10-14" }, minimum_payment_cents: 27000, last_statement_balance_cents: 510000, last_statement_date: "2026-09-15" };
    assert.equal(planCardDuePush(card, cycle, { today: "2026-10-12" }).key, "card-due:amex:2026-10-14");
    assert.equal(planCardDuePush(card, { ...cycle, raw: { ...cycle.raw, last_payment_date: "2026-10-01" } }, { today: "2026-10-12" }).reason,
      "payment_recorded", "a card paid this cycle is not buzzed");
    assert.equal(planCardDuePush(card, { ...cycle, raw: {} }, { today: "2026-10-12" }).reason, "no_due_date");
  });

  test("planPhoneAlerts is pure and skips a bill that is not marked without a line", () => {
    const out = planPhoneAlerts({ cards: [], bills: [{ id: "b", important: false }], today: "2026-10-12" });
    assert.deepEqual(out, { owed: [], skipped: [] });
  });

  test("keys read back to their day and their card or bill", () => {
    assert.equal(eventDateOfKey("bill:abc:2026-10-14"), "2026-10-14");
    assert.equal(subjectIdOfKey("custom:abc:2026-10-14"), "abc");
    assert.equal(kindOfTemplate(PUSH_TEMPLATES.custom_bill), "custom_bill");
    assert.equal(subjectIdOfKey("fpa:pay:amex:2026-10-15"), "amex");
    assert.equal(subjectIdOfKey("card-due:amex:2026-10-14"), "amex");
    assert.equal(subjectIdOfKey("whop:d1000000-0000-4000-8000-000000000001:2026-10-14"), "d1000000-0000-4000-8000-000000000001");
    assert.equal(eventDateOfKey("whop:d1000000-0000-4000-8000-000000000001:2026-10-14"), "2026-10-14");
    assert.equal(kindOfTemplate(PUSH_TEMPLATES.important_bill), "important_bill");
    assert.equal(kindOfTemplate("SMS-FINANCE-OS-CARD-DUE"), null);
  });

  test("every phone kind has an approved lock-screen sentence", () => {
    for (const kind of Object.values(PUSH_KINDS)) {
      assert.ok(PAYLOAD_KINDS.includes(kind), kind);
      assert.ok(APPROVED_BODIES[kind], kind);
    }
  });
});
