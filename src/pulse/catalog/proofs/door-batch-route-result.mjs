export const ROUTE_RESULT_EVIDENCE =
  "src/pulse/catalog/proofs/door-batch-route-result.mjs " +
  "src/pulse/catalog/proofs/door-batch-route-result.test.mjs";

const DEEP_IMPACTS = new Set(["money", "customerMessage", "customerData"]);

export function routeKeyForDoor(row) {
  return String(row?.route || row?.surface || "")
    .replace(/^route:/, "")
    .replace(/ \(.*$/, "")
    .trim();
}

export function routeResultProof(row) {
  const key = routeKeyForDoor(row);
  if (!key) return null;
  const control = String(row?.control || key).trim();
  return {
    depth: DEEP_IMPACTS.has(row?.impact) ? "deep" : "e2e",
    evidence: ROUTE_RESULT_EVIDENCE,
    asserts: `${control} — ${key} invokes its real handler and returns its exact safe refusal`,
  };
}
