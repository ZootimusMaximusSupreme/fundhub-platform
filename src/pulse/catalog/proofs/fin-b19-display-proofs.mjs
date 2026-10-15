// Display proof cases for batch 19 (finish the 853, tier 4, lane gap-catalog-display).
// Each listed control is exercised by the test file named beside it in fin-b19-rows.json: a real page in
// Chromium, fake /api answers, one action, and a judgement of the exact request and the words painted.
// That is a practice test, not a live check: it reads no saved data. A control under "notAttached" is
// also exercised, but is left out here (see fin-b19-not-attachable.mjs): the Sort, filter-chip and Search rows stay
// reported as not proved, and the three sidebar heads that no role is shown are judged by the live shared
// chrome (src/pulse/coverage/fin-b19-hidden-head.mjs), which says "nothing to judge" only while that holds.

import ROWS from "./fin-b19-rows.json" with { type: "json" };

const DIR = "src/pulse/catalog/proofs";

// Controls an older test already judges end to end, held to that test by name beside the batch's own.
const ALSO = Object.freeze({
  "Account chip: Sign out": ["src/http/auth-logout-handler.test.mjs"],
});

export const FIN_B19_DISPLAY_PROOF_CASES = Object.freeze(
  Object.entries(ROWS).flatMap(([file, groups]) => groups.flatMap((group) => group.controls.map((control) => {
    const tests = [`${DIR}/${file}`, ...(ALSO[control] || [])];
    return Object.freeze({
      sourceFile: group.sourceFile,
      surface: group.surface,
      control,
      depth: "e2e",
      evidence: tests.join("; "),
      tests: Object.freeze(tests),
    });
  }))),
);
