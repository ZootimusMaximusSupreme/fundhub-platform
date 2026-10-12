export const ROUTE_EXACT_EVIDENCE =
  "src/pulse/catalog/proofs/door-batch-route-exact.test.mjs";

const ASSERTIONS = new Map([
  [
    "route:climate/geocode",
    "Turn a typed address into a state / county for the lending-climate map (no lenders read, no record).",
  ],
  [
    "route:public/rb2b-webhook",
    "POST ?secret= store one identified website visitor as an events row rb2b.visitor_identified (upsert by email; no client, no mail, no workflow)",
  ],
]);

export function routeExactProof(row) {
  const assertion = ASSERTIONS.get(row?.surface);
  if (!assertion || assertion !== row?.control) return null;
  return {
    depth: ["money", "customerMessage", "customerData"].includes(row?.impact) ? "deep" : "e2e",
    evidence: ROUTE_EXACT_EVIDENCE,
    asserts: row.control,
  };
}
