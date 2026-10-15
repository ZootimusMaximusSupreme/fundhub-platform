// Display proof cases for batch 10 (finish the 853, tier 4, lane gap-catalog-display).
//
// Two kinds of attachment, and each row has exactly one:
//   live check      the row has a contract in fin-b10-display-contracts.mjs: a saved-result SQL contract (five)
//                   or a link-gate contract (two). Its evidence names the display lane, so the lane judges it
//                   from the live system and it stays in the lane.
//   practice test   a real page in Chromium, fake /api answers, one action, a judgement of the exact request and
//                   the words painted (the test file named beside the row in fin-b10-rows.json). It reads no
//                   saved data. The row leaves the lane.
// A live row also has its practice test (extra cover). Every one of the 40 rows is attached.

import ROWS from "./fin-b10-rows.json" with { type: "json" };
import { FIN_B10_LIVE_CASES, FIN_B10_LIVE_ROWS } from "./fin-b10-display-contracts.mjs";

const DIR = "src/pulse/catalog/proofs";
const keyOf = (sourceFile, surface, control) => `${sourceFile}\0${surface}\0${control}`;
const LIVE = new Set(FIN_B10_LIVE_ROWS.map(([sourceFile, surface, control]) => keyOf(sourceFile, surface, control)));

export const FIN_B10_PRACTICE_CASES = Object.freeze(
  Object.entries(ROWS).flatMap(([file, groups]) => groups.flatMap((group) => group.controls
    .filter((control) => !LIVE.has(keyOf(group.sourceFile, group.surface, control)))
    .map((control) => {
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

export const FIN_B10_DISPLAY_PROOF_CASES = Object.freeze([...FIN_B10_LIVE_CASES, ...FIN_B10_PRACTICE_CASES]);
