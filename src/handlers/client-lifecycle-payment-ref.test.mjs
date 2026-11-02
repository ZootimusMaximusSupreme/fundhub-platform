import { test } from "node:test";
import assert from "node:assert";
import {
  PaymentProviderRefConflictError,
  reconcileProviderRefTransaction,
  paymentFactsFromEvent,
  parseProviderPaidAt,
  coreFactsMatch
} from "./client-lifecycle-payment-ref.mjs";

const baseFacts = (over = {}) => ({
  orgId: "org-1",
  clientId: "cl-1",
  productName: "Consulting Services Deposit",
  amountPaid: 3000,
  status: "failed",
  provider: "commas",
  providerRef: "ref-1",
  currency: "USD",
  rawPayload: { currency: "USD" },
  ...over
});

test("parseProviderPaidAt ignores ingest-only occurredAt", () => {
  assert.equal(parseProviderPaidAt({ paidAt: "2026-10-31T18:00:00.000Z" }), "2026-10-31T18:00:00.000Z");
  assert.equal(parseProviderPaidAt({ occurredAt: "2026-10-31T19:00:00.000Z" }), null);
});

test("reconcile: failed then succeeded with matching facts upgrades", () => {
  const existing = baseFacts({ status: "failed" });
  const incoming = baseFacts({ status: "succeeded", rawPayload: { currency: "USD", provider_paid_at: "2026-10-31T18:00:00.000Z" } });
  assert.equal(reconcileProviderRefTransaction(existing, incoming).action, "upgrade");
});

test("reconcile: conflicting product throws payment_ref_conflict", () => {
  const existing = baseFacts({ status: "failed" });
  const incoming = baseFacts({ status: "succeeded", productName: "Other Product" });
  assert.throws(
    () => reconcileProviderRefTransaction(existing, incoming),
    (err) => err instanceof PaymentProviderRefConflictError && err.code === "payment_ref_conflict" && err.retryable === true
  );
});

test("reconcile: conflicting amount throws", () => {
  const existing = baseFacts({ status: "failed" });
  const incoming = baseFacts({ status: "succeeded", amountPaid: 3100 });
  assert.throws(
    () => reconcileProviderRefTransaction(existing, incoming),
    (err) => err instanceof PaymentProviderRefConflictError
  );
});

test("reconcile: conflicting currency throws", () => {
  const existing = baseFacts({ status: "failed", currency: "USD", rawPayload: { currency: "USD" } });
  const incoming = baseFacts({ status: "succeeded", currency: "EUR", rawPayload: { currency: "EUR" } });
  assert.throws(
    () => reconcileProviderRefTransaction(existing, incoming),
    (err) => err instanceof PaymentProviderRefConflictError
  );
});

test("reconcile: conflicting buyer throws", () => {
  const existing = baseFacts({ status: "failed", clientId: "cl-a" });
  const incoming = baseFacts({ status: "succeeded", clientId: "cl-b" });
  assert.throws(
    () => reconcileProviderRefTransaction(existing, incoming),
    (err) => err instanceof PaymentProviderRefConflictError
  );
});

test("reconcile: succeeded then failed preserves settled row when facts match", () => {
  const existing = baseFacts({ status: "succeeded" });
  const incoming = baseFacts({ status: "failed" });
  assert.equal(reconcileProviderRefTransaction(existing, incoming).action, "noop");
});

test("reconcile: succeeded then failed with different facts throws conflict", () => {
  const existing = baseFacts({ status: "succeeded", amountPaid: 3000 });
  const incoming = baseFacts({ status: "failed", amountPaid: 3100 });
  assert.throws(
    () => reconcileProviderRefTransaction(existing, incoming),
    (err) => err instanceof PaymentProviderRefConflictError
  );
});

test("reconcile: failed to succeeded with null client ids throws conflict", () => {
  const existing = baseFacts({ status: "failed", clientId: null });
  const incoming = baseFacts({ status: "succeeded", clientId: null });
  assert.throws(
    () => reconcileProviderRefTransaction(existing, incoming),
    (err) => err instanceof PaymentProviderRefConflictError
  );
});

test("paymentFactsFromEvent stores provider_paid_at only from paidAt", () => {
  const facts = paymentFactsFromEvent({
    orgId: "org-1",
    occurredAt: "2026-11-01T12:00:00.000Z",
    payload: { providerRef: "x", paidAt: "2026-10-31T18:00:00.000Z", currency: "USD" }
  }, "cl-1", "succeeded");
  assert.equal(facts.rawPayload.provider_paid_at, "2026-10-31T18:00:00.000Z");
  assert.equal(facts.currency, "USD");
  assert.ok(coreFactsMatch(facts, { ...facts, status: "failed" }));
});
