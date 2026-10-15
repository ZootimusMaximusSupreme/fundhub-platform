// Display proof cases for batch 18 (finish the 853, tier 4, lane gap-catalog-display): the client money
// pages (Money, Transfers, Funding papers, Applications, Money helper, Next steps, Payments, Setup), the
// Ops & Admin screen, the partner Home screen and the Pipeline board.
//
// Two kinds of attachment, and each row has exactly one outcome:
//   live check      the row has a saved-result contract in fin-b18-display-contracts.mjs. Its evidence names
//                   the display lane, so the lane judges it from saved data, and it stays in the lane. A
//                   practice test that also presses the same control is listed beside the live test in its
//                   `tests`, so the screen half is run too.
//   practice test   a real page in Chromium, fake /api answers, one action, a judgement of the exact request
//                   and the words painted (the test file named beside the row in fin-b18-rows.json). It
//                   reads no saved data. The row leaves the lane.
//
// Left out on purpose, and still red in the lane (each has its reason in manifest-b18.md):
//   ops-admin.html "AR column header sort", "AR row expand"   the page attaches both once, then replaces the table
//   partner-galaxy.html "click a worker to open the detail panel"   no worker is drawn (NODES is empty)

import ROWS from "./fin-b18-rows.json" with { type: "json" };
import { FIN_B18_LANE, FIN_B18_LIVE_CASES, FIN_B18_LIVE_ROWS } from "./fin-b18-display-contracts.mjs";

const DIR = "src/pulse/catalog/proofs";
const keyOf = (sourceFile, surface, control) => `${sourceFile}\0${surface}\0${control}`;
const LIVE = new Set(FIN_B18_LIVE_ROWS.map(([sourceFile, surface, control]) => keyOf(sourceFile, surface, control)));

const rowsOf = () => Object.entries(ROWS).flatMap(([file, groups]) => groups.flatMap((group) => group.controls.map((control) => ({
  file: `${DIR}/${file}`, sourceFile: group.sourceFile, surface: group.surface, control,
}))));

export const FIN_B18_PRACTICE_CASES = Object.freeze(
  rowsOf()
    .filter((row) => !LIVE.has(keyOf(row.sourceFile, row.surface, row.control)))
    .map((row) => Object.freeze({
      sourceFile: row.sourceFile,
      surface: row.surface,
      control: row.control,
      depth: "e2e",
      evidence: row.file,
      tests: Object.freeze([row.file]),
    })),
);

// A live row keeps the lane in its evidence, and also runs the practice test that presses the same control.
export const FIN_B18_LIVE_PROOF_CASES = Object.freeze(FIN_B18_LIVE_CASES.map((live) => {
  const extra = rowsOf()
    .filter((row) => keyOf(row.sourceFile, row.surface, row.control) === keyOf(live.sourceFile, live.surface, live.control))
    .map((row) => row.file);
  const tests = [...live.tests, ...extra];
  return Object.freeze({ ...live, evidence: [...tests, FIN_B18_LANE].join("; "), tests: Object.freeze(tests) });
}));

export const FIN_B18_DISPLAY_PROOF_CASES = Object.freeze([...FIN_B18_LIVE_PROOF_CASES, ...FIN_B18_PRACTICE_CASES]);
