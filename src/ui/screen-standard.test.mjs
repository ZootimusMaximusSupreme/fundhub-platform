// EVERY CRM SCREEN USES THE SAME FRAME. Owner rule, set 2026-08-30.
// The frame itself is written down in docs/rules/UI-STANDARDS.md §12.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS PREVENTS
//
// On 2026-08-19 two screens were reworked on the same day with OPPOSITE
// instructions, and both agents cited docs/rules/UI-STANDARDS.md as their authority.
// Neither of them was lying. The document said nothing about what a container
// looks like at rest, what a topbar has to carry, or that a font size written
// in a screen's own <style> is thrown away by the brand file. So each agent
// filled the gap with a reasonable guess, and the two guesses did not match.
//
// The root cause was never a bad screen. It was that no settled standard
// existed in writing anywhere an agent could see it. §12 writes it down. This
// file is what keeps it true, because a document nobody is forced to read
// decays back into folklore within a month.
//
// ═══════════════════════════════════════════════════════════════════════════
// THIS FILE IS EXPECTED TO FAIL WHEN IT LANDS
//
// The dead-font-size assertion below is RED on purpose, and its failure list
// is the burndown for the screens phase — one line per declaration that has to
// go. A green test here on day one would have meant it was measuring nothing.
// Do not weaken it to get a green suite; fix the screens it names.
//
// ═══════════════════════════════════════════════════════════════════════════
// HOUSE STYLE
//
// Modelled on src/ui/shell-is-fluid.test.mjs: same screen discovery, the same
// hand-written CSS walker (a regex cannot tell `@media (max-width:1000px)`, a
// CONDITION, from `.shell{max-width:1000px}`, a DECLARATION), and the same
// rule that a failure message must TEACH. Somebody trips one of these once and
// then knows the trap for the rest of the codebase.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..", "..");
const APP = path.join(ROOT, "public", "app");

const BRAND = fs.readFileSync(path.join(APP, "fundhub-brand.css"), "utf8");

/** Screens that carry the shared shell. Same discovery as shell-is-fluid. */
function shellScreens() {
  return fs.readdirSync(APP)
    .filter((f) => f.endsWith(".html"))
    .filter((f) => fs.readFileSync(path.join(APP, f), "utf8").includes("crm-sidebar.css"))
    .sort();
}

/**
 * Walk CSS and yield every { selector, body } pair at any nesting depth.
 * Anything whose selector starts with `@` is skipped and its inner rules are
 * still visited, so a declaration inside a media query is still seen.
 */
function* rules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let buf = "";
  const stack = [];
  for (const ch of clean) {
    if (ch === "{") { stack.push(buf.trim()); buf = ""; continue; }
    if (ch === "}") {
      const sel = stack.pop();
      if (sel !== undefined && !sel.startsWith("@")) yield { selector: sel, body: buf };
      buf = "";
      continue;
    }
    buf += ch;
  }
}

/** Every <style> block on a screen, comments already stripped. */
function styleBlocks(html) {
  return (html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [])
    .map((b) => b.replace(/\/\*[\s\S]*?\*\//g, ""));
}

describe("every CRM screen uses the same frame (UI-STANDARDS §12, owner-set 2026-08-30)", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // 1. THE TYPE TRAP
  // ─────────────────────────────────────────────────────────────────────────
  test("no screen writes a px font-size that the brand file will throw away", () => {
    // fundhub-brand.css:184-186 says, app-wide:
    //     :is(.app,.app-shell,.shell,.main,.fh-maxw) * { font-size:inherit !important }
    // An !important author declaration beats a normal one no matter which file
    // loads last, so a plain `font-size:12px` in a screen's own <style> NEVER
    // PAINTS. It lints clean, it reviews clean, and the browser discards it.
    const offenders = [];
    for (const file of shellScreens()) {
      const html = fs.readFileSync(path.join(APP, file), "utf8");
      for (const block of styleBlocks(html)) {
        for (const m of block.matchAll(/font-size\s*:\s*([^;}]*)/gi)) {
          const value = m[1];
          if (!/\d*\.?\d+px/.test(value)) continue;       // token or unitless — fine
          if (/!important/i.test(value)) continue;        // deliberate, and it works
          offenders.push(`${file}: font-size:${value.trim()}`);
        }
        // The `font:` shorthand sets a size too and dies the same way. This
        // scan only read the long form, so pipeline.html — this file's own
        // reference screen — shipped `font:600 11px var(--sans)` on its drawer
        // buttons and passed green (walkthrough-4 defect 21, 2026-09-06).
        for (const m of block.matchAll(/(?:^|[;{\s])font\s*:\s*([^;}]*)/gi)) {
          const value = m[1];
          if (!/\d*\.?\d+px/.test(value)) continue;
          if (/!important/i.test(value)) continue;
          offenders.push(`${file}: font:${value.trim()}`);
        }
      }
    }

    assert.deepEqual(
      offenders, [],
      "These font sizes are written but never painted — the browser throws every one of them away.\n\n" +
      "  " + offenders.join("\n  ") + "\n\n" +
      "WHY: fundhub-brand.css:184-186 sets `font-size:inherit !important` on EVERY element inside\n" +
      ".app / .app-shell / .shell / .main / .fh-maxw. An important author rule beats a normal one\n" +
      "regardless of load order, so a plain px size in a screen's <style> is dead CSS. The screen\n" +
      "renders flat at 16px body, someone reads that as a design problem, writes MORE px sizes that\n" +
      "also do nothing, and the file fills with declarations that have never once had an effect.\n\n" +
      "THE FIX, in order of preference:\n" +
      "  1. Use the whitelist. The brand file hands sizes back to real class names for free:\n" +
      "       --fs-title   20px  h1, h2\n" +
      "       --fs-metric  32px  .sv .vl .big  (+ .big-tile .val, .kpi .vl, .band .bv, .fh-num …)\n" +
      "       --fs-caption 13px  .chip .eyebrow (+ .badge .tag .caption .sub .card-title .mono, label, th …)\n" +
      "       --fs-body    16px  everything else, by inheritance\n" +
      "     A small label wants class `caption` or `eyebrow`, not a px value.\n" +
      "  2. If the screen truly has its own class names that must be captions, add them to that\n" +
      "     screen's ONE escape hatch: a single rule, with !important, with the reason written\n" +
      "     above it. Copy the shape of client-control-panel.html:100-106 or\n" +
      "     closer-dashboard.html:223-228. One rule per screen. Never two — a second one is how a\n" +
      "     screen ends up with six sizes and no hierarchy (§3).\n" +
      "  3. Delete it. Most of these are leftovers from before the brand file existed.\n\n" +
      "The same trap eats the `font:` shorthand (`font:600 11px var(--sans)`) and inline\n" +
      "style=\"font-size:12px\" in the markup. Full write-up: docs/rules/UI-STANDARDS.md §12.7."
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. THE TOPBAR CONTRACT
  // ─────────────────────────────────────────────────────────────────────────
  test("a topbar that is allowed to wrap does not hide the row it wrapped onto", () => {
    // Checked on `.topbar` as well as `header.topbar`: a <div class="topbar">
    // fails in exactly the same way, and the selector a screen happens to have
    // used is not the thing that makes it safe.
    const offenders = [];
    for (const file of shellScreens()) {
      const html = fs.readFileSync(path.join(APP, file), "utf8");
      for (const block of styleBlocks(html)) {
        for (const r of rules(block)) {
          if (!/(^|[\s,>])(header)?\.topbar\s*$/.test(r.selector.split(",")[0].trim()) &&
              !/(^|[\s,>])(header)?\.topbar\b/.test(r.selector)) continue;
          const body = r.body.replace(/\s+/g, " ");
          if (!/flex-wrap\s*:\s*wrap/.test(body)) continue;
          if (/overflow\s*:\s*hidden/.test(body)) {
            offenders.push(`${file}: ${r.selector.trim()} wraps AND clips (overflow:hidden)`);
          }
          if (/(^|[;{ ])height\s*:\s*\d/.test(body)) {
            offenders.push(`${file}: ${r.selector.trim()} wraps AND pins a px height`);
          }
        }
      }
    }

    assert.deepEqual(
      offenders, [],
      "These topbars wrap onto a second row and then throw that row away:\n\n" +
      "  " + offenders.join("\n  ") + "\n\n" +
      "WHY IT IS THE WORST KIND OF BUG: the wrap is real, the controls move down to row two, and\n" +
      "then the clip deletes them. No scrollbar, no overflow, no clue anything is missing — the\n" +
      "bar just quietly stops carrying half its buttons at some window width. partner-galaxy.html:79-85\n" +
      "is the shape not to copy: `flex-wrap:wrap` and `overflow:hidden` on the same bar.\n" +
      "A pinned `height:44px` does the same thing more slowly: the second row is painted underneath\n" +
      "a fixed-height box.\n\n" +
      "THE FIX: when wrapping is on, release the height — `min-height:44px; height:auto` — and drop\n" +
      "`overflow:hidden`. The reference is client-control-panel.html:64-84 plus its 480px block:\n" +
      "  header.topbar{height:auto;min-height:44px;flex-wrap:wrap;gap:8px}\n" +
      "  .topbar-right{width:100%;gap:8px;flex-wrap:wrap}\n" +
      "Before the bar is ever allowed to wrap, spend the room instead: `.brand{min-width:0}`, the\n" +
      "screen name truncates with an ellipsis, and the clock is the first thing to hide.\n" +
      "Full write-up: docs/rules/UI-STANDARDS.md §12.8."
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. THE RESTING CONTAINER
  // ─────────────────────────────────────────────────────────────────────────
  test("no container on the brand's shadow list drops its border", () => {
    // The list is READ from fundhub-brand.css rather than copied here, so that
    // adding a class to the shadow rule extends this guard automatically and
    // the two can never drift apart.
    const shadowRule = [...rules(BRAND)].find(
      (r) => /box-shadow\s*:\s*var\(--panel-shadow\)/.test(r.body) && r.selector.includes(".card")
    );
    assert.ok(
      shadowRule,
      "the app-wide `box-shadow:var(--panel-shadow)` rule vanished from fundhub-brand.css. " +
      "It is what gives every panel in the app one identical resting elevation — see UI-STANDARDS §12.2."
    );
    const shadowed = [...new Set(shadowRule.selector.match(/\.[a-z][a-z0-9-]*/gi) || [])]
      .filter((c) => c !== ".app" && c !== ".app-shell");
    assert.ok(shadowed.length >= 8, `expected the full shadow list, parsed only ${shadowed.length}`);

    const offenders = [];
    for (const file of shellScreens()) {
      const html = fs.readFileSync(path.join(APP, file), "utf8");
      for (const block of styleBlocks(html)) {
        for (const r of rules(block)) {
          const body = r.body.replace(/\s+/g, " ");
          if (!/(^|[;{ ])border\s*:\s*(0|none)\b/.test(body)) continue;
          // Taking the shadow off in the same rule is the ONE legal way to
          // un-panel something: no border and no shadow is a plain block.
          if (/box-shadow\s*:\s*none/.test(body)) continue;
          // A stripe on one side is still an edge — that is the status pattern
          // from §12.6, not a borderless panel.
          if (/border-(top|right|bottom|left)\s*:\s*[^;}]*\d/.test(body)) continue;
          for (const subject of r.selector.split(",").map((s) => s.trim())) {
            const last = subject.split(/[\s>+~]+/).pop() || "";
            const cls = "." + (last.replace(/^[a-z]+/i, "").split(/[.:[]/).filter(Boolean)[0] || "");
            if (shadowed.includes(cls)) {
              offenders.push(`${file}: ${subject} { border:0 } — ${cls} is on the shadow list`);
            }
          }
        }
      }
    }

    assert.deepEqual(
      offenders, [],
      "These containers keep the app-wide resting shadow and remove the border it belongs to:\n\n" +
      "  " + offenders.join("\n  ") + "\n\n" +
      "WHY: fundhub-brand.css:130-137 gives `box-shadow:var(--panel-shadow)` to " + shadowed.join(" ") + "\n" +
      "everywhere in the app. Deleting the border off one of those names does not simplify it — it\n" +
      "paints a floating shadow with no edge, a soft grey smudge around nothing. The border is what\n" +
      "the shadow is a shadow OF.\n\n" +
      "THE FIX, pick one:\n" +
      "  • Put the hairline back: `border:1px solid var(--line)`. That plus #fff plus a radius plus\n" +
      "    the token shadow IS the resting container (§12.1), and it is all of it.\n" +
      "  • Or drop both in the same rule — `border:0;box-shadow:none` — which turns the panel into a\n" +
      "    plain block. That is a real and useful thing to do. Half of it is not.\n" +
      "  • Or rename the class so it is not on the shadow list at all. A box that HOLDS boxes is not\n" +
      "    itself a panel: it takes a flat tint and a hairline, never a shadow (§12.5).\n" +
      "Never hand-roll a shadow value to replace the token — two screens with two nearly-identical\n" +
      "shadows is invisible in review and is exactly the drift §12 exists to stop."
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. THE STANDARD IS REACHABLE
  // ─────────────────────────────────────────────────────────────────────────
  test("CLAUDE.md points at UI-STANDARDS.md, so an agent can actually find it", () => {
    // This is the assertion that stops the whole thing happening a third time.
    // Until 2026-08-30 the only pointer to UI-STANDARDS.md was a Cursor rule
    // with alwaysApply:false — invisible to Claude Code, which is why two
    // agents building screens on the same day both guessed. A standard nobody
    // is told to read is not a standard.
    const claude = fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");
    assert.ok(
      claude.includes("docs/rules/UI-STANDARDS.md"),
      "CLAUDE.md no longer names docs/rules/UI-STANDARDS.md.\n\n" +
      "CLAUDE.md is the one file every agent reads before it does anything. It is the only reliable\n" +
      "route to the screen standard. Put the pointer back in §3:\n\n" +
      "  Touching anything under `public/app/`? `docs/rules/UI-STANDARDS.md` is law. Read it first.\n\n" +
      "Without that line the standard is unreachable in practice, every screen change becomes a\n" +
      "guess again, and the guesses do not agree with each other."
    );
    const standards = path.join(ROOT, "docs", "rules", "UI-STANDARDS.md");
    assert.ok(fs.existsSync(standards), "docs/rules/UI-STANDARDS.md itself is gone");
    assert.match(
      fs.readFileSync(standards, "utf8"), /##\s*12\.\s*THE SCREEN FRAME/i,
      "UI-STANDARDS.md lost §12, the section this whole test file enforces"
    );
  });

  test("every shell screen is actually covered by this guard", () => {
    const screens = shellScreens();
    assert.ok(screens.length >= 29, `expected the full set of shell screens, found ${screens.length}`);
    assert.ok(screens.includes("pipeline.html"), "pipeline.html is the §12 reference and must be in scope");
  });
});
