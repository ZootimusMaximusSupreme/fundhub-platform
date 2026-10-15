// Display proof cases for batch 16 (finish the 853, tier 4, lane gap-catalog-display): the Marketing
// Command Center settings, shoot, Today and avatar controls, the staff reply inbox, three money pages and
// three Present deck buttons.
//
// Two kinds of attachment, and each row has exactly one outcome:
//   live check      the row has a saved-result contract in fin-b16-display-contracts.mjs. Its evidence names
//                   the display lane, so the lane judges it from saved data, and it stays in the lane. A
//                   practice test that also presses the same control is listed beside the live test in its
//                   `tests`, so the screen half is run too.
//   practice test   a real page in Chromium, fake /api answers, one action, a judgement of the exact request
//                   and the words painted (the test file named beside the row in fin-b16-rows.json). It
//                   reads no saved data. The row leaves the lane.
// The retired Decline Autopsy page row is not here: the catalog compiler marks it retired and the lane
// proves the live redirect (src/pulse/coverage/gap-catalog-display.mjs).

import ROWS from "./fin-b16-rows.json" with { type: "json" };
import { FIN_B16_LANE, FIN_B16_LIVE_CASES, FIN_B16_LIVE_ROWS } from "./fin-b16-display-contracts.mjs";

const DIR = "src/pulse/catalog/proofs";
const keyOf = (sourceFile, surface, control) => `${sourceFile}\0${surface}\0${control}`;
const LIVE = new Set(FIN_B16_LIVE_ROWS.map(([sourceFile, surface, control]) => keyOf(sourceFile, surface, control)));

// Tests that already existed in the repo and judge the same control, attached beside the batch's own.
//   compose.test.mjs   the server half of "Send this one to": a typed address is checked before anything is
//                      written, and compose.mjs holds no UPDATE of the clients table (a source scan; the
//                      statement trace is fin-b16-compose-writes.test.mjs).
const EXTRA_TESTS = new Map([
  [keyOf("desks-c.json", "messaging.html", "'Send this one to' address box (applies to this one message only; never written back to the record)"),
    ["src/messaging/compose.test.mjs"]],
]);

/** One entry per exact map row: every practice test file that lists it (a row can be pressed by several), in file order. */
const ROW_FILES = new Map();
for (const [file, groups] of Object.entries(ROWS)) {
  for (const group of groups) {
    for (const control of group.controls) {
      const key = keyOf(group.sourceFile, group.surface, control);
      if (!ROW_FILES.has(key)) ROW_FILES.set(key, { sourceFile: group.sourceFile, surface: group.surface, control, files: [] });
      ROW_FILES.get(key).files.push(`${DIR}/${file}`);
    }
  }
}
const testsOf = (key, files) => [...new Set([...files, ...(EXTRA_TESTS.get(key) || [])])];

export const FIN_B16_PRACTICE_CASES = Object.freeze(
  [...ROW_FILES.entries()]
    .filter(([key]) => !LIVE.has(key))
    .map(([key, row]) => {
      const tests = testsOf(key, row.files);
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

// A live row keeps the lane in its evidence, and also runs the practice tests that press the same control.
export const FIN_B16_LIVE_PROOF_CASES = Object.freeze(FIN_B16_LIVE_CASES.map((live) => {
  const key = keyOf(live.sourceFile, live.surface, live.control);
  const extra = ROW_FILES.has(key) ? ROW_FILES.get(key).files : [];
  const tests = [...live.tests, ...testsOf(key, extra).filter((t) => !live.tests.includes(t))];
  return Object.freeze({ ...live, evidence: [...tests, FIN_B16_LANE].join("; "), tests: Object.freeze(tests) });
}));

export const FIN_B16_DISPLAY_PROOF_CASES = Object.freeze([...FIN_B16_LIVE_PROOF_CASES, ...FIN_B16_PRACTICE_CASES]);
