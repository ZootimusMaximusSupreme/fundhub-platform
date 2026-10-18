// Display proof cases for batch 10 (finish the 853, tier 4, lane gap-catalog-display).
//
// Two kinds of attachment, and each row has exactly one:
//   live check      the row has a contract in fin-b10-display-contracts.mjs: a saved-result SQL contract (five)
//                   or a link-gate contract (two). Its evidence names the display lane, so the lane judges it
//                   from the live system and it stays in the lane. Its test list names the test that holds the
//                   contract AND the row's browser practice test (the page, pressed in Chromium), so the
//                   catalog runs both and neither is hidden behind the other.
//   practice test   a real page in Chromium, fake /api answers, one action, a judgement of the exact request and
//                   the words painted (the test file named beside the row in fin-b10-rows.json). It reads no
//                   saved data. The row leaves the lane.
// Every batch row now belongs to one of those two lists.

import ROWS from "./fin-b10-rows.json" with { type: "json" };
import { FIN_B10_LANE, FIN_B10_LIVE_CASES, FIN_B10_LIVE_ROWS, FIN_B10_RESULT_CONTRACTS } from "./fin-b10-display-contracts.mjs";

const DIR = "src/pulse/catalog/proofs";
const keyOf = (sourceFile, surface, control) => `${sourceFile}\0${surface}\0${control}`;
const LIVE = new Set(FIN_B10_LIVE_ROWS.map(([sourceFile, surface, control]) => keyOf(sourceFile, surface, control)));

// The browser test file each attached row is pressed in, from the row table.
const BROWSER_TEST = new Map(Object.entries(ROWS).flatMap(([file, groups]) => groups.flatMap((group) => group.controls
  .map((control) => [keyOf(group.sourceFile, group.surface, control), `${DIR}/${file}`]))));

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

// Extra tests a live row carries beyond its contract test and its browser test. The client picker's live
// check re-derives the door's rule from the clients table, so the door itself is held to the same rule.
const PICKER = FIN_B10_RESULT_CONTRACTS.find((c) => c.control.startsWith("Client picker select"));
const EXTRA_TESTS = new Map([
  [keyOf("desks-a.json", "client-control-panel.html", PICKER.control), [`${DIR}/fin-b10-clients-handler.test.mjs`]],
]);

// A live row keeps its lane evidence and its contract test, and gains the browser test of the same row (and
// any extra test named above).
export const FIN_B10_LIVE_PROOF_CASES = Object.freeze(FIN_B10_LIVE_CASES.map((live) => {
  const key = keyOf(live.sourceFile, live.surface, live.control);
  const browser = BROWSER_TEST.get(key);
  if (!browser) throw new Error(`no browser test is listed for the live row ${live.surface} / ${live.control}`);
  const tests = [...new Set([...live.tests, browser, ...(EXTRA_TESTS.get(key) || [])])];
  return Object.freeze({ ...live, evidence: `${tests.join("; ")}; ${FIN_B10_LANE}`, tests: Object.freeze(tests) });
}));

export const FIN_B10_DISPLAY_PROOF_CASES = Object.freeze([...FIN_B10_LIVE_PROOF_CASES, ...FIN_B10_PRACTICE_CASES]);
