// Batch 17: the browser half of the practice tests. One Chromium and one static server for a whole test
// file (opened in before(), closed in after()), fake /api answers, and a dialog recorder.
//
// The browser, the static server and the fake /api wiring are the S4 harness (s4-screen-harness.mjs).
// Nothing here reaches a real database, a vendor or the network: every request that is not the local
// page is refused, and every /api call is answered by the test.

import { after, before } from "node:test";

import { OWNER, bodyOf, json, startScreens } from "./s4-screen-harness.mjs";

export { OWNER, bodyOf, json };

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

/** The session the page's own /api/auth/session read gets back, for a staff role. */
export const asRole = (role) => ({ ok: true, staff: { ...OWNER.staff, role } });

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

/** A fixed day for pages that read the clock: the page's own `new Date()` and `Date.now()`. */
export const frozenClock = (iso) => `{
  const fixed = new Date(${JSON.stringify(iso)}).valueOf();
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
    static now() { return fixed; }
  }
  Date = FrozenDate;
}`;
