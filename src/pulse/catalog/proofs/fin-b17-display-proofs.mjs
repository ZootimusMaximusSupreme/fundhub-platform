// Display proof cases for batch 17 (finish the 853, tier 4, lane gap-catalog-display): the closer's client
// deck (Present), Products & Commissions, the staff chat widget, and the money connection status lines.
//
// Two kinds of attachment, and each row has exactly one outcome:
//   live check      the row has a saved-result contract in fin-b17-display-contracts.mjs. Its evidence names
//                   the display lane, so the lane judges it from saved data, and it stays in the lane. The
//                   practice test that also presses the same control is listed beside the live test in its
//                   `tests`, so the screen half is run too.
//   practice test   a real page script (a vm, or Chromium) with fake answers, one action, and a judgement of
//                   the exact request and the words painted (the test file named beside the row in
//                   fin-b17-rows.json). It reads no saved data. The row leaves the lane.
// Two Present rows (the scripts are served, and wired) are practice tests whose evidence also names the
// closer desk lane's own live GET check (gap-closer.mjs, check closer:desk-pages) and its test.

import ROWS from "./fin-b17-rows.json" with { type: "json" };
import { FIN_B17_LANE, FIN_B17_LIVE_CASES, FIN_B17_LIVE_ROWS } from "./fin-b17-display-contracts.mjs";

const DIR = "src/pulse/catalog/proofs";
const keyOf = (sourceFile, surface, control) => `${sourceFile}\0${surface}\0${control}`;
const LIVE = new Set(FIN_B17_LIVE_ROWS.map(([sourceFile, surface, control]) => keyOf(sourceFile, surface, control)));

// The two scripts' rows: the closer desk lane reads them live over HTTP every run.
const CLOSER_LANE_ROWS = [
  /^contract-send\.js and data\.js are served/,
  /^present\.js is served and wired/,
];
const CLOSER_LANE_TESTS = ["src/pulse/coverage/gap-closer.test.mjs"];

// One map row, and every practice test file that presses it. A row that a vm test and a real-page test
// both judge is listed under both files in fin-b17-rows.json and is ONE proof case here, naming both.
const rowsOf = () => {
  const byKey = new Map();
  for (const [file, groups] of Object.entries(ROWS)) {
    for (const group of groups) {
      for (const control of group.controls) {
        const key = keyOf(group.sourceFile, group.surface, control);
        if (!byKey.has(key)) byKey.set(key, { sourceFile: group.sourceFile, surface: group.surface, control, files: [] });
        byKey.get(key).files.push(`${DIR}/${file}`);
      }
    }
  }
  return [...byKey.values()];
};

export const FIN_B17_PRACTICE_CASES = Object.freeze(
  rowsOf()
    .filter((row) => !LIVE.has(keyOf(row.sourceFile, row.surface, row.control)))
    .map((row) => {
      const tests = [...row.files, ...(CLOSER_LANE_ROWS.some((re) => re.test(row.control)) ? CLOSER_LANE_TESTS : [])];
      return Object.freeze({
        sourceFile: row.sourceFile,
        surface: row.surface,
        control: row.control,
        depth: "e2e",
        evidence: tests.join("; "),
        tests: Object.freeze(tests),
      });
    }),
);

export const FIN_B17_LIVE_PROOF_CASES = FIN_B17_LIVE_CASES;

export const FIN_B17_DISPLAY_PROOF_CASES = Object.freeze([...FIN_B17_LIVE_PROOF_CASES, ...FIN_B17_PRACTICE_CASES]);
export { FIN_B17_LANE };
