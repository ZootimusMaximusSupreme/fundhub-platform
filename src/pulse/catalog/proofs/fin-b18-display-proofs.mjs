// Display proof cases for batch 18 (finish the 853, tier 4, lane gap-catalog-display): the client money
// pages (Money, Transfers, Funding papers, Applications, Money helper, Next steps, Payments, Setup), the
// Ops & Admin screen, the partner Home screen and the Pipeline board.
//
// Two kinds of attachment, and each row has exactly one outcome:
//   live check      the row has a saved-result contract in fin-b18-display-contracts.mjs. Its evidence names
//                   the display lane, so the lane judges it from saved data, and it stays in the lane. A
//                   practice test that also presses the same control, and a server test that runs the read
//                   the page depends on, are listed beside the live test in its `tests`, so the screen half
//                   and the server half are run too.
//   practice test   a real page in Chromium, fake /api answers, one action, a judgement of the exact request
//                   and the words painted (the test file named beside the row in fin-b18-rows.json), plus,
//                   where the page depends on a server read, a Node test of that read
//                   (fin-b18-server-rows.json). It reads no saved data. The row leaves the lane.
//
// Left out on purpose, and still red in the lane (each has its reason in manifest-b18.md):
//   ops-admin.html "AR column header sort", "AR row expand"   the page attaches both once, then replaces the table
//   partner-galaxy.html "click a worker to open the detail panel"   no worker is drawn (NODES is empty)
//   partner-galaxy.html "click a cluster to zoom (5 static clusters ...)"   clicking Inquiry Removal where it is
//       shown zooms Sales & Funding (the sky is drawn taller than it is shown)
//   partner-galaxy.html "click empty space or press Escape to pull back; panel close button"   the close
//       button is behind a panel nobody can open

import PAGE_ROWS from "./fin-b18-rows.json" with { type: "json" };
import SERVER_ROWS from "./fin-b18-server-rows.json" with { type: "json" };
import { FIN_B18_LANE, FIN_B18_LIVE_CASES, FIN_B18_LIVE_ROWS } from "./fin-b18-display-contracts.mjs";

const DIR = "src/pulse/catalog/proofs";
const keyOf = (sourceFile, surface, control) => `${sourceFile}\0${surface}\0${control}`;
const LIVE = new Set(FIN_B18_LIVE_ROWS.map(([sourceFile, surface, control]) => keyOf(sourceFile, surface, control)));

// One entry per row. A row may be pressed by a page test (Chromium) and read by a server test (Node): both
// files are listed on the one case.
const filesByRow = () => {
  const byKey = new Map();
  for (const table of [PAGE_ROWS, SERVER_ROWS]) {
    for (const [file, groups] of Object.entries(table)) {
      for (const group of groups) {
        for (const control of group.controls) {
          const key = keyOf(group.sourceFile, group.surface, control);
          const entry = byKey.get(key) || { sourceFile: group.sourceFile, surface: group.surface, control, files: [] };
          entry.files.push(`${DIR}/${file}`);
          byKey.set(key, entry);
        }
      }
    }
  }
  return [...byKey.values()];
};

export const FIN_B18_PRACTICE_CASES = Object.freeze(
  filesByRow()
    .filter((row) => !LIVE.has(keyOf(row.sourceFile, row.surface, row.control)))
    .map((row) => Object.freeze({
      sourceFile: row.sourceFile,
      surface: row.surface,
      control: row.control,
      depth: "e2e",
      evidence: row.files.join("; "),
      tests: Object.freeze([...row.files]),
    })),
);

// A live row keeps the lane in its evidence, and also runs every test that presses or reads the same control.
export const FIN_B18_LIVE_PROOF_CASES = Object.freeze(FIN_B18_LIVE_CASES.map((live) => {
  const extra = filesByRow()
    .filter((row) => keyOf(row.sourceFile, row.surface, row.control) === keyOf(live.sourceFile, live.surface, live.control))
    .flatMap((row) => row.files);
  const tests = [...new Set([...live.tests, ...extra])];
  return Object.freeze({ ...live, evidence: [...tests, FIN_B18_LANE].join("; "), tests: Object.freeze(tests) });
}));

export const FIN_B18_DISPLAY_PROOF_CASES = Object.freeze([...FIN_B18_LIVE_PROOF_CASES, ...FIN_B18_PRACTICE_CASES]);
