// Display proof cases for batch 12 (finish the 853, tier 4, lane gap-catalog-display).
// Each listed control is exercised by the test file named beside it in fin-b12-rows.json: a real page in
// Chromium, fake /api answers, one click, and a judgement of the exact request and the words painted.
// That is a practice test, not a live check: it reads no saved data.

import ROWS from "./fin-b12-rows.json" with { type: "json" };

const DIR = "src/pulse/catalog/proofs";

export const FIN_B12_DISPLAY_PROOF_CASES = Object.freeze(
  Object.entries(ROWS).flatMap(([file, groups]) => groups.flatMap((group) => group.controls.map((control) => {
    const test = `${DIR}/${file}`;
    return Object.freeze({
      sourceFile: group.sourceFile,
      surface: group.surface,
      control,
      depth: "e2e",
      evidence: test,
      tests: Object.freeze([test]),
    });
  }))),
);
