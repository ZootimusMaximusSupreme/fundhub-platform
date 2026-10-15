// Batch 19 (finish the 853, tier 4, lane gap-catalog-display) practice tests: the row tracker and a few
// small browser helpers. Practice test means: a real page in Chromium, fake /api answers, a click, and a
// judgement of the exact request the page sends and the words the page paints. It reads no live data.
//
// The static server, the browser and the fake staff session are the S5 browser kit (s5-browser-kit.mjs).
// This file only adds the batch's own row table and the "claim a row inside the callback that asserts it"
// tracker, so a listed row cannot be attached without being exercised.

import { after, before } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { newStaffPage, openLab, waitForShell, fulfillJson } from "./s5-browser-kit.mjs";
import "./s4-browser-slots.mjs";
import ROWS from "./fin-b19-rows.json" with { type: "json" };

export { newStaffPage, waitForShell, fulfillJson };
export const FIN_B19_ROWS = Object.freeze(ROWS);

// A callback with nothing in it, or nothing but comments, proves nothing.
const EMPTY_BODY = /^(?:async\s*)?(?:function\s*\w*\s*)?\(\s*\w*\s*\)\s*(?:=>\s*)?\{\s*\}$/;
const isEmptyCallback = (run) => EMPTY_BODY.test(run.toString().replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "").trim());

/**
 * The rows one test file proves, read from fin-b19-rows.json. check() claims a row only when the
 * assertions in its own callback finish. assertAllClaimed() names every listed row that never ran.
 * A control under "notAttached" is also exercised, but its row words name something the product does not
 * do (or no person can reach), so it is not handed to the catalog and stays reported as not proved.
 */
export function proofRows(testFile) {
  const name = path.basename(testFile.startsWith("file:") ? fileURLToPath(testFile) : testFile);
  const groups = ROWS[name];
  if (!groups) throw new Error(`fin-b19-rows.json has no rows for ${name}`);
  const controls = groups.flatMap((group) => [...group.controls, ...(group.notAttached || [])]
    .map((control) => ({ ...group, control })));
  const claimed = new Set();
  const find = (matcher) => {
    const hits = controls.filter((row) => (matcher instanceof RegExp ? matcher.test(row.control) : row.control === matcher));
    if (hits.length !== 1) throw new Error(`expected one listed row for ${matcher}, found ${hits.length}`);
    return hits[0];
  };
  return {
    rows: controls,
    async check(matcher, run) {
      if (typeof run !== "function" || isEmptyCallback(run)) {
        throw new Error("proof.check needs the row's own assertions in its callback, not an empty one");
      }
      const row = find(matcher);
      await run(row.control);
      claimed.add(`${row.surface}\0${row.control}`);
    },
    assertAllClaimed() {
      const missing = controls.filter((row) => !claimed.has(`${row.surface}\0${row.control}`)).map((row) => row.control);
      if (missing.length) throw new Error(`listed rows never exercised:\n${missing.join("\n")}`);
    },
  };
}

/** One server and one Chromium for a whole test file (opened in before(), closed in after()). */
export function sharedLab() {
  const state = { lab: null };
  before(async () => { state.lab = await openLab(); });
  after(async () => { if (state.lab) await state.lab.close(); });
  return {
    get origin() { return state.lab.origin; },
    // A signed-in page. api(request, url) answers /api calls; see newStaffPage.
    page: (options) => newStaffPage(state.lab, options),
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
