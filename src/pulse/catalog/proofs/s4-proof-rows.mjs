// The row tracker for the S4 proofs. It has no browser in it, so a unit test can use it alone.
// A test claims a row by running its assertions inside proof.check(); assertAllClaimed()
// fails the test file if a listed row never ran.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { S4_ROWS } from "./s4-rows.mjs";

// A callback with nothing in it, or nothing but comments, proves nothing.
const EMPTY_BODY = /^(?:async\s*)?(?:function\s*\w*\s*)?\(\s*\w*\s*\)\s*(?:=>\s*)?\{\s*\}$/;
const isEmptyCallback = (run) => EMPTY_BODY.test(run.toString().replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "").trim());

/**
 * The rows one test file proves, read from the row tables (s4-rows.mjs). A row cannot be
 * attached without being exercised: assertAllClaimed() names every listed row that never ran.
 */
export function proofRows(testFile) {
  const name = path.basename(testFile.startsWith("file:") ? fileURLToPath(testFile) : testFile);
  const groups = S4_ROWS[name];
  if (!groups) throw new Error(`the S4 row tables have no rows for ${name}`);
  // notAttached: exercised here, but the pulse lane still wants a saved receipt for
  // that control, so the row is deliberately not handed to the catalog.
  const controls = groups.flatMap((group) => [...group.controls, ...(group.notAttached || [])].map((control) => ({ ...group, control })));
  const claimed = new Set();
  const find = (matcher, surface = null) => {
    const hits = controls.filter((row) => (!surface || row.surface === surface)
      && (matcher instanceof RegExp ? matcher.test(row.control) : row.control === matcher));
    if (hits.length !== 1) throw new Error(`expected one listed row for ${matcher} on ${surface || "any surface"}, found ${hits.length}`);
    return hits[0];
  };
  return {
    rows: controls,
    controlsOf: (matcher) => controls.filter((row) => matcher.test(row.control)).map((row) => row.control),
    // A row is claimed only when its own assertions finish inside `run`. An empty
    // callback would claim a row without proving it, so it is refused.
    async check(matcher, run, surface = null) {
      if (typeof run !== "function" || isEmptyCallback(run)) {
        throw new Error("proof.check needs the row's own assertions in its callback, not an empty one");
      }
      const row = find(matcher, surface);
      await run(row.control);
      claimed.add(`${row.surface}\0${row.control}`);
    },
    assertAllClaimed() {
      const missing = controls.filter((row) => !claimed.has(`${row.surface}\0${row.control}`)).map((row) => row.control);
      if (missing.length) throw new Error(`listed rows never exercised:\n${missing.join("\n")}`);
    },
  };
}
