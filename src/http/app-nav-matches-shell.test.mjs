/* Every screen's inline sidebar must be identical to shell.js's SIDEBAR_HTML.
 *
 * THE DEFECT THIS FILE EXISTS FOR. The sidebar is written twice: once inline in
 * each of the 35 gated screens, and once as SIDEBAR_HTML inside shell.js.
 * mountSidebar() replaces the inline copy with the shell's on every load —
 * unconditionally, see the replaceChild call.
 *
 * Every inline copy was missing exactly one row: its own screen's link. So each
 * page painted a 32-row sidebar, then shell.js swapped in the 33-row one, and
 * every row below the current tab jumped down about 30px after load. Walk
 * between tabs and the navigation visibly resettles each time.
 *
 * app-nav-reachability.test.mjs already checks the sidebars are consistent, but
 * it compares the screens to EACH OTHER. All 35 were wrong in the same way, so
 * that rule was satisfied and the defect shipped. The missing comparison is
 * against the copy that actually renders — shell.js. That is this file.
 *
 * Read as text rather than executed: shell.js is an IIFE that redirects on load
 * and exports nothing, the same reason app-nav-reachability.test.mjs reads it
 * as source.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");

/* Screens with no inline sidebar at all, and why:
   index.html           — a 22-line forwarder, shell.js sends each role to its home
   client-portal        — client-facing, deliberately carries no staff navigation
   present.html         — fullscreen closer deck; opened from Closer Dashboard, no shell.js
   closer-call.html     — backward-compatible redirect to Closer Dashboard
   payment-success.html — public post-payment thank-you; no CRM shell, no staff nav
   soft-pull-approve.html — public signed-link consent page; no CRM shell, no staff nav
   money.html           — the client's Finance OS page; client-facing like client-portal,
                          no shell.js, no staff navigation (finance spec §8 step 4)
   money-accounts.html  — the client's Finance OS Accounts page; same as money.html
   teleprompter.html    — full-screen reading stage for Shoot Day (spec §8.1: "Add the
                          page to NO_SIDEBAR"); no shell.js, links back to the Command Center
   *.fragment.html      — a fragment, not a screen */
const NO_SIDEBAR = new Set([
  "index.html",
  "client-portal.html",
  "closer-call.html",
  "present.html",
  "payment-success.html",
  "soft-pull-approve.html",
  "money.html",
  "money-accounts.html",
  "teleprompter.html"
]);

function navHrefs(html) {
  return [...html.matchAll(/class="navitem[^"]*"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
}

function canonicalSidebar() {
  const src = fs.readFileSync(path.join(APP, "shell.js"), "utf8");
  const m = src.match(/var SIDEBAR_HTML = "((?:[^"\\]|\\.)*)"/);
  assert.ok(m, "shell.js no longer declares SIDEBAR_HTML as a double-quoted string literal");
  return JSON.parse('"' + m[1] + '"');
}

function inlineSidebar(html) {
  const m = html.match(/<aside[^>]*class="[^"]*\bside\b[^"]*"[^>]*>[\s\S]*?<\/aside>/);
  return m ? m[0] : null;
}

describe("inline sidebars match shell.js", () => {
  const canonical = canonicalSidebar();
  const want = navHrefs(canonical);

  test("shell.js's SIDEBAR_HTML actually carries a nav", () => {
    assert.ok(want.length > 10, `SIDEBAR_HTML parsed to only ${want.length} rows — the regex above is probably wrong`);
  });

  const screens = fs
    .readdirSync(APP)
    .filter((f) => f.endsWith(".html") && !f.includes(".fragment.") && !NO_SIDEBAR.has(f));

  for (const screen of screens) {
    const html = fs.readFileSync(path.join(APP, screen), "utf8");

    test(`${screen}: inline sidebar carries the same rows, in the same order, as shell.js`, () => {
      const aside = inlineSidebar(html);
      assert.ok(aside, `${screen} has no <aside class="side"> for shell.js to replace — mountSidebar bails and the screen renders with no navigation`);

      const got = navHrefs(aside);
      const missing = want.filter((h) => !got.includes(h));
      const extra = got.filter((h) => !want.includes(h));

      assert.deepStrictEqual(
        got,
        want,
        `${screen}'s inline sidebar differs from shell.js's SIDEBAR_HTML.` +
          (missing.length ? ` Missing: ${missing.join(", ")}.` : "") +
          (extra.length ? ` Unexpected: ${extra.join(", ")}.` : "") +
          ` Rows inline: ${got.length}, rows in shell.js: ${want.length}.` +
          " shell.js replaces this markup on load, so any difference is a visible jump" +
          " the moment the page finishes loading. Copy SIDEBAR_HTML verbatim."
      );
    });
  }
});
