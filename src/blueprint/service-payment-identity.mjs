import { paidCentsFromEvent, requestIdFromEvent } from "../handlers/paid-service-payment.mjs";

// Only a saved, authorized service request can name this checkout. Provider
// display titles are intentionally generic and must never assign a new SKU.
export async function lookupBlueprintServiceReceipt(db,event) {
  const requestId = requestIdFromEvent(event);
  if (!requestId || !event?.orgId) return null;
  const {rows:[row]} = await db.query(
    `SELECT p.id,p.org_id,p.client_id,p.price_total_cents,p.status,s.service_kind,s.state,s.authorized_at,s.checkout_provider,s.whop_payment_id
       FROM paid_service_requests p JOIN blueprint_client_services s
         ON s.id=p.id AND s.org_id=p.org_id AND s.client_id=p.client_id
      WHERE p.id=$1 AND p.org_id=$2`,[requestId,event.orgId]);
  if (!row) return null;
  const amountCents = Number(row.price_total_cents);
  const buyer = event.clientId || event.payload?.clientId || event.payload?.client_id || null;
  const productCode = "blueprint-help-"+row.service_kind;
  const payload = event.payload || {};
  const provider = String(payload.source || payload.provider || "commas").toLowerCase();
  const paymentRef = payload.paymentId ?? payload.payment_id ?? payload.transactionId ?? payload.providerRef ?? payload.provider_ref ?? null;
  let reason = null;
  if ((row.checkout_provider || "commas") !== provider) reason="service_provider_mismatch";
  else if (row.checkout_provider === "whop" && (!row.whop_payment_id || row.whop_payment_id !== paymentRef)) reason="service_provider_receipt_mismatch";
  else if (buyer && buyer!==row.client_id) reason="service_client_mismatch";
  else if (event.payload?.currency && String(event.payload.currency).toUpperCase()!=="USD") reason="service_currency_mismatch";
  else if (!row.authorized_at || !["checkout_pending","awaiting_payment","paid","in_progress","completed","needs_review"].includes(row.state)) reason="service_not_authorized";
  else if (!Number.isSafeInteger(amountCents) || amountCents<=0 || amountCents!==paidCentsFromEvent(event)) reason="service_amount_mismatch";
  return {matched:true,valid:!reason,reason,requestId,productCode,productName:productCode,clientId:row.client_id,orgId:row.org_id,amountCents};
}
