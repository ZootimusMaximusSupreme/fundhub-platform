export const ROUTE_RESULT_EVIDENCE =
  "src/pulse/coverage/gap-door-batch-routes.mjs " +
  "src/pulse/coverage/gap-door-batch-routes.test.mjs " +
  "src/pulse/catalog/proofs/door-batch-route-result.test.mjs";

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
    depth: "e2e",
    verdict: "red",
    evidence: ROUTE_RESULT_EVIDENCE,
    asserts: `${control} — the exact ${key} route monitor stays red until an intended-method fake-data test judges this named result`,
  };
}
