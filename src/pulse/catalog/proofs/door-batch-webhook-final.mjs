export const WEBHOOK_FINAL_EVIDENCE =
  "src/pulse/catalog/proofs/door-batch-webhook-final.mjs " +
  "src/pulse/catalog/proofs/door-batch-webhook-final.test.mjs";

const SURFACES = new Set([
  "webhook:POST /api/webhooks/twilio-status",
  "webhook:POST /api/webhooks/mailgun-events",
  "webhook:GET|POST /api/contracts/sign",
  "webhook:GET /api/documents/[id]",
]);

export function webhookFinalProof(row) {
  if (!SURFACES.has(row?.surface)) return null;
  return {
    depth: "deep",
    evidence: WEBHOOK_FINAL_EVIDENCE,
    asserts: String(row.control) + " — " + String(row.surface) +
      " accepts its real fake signature and returns the expected safe handler result",
  };
}
