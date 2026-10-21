/* N7 (live 2026-09-18) — the success fee follows the bank approvals.

   The stub below is Sim Eight-Funding round 2 as it stood on live: the bill
   INV-B4B9C768 was raised for 10% of $25,000 (Arizona Bank & Trust, Approved at
   funding time) and paid, then Arizona was moved to Denied and Native American
   Bank was recorded Approved at $10,000. The rule says $1,000.

   Owner decision (2026-09-18, final): the fee must follow the real approval,
   not $25k. The first pass only made a task and left the $2,500 bill standing;
   the tests below fail on that code. Now the bill is voided and reissued at the
   rule fee, what was paid is carried across up to the new fee, and a person is
   told about anything paid over it. Nothing is sent to the client. */

import test from "node:test";
import assert from "node:assert/strict";
import {
  checkBilledSuccessFee,
  followRuleFee,
  flagBilledFeeDrift,
  feeDriftTask,
  reissueKey,
  CARD_STACKING,
  FEE_DRIFT_TASK_SOURCE
} from "./billed-fee-check.mjs";
import { successFeeKey } from "../invoices/index.mjs";
import { PRODUCT } from "./card-stacking-rounds.mjs";
import { setApplicationStatus, setApprovalExclusion } from "../applications/status.mjs";
import { CLIENT_INVOICES_SQL } from "../fulfillment/client-step.mjs";
import { BALANCES_SQL } from "../fulfillment/read-signals.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const ROUND = "bc9bb3a1-c043-4554-8512-a2e005612541";
const CLIENT = "d682c13b-11f3-4bd5-a0c5-232b6a7875c4";
const SALE = "d7f8d653-c419-4df0-b12c-ce67258092c1";
const INVOICE = "b4b9c768-5488-4202-9d2a-323a28b8aec6";
const NEW_INVOICE = "c0ffee00-0000-4000-8000-000000000001";
const APP = "2a5b7ba0-ab99-4179-8ebc-e786f3b5b266";

/* A stateful stand-in for the handful of tables this path touches. Invoices
   and invoice_payments keep their rows, so a second press sees the reissued
   bill exactly as a real one would. */
function stubDb({
  product = "card_stacking",
  roundStatus = "funded",
  invoice = { id: INVOICE, org_id: ORG, client_id: CLIENT, sale_id: SALE, status: "paid", amount_due: "2500.00", funding_round_id: ROUND },
  confirmed = [{ id: APP, approved_amount: "10000.00", lender_name: "Native American Bank" }],
  pct = "10.0000",
  paid = "2500.00",
  links = [],
  failVoid = false,
  onRoundLock = null,
  appRow = { id: APP, org_id: ORG, client_id: CLIENT, funding_round_id: ROUND, status: "Approved", lender_name: "Native American Bank" }
} = {}) {
  const calls = [];
  const tasks = [];
  const events = [];
  const invoices = invoice ? [{ ...invoice }] : [];
  const payments = invoice && Number(paid) > 0
    ? [{ invoice_id: invoice.id, kind: "payment", amount: paid }]
    : [];
  const closeouts = [];
  const paymentLinks = links.map((link) => ({ ...link }));
  const byId = (id) => invoices.find((i) => i.id === id);
  return {
    calls, tasks, events, invoices, payments, closeouts, paymentLinks, confirmed,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/UPDATE applications/i.test(sql) && /RETURNING/i.test(sql)) {
        return { rows: [{ ...appRow, status: params[2] ?? appRow.status }] };
      }
      if (/SELECT id, status, approval_excluded_at/i.test(sql)) return { rows: [appRow] };
      if (/INSERT INTO application_decisions/i.test(sql)) return { rows: [{ id: "d1" }] };

      // ── invoices ───────────────────────────────────────────────────────
      if (/INSERT INTO invoices/i.test(sql)) {
        const key = params[12];
        if (key && invoices.some((i) => i.idempotency_key === key)) return { rows: [] };
        const row = {
          id: invoices.length < 2 ? NEW_INVOICE : `c0ffee00-0000-4000-8000-${String(invoices.length).padStart(12, "0")}`,
          org_id: params[0], client_id: params[1], source: params[3],
          amount_due: String(params[5]), sale_id: params[7], funding_round_id: params[8],
          idempotency_key: key, notes: params[13], status: "draft"
        };
        invoices.push(row);
        return { rows: [{ ...row }] };
      }
      if (/UPDATE invoices/i.test(sql) && /status = 'void'/i.test(sql)) {
        if (failVoid) throw new Error("void refused");
        const row = byId(params[0]);
        if (!row || ["void", "written_off"].includes(row.status)) return { rows: [] };
        row.status = "void";
        return { rows: [{ ...row }] };
      }
      if (/UPDATE invoices/i.test(sql)) {
        const to = (/SET\s+status = '(\w+)'/i.exec(sql) || [])[1] || null;
        const row = byId(params[0]);
        if (!row || !to) return { rows: [] };
        row.status = to;
        return { rows: [{ ...row }] };
      }
      if (/FROM invoices\b/i.test(sql)) {
        if (/SELECT id, status FROM invoices/i.test(sql) && /funding_round_id/i.test(sql)) {
          return { rows: invoices.slice(0, 1).map((i) => ({ id: i.id, status: i.status })) };
        }
        const live = invoices.filter((i) => !["void", "written_off"].includes(i.status));
        return { rows: live.slice(0, 1).map((i) => ({ ...i })) };
      }

      // ── invoice_payments ───────────────────────────────────────────────
      if (/INSERT INTO invoice_payments/i.test(sql)) {
        const kind = /'correction'/.test(sql) ? "correction" : "payment";
        payments.push({ invoice_id: params[1], kind, amount: params[2], notes: params[3] });
        return { rows: [] };
      }
      if (/FROM invoice_payments/i.test(sql)) {
        const net = payments
          .filter((p) => p.invoice_id === params[0])
          .reduce((s, p) => s + (p.kind === "payment" ? 1 : -1) * Number(p.amount), 0);
        return { rows: [{ paid: net.toFixed(2) }] };
      }

      if (/UPDATE payment_links/i.test(sql)) {
        const retired = paymentLinks.filter((link) => link.org_id === params[0]
          && link.invoice_id === params[1] && ["created", "sent"].includes(link.status));
        for (const link of retired) link.status = "expired";
        return { rows: retired.map((link) => ({ id: link.id })) };
      }

      // ── events (invoice.* announcements) ───────────────────────────────
      if (/INSERT INTO events/i.test(sql)) {
        events.push({ name: params[1], payload: params[5] });
        return { rows: [{ id: `e${events.length}` }] };
      }

      // ── closeout refresh ───────────────────────────────────────────────
      if (/SELECT \* FROM funding_closeout\b/i.test(sql)) return { rows: [] };
      if (/INSERT INTO funding_closeout \(/i.test(sql)) {
        const row = { id: "co1", total_approved_amount: params[2], total_fee: params[3], balance_due: params[4] };
        closeouts.push(row);
        return { rows: [row] };
      }
      if (/INSERT INTO funding_closeout_items/i.test(sql)) return { rows: [{ id: "ci1" }] };

      if (/FROM funding_rounds\b/i.test(sql)) {
        if (/FOR UPDATE/i.test(sql)) await onRoundLock?.();
        return { rows: [{ id: ROUND, org_id: ORG, client_id: CLIENT, round_number: 2, product, status: roundStatus }] };
      }
      if (/FROM funding_round_sales/i.test(sql)) {
        return { rows: pct == null ? [] : [{ sale_id: SALE, agreed_success_fee_percent: pct }] };
      }
      if (/FROM applications/i.test(sql)) return { rows: confirmed };
      if (/SELECT id FROM tasks/i.test(sql)) {
        const hit = tasks.find((t) => t.body === params[2]);
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      if (/INSERT INTO tasks/i.test(sql)) {
        const row = { id: `t${tasks.length + 1}`, title: params[2], body: params[3], source: params[5], role: params[6] };
        tasks.push(row);
        return { rows: [{ id: row.id }] };
      }
      return { rows: [] };
    }
  };
}

function withSerializedRoundLock(db) {
  let tail = Promise.resolve();
  db.connect = async () => {
    let unlock = null;
    return {
      async query(sql, params = []) {
        if (/^BEGIN$/i.test(sql)) return { rows: [] };
        if (/^(COMMIT|ROLLBACK)$/i.test(sql)) {
          unlock?.();
          return { rows: [] };
        }
        if (/FROM funding_rounds[\s\S]*FOR UPDATE/i.test(sql)) {
          const previous = tail;
          tail = new Promise((resolve) => { unlock = resolve; });
          await previous;
        }
        return db.query(sql, params);
      },
      release() {}
    };
  };
  return db;
}

const netPaid = (db, invoiceId) => db.payments
  .filter((p) => p.invoice_id === invoiceId)
  .reduce((s, p) => s + (p.kind === "payment" ? 1 : -1) * Number(p.amount), 0);

test("the scope constant is the card-stacking product the rounds are stamped with", () => {
  assert.equal(CARD_STACKING, PRODUCT);
});

test("#8 round 2 as it stood on live: billed $2,500, the rule says $1,000", async () => {
  const check = await checkBilledSuccessFee(stubDb(), { orgId: ORG, fundingRoundId: ROUND });
  assert.equal(check.matches, false);
  assert.equal(check.billedCents, 250000);
  assert.equal(check.ruleFeeCents, 100000, "10% of the $10,000 confirmed approval");
  assert.equal(check.paidCents, 250000);
  assert.equal(check.invoiceNumber, "INV-B4B9C768");
});

test("#8: a bank decision on the billed round makes the bill follow the approvals — $1,000, not $2,500", async () => {
  const db = stubDb();
  await setApplicationStatus(db, {
    orgId: ORG,
    applicationId: APP,
    status: "Approved",
    staff: { name: "Advisor" },
    patch: { approved_amount: "10000.00" }
  });

  const old = db.invoices.find((i) => i.id === INVOICE);
  const next = db.invoices.find((i) => i.id === NEW_INVOICE);
  assert.equal(old.status, "void", "the $2,500 bill still stands");
  assert.ok(next, "no bill was raised at the rule fee");
  assert.equal(Number(next.amount_due), 1000, "the fee is 10% of confirmed approvals");
  assert.equal(next.source, "funding_success_fee");
  assert.equal(next.sale_id, SALE);
  assert.equal(next.funding_round_id, ROUND);
  assert.equal(next.idempotency_key, reissueKey(INVOICE));
  assert.equal(next.status, "paid", "the $2,500 already paid covers the $1,000 fee");

  // The money received never changes: $1,000 carried across, $1,500 left on the old bill.
  assert.equal(netPaid(db, NEW_INVOICE), 1000);
  assert.equal(netPaid(db, INVOICE), 1500);
  assert.equal(netPaid(db, NEW_INVOICE) + netPaid(db, INVOICE), 2500);

  // A person is told about the overpayment; nobody refunds anything here.
  assert.equal(db.tasks.length, 1);
  const [task] = db.tasks;
  assert.equal(task.source, FEE_DRIFT_TASK_SOURCE);
  assert.equal(task.role, "funding_advisor");
  assert.match(task.title, /INV-B4B9C768 was reissued as INV-C0FFEE00 at \$1,000\.00/);
  assert.match(task.title, /\$1,500\.00 was paid over the new fee/);
  assert.match(task.body, /owner decision/);

  // Both facts on the record, and nothing that starts collections or reaches the client.
  const names = db.events.map((e) => e.name);
  assert.deepEqual(names, ["invoice.voided", "invoice.created", "invoice.paid"]);
  assert.ok(!db.calls.some((c) => /INSERT INTO messages/i.test(c.sql)), "nothing goes to the client");

  // The closeout record carries the same fee.
  assert.equal(db.closeouts.length, 1);
  assert.equal(Number(db.closeouts[0].total_fee), 1000);
  assert.equal(Number(db.closeouts[0].total_approved_amount), 10000);
});

test("the same decision pressed twice reissues once and makes one task", async () => {
  const db = stubDb();
  const opts = { orgId: ORG, applicationId: APP, status: "Approved", staff: { name: "Advisor" } };
  await setApplicationStatus(db, opts);
  await setApplicationStatus(db, opts);
  assert.equal(db.invoices.length, 2, "one old, one reissue");
  assert.equal(db.tasks.length, 1);
});

test("marking an approval as not counting on a billed round makes the bill follow too", async () => {
  const db = stubDb();
  await setApprovalExclusion(db, {
    orgId: ORG, applicationId: APP, excluded: true, reason: "Withdrawn", staff: { id: "55555555-5555-4555-8555-555555555555", name: "Advisor" }
  });
  assert.equal(db.invoices.find((i) => i.id === INVOICE).status, "void");
  assert.equal(db.invoices.length, 2);
});

test("an unpaid bill that is too high is reissued and collections follow the new bill", async () => {
  const db = stubDb({
    invoice: { id: INVOICE, org_id: ORG, client_id: CLIENT, sale_id: SALE, status: "sent", amount_due: "2500.00", funding_round_id: ROUND },
    links: [{ id: "link-old", org_id: ORG, invoice_id: INVOICE, status: "sent" }],
    paid: "0"
  });
  await setApplicationStatus(db, { orgId: ORG, applicationId: APP, status: "Approved", staff: { name: "A" } });
  const next = db.invoices.find((i) => i.id === NEW_INVOICE);
  assert.equal(Number(next.amount_due), 1000);
  assert.equal(next.status, "sent");
  assert.equal(db.payments.length, 0, "nothing was paid, nothing to carry");
  assert.equal(db.paymentLinks[0].status, "expired", "the old payable link is retired with the void bill");
  assert.deepEqual(db.events.map((e) => e.name), ["invoice.voided", "invoice.created", "invoice.sent"]);
  assert.equal(db.tasks.length, 0);
});

test("a part payment is carried across and the new bill reads partly paid", async () => {
  const db = stubDb({
    invoice: { id: INVOICE, org_id: ORG, client_id: CLIENT, sale_id: SALE, status: "partially_paid", amount_due: "2500.00", funding_round_id: ROUND },
    paid: "400.00"
  });
  await setApplicationStatus(db, { orgId: ORG, applicationId: APP, status: "Approved", staff: { name: "A" } });
  const next = db.invoices.find((i) => i.id === NEW_INVOICE);
  assert.equal(next.status, "partially_paid");
  assert.equal(netPaid(db, NEW_INVOICE), 400);
  assert.equal(netPaid(db, INVOICE), 0);
  assert.equal(db.tasks.length, 0, "nothing was paid over the new fee");
});

test("a receipt after the fee check is carried from the locked bill", async () => {
  const db = stubDb({
    invoice: { id: INVOICE, org_id: ORG, client_id: CLIENT, sale_id: SALE, status: "sent", amount_due: "2500.00", funding_round_id: ROUND },
    paid: "0"
  });
  const check = await checkBilledSuccessFee(db, { orgId: ORG, fundingRoundId: ROUND });
  db.payments.push({ invoice_id: INVOICE, kind: "payment", amount: "400.00" });
  assert.equal(check.paidCents, 0, "the saved check predates the receipt");
  const result = await followRuleFee(db, check);
  assert.equal(result.carriedCents, 40000, "the transaction rereads the actual paid balance");
  assert.equal(netPaid(db, NEW_INVOICE), 400);
  assert.equal(netPaid(db, INVOICE), 0);
});

test("a bill that still matches the rule is left alone", async () => {
  const db = stubDb({
    invoice: { id: INVOICE, org_id: ORG, client_id: CLIENT, sale_id: SALE, status: "sent", amount_due: "1000.00", funding_round_id: ROUND },
    paid: "0"
  });
  await setApplicationStatus(db, { orgId: ORG, applicationId: APP, status: "Approved", staff: { name: "A" } });
  assert.equal(db.tasks.length, 0);
  assert.equal(db.invoices.length, 1);
  assert.equal(db.invoices[0].status, "sent");
});

test("nothing confirmed left is 'nothing to bill', never a $0 fee — the bill is left and a person told", async () => {
  const db = stubDb({ confirmed: [] });
  const out = await flagBilledFeeDrift(db, { orgId: ORG, application: { funding_round_id: ROUND, client_id: CLIENT } });
  assert.equal(out.matches, false);
  assert.equal(out.check.ruleFeeCents, null);
  assert.equal(db.invoices.length, 1, "no $0 bill");
  assert.equal(db.invoices[0].status, "paid");
  const [task] = db.tasks;
  assert.match(task.title, /no bank approval with a dollar amount is left/);
  assert.doesNotMatch(task.title, /\$0\.00/);
  assert.match(task.body, /nothing to bill/);
});

test("a reissue that fails falls back to telling a person, and the answer still saves", async () => {
  const db = stubDb({ failVoid: true });
  const row = await setApplicationStatus(db, { orgId: ORG, applicationId: APP, status: "Approved", staff: { name: "A" } });
  assert.equal(row.status, "Approved");
  assert.equal(db.tasks.length, 1);
  assert.match(db.tasks[0].body, /could not be reissued/);
});

test("an alt-fin round is out of scope — it bills off the Lendflow figure", async () => {
  const db = stubDb({ product: "alt_fin" });
  const out = await flagBilledFeeDrift(db, { orgId: ORG, application: { funding_round_id: ROUND } });
  assert.equal(out, null);
  assert.equal(db.tasks.length, 0);
  assert.equal(db.invoices.length, 1);
});

test("no confirmed amount, no agreed rate, or no funded round never creates a bill", async () => {
  for (const opts of [
    { invoice: null, confirmed: [] },
    { invoice: null, pct: null },
    { invoice: null, roundStatus: "approved" }
  ]) {
    const db = stubDb(opts);
    assert.equal(await flagBilledFeeDrift(db, { orgId: ORG, application: { funding_round_id: ROUND } }), null);
    assert.equal(db.invoices.length, 0);
    assert.equal(db.events.length, 0);
  }
  assert.equal(await flagBilledFeeDrift(stubDb(), { orgId: ORG, application: { funding_round_id: null } }), null);
});

test("a first confirmed amount on an already-funded round creates one separate bill without F-07 messages", async () => {
  const db = stubDb({ invoice: null });
  const opts = { orgId: ORG, applicationId: APP, status: "Approved", staff: { name: "Advisor" } };
  await setApplicationStatus(db, opts);
  await setApplicationStatus(db, opts);
  assert.equal(db.invoices.length, 1);
  const [bill] = db.invoices;
  assert.equal(Number(bill.amount_due), 1000);
  assert.equal(bill.sale_id, SALE);
  assert.equal(bill.funding_round_id, ROUND);
  assert.equal(bill.idempotency_key, successFeeKey(SALE, ROUND));
  assert.equal(bill.status, "sent");
  assert.deepEqual(db.events.map((event) => event.name), ["invoice.created", "invoice.sent"]);
  assert.equal(db.closeouts.length, 1);
  assert.ok(!db.calls.some((call) => /INSERT INTO messages/i.test(call.sql)));
});

test("two concurrent late bank answers still issue only one first bill", async () => {
  const db = withSerializedRoundLock(stubDb({ invoice: null }));
  const opts = { orgId: ORG, applicationId: APP, status: "Approved" };
  await Promise.all([setApplicationStatus(db, opts), setApplicationStatus(db, opts)]);
  assert.equal(db.invoices.length, 1);
  assert.equal(Number(db.invoices[0].amount_due), 1000);
  assert.equal(db.invoices[0].idempotency_key, successFeeKey(SALE, ROUND));
  assert.deepEqual(db.events.map((event) => event.name), ["invoice.created", "invoice.sent"]);
});

test("a deliberately voided fee bill is not silently restored", async () => {
  const db = stubDb({ invoice: { id: INVOICE, org_id: ORG, client_id: CLIENT, sale_id: SALE,
    status: "void", amount_due: "1000.00", funding_round_id: ROUND }, paid: "0" });
  const out = await flagBilledFeeDrift(db, { orgId: ORG, application: { funding_round_id: ROUND } });
  assert.equal(out, null);
  assert.equal(db.invoices.length, 1);
  assert.equal(db.events.length, 0);
});

test("the fee is recalculated after the round lock, not from an older bank answer", async () => {
  const confirmed = [{ id: APP, approved_amount: "10000.00", lender_name: "Bank" }];
  const db = stubDb({
    invoice: { id: INVOICE, org_id: ORG, client_id: CLIENT, sale_id: SALE,
      status: "sent", amount_due: "2500.00", funding_round_id: ROUND },
    paid: "0", confirmed,
    onRoundLock: () => { confirmed[0].approved_amount = "20000.00"; }
  });
  await setApplicationStatus(db, { orgId: ORG, applicationId: APP, status: "Approved" });
  assert.equal(Number(db.invoices.find((bill) => bill.id === NEW_INVOICE).amount_due), 2000);
  assert.ok(db.calls.some((call) => /FROM funding_rounds[\s\S]*FOR UPDATE/i.test(call.sql)));
});

test("two overlapping bank corrections finish with one active bill at the latest approved amount", async () => {
  const confirmed = [{ id: APP, approved_amount: "10000.00", lender_name: "Bank" }];
  let locks = 0;
  const db = withSerializedRoundLock(stubDb({
    invoice: { id: INVOICE, org_id: ORG, client_id: CLIENT, sale_id: SALE,
      status: "sent", amount_due: "2500.00", funding_round_id: ROUND },
    paid: "0", confirmed,
    onRoundLock: () => {
      locks += 1;
      if (locks === 2) confirmed[0].approved_amount = "20000.00";
    }
  }));
  const opts = { orgId: ORG, applicationId: APP, status: "Approved" };
  await Promise.all([setApplicationStatus(db, opts), setApplicationStatus(db, opts)]);
  const active = db.invoices.filter((bill) => !["void", "written_off"].includes(bill.status));
  assert.equal(locks, 2);
  assert.equal(active.length, 1);
  assert.equal(Number(active[0].amount_due), 2000);
  assert.equal(db.invoices.length, 3, "each distinct correction replaces its predecessor once");
  assert.equal(active[0].idempotency_key, reissueKey(NEW_INVOICE));
});

test("a fault while checking never turns the saved bank answer into an error", async () => {
  const db = {
    calls: 0,
    async query(sql) {
      this.calls += 1;
      if (/UPDATE applications/i.test(sql) && /RETURNING/i.test(sql)) {
        return { rows: [{ id: APP, funding_round_id: ROUND, status: "Denied" }] };
      }
      if (/FROM funding_rounds\b/i.test(sql)) throw new Error("boom");
      return { rows: [] };
    }
  };
  const row = await setApplicationStatus(db, { orgId: ORG, applicationId: APP, status: "Denied", staff: { name: "A" } });
  assert.equal(row.status, "Denied");
});

test("the task words when a reissue could not run: an unpaid bill that is too high names no overpayment", () => {
  const { title, body } = feeDriftTask({
    invoice: { id: INVOICE, status: "sent" },
    invoiceNumber: "INV-B4B9C768",
    roundNumber: 2,
    billedCents: 250000,
    ruleFeeCents: 100000,
    paidCents: 0,
    confirmedApprovedAmount: 10000,
    feePercent: 10
  });
  assert.match(title, /10% of the approvals now on file is \$1,000\.00/);
  assert.match(body, /void it and raise a new one/);
  assert.doesNotMatch(body, /paid over/);
});

/* The void bill a reissue leaves behind still carries a raw balance_due in
   v_invoice_balance (amount_due minus what stayed paid on it: $1,000 on #8).
   The control panel's blockers, the Finance page and the list signals read
   that column as "still owed". A void or written-off bill owes nothing. */
test("a void bill left by a reissue never reads as still owed", () => {
  const sql = (s) => s.replace(/\s+/g, " ");
  assert.match(sql(CLIENT_INVOICES_SQL),
    /CASE WHEN status IN \('void', 'written_off'\) THEN 0 ELSE balance_due END AS balance_due/);
  assert.match(sql(BALANCES_SQL), /status NOT IN \('void', 'written_off'\) AND balance_due > 0/);
});
