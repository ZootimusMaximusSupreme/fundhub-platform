// Display proof cases for batch 12 (finish the 853, tier 4, lane gap-catalog-display).
// Each listed control is exercised by the test file or files named beside it in fin-b12-rows.json: a real page
// in Chromium, fake /api answers, one click, and a judgement of the exact request and the words painted (or, for
// the bench numbers, the handler's own query over stand-in rows). That is a practice test, not a live check: it
// reads no saved data. A control named under more than one file keeps every file as evidence.

import ROWS from "./fin-b12-rows.json" with { type: "json" };

const DIR = "src/pulse/catalog/proofs";

const byControl = new Map();
for (const [file, groups] of Object.entries(ROWS)) {
  for (const group of groups) {
    for (const control of group.controls) {
      const key = `${group.sourceFile}\0${group.surface}\0${control}`;
      const found = byControl.get(key) || { sourceFile: group.sourceFile, surface: group.surface, control, tests: [] };
      found.tests.push(`${DIR}/${file}`);
      byControl.set(key, found);
    }
  }
}

export const FIN_B12_DISPLAY_PROOF_CASES = Object.freeze([...byControl.values()].map((entry) => Object.freeze({
  sourceFile: entry.sourceFile,
  surface: entry.surface,
  control: entry.control,
  depth: "e2e",
  evidence: entry.tests.join("; "),
  tests: Object.freeze([...entry.tests]),
})));
