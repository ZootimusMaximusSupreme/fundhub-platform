// Display proof cases for the S4 slice (customer-data screens). Each listed
// control is exercised by the test file named beside it in s4-rows.json, which
// drives the real page in Chromium against fake /api answers.

import S4_ROWS from "./s4-rows.json" with { type: "json" };

const DIR = "src/pulse/catalog/proofs";

export const S4_DISPLAY_PROOF_CASES = Object.freeze(
  Object.entries(S4_ROWS).flatMap(([file, groups]) => groups.flatMap((group) => group.controls.map((control) => {
    const test = `${DIR}/${file}`;
    return Object.freeze({
      sourceFile: group.sourceFile,
      surface: group.surface,
      control,
      depth: "deep",
      evidence: test,
      tests: Object.freeze([test]),
    });
  }))),
);
