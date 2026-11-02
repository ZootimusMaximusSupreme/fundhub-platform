import { test } from "node:test";
import assert from "node:assert/strict";
import { allocatePayment } from "./allocate.mjs";
import { inngest } from "../workflows/client.mjs";

function fixture(t, receipt = {}) {
  t.mock.method(inngest, "send", async () => ({ ids: [] }));
  const invoice = { id: "invoice-1", org_id: "org-1", client_id: "buyer-1", source: "funding_success_fee", invoice_type: "success_fee", status: "sent", amount_due: "100.00" };
  const stored = receipt === null ? null : { id: "tx-1", org_id: "org-1", client_id: "buyer-1", provider_ref: "payment-1", provider: "commas", product_name: "Success fee", status: "succeeded", amount_paid: "100.00", ...receipt };
  const payments = [], events = [], tasks = [];
  const db = { async query(sql, params = []) {
    if (/FROM transactions/.test(sql)) return { rows: stored ? [stored] : [] };
    if (/SELECT \* FROM invoices/.test(sql)) return { rows: [{ ...invoice }] };
    if (/SELECT id FROM clients/.test(sql)) return { rows: params[0] === "buyer-1" && params[1] === "org-1" ? [{ id: "buyer-1" }] : [] };
    if (/FROM invoice_payments/.test(sql) && /SUM/.test(sql)) return { rows: [{ paid: payments.reduce((n, p) => n + Number(p.amount), 0) }] };
    if (/SELECT \* FROM invoice_payments/.test(sql)) return { rows: payments.filter(p => p.external_ref === params[1]) };
    if (/INSERT INTO invoice_payments/.test(sql)) {
      const row = { id: "ip-1", org_id: params[0], invoice_id: params[1], amount: params[2], external_ref: params[3], source_event_id: params[4] };
      payments.push(row); return { rows: [row] };
    }
    if (/UPDATE invoices/.test(sql)) { invoice.status = /'partially_paid'/.test(sql) ? "partially_paid" : "paid"; return { rows: [{ ...invoice }] }; }
    if (/INSERT INTO events/.test(sql)) { events.push(params[1]); return { rows: [{ id: `event-${events.length}` }] }; }
    if (/SELECT id FROM tasks/.test(sql)) return { rows: [] };
    if (/INSERT INTO tasks/.test(sql)) { tasks.push(params); return { rows: [{ id: `task-${tasks.length}` }] }; }
    throw new Error(`Unexpected allocator query: ${sql}`);
  } };
  const event = { id: "callback-1", name: "payment.received", orgId: "org-1", clientId: "buyer-1", payload: { invoiceId: invoice.id, providerRef: "payment-1", paymentId: "payment-1", source: "commas", product: "success_fee", productName: "Success fee", amount: 100 } };
  return { db, event, stored, invoice, payments, events, tasks };
}

for (const [name, receipt] of [
  ["failed ninety-dollar receipt cannot settle a hundred-dollar callback", { status: "failed", amount_paid: "90.00" }],
  ["failed receipt at the same amount", { status: "failed" }],
  ["succeeded receipt at a different amount", { amount_paid: "90.00" }],
  ["different buyer", { client_id: "buyer-2" }],
  ["different organization", { org_id: "org-2" }],
  ["different provider", { provider: "whop" }],
  ["different product", { product_name: "Deposit" }]
]) {
  test(`allocator refuses ${name}`, async t => {
    const f = fixture(t, receipt);
    const result = await allocatePayment(f.db, f.event);
    assert.equal(result.allocated, false);
    assert.equal(result.reason, "transaction_receipt_mismatch");
    assert.equal(f.invoice.status, "sent");
    assert.equal(f.payments.length, 0);
    assert.equal(f.events.length, 0, "no invoice.paid event may escape");
    assert.equal(f.tasks.length, 1, "the owned invoice buyer gets a review task");
  });
}

for (const [name, receipt] of [["matching succeeded transaction", {}], ["invoice-only provider receipt without a transaction", null]]) {
  test(`allocator preserves ${name}`, async t => {
    const f = fixture(t, receipt);
    const result = await allocatePayment(f.db, f.event);
    assert.equal(result.allocated, true);
    assert.equal(f.invoice.status, "paid");
    assert.equal(f.payments.length, 1);
    assert.deepEqual(f.events, ["invoice.paid"]);
    const replay = await allocatePayment(f.db, f.event);
    assert.equal(replay.replay, true);
    assert.equal(f.payments.length, 1);
  });
}

test("a conflicting transaction prevents replay from reannouncing invoice.paid", async t => {
  const f = fixture(t);
  await allocatePayment(f.db, f.event);
  f.stored.status = "failed";
  const result = await allocatePayment(f.db, f.event);
  assert.equal(result.replay, false);
  assert.equal(f.payments.length, 1);
  assert.deepEqual(f.events, ["invoice.paid"]);
});
