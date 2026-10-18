/* The phone-width sidebar. One implementation, in the shell — not 35 copies.
 *
 * WHAT THIS FILE USED TO ASSERT, AND WHY IT CHANGED. Until 2026-08-05 the phone
 * treatment was pasted into nine screens: each carried its own
 * `@media (max-width:860px)` rule for `.side`, its own `<div id="sideScrim">`,
 * and its own IIFE that forced `.mini` on a narrow load. This file checked for
 * those three things per screen, so it was pinning the duplication in place.
 *
 * None of it ran. shell.js replaces the whole `<aside>` on mount
 * (mountSidebar -> replaceChild), so every listener those scripts bound was
 * attached to an element that no longer existed a moment later. The CSS was
 * worse than inert: `.side:not(.mini)` set `z-index:500` and `width:250px`
 * against the shell's locked 400 and 228, and the forced `.mini` fought the
 * off-canvas drawer the shell now owns.
 *
 * The behaviour moved to crm-sidebar.css plus the lock stylesheet shell.js
 * injects, and the per-page copies were deleted. So the thing worth testing is
 * no longer "does each screen implement this" but its opposite: the shell
 * implements it, and no screen re-implements it.
 *
 * Read as text, same convention as app-nav-reachability.test.mjs — these are
 * static files with no server. Rendered behaviour (the drawer opens, closes on
 * scrim tap, and no screen scrolls sideways at 390px) is covered by
 * ops/workflows/mobile-check.mjs, which drives a real browser.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");

const shell = fs.readFileSync(path.join(APP, "shell.js"), "utf8");
const sidebarCss = fs.readFileSync(path.join(APP, "crm-sidebar.css"), "utf8");

describe("mobile sidebar — owned by the shell", () => {
  test("crm-sidebar.css takes the rail off-canvas below 860px", () => {
    assert.match(sidebarCss, /@media\s*\(max-width:\s*860px\)/,
      "crm-sidebar.css has no 860px breakpoint");
    assert.match(sidebarCss, /transform:\s*translateX\(-100%\)/,
      "the rail is not parked off-canvas below 860px");
    assert.match(sidebarCss, /\.side\.open\s*\{[^}]*transform:\s*translateX\(0\)/,
      "nothing brings the rail back on screen when .open is set");
  });

  test("the lock stylesheet clears the content's left padding on mobile", () => {
    /* This has to be in the lock, not crm-sidebar.css. The lock is injected at
       runtime and appended to <head>, so at equal specificity it wins on source
       order. Written in the stylesheet instead, it lost, and every screen kept
       228px of dead padding on a 390px phone. */
    const lock = shell.slice(shell.indexOf('lock.textContent'), shell.indexOf('(document.head || document.documentElement).appendChild(lock)'));
    assert.match(lock, /@media\s*\(max-width:\s*860px\)/,
      "the injected lock stylesheet has no mobile block");
    assert.match(lock, /padding-left:0!important/,
      "the lock never clears the content's left padding on mobile");
  });

  test("shell.js owns the scrim and creates it if a screen has none", () => {
    assert.match(shell, /function getScrim\(\)/, "no getScrim() in shell.js");
    assert.match(shell, /createElement\("div"\)[\s\S]{0,200}side-scrim/,
      "getScrim() never creates a scrim, so screens without one get no backdrop");
    assert.match(shell, /scrim\.addEventListener\("click"/,
      "tapping the scrim does not close the drawer");
  });

  test("shell.js provides the control that opens the drawer", () => {
    assert.match(shell, /function getMenuBtn\(\)/, "no getMenuBtn() in shell.js");
    assert.match(shell, /fh-menu-btn/, "no menu button id/class in shell.js");
    assert.match(sidebarCss, /\.fh-menu-btn/, "the menu button has no styles");
  });

  test("entering mobile strips .mini so a desktop-collapsed rail cannot carry over", () => {
    assert.match(shell, /classList\.remove\("mini"\)/,
      "shell.js never clears .mini when the viewport becomes narrow");
  });

  test("Escape closes the drawer", () => {
    assert.match(shell, /"Escape"/, "no keyboard escape from the drawer");
  });

  test("screens without a top bar get one in-flow account row", () => {
    assert.match(shell, /fh-shell-account-row/,
      "the shell has no shared account row for screens without a named header");
    assert.match(shell, /host\.insertBefore\(row,\s*host\.firstChild\)/,
      "the shared account row does not reserve space before page content");
    assert.match(shell, /row\.appendChild\(el\)[\s\S]{0,120}el\.setAttribute\("data-fh-in-header",\s*"1"\)/,
      "the shared account row does not hold the account control in normal page flow");
  });
});

describe("no screen re-implements the sidebar", () => {
  const screens = fs
    .readdirSync(APP)
    .filter((f) => f.endsWith(".html") && !f.includes(".fragment."));

  /* Each of these is a fragment of the old per-screen implementation. They are
     listed by what they were, so a failure says which corpse came back. */
  const BANNED = [
    [/\.side:not\(\.mini\)\s*\{/, "a per-page .side:not(.mini) rule — the shell's lock already sets width and z-index, and this fought it"],
    [/fh-dead-/, "a rule renamed fh-dead-* by an earlier pass — nothing selects it, delete it rather than carrying it"],
    [/id="sideScrim"/, "a hand-placed scrim element — shell.js getScrim() owns the scrim now"],
    [/getElementById\('sideScrim'\)/, "per-page scrim wiring — shell.js wires the scrim"],
    [/classList\.add\('mini'\)/, "forcing the compact rail on a narrow load — mobile is off-canvas now, and this fights it"],
  ];

  for (const screen of screens) {
    const html = fs.readFileSync(path.join(APP, screen), "utf8");
    test(`${screen}: carries no per-page sidebar implementation`, () => {
      for (const [pattern, why] of BANNED) {
        assert.ok(
          !pattern.test(html),
          `${screen} contains ${pattern} — ${why}. Sidebar behaviour belongs in ` +
            "crm-sidebar.css and shell.js; see the header of this file."
        );
      }
    });
  }
});
