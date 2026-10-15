// Batch 09 (finish the 853) practice tests: the row tracker and a few small browser helpers.
// Practice test means: a real page in Chromium, fake /api answers, one click, and a judgement of the
// exact request the page sends and the words the page paints. It reads no live data.
//
// The browser, the static server and the fake /api wiring are the S4 harness (s4-screen-harness.mjs).
// This file only adds the batch's own row table and the "claim a row inside the callback that asserts it"
// tracker, so a listed row cannot be attached without being exercised.

import { after, before } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bodyOf, json, OWNER, startScreens } from "./s4-screen-harness.mjs";
import ROWS from "./fin-b09-rows.json" with { type: "json" };

export { bodyOf, json, OWNER };
export const FIN_B09_ROWS = Object.freeze(ROWS);

// A callback with nothing in it, or nothing but comments, proves nothing.
const EMPTY_BODY = /^(?:async\s*)?(?:function\s*\w*\s*)?\(\s*\w*\s*\)\s*(?:=>\s*)?\{\s*\}$/;
const isEmptyCallback = (run) => EMPTY_BODY.test(run.toString().replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "").trim());

/**
 * The rows one test file proves, read from fin-b09-rows.json. check() claims a row only when the
 * assertions in its own callback finish. assertAllClaimed() names every listed row that never ran.
 */
export function proofRows(testFile) {
  const name = path.basename(testFile.startsWith("file:") ? fileURLToPath(testFile) : testFile);
  const groups = FIN_B09_ROWS[name];
  if (!groups) throw new Error(`fin-b09-rows.json has no rows for ${name}`);
  // notAttached: exercised here, but the row's own words name something the product does not do, so
  // the row is deliberately not handed to the catalog (it stays reported as not proved).
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

/**
 * One Chromium and one static server for a whole test file (opened in before(), closed in after()).
 * open(pathName, { session, handlers, viewport, init, clock, before }) -> { page, errors }.
 */
export function sharedScreens() {
  const cleanups = [];
  let screens = null;
  before(async () => {
    screens = await startScreens({ after: (fn) => cleanups.push(fn) });
  });
  after(async () => {
    for (const fn of cleanups.reverse()) await fn();
  });
  return { open: (...args) => screens.open(...args) };
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

/**
 * Answer the page's window.confirm / prompt / alert from a queue. Each answer is a string (accept, and
 * that text for a prompt), true (accept), or false (dismiss). Every dialog the page raises is logged
 * with its kind and words, in order. A dialog with nothing queued is dismissed and logged as such.
 */
export function dialogs(page) {
  const seen = [];
  const answers = [];
  page.on("dialog", async (dialog) => {
    seen.push({ type: dialog.type(), message: dialog.message() });
    const answer = answers.length ? answers.shift() : false;
    if (answer === false) await dialog.dismiss();
    else await dialog.accept(typeof answer === "string" ? answer : undefined);
  });
  return { seen, next: (...list) => answers.push(...list) };
}
