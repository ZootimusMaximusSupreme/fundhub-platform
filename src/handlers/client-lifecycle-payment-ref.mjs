export const SETTLED_TRANSACTION_STATUSES = new Set(["succeeded", "paid", "complete", "completed"]);

export class PaymentProviderRefConflictError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "PaymentProviderRefConflictError";
    this.code = "payment_ref_conflict";
    this.retryable = true;
    this.detail = detail;
  }
}

export function normalizeCurrency(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim().toUpperCase();
  return s || null;
}

export function parseProviderPaidAt(payload) {
  const p = payload || {};
  const at = p.paidAt ?? p.paid_at ?? null;
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function paymentFactsFromEvent(event, clientId, status) {
  const p = event.payload || {};
  const raw = { ...p };
  const paidAt = parseProviderPaidAt(p);
  if (paidAt) raw.provider_paid_at = paidAt;
  return {
    orgId: event.orgId,
    clientId,
    productName: p.productName || p.product || "unknown",
    amountPaid: p.amount ?? null,
    status,
    provider: p.source || "commas",
    providerRef: p.providerRef || null,
    currency: normalizeCurrency(p.currency ?? p.currencyCode ?? p.currency_code),
    rawPayload: raw
  };
}

export function paymentFactsFromRow(row) {
  const raw = row.raw_payload && typeof row.raw_payload === "object"
    ? row.raw_payload
    : (row.raw_payload ? JSON.parse(row.raw_payload) : {});
  return {
    orgId: row.org_id,
    clientId: row.client_id,
    productName: row.product_name,
    amountPaid: row.amount_paid,
    status: row.status,
    provider: row.provider,
    providerRef: row.provider_ref,
    currency: normalizeCurrency(raw.currency ?? raw.currencyCode ?? raw.currency_code),
    rawPayload: raw
  };
}

export function amountPaidSame(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

export function currencySame(a, b) {
  if (a == null && b == null) return true;
  return a === b;
}

export function verifiedSameClient(existing, incoming) {
  if (existing.clientId == null || incoming.clientId == null) return false;
  return String(existing.clientId) === String(incoming.clientId);
}

export function coreFactsMatch(existing, incoming) {
  return verifiedSameClient(existing, incoming)
    && existing.productName === incoming.productName
    && amountPaidSame(existing.amountPaid, incoming.amountPaid)
    && existing.provider === incoming.provider
    && currencySame(existing.currency, incoming.currency);
}

export function isSettledStatus(status) {
  return SETTLED_TRANSACTION_STATUSES.has(status);
}

/**
 * @returns {{ action: "insert" | "noop" | "upgrade", reason?: string, rawPayloadPatch?: string }}
 */
export function reconcileProviderRefTransaction(existing, incoming) {
  if (!incoming.providerRef) {
    throw new Error("reconcileProviderRefTransaction: providerRef is required");
  }
  if (!existing) return { action: "insert" };

  if (isSettledStatus(existing.status) && incoming.status === "failed") {
    if (coreFactsMatch(existing, incoming)) {
      return { action: "noop", reason: "preserve_settled_on_failed_replay" };
    }
    throw new PaymentProviderRefConflictError(
      `provider_ref ${incoming.providerRef} is already settled and a failed replay disagrees on buyer, product, amount, currency, or provider`,
      conflictDetail(existing, incoming)
    );
  }

  if (coreFactsMatch(existing, incoming)) {
    if (existing.status === incoming.status) {
      return { action: "noop", reason: "duplicate_status" };
    }
    if (existing.status === "failed" && incoming.status === "succeeded") {
      if (!verifiedSameClient(existing, incoming)) {
        throw new PaymentProviderRefConflictError(
          `provider_ref ${incoming.providerRef} cannot upgrade without a verified client on both sides`,
          conflictDetail(existing, incoming)
        );
      }
      return {
        action: "upgrade",
        reason: "failed_to_succeeded",
        rawPayloadPatch: JSON.stringify(incoming.rawPayload)
      };
    }
    if (isSettledStatus(existing.status) && incoming.status === "succeeded") {
      return { action: "noop", reason: "duplicate_settled" };
    }
  }

  throw new PaymentProviderRefConflictError(
    `provider_ref ${incoming.providerRef} is already recorded with different buyer, product, amount, currency, or provider`,
    conflictDetail(existing, incoming)
  );
}

function conflictDetail(existing, incoming) {
  return {
    providerRef: incoming.providerRef,
    orgId: incoming.orgId,
    existingClientId: existing.clientId,
    incomingClientId: incoming.clientId,
    existingProduct: existing.productName,
    incomingProduct: incoming.productName,
    existingAmount: existing.amountPaid,
    incomingAmount: incoming.amountPaid,
    existingCurrency: existing.currency,
    incomingCurrency: incoming.currency,
    existingProvider: existing.provider,
    incomingProvider: incoming.provider,
    existingStatus: existing.status,
    incomingStatus: incoming.status
  };
}
