// A/R receipts cannot create or update CRM contacts before identity is checked.
// These are synthetic workflow fakes; the SQL-level proof is in the adjacent
// *.pg.test.mjs and runs only against disposable GitHub Actions Postgres.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "./ar-collections.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

function fixture() {
  const db = pgFake({
    clients: [
      { id: "owner-client", org_id: "org-1", email: "owner@example.invalid",
        first_name: "Stored", custom_fields: { source: "original" } },
      { id: "foreign-client", org_id: "org-2", email: "foreign@example.invalid",
        first_name: "Other", custom_fields: { source: "original" } }
    ],
    invoices: [{
      id: "invoice-1", org_id: "org-1", client_id: "owner-client",
      source: "funding_success_fee", invoice_type: "success_fee",
      status: "sent", amount_due: 100
    }]
  });
  const queries = [];
  const query = db.query.bind(db);
  db.query = async (sql, params) => {
    queries.push(String(sql));
    if (/\\b(?:INSERT|UPDATE|DELETE)\\s+clients\\b/i.test(sql)) {
      throw new Error("A/R must never mutate a CRM customer");
    }
    return query(sql, params);
  };
  return { db, queries };
}

const pay = (clientId, extra = {}) => ev("payment.received", {
  invoiceId: "invoice-1", product: "success_fee", amount: 40,
  paymentId: "ar-owned-receipt", ...extra
}, { clientId, id: "ar-owned-event" });

test("foreign org clientId cannot allocate on another tenant or mutate its contact", async () => {
  const { db, queries } = fixture();
  const before = JSON.stringify(db.clients);
  const result = await handle({
    event: pay("foreign-client", { email: "owner@example.invalid", firstName: "Tampered" }),
    db, step: fakeStep()
  });
  assert.equal(result.reason, "client_not_owned");
  assert.equal(result.allocated, false);
  assert.equal(db.invoicePayments.length, 0);
  assert.equal(db.invoices[0].status, "sent");
  assert.equal(JSON.stringify(db.clients), before);
  assert.ok(queries.every((sql) => !/INSERT INTO clients|UPDATE clients/i.test(sql)));
});

test("unknown email does not mint a phantom buyer or settle the hinted invoice", async () => {
  const { db } = fixture();
  const result = await handle({
    event: pay(null, { email: "not-a-buyer@example.invalid", name: "Phantom Client" }),
    db, step: fakeStep()
  });
  assert.equal(result.reason, "client_not_owned");
  assert.equal(db.clients.length, 2);
  assert.equal(db.invoicePayments.length, 0);
  assert.equal(db.invoices[0].status, "sent");
});

test("existing org customer ID allocates without patching CRM contact details", async () => {
  const { db } = fixture();
  const result = await handle({
    event: pay("owner-client", { firstName: "Should Not Overwrite" }),
    db, step: fakeStep()
  });
  assert.equal(result.allocated, true);
  assert.equal(result.appliedCents, 4000);
  assert.equal(db.invoices[0].status, "partially_paid");
  assert.equal(db.clients[0].first_name, "Stored");
  assert.deepEqual(db.clients[0].custom_fields, { source: "original" });
  assert.equal(db.invoicePayments.length, 1);
});

test("existing same-org email lookup allocates without CRM creation or patch", async () => {
  const { db } = fixture();
  const result = await handle({
    event: pay(null, { email: "OWNER@example.invalid", firstName: "Should Not Overwrite" }),
    db, step: fakeStep()
  });
  assert.equal(result.allocated, true);
  assert.equal(db.clients[0].first_name, "Stored");
  assert.equal(db.invoicePayments.length, 1);
});

test("exact invoice-only provider receipt retains the upstream allocator path", async () => {
  const { db } = fixture();
  const result = await handle({
    event: pay(null),
    db, step: fakeStep()
  });
  assert.equal(result.allocated, true);
  assert.equal(db.invoicePayments.length, 1);
});

test("missing organization refuses before any buyer read or allocation", async () => {
  const { db, queries } = fixture();
  const result = await handle({
    event: { ...pay("owner-client"), orgId: null },
    db, step: fakeStep()
  });
  assert.equal(result.reason, "missing_org");
  assert.deepEqual(queries, []);
  assert.equal(db.invoicePayments.length, 0);
});
