const TEST_FILE = "src/pulse/catalog/proofs/display-contracts-cd-2.test.mjs";

function proof(rowId, sourceFile, surface, control, assertion) {
  return Object.freeze({
    rowId,
    key: `${sourceFile}\0${surface}\0${control}`,
    sourceFile,
    surface,
    control,
    depth: "deep",
    evidence: TEST_FILE,
    tests: Object.freeze([TEST_FILE]),
    proof: Object.freeze({
      runner: "local Chromium with controlled fake API routes",
      assertion,
    }),
  });
}

export const DISPLAY_CONTRACTS_CD_2_PROOFS = Object.freeze([
  proof(
    "9990cab269a68a9e346f",
    "desks-d.json",
    "public/app/money-connections.html",
    "Connect Commas / Connect Whop / Connect Open API",
    "Clicking each real provider button posts its exact provider, business, and mode to the fake API, then renders Connected; the Open API key is shown once.",
  ),
]);

export const DISPLAY_CONTRACTS_CD_2_PROOF_KEYS = Object.freeze(
  DISPLAY_CONTRACTS_CD_2_PROOFS.map((entry) => entry.key),
);

export const DISPLAY_CONTRACTS_CD_2_METADATA = Object.freeze({
  shard: "Display CD2",
  sourceFiles: Object.freeze(["desks-c.json", "desks-d.json"]),
  test: TEST_FILE,
  runner: "rendered Chromium pages on a local static server with controlled fake API routes",
  provedCount: DISPLAY_CONTRACTS_CD_2_PROOFS.length,
  baselineRedCount: 382,
  honestLeftoverCount: 381,
});
