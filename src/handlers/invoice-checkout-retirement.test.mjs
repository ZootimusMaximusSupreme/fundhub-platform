import { test } from "node:test";
import assert from "node:assert/strict";
import {
  onInvoiceCheckoutClosed,
  onInvoiceCheckoutPartiallyPaid
} from "./invoice-checkout-retirement.mjs";
import { attachInvoicePayLink } from "../workflows/ar-collections.mjs";
import { pgFake } from "../workflows/test-support.mjs";

const invoice = (over = {}) => ({ id: "inv-1", org_id: "org-1", client_id: "cl-1",
  source: "funding_success_fee", invoice_type: "success_fee", status: "partially_paid", ...over });
const event = (name) => ({ name, orgId: "org-1", payload: { invoiceId: "inv-1" } });

function fakeDb(row) {
  return { query: async (sql, params) => {
    assert.match(sql, /FROM invoices/);
    assert.deepEqual(params, ["inv-1", "org-1"]);
    return { rows: row ? [row] : [] };
  } };
}

test("partial settlement refreshes only a fee invoice and sends no notice", async () => {
  let refreshed = 0;
  const refreshLink = async (_db, row) => { refreshed++; assert.equal(row.id, "inv-1"); return { id: "new-link" }; };
  const result = await onInvoiceCheckoutPartiallyPaid(event("invoice.partially_paid"), fakeDb(invoice()), { refreshLink });
  assert.equal(result.id, "new-link");
  assert.equal(refreshed, 1);
  const notFee = await onInvoiceCheckoutPartiallyPaid(event("invoice.partially_paid"),
    fakeDb(invoice({ source: "deposit", invoice_type: "deposit" })), { refreshLink });
  assert.equal(notFee.skipped, true);
  const nowPaid = await onInvoiceCheckoutPartiallyPaid(event("invoice.partially_paid"),
    fakeDb(invoice({ status: "paid" })), { refreshLink });
  assert.equal(nowPaid.skipped, true);
  assert.equal(refreshed, 1);
});

test("closed invoice cleanup is scoped to the fee source", async () => {
  const skipped = await onInvoiceCheckoutClosed(event("invoice.paid"),
    fakeDb(invoice({ source: "deposit", invoice_type: "deposit" })));
  assert.equal(skipped.skipped, true);
  await assert.rejects(onInvoiceCheckoutClosed(event("invoice.voided"), fakeDb(null)), /not in org/);
});

test("partial event deletes the old amount before minting the remainder, without a notice", async () => {
  const db = pgFake({
    invoices: [invoice({ amount_due: 1000 })],
    invoicePayments: [{ invoice_id: "inv-1", org_id: "org-1", amount: 400, kind: "payment" }],
    paymentLinks: [{ id: "old-link", org_id: "org-1", client_id: "cl-1", invoice_id: "inv-1",
      status: "sent", amount_cents: 100000, checkout_url: "https://checkout.example/old-link" }]
  });
  const seen = [];
  const refreshLink = (conn, row, env) => attachInvoicePayLink(conn, row, env,
    async (_db, input) => {
      assert.equal(db.paymentLinks[0].status, "void", "retirement must finish before the new POST");
      const next = { id: "balance-link", org_id: input.orgId, invoice_id: input.invoiceId,
        status: "created", amount_cents: input.amountCents, checkout_url: "https://checkout.example/balance-link" };
      db.paymentLinks.push(next);
      seen.push(input.amountCents);
      return next;
    },
    async (_db, input) => {
      const old = db.paymentLinks.find((link) => link.id === input.linkId);
      old.status = "void";
      return { retired: true };
    });
  const result = await onInvoiceCheckoutPartiallyPaid(event("invoice.partially_paid"), db, {
    env: { CORTANA_COMMAS_API_KEY: "test-only" }, refreshLink
  });
  assert.equal(result.id, "balance-link");
  assert.deepEqual(seen, [60000]);
  assert.equal(db.messages.length, 0);
});
