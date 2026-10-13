const PROOF_FILE = "src/pulse/catalog/proofs/display-contracts-ab-3.test.mjs";

function contract(rowKey, sourceFile, family, surface, expected, assertion) {
  return Object.freeze({
    rowKey,
    sourceFile,
    family,
    surface,
    expected,
    proof: Object.freeze({
      depth: "deep",
      runner: "rendered-chromium-local-fake-routes",
      file: PROOF_FILE,
      assertion,
    }),
  });
}

export const DISPLAY_CONTRACTS_AB_3 = Object.freeze([
  contract(
    "35f9024f2f53a228338b", "desks-b.json", "button",
    "shell.js shared chrome (on every desk here except financeos.html)",
    "Sidebar burger (collapse to icon rail)",
    "Clicking the rendered burger collapses the sidebar into the mini rail, then clicking it again restores the full rail.",
  ),
]);

export const DISPLAY_CONTRACT_KEYS_AB_3 = Object.freeze(
  DISPLAY_CONTRACTS_AB_3.map((entry) => entry.rowKey),
);

export const DISPLAY_CONTRACT_PROOF_AB_3 = Object.freeze({
  shard: "Display AB 3",
  sourceFiles: Object.freeze(["desks-b.json"]),
  runner: "rendered-chromium-local-fake-routes",
  testFile: PROOF_FILE,
  rowKeys: DISPLAY_CONTRACT_KEYS_AB_3,
  strictProvedCount: DISPLAY_CONTRACT_KEYS_AB_3.length,
});
