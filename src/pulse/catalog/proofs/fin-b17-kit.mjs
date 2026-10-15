// Batch 17 (finish the 853, tier 4, lane gap-catalog-display): the row tracker for the batch's practice
// tests. It has no browser in it, so the Present deck test (which runs present.js in a vm) can use it alone.
//
// A practice test is the real page script, fake answers, one action, and a judgement of the exact request
// the page sends and the words or links it paints. It reads no live data. A listed row cannot be attached
// without being exercised: check() claims a row only when the assertions in its own callback finish, and
// assertAllClaimed() names every listed row that never ran.

import path from "node:path";
import { fileURLToPath } from "node:url";

import ROWS from "./fin-b17-rows.json" with { type: "json" };

export const FIN_B17_ROWS = Object.freeze(ROWS);

// A callback with nothing in it, or nothing but comments, proves nothing.
const EMPTY_BODY = /^(?:async\s*)?(?:function\s*\w*\s*)?\(\s*\w*\s*\)\s*(?:=>\s*)?\{\s*\}$/;
const isEmptyCallback = (run) => EMPTY_BODY.test(run.toString().replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "").trim());

/** The rows one test file proves, read from fin-b17-rows.json. */
export function proofRows(testFile) {
  const name = path.basename(testFile.startsWith("file:") ? fileURLToPath(testFile) : testFile);
  const groups = FIN_B17_ROWS[name];
  if (!groups) throw new Error(`fin-b17-rows.json has no rows for ${name}`);
  const controls = groups.flatMap((group) => group.controls.map((control) => ({ ...group, control })));
  const claimed = new Set();
  const find = (matcher, surface = null) => {
    const hits = controls.filter((row) => (!surface || row.surface === surface)
      && (matcher instanceof RegExp ? matcher.test(row.control) : row.control === matcher));
    if (hits.length !== 1) throw new Error(`expected one listed row for ${matcher} on ${surface || "any surface"}, found ${hits.length}`);
    return hits[0];
  };
  return {
    rows: controls,
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

/** Poll until the predicate is true. Fails with the label so a red run says what never happened. */
export async function waitFor(predicate, label = "condition", ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}
