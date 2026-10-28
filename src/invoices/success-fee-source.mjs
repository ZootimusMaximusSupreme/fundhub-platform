// Funding success-fee AR must trust the stored invoice, not event metadata.
// 'source' is canonical after migration 031; invoice_type is only a legacy fallback.
export function isFundingSuccessFeeInvoice(invoice) {
  if (!invoice) return false;
  if (invoice.source != null && String(invoice.source).trim() !== "") {
    return invoice.source === "funding_success_fee";
  }
  return invoice.invoice_type === "success_fee";
}
