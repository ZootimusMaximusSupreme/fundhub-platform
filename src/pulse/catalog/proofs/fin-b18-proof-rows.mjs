// Finish-853 batch 18: the row tracker for the batch's tests. It loads no browser (the kit that starts
// Chromium is fin-b18-kit.mjs), so a test that reads no page can claim its rows through it too.
//
// A test file lists the map rows it presses in one of two tables:
//   fin-b18-rows.json          the practice tests that open a real page in Chromium
//   fin-b18-server-rows.json   the tests that run the server's own read (or the page's own script) in Node
// A row may be listed by more than one file: the page half and the server half of one control.

import path from "node:path";
import { fileURLToPath } from "node:url";

import PAGE_ROWS from "./fin-b18-rows.json" with { type: "json" };
import SERVER_ROWS from "./fin-b18-server-rows.json" with { type: "json" };

export const FIN_B18_ROWS = Object.freeze({ ...PAGE_ROWS, ...SERVER_ROWS });

// A callback with nothing in it, or nothing but comments, proves nothing.
const EMPTY_BODY = /^(?:async\s*)?(?:function\s*\w*\s*)?\(\s*\w*\s*\)\s*(?:=>\s*)?\{\s*\}$/;
const isEmptyCallback = (run) => EMPTY_BODY.test(run.toString().replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "").trim());

/**
 * The rows one test file proves, read from the row tables. check() claims a row only when the
 * assertions in its own callback finish. assertAllClaimed() names every listed row that never ran.
 */
export function proofRows(testFile) {
  const name = path.basename(testFile.startsWith("file:") ? fileURLToPath(testFile) : testFile);
  const groups = FIN_B18_ROWS[name];
  if (!groups) throw new Error(`the batch 18 row tables have no rows for ${name}`);
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
