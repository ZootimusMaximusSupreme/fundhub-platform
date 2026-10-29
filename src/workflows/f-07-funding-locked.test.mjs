import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./f-07-funding-locked.mjs";
import { NO_CONFIRMED_APPROVALS, NO_AGREED_FEE_PERCENT } from "../funding/success-fee.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "Locked email", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Locked sms", compliance_passed: true }
];

test("happy path: fee ready sends email + sms and creates an invoice task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], templates: withTemplates() });
  const res = await handle({ event: ev("round.funded", { approvedAmount: 25000, feePercent: 12 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(res.feeReady, true);
  assert.equal(res.feeAmount, "3000.00", "25000 of confirmed approvals at 12%");
  assert.equal(res.invoiceTask.created, true);
  assert.equal(db.messages.length, 2);
  assert.equal(db.tasks.length, 1);
  assert.ok(res.invoice);
  assert.equal(res.invoice.source, "funding_success_fee");
  assert.equal(db.invoices.length, 1);
  assert.equal(db.invoices[0].status, "sent");
});

test("the fee comes off the confirmed approved total, at the rate on the sale", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], templates: withTemplates() });
  const res = await handle({
    event: ev("round.funded", { approvedAmount: 35000, feePercent: 10, fundedAmount: 90000 }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.feeAmount, "3500.00", "10% of the 35000 confirmed, not of the 90000 funded");
  assert.equal(Number(db.invoices[0].amount_due), 3500);
});

test("no confirmed approvals: no invoice, no send, a named reason and a task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const res = await handle({
    event: ev("round.funded", { approvedAmount: null, feePercent: 10, fundedAmount: 50000 }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.feeReady, false);
  assert.equal(res.reason, NO_CONFIRMED_APPROVALS);
  assert.equal(res.task.created, true);
  assert.equal(db.invoices.length, 0, "a round with nothing confirmed must not be billed at all");
  assert.equal(db.messages.length, 0);
  assert.deepEqual(db.clients[0].tags, ["ops:action-required"]);
});

test("zero confirmed is a refusal, never a $0 invoice", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const res = await handle({
    event: ev("round.funded", { approvedAmount: 0, feePercent: 10 }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.feeReady, false);
  assert.equal(res.reason, NO_CONFIRMED_APPROVALS);
  assert.equal(db.invoices.length, 0);
});

test("no agreed fee rate: named refusal, no invoice — never a default 10%", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const res = await handle({ event: ev("round.funded", { approvedAmount: 25000 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.feeReady, false);
  assert.equal(res.reason, NO_AGREED_FEE_PERCENT);
  assert.equal(res.task.created, true);
  assert.equal(db.invoices.length, 0);
  assert.equal(db.messages.length, 0);
  assert.deepEqual(db.clients[0].tags, ["ops:action-required"]);
});

test("duplicate delivery: replaying the same event does not double-send or double-invoice", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], templates: withTemplates() });
  const event = ev("round.funded", { approvedAmount: 10000, feePercent: 10 }, { id: "evt-dup-f07", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 2);
  assert.equal(db.tasks.length, 1);
  assert.equal(db.invoices.length, 1, "the same round must never be invoiced twice");
});

test("two verified funded rounds create two separate bills and a replay creates no third", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], templates: withTemplates() });
  const saleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const round1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const round2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  // The new ownership gate requires the genuine same-sale round linkage.
  // This stub is only for this legacy invoice/replay fixture; the separate
  // fee-source PG suite exercises its full SQL against disposable Postgres.
  const query = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/FROM funding_rounds fr/.test(sql)) {
      assert.deepEqual(params.slice(1), ["org-1", "cl-1", saleId]);
      return { rows: [round1, round2].includes(params[0]) ? [{ id: params[0] }] : [] };
    }
    return query(sql, params);
  };
  const first = ev("round.funded", {
    approvedAmount: 10000, feePercent: 10, saleId, fundingRoundId: round1, rail: "card_stacking"
  }, { id: "evt-round-1", clientId: "cl-1" });
  const second = ev("round.funded", {
    approvedAmount: 20000, feePercent: 10, saleId, fundingRoundId: round2, rail: "card_stacking"
  }, { id: "evt-round-2", clientId: "cl-1" });
  await handle({ event: first, db, step: fakeStep() });
  await handle({ event: second, db, step: fakeStep() });
  await handle({ event: first, db, step: fakeStep() });
  assert.deepEqual(db.invoices.map((row) => [row.funding_round_id, row.amount_due]), [
    [round1, "1000.00"], [round2, "2000.00"]
  ]);
  assert.notEqual(db.invoices[0].idempotency_key, db.invoices[1].idempotency_key);
});
