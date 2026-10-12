export const DOOR_CONTRACTS_ROUTES_01_EVIDENCE =
  "src/pulse/catalog/proofs/door-contracts-routes-01.test.mjs";

export function doorContractsRoutes01RowKey(sourceFile, row) {
  const file = String(sourceFile || "").split(/[\\/]/).at(-1);
  const surface = String(row?.surface || "").trim();
  const control = String(row?.control || "").trim();
  return `${file}::${surface}::${control}`;
}

const DEFINITIONS = [
  {
    generatedId: "052113deacd359e4a84f",
    sourceFile: "routes-0.json",
    surface: "route:finance/model",
    control:
      "Deal model: net cash, fee split, monthly obligation and the funding waterfall for a client. Computes only; writes nothing.",
    depth: "deep",
  },
  {
    generatedId: "94bf89e6f3d796771af9",
    sourceFile: "routes-1.json",
    surface: "route:auth/logout",
    control:
      "POST revoke the presented session (staff sessions and account sessions) and clear the cookie",
    depth: "deep",
  },
  {
    generatedId: "7e8eac534a9573f2d854",
    sourceFile: "routes-1.json",
    surface: "route:push/key",
    control:
      "GET the public VAPID key and whether web push is configured (both keys must be present)",
    depth: "e2e",
  },
  {
    generatedId: "ebbcbdf0d46786d3f27c",
    sourceFile: "routes-0.json",
    surface: "route:trials/eligibility",
    control:
      "Live Trial eligibility gate in front of the $297 pay button: decides sellable or held, returns terms, price, guarantee words. Computes only.",
    depth: "deep",
  },
];

export const DOOR_CONTRACTS_ROUTES_01_PROOFS = Object.freeze(
  DEFINITIONS.map((definition) => {
    const key = doorContractsRoutes01RowKey(definition.sourceFile, definition);
    return Object.freeze({
      key,
      generatedId: definition.generatedId,
      sourceFile: definition.sourceFile,
      surface: definition.surface,
      control: definition.control,
      proof: Object.freeze({
        depth: definition.depth,
        evidence: DOOR_CONTRACTS_ROUTES_01_EVIDENCE,
        asserts: definition.control,
      }),
    });
  }),
);

export const DOOR_CONTRACTS_ROUTES_01_ROW_KEYS = Object.freeze(
  DOOR_CONTRACTS_ROUTES_01_PROOFS.map((entry) => entry.key),
);

const PROOF_BY_KEY = new Map(
  DOOR_CONTRACTS_ROUTES_01_PROOFS.map((entry) => [entry.key, entry.proof]),
);

export function doorContractsRoutes01Proof(sourceFile, row) {
  return PROOF_BY_KEY.get(doorContractsRoutes01RowKey(sourceFile, row)) || null;
}
