// Finish-853 batch 18 (tier 4, lane gap-catalog-display): the row tracker and a few small browser helpers
// for the batch's practice tests. A practice test is a real page in Chromium, fake /api answers, one action,
// and a judgement of the exact request the page sends and the words or links it paints. It reads no live
// data.
//
// The browser, the static server and the fake /api wiring are the S4 harness (s4-screen-harness.mjs).
// The row tracker ("claim a row inside the callback that asserts it") lives in fin-b18-proof-rows.mjs, which
// loads no browser, so a test that needs no browser can use it too.

import { after, before } from "node:test";

import { bodyOf, json, OWNER, startScreens } from "./s4-screen-harness.mjs";
import { FIN_B18_ROWS, proofRows } from "./fin-b18-proof-rows.mjs";

export { bodyOf, json, OWNER, FIN_B18_ROWS, proofRows };

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
  return { open: (...args) => screens.open(...args), origin: () => screens.origin };
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
 * A fake GET that fails (500, query_failed) until state.ok is set, then answers `body`.
 * Every read is logged on state.reads as its query string, in order.
 */
export function flaky(body) {
  const state = { ok: false, reads: [] };
  const handler = async (route, { url }) => {
    state.reads.push(new URL(url).search);
    if (!state.ok) return json(route, { ok: false, error: "query_failed" }, 500);
    return json(route, body);
  };
  return { state, handler };
}

/** The money nav on a page: every link's words, address and current-page marker. */
export const navOf = (page) => page.evaluate(() => [...document.querySelectorAll(".mnav a")].map((a) => ({
  label: a.textContent.trim(), href: a.getAttribute("href"), current: a.getAttribute("aria-current"),
})));

/** The header back link: its words and address. */
export const backOf = (page) => page.evaluate(() => {
  const a = document.getElementById("money-back");
  return [a && a.textContent.trim(), a && a.getAttribute("href")];
});
