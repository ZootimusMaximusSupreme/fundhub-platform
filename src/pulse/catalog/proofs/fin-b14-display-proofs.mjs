// Display proof cases for batch 14 (finish the 853, tier 4, lane gap-catalog-display): the Journeys editor
// and the Lenders desk.
//
// Two kinds of attachment, and each row has exactly one:
//   live check      the row has a saved-result contract in fin-b14-display-contracts.mjs. Its evidence names the
//                   display lane, so the lane judges it from saved data, and it stays in the lane.
//   practice test   a real page in Chromium, fake /api answers, one action, a judgement of the exact request and
//                   the words painted (the test file named beside the row in fin-b14-rows.json). It reads no
//                   saved data. The row leaves the lane.
// A control listed under "notAttached" is also exercised, but its row words name something the product does
// not do, so it is left out here and stays reported as not proved (see fin-b14-not-attachable.mjs).

import ROWS from "./fin-b14-rows.json" with { type: "json" };
import { FIN_B14_LIVE_CASES, FIN_B14_LIVE_ROWS } from "./fin-b14-display-contracts.mjs";

const DIR = "src/pulse/catalog/proofs";
const keyOf = (sourceFile, surface, control) => `${sourceFile}\0${surface}\0${control}`;
const LIVE = new Set(FIN_B14_LIVE_ROWS.map(([sourceFile, surface, control]) => keyOf(sourceFile, surface, control)));

export const FIN_B14_PRACTICE_CASES = Object.freeze(
  Object.entries(ROWS).flatMap(([file, groups]) => groups.flatMap((group) => group.controls
    .filter((control) => !LIVE.has(keyOf(group.sourceFile, group.surface, control)))
    .map((control) => {
      const tests = [`${DIR}/${file}`, ...(group.also || [])];
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

export const FIN_B14_DISPLAY_PROOF_CASES = Object.freeze([...FIN_B14_LIVE_CASES, ...FIN_B14_PRACTICE_CASES]);
