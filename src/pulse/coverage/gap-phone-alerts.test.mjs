// alerts:phone-alerts-went-out — green when every owed phone alert was queued and went
// out, red when one was never queued or did not go out, skip when it could not read.
// A stub database answers each read by its SQL. SELECT only; nothing is sent.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  gapChecks, CHECK_IDS, lastPassDate, owedPushes, pushProblem,
  PHONE_CLIENTS_SQL, PHONE_CARDS_SQL, PHONE_BILLS_SQL, PHONE_PLANS_SQL, PHONE_WHOP_SQL, PHONE_CUSTOM_SQL, OWED_PUSHES_SQL, RECENT_PUSHES_SQL
} from "./gap-phone-alerts.mjs";

const ORG = "0f000000-0000-4000-8000-000000000001";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const ACCT = "a1000000-0000-4000-8000-000000000001";
const BILL = "b1000000-0000-4000-8000-000000000001";
/* The morning pulse, 6 a.m. Arizona (13:00 UTC) on Oct 12. The pass last ran 07:30 UTC that day. */
const NOW = new Date("2026-10-12T13:00:00.000Z");

const CARD = { client_id: CLIENT, bank_account_id: ACCT, minimum_payment_cents: 27000, last_statement_balance_cents: 510000,
  last_statement_date: "2026-09-15", raw: { next_payment_due_date: "2026-10-14" }, name: "Business Card", mask: "4404" };
const IMPORTANT = { id: BILL, client_id: CLIENT, important: true, merchant_display: "Google Workspace", confidence_label: "high",
  next_expected_on: "2026-10-13", next_expected_unknown_reason: null };
const queuedRow = (ref) => ({ provider_ref: ref, status: "queued", last_error: null, scheduled_at: "2026-10-12T16:00:00.000Z",
  created_at: "2026-10-12T07:30:00.000Z", updated_at: "2026-10-12T07:30:00.000Z" });
const CARD_REF = `finance-push:card-due:${ACCT}:2026-10-14`;
const BILL_REF = `finance-push:bill:${BILL}:2026-10-13`;

function db(over = {}) {
  const rows = {
    clients: [{ client_id: CLIENT }],
    cards: [CARD],
    bills: [IMPORTANT],
    plans: [],
    whop: [],
    custom: [],
    owed: [queuedRow(CARD_REF), queuedRow(BILL_REF)],
    recent: [
      { ...queuedRow(CARD_REF), template_key: "PUSH-FINANCE-CARD-DUE", blocked_reason: null, last_attempt_at: null },
      { ...queuedRow(BILL_REF), template_key: "PUSH-FINANCE-BILL-SOON", blocked_reason: null, last_attempt_at: null }
    ],
    ...over
  };
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const pick = { [PHONE_CLIENTS_SQL]: "clients", [PHONE_CARDS_SQL]: "cards", [PHONE_BILLS_SQL]: "bills", [PHONE_PLANS_SQL]: "plans",
        [PHONE_WHOP_SQL]: "whop", [PHONE_CUSTOM_SQL]: "custom", [OWED_PUSHES_SQL]: "owed", [RECENT_PUSHES_SQL]: "recent" }[sql];
      if (!pick) throw new Error("unexpected sql");
      if (rows[pick] instanceof Error) throw rows[pick];
      return { rows: rows[pick] };
    }
  };
}
const run = async (d, now = NOW) => (await gapChecks({ db: d, orgId: ORG, now }))[0];

describe("alerts:phone-alerts-went-out", () => {
  test("one id, and it is the id the tripwires name", () => {
    assert.deepEqual([...CHECK_IDS], ["alerts:phone-alerts-went-out"]);
  });

  test("PASS: the card due in 2 days and the Important bill charging tomorrow each have a row waiting for 9 a.m.", async () => {
    const d = db();
    const r = await run(d);
    assert.equal(r.status, "PASS", r.detail);
    const owedRead = d.calls.find((c) => c.sql === OWED_PUSHES_SQL);
    assert.deepEqual(owedRead.params, [ORG, [CARD_REF, BILL_REF]]);
    for (const c of d.calls) assert.match(c.sql, /^SELECT/, "SELECT only");
  });

  test("FAIL: an owed card due date with no phone alert row names the card", async () => {
    const r = await run(db({ owed: [queuedRow(BILL_REF)] }));
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, /1 of 2 owed phone alerts was never queued \(card Business Card ending 4404 due 2026-10-14\)|card .*due 2026-10-14/);
    assert.ok(r.suggestedFix);
  });

  test("FAIL: an owed Important bill with no row names the bill", async () => {
    const r = await run(db({ owed: [queuedRow(CARD_REF)] }));
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, /bill Google Workspace due 2026-10-13/);
  });

  test("a bill not marked Important is never owed, so a missing row for it is not red", async () => {
    const r = await run(db({ bills: [], owed: [queuedRow(CARD_REF)] }));
    assert.equal(r.status, "PASS", r.detail);
  });

  test("FAIL: a recent row that every phone refused, or one stuck in the queue, or one with an unknown outcome", async () => {
    for (const bad of [
      { status: "failed", last_error: "No phone accepted this alert." },
      { status: "queued", scheduled_at: "2026-10-11T16:00:00.000Z" },
      { status: "sending", last_attempt_at: "2026-10-12T11:00:00.000Z", last_error: "Push outcome unknown; review before resending." },
      { status: "failed", last_error: "too_late: this alert was about 2026-10-11" }
    ]) {
      const recent = [{ ...queuedRow(CARD_REF), template_key: "PUSH-FINANCE-CARD-DUE", blocked_reason: null, last_attempt_at: null, ...bad }];
      const r = await run(db({ recent }));
      assert.equal(r.status, "FAIL", JSON.stringify(bad));
      assert.match(r.detail, /did not go out/);
    }
  });

  test("a push the client stopped, or one whose phone went away, is the client's choice, not a break", async () => {
    for (const fine of [{ status: "blocked", blocked_reason: "opted_out" }, { status: "failed", last_error: "no_push_device" }, { status: "sent" }]) {
      const recent = [{ ...queuedRow(CARD_REF), template_key: "PUSH-FINANCE-CARD-DUE", blocked_reason: null, last_attempt_at: null, ...fine }];
      const r = await run(db({ recent }));
      assert.equal(r.status, "PASS", `${JSON.stringify(fine)}: ${r.detail}`);
    }
  });

  test("skip, never PASS, when a read fails or there is no database", async () => {
    assert.equal((await run(db({ clients: new Error("boom") }))).status, "skip");
    assert.equal((await run(db({ recent: new Error("boom") }))).status, "skip");
    assert.equal((await gapChecks({}))[0].status, "skip");
    assert.equal((await gapChecks({ db: db() }))[0].status, "skip");
  });

  test("no client with a phone set up: nothing is owed, and only the recent rows are judged", async () => {
    const d = db({ clients: [], recent: [] });
    const r = await run(d);
    assert.equal(r.status, "PASS");
    assert.ok(!d.calls.some((c) => c.sql === PHONE_CARDS_SQL), "no card read without a client");
  });
});

/* D2 (owner-set 2026-11-07): every payment — business cards, lines of credit, loans and payment plans. */
const LOAN_ACCT = "a2000000-0000-4000-8000-000000000002";
const LOC_ACCT = "a3000000-0000-4000-8000-000000000003";
const BIZ_CARD = "a4000000-0000-4000-8000-000000000004";
const INSTALLMENT = "i1000000-0000-4000-8000-000000000001".replace(/^i/, "e");
const LOAN = { client_id: CLIENT, bank_account_id: LOAN_ACCT, minimum_payment_cents: 105000, last_statement_balance_cents: null,
  last_statement_date: null, payment_due_day: 13, raw: {}, name: "SBA Loan", mask: null, account_type: "loan",
  account_subtype: "business", current_balance_cents: 4800000 };
const LINE = { ...LOAN, bank_account_id: LOC_ACCT, name: "Business Line", account_subtype: "line of credit", payment_due_day: 14 };
const BIZ = { ...CARD, bank_account_id: BIZ_CARD, name: "Business Visa", account_type: "credit", account_subtype: "credit card" };
const PLAN_ROW = { plan_id: "p0000000-0000-4000-8000-000000000001".replace(/^p/, "f"), client_id: CLIENT, kind: "clarity",
  owed_to: "Fundhub LLC", label: null, installment_id: INSTALLMENT, seq: 2, due_on: "2026-10-14", left_cents: 65000 };
const LOAN_REF = `finance-push:loan-due:${LOAN_ACCT}:2026-10-13`;
const LINE_REF = `finance-push:loan-due:${LOC_ACCT}:2026-10-14`;
const BIZ_REF = `finance-push:card-due:${BIZ_CARD}:2026-10-14`;
const PLAN_REF = `finance-push:plan:${INSTALLMENT}:2026-10-14`;

describe("every payment is owed a phone alert (D2)", () => {
  const all = { cards: [CARD, BIZ, LOAN, LINE], bills: [IMPORTANT], plans: [PLAN_ROW] };
  const allRows = [CARD_REF, BILL_REF, LOAN_REF, LINE_REF, BIZ_REF, PLAN_REF].map(queuedRow);

  test("owed: a business card, a loan, a line of credit and a plan installment, each by its own planner and kind", () => {
    const owed = owedPushes(all, "2026-10-12");
    assert.deepEqual(owed.map((o) => [o.kind, o.ref]).sort(), [
      ["card_due", BIZ_REF], ["card_due", CARD_REF], ["credit_line_due", LINE_REF],
      ["important_bill", BILL_REF], ["loan_due", LOAN_REF], ["plan_due", PLAN_REF]
    ].sort());
  });

  test("PASS when each has its row; FAIL naming each one that has none", async () => {
    const ok = await run(db({ ...all, owed: allRows }));
    assert.equal(ok.status, "PASS", ok.detail);
    for (const [ref, words] of [
      [LOAN_REF, /loan SBA Loan due 2026-10-13/],
      [LINE_REF, /credit line Business Line due 2026-10-14/],
      [BIZ_REF, /card Business Visa due 2026-10-14/],
      [PLAN_REF, /plan payment Payment plan with Fundhub LLC due 2026-10-14/]
    ]) {
      const r = await run(db({ ...all, owed: allRows.filter((x) => x.provider_ref !== ref) }));
      assert.equal(r.status, "FAIL", ref);
      assert.match(r.detail, words);
    }
  });

  test("a paid installment, a late one and a loan paid off are not owed, so no row is not red", async () => {
    const quiet = { cards: [{ ...LOAN, current_balance_cents: 0 }], bills: [],
      plans: [{ ...PLAN_ROW, left_cents: 0 }, { ...PLAN_ROW, installment_id: "e2000000-0000-4000-8000-000000000002", due_on: "2026-10-01" }] };
    assert.deepEqual(owedPushes(quiet, "2026-10-12"), []);
    const r = await run(db({ ...quiet, owed: [], recent: [] }));
    assert.equal(r.status, "PASS", r.detail);
  });

  test("a failed plan read is a skip, never a PASS", async () => {
    assert.equal((await run(db({ plans: new Error("boom") }))).status, "skip");
  });
});

/* AL2 (2026-11-07): alerts and repeat bills the client added by hand, with the phone alert on. */
const MINE = { id: "c0a1e2d3-4b5c-4d6e-8f70-81a2b3c4d5e1", client_id: CLIENT, kind: "alert", name: "Pay the contractor Dana Smith",
  cadence: "monthly", day_of_month: 14, start_on: null, phone_alert: true, archived_at: null };
const ADDED_BILL = { id: "c0a1e2d3-4b5c-4d6e-8f70-81a2b3c4d5e2", client_id: CLIENT, kind: "bill", name: "Office rent",
  cadence: "weekly", day_of_month: null, start_on: "2026-09-15", phone_alert: true, archived_at: null };
const MINE_REF = `finance-push:custom:${MINE.id}:2026-10-14`;
const ADDED_REF = `finance-push:custom:${ADDED_BILL.id}:2026-10-13`;

describe("alerts and bills the client added are owed a phone alert (AL2)", () => {
  const base = { custom: [MINE, ADDED_BILL] };
  const allRows = [CARD_REF, BILL_REF, MINE_REF, ADDED_REF].map(queuedRow);

  test("owed: each by the shared planner, with its own kind and key", () => {
    const owed = owedPushes({ cards: [], bills: [], plans: [], custom: [MINE, ADDED_BILL] }, "2026-10-12");
    assert.deepEqual(owed.map((o) => [o.kind, o.ref]).sort(), [["custom_alert", MINE_REF], ["custom_bill", ADDED_REF]].sort());
  });

  test("PASS when each has its row; FAIL when one has none, without the name the client typed", async () => {
    const ok = await run(db({ ...base, owed: allRows }));
    assert.equal(ok.status, "PASS", ok.detail);
    const r = await run(db({ ...base, owed: allRows.filter((x) => x.provider_ref !== MINE_REF) }));
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, /alert they added due 2026-10-14/);
    assert.doesNotMatch(r.detail, /Dana Smith|contractor/, "a typed name stays out of the report");
    const b = await run(db({ ...base, owed: allRows.filter((x) => x.provider_ref !== ADDED_REF) }));
    assert.equal(b.status, "FAIL");
    assert.match(b.detail, /bill they added due 2026-10-13/);
  });

  test("switched off, removed or not yet due is not owed, so no row is not red", async () => {
    const quiet = [{ ...MINE, phone_alert: false }, { ...ADDED_BILL, archived_at: "2026-10-01T00:00:00Z" }, { ...MINE, day_of_month: 20 }];
    assert.deepEqual(owedPushes({ custom: quiet }, "2026-10-12"), []);
    const r = await run(db({ custom: quiet }));
    assert.equal(r.status, "PASS", r.detail);
  });

  test("a failed read of the added alerts is a skip, never a PASS", async () => {
    assert.equal((await run(db({ custom: new Error("boom") }))).status, "skip");
  });

  test("the read is read-only, scoped to the company, live rows with the phone alert on", () => {
    assert.match(PHONE_CUSTOM_SQL, /^SELECT/);
    assert.match(PHONE_CUSTOM_SQL, /org_id = \$1::uuid/);
    assert.match(PHONE_CUSTOM_SQL, /archived_at IS NULL/);
    assert.match(PHONE_CUSTOM_SQL, /f\.phone_alert/);
  });
});

describe("every Whop plan charge is owed a phone alert (unit W)", () => {
  const WHOP = "d1000000-0000-4000-8000-000000000001";
  const WHOP_ROW = { id: WHOP, client_id: CLIENT, product_title: "Consulting Services Package", status: "active",
    renewal_cents: 50000, split_pay_required: null, split_pay_paid: null, cancel_at_period_end: false,
    period_end_on: "2026-10-14", current_period_end: null, unlinked_at: null };
  const WHOP_REF = `finance-push:whop:${WHOP}:2026-10-14`;

  test("owed: a Whop plan Whop charges in 2 days, as a plan push", () => {
    const owed = owedPushes({ whop: [WHOP_ROW] }, "2026-10-12");
    assert.deepEqual(owed, [{ ref: WHOP_REF, kind: "plan_due", label: "Consulting Services Package", dueOn: "2026-10-14" }]);
    assert.deepEqual(owedPushes({ whop: [{ ...WHOP_ROW, cancel_at_period_end: true }, { ...WHOP_ROW, status: "past_due" }] }, "2026-10-12"), []);
  });

  test("PASS when its row is there; FAIL naming the plan when it is not", async () => {
    const ok = await run(db({ whop: [WHOP_ROW], owed: [queuedRow(CARD_REF), queuedRow(BILL_REF), queuedRow(WHOP_REF)] }));
    assert.equal(ok.status, "PASS", ok.detail);
    const missing = await run(db({ whop: [WHOP_ROW] }));
    assert.equal(missing.status, "FAIL");
    assert.match(missing.detail, /plan payment Consulting Services Package due 2026-10-14/);
  });

  test("the Whop read is this company's clients only, and a failed one is a skip, never a PASS", async () => {
    const d = db();
    await run(d);
    const read = d.calls.find((c) => c.sql === PHONE_WHOP_SQL);
    assert.deepEqual(read.params, [ORG, [CLIENT]]);
    assert.equal((await run(db({ whop: new Error("relation whop_memberships does not exist") }))).status, "skip");
  });
});

describe("the values the beat library carries", () => {
  test("the Blueprint product code and the paid status equal their sources", async () => {
    const { OFFERS } = await import("../../config/offers.mjs");
    const { PAID_TRANSACTION_STATUS } = await import("../../entitlements/entitlements.mjs");
    const truth = await import("../beats/lib/phone-alerts-truth.mjs");
    assert.equal(truth.BLUEPRINT_PRODUCT_CODE, OFFERS.UWIQ_DELIVERABLES.productCode);
    assert.equal(truth.PAID_TRANSACTION_STATUS, PAID_TRANSACTION_STATUS);
  });

  test("the daily pass and this check run one planner (the pass re-exports the beat library's)", async () => {
    const pass = await import("../../finance/file-alerts/phone-alerts.mjs");
    const lib = await import("../beats/lib/phone-alert-plan.mjs");
    for (const name of ["planBillPush", "planCardDuePush", "pushRef", "PUSH_TEMPLATES", "BILL_PUSH_DAYS_BEFORE"]) {
      assert.equal(pass[name], lib[name], name);
    }
  });
});

describe("the pure parts", () => {
  test("the last pass is today's 07:30 UTC run once its hour has passed, yesterday's before", () => {
    assert.equal(lastPassDate(new Date("2026-10-12T13:00:00Z")), "2026-10-12");
    assert.equal(lastPassDate(new Date("2026-10-12T08:00:00Z")), "2026-10-11");
  });

  test("owedPushes runs the pass's planners", () => {
    assert.deepEqual(owedPushes({ cards: [CARD], bills: [IMPORTANT] }, "2026-10-12").map((o) => o.ref), [CARD_REF, BILL_REF]);
    assert.deepEqual(owedPushes({ cards: [CARD], bills: [{ ...IMPORTANT, important: false }] }, "2026-10-09").map((o) => o.ref), []);
  });

  test("a queued row waiting for its hour is fine; two hours past it is stuck", () => {
    assert.equal(pushProblem({ status: "queued", scheduled_at: "2026-10-12T16:00:00Z" }, NOW), null);
    assert.ok(pushProblem({ status: "queued", scheduled_at: "2026-10-12T10:00:00Z" }, NOW));
  });

  test("the reads are read-only and scoped to the company", () => {
    for (const sql of [PHONE_CLIENTS_SQL, PHONE_CARDS_SQL, PHONE_BILLS_SQL, PHONE_PLANS_SQL, PHONE_WHOP_SQL, OWED_PUSHES_SQL, RECENT_PUSHES_SQL]) {
      assert.match(sql, /^SELECT/);
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|FOR UPDATE)\b/);
      assert.match(sql, /org_id = \$1::uuid/);
    }
  });
});
