// Batch 12 (finish the 853) practice-test kit: the row tracker.
// A practice test means: a real page in Chromium, fake /api answers, one click, and a judgement of the
// exact request the page sends and the words the page paints. It reads no live data.
//
// The browser, the static server and the fake /api wiring are the S4 harness (s4-screen-harness.mjs).
// This file only adds the batch's own row table (fin-b12-rows.json) and the "claim a row inside the
// callback that asserts it" tracker, so a listed row cannot be attached without being exercised.

import path from "node:path";
import { fileURLToPath } from "node:url";

import ROWS from "./fin-b12-rows.json" with { type: "json" };

export const FIN_B12_ROWS = Object.freeze(ROWS);

// A callback with nothing in it, or nothing but comments, proves nothing.
const EMPTY_BODY = /^(?:async\s*)?(?:function\s*\w*\s*)?\(\s*\w*\s*\)\s*(?:=>\s*)?\{\s*\}$/;
const isEmptyCallback = (run) => EMPTY_BODY.test(run.toString().replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "").trim());

/**
 * The rows one test file proves, read from fin-b12-rows.json. check() claims a row only when the
 * assertions in its own callback finish. assertAllClaimed() names every listed row that never ran.
 */
export function proofRows(testFile) {
  const name = path.basename(testFile.startsWith("file:") ? fileURLToPath(testFile) : testFile);
  const groups = FIN_B12_ROWS[name];
  if (!groups) throw new Error(`fin-b12-rows.json has no rows for ${name}`);
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
