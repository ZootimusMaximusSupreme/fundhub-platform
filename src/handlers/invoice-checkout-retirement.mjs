// A settled or voided fee invoice must not leave another hosted Commas URL
// payable. The event bus dead-letters a provider failure with the invoice ID;
// replay calls the same idempotent retirement helper.
import { on } from "../events/registry.mjs";
import { retireInvoiceCheckoutLinksForInvoice } from "../payment-links/retire-invoice-checkout.mjs";
import { attachInvoicePayLink } from "../workflows/ar-collections.mjs";

export async function onInvoiceCheckoutClosed(event, db, {
  env = process.env, fetchImpl = fetch
} = {}) {
  const invoiceId = event.payload?.invoiceId || event.payload?.invoice_id;
  const orgId = event.orgId;
  if (!invoiceId || !orgId) throw new Error("Closed invoice event lacks invoice/org identity");
  const invoice = (await db.query(
    `SELECT id, source, invoice_type
       FROM invoices WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [invoiceId, orgId]
  )).rows[0];
  if (!invoice) throw new Error(`Closed invoice ${invoiceId} is not in org ${orgId}`);
  if (invoice.source !== "funding_success_fee" && invoice.invoice_type !== "success_fee") {
    return { skipped: true, reason: "not_success_fee" };
  }
  return retireInvoiceCheckoutLinksForInvoice(db, { orgId, invoiceId, env, fetchImpl });
}

export async function onInvoiceCheckoutPartiallyPaid(event, db, {
  env = process.env, refreshLink = attachInvoicePayLink
} = {}) {
  const invoiceId = event.payload?.invoiceId || event.payload?.invoice_id;
  const orgId = event.orgId;
  if (!invoiceId || !orgId) throw new Error("Partial invoice event lacks invoice/org identity");
  const invoice = (await db.query(
    `SELECT * FROM invoices WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [invoiceId, orgId]
  )).rows[0];
  if (!invoice) throw new Error(`Partial invoice ${invoiceId} is not in org ${orgId}`);
  if (invoice.source !== "funding_success_fee" && invoice.invoice_type !== "success_fee") {
    return { skipped: true, reason: "not_success_fee" };
  }
  if (invoice.status !== "partially_paid") {
    return { skipped: true, reason: invoice.status };
  }
  // This is not another AR notice. The obsolete amount is deleted at Commas
  // before refreshLink mints a checkout for only the remaining balance.
  return refreshLink(db, invoice, env);
}

export function register() {
  on("invoice.voided", onInvoiceCheckoutClosed);
  on("invoice.paid", onInvoiceCheckoutClosed);
  on("invoice.partially_paid", onInvoiceCheckoutPartiallyPaid);
}
