# Removed from `marketing/landing-pages/CURSOR-PROMPT.md` on 2026-10-24

Reason: S41. TEMPORARY. The fragment-repair task is done. Its output `fixes.md` was archived in A9. The live file keeps the design tokens (`public/partner/funnel.css` cites them as the canonical funnel set). Title is now "Fundhub funnel design tokens".

```
# FUNDHUB CLICKFUNNELS FRAGMENT REPAIR — CURSOR TASK

## Context

Fundhub.ai runs a 4-step ClickFunnels 2.0 funnel at apply.fundhub.ai:
`/watch` (VSL) → `/apply` (survey) → `/funding-book-call` (calendar) → `/thank-you`.

Each page is built as HTML/CSS fragments pasted into ClickFunnels **Custom JavaScript/HTML elements**, sandwiched around **native CF elements** (Survey Workflows widget on /apply, Appointments Calendar widget on /funding-book-call). The fragments cannot use `<html>`, `<head>`, `<body>`, or `<!DOCTYPE>` tags — CF injects them into its own page shell (`.c-section`, `.c-row`, `.c-column`, `[data-page-element]` wrappers).

Design tokens (canonical, do not change):
- Paper: `#FCFCFC` · Ink: `#0A0A0A` · Line: `#E4E4E7`
- Grid: 44px squares, `rgba(10,10,10,.048)` 1px lines
- Fonts: Inter (sans, h1 = 700 / -.045em / .98lh), JetBrains Mono (labels/amounts)
- Spectrum gradient: `linear-gradient(90deg,#F2A69B 0%,#F5CE8F 20%,#F2E39B 40%,#A8D8B0 60%,#A9C6E8 80%,#C4B3E5 100%)`
- CTA blue: `#188bf6`
- Content column: `max-width:900px` (recently changed from 720 — verify consistency everywhere)

Files in this folder:
- `01-vsl.html` — full VSL page fragment (single element, contains video w/ muted autoplay + tap-for-sound overlay). CURRENT/CANONICAL.
- `02b-apply-bottom-BROKEN.html` — /apply bottom fragment AS CURRENTLY LIVE, with all four Bug-1 defects intact. NOTE: its logo base64 was replaced with placeholder `LOGO_SVG_BASE64_SAME_AS_OTHER_FRAGMENTS` — copy the real base64 string from any `.logo` rule in 01-vsl.html when fixing.
- `04a-book-top.html` — book-call TOP fragment (header + hero, sits ABOVE the native Calendar element). CURRENT/CANONICAL.
- `04b-book-bottom.html` — book-call BOTTOM fragment (marquee + footer, below the Calendar element). CURRENT/CANONICAL.

NOT in this folder — export these from ClickFunnels before starting (page editor → HTML element → gear → Open Code Editor → copy all):
- `02a-apply-top.html` — /apply TOP fragment (header + "Let's See What You Qualify For" hero + "Application · Step 1 of 2" eyebrow). Same shell pattern as 04a.
- `05-thank-you.html` — /thank-you page fragment(s). Audit for the black-body rule (Bug 4).

## The Bugs (confirmed + reported)

### BUG 1 — Apply-page bottom fragment is structurally broken (CONFIRMED, root cause known)
In the `.fh-b` fragment (APPENDIX A):
1. `@keyframes fhmarq{to{transform:translateX(-50%)}` — **missing closing brace**
2. `@keyframes fhpulse{to{transform:scale(1.9);opacity:0}` — **missing closing brace**
   → these two unclosed blocks swallow all following CSS including the media query.
3. `.fh-b .marq-track{animation:none}` and `.fh-b .pulse::after{animation:none;opacity:0}` are hardcoded OUTSIDE the reduced-motion media query → marquee animation permanently dead.
4. Fragment uses `var(--line)`, `var(--mono)`, `var(--gray)`, `var(--gray2)`, `var(--ink2)`, `var(--spectrum)` but **never defines them** (they were defined on `.fh-root`, this fragment uses `.fh-b`) → borders, mono font, gradient dividers all silently fail.
Fix: close the keyframes, define the custom properties on `.fh-b`, remove the hardcoded animation:none lines (keep them only inside `@media(prefers-reduced-motion:reduce)`).

### BUG 2 — Widgets don't read as "floating cards"
The native CF Survey widget (on /apply) and Calendar widget (on /funding-book-call) sit between the top/bottom fragments. Requirement: each should render as a **floating card** — white surface, 1px `#E4E4E7` border, 12–14px radius, soft shadow (`0 18px 44px rgba(10,10,10,.10)`), constrained to the 900px column, centered — with the 44px grid paper visible around it.
Constraint: the widgets are CF-rendered DOM (NOT iframes — verify this in devtools first). Page-level CSS from the fragments CAN reach them. Find the real stable wrapper selectors by inspecting (do not guess class names — earlier attempts guessed `[class*="calendar"]` style selectors with mixed results). If CF class names are hashed/unstable, target structural selectors relative to `[data-page-element]` wrappers instead.

### BUG 3 — Grid background breaks on zoom (see user screenshots)
The 44px grid is painted via `background-image` on `html,body` in some fragments and on `.gridzone` divs in others. On browser zoom in/out the grid tears: it disappears behind widget sections, misaligns between the fragment zones, and the page reads as broken.
Root causes to investigate and fix:
- Grid painted on multiple competing layers (body AND .gridzone) that scroll/scale independently.
- Fragment roots use `width:100vw; margin-left:calc(50% - 50vw)` full-bleed hacks — at some zoom levels this produces horizontal overflow and subpixel offset, shifting the grid.
- CF's own wrappers get `background:transparent!important` from the fragments, but the native widget sections between fragments may paint their own opaque backgrounds that cover the body grid.
Fix approach (Cursor to validate): paint the grid ONCE, on a single fixed layer (either `body` with `background-attachment` handled correctly, or a single full-page `position:fixed; inset:0; z-index:-1; pointer-events:none` grid div injected from the first fragment), and make everything above it transparent except intentional white zones (marquee, footer, floating cards). Kill the 100vw negative-margin hack if it's causing overflow — prefer `width:100%` on the fragment roots with the full-bleed handled by CF's own section widths.

### BUG 4 — No black backgrounds anywhere
History: earlier fragment versions had `html,body{background:#0A0A0A!important}`. It was removed from the three files in this folder but MUST be verified absent across ALL live fragments (VSL top, Apply top, Apply bottom, Book top, Book bottom, Thank You). Any `#0A0A0A` background on html/body/section-level containers is a defect. Dark is allowed ONLY on: the video card (`--card:#111113`), and small intentional accents. The Thank You page fragments should be pulled from the live page and audited too.

### BUG 5 — Cross-page consistency
All pages must share: 900px content column, identical 44px grid, identical marquee, identical footer (white, no grid behind legal text, ghost wordmark crop), identical header logo sizing. Audit all fragments against each other and normalize.

## Deliverables

1. Fixed fragment files, same names, drop-in replacements. Keep them **fragment-safe**: no doctype/html/head/body tags, all styles scoped or intentionally global with `!important` only where CF requires it.
2. A `fixes.md` summarizing every change per file.
3. **A local test harness** (`harness/` folder):
   - One HTML shell per page that mimics the CF page structure: CF-like wrapper divs (`.c-section > .c-row > .c-column > [data-page-element]`) with the top fragment, a placeholder block simulating the native widget (a 500px-tall div with its own white background, mimicking how CF widgets paint), then the bottom fragment. This lets us reproduce the sandwich locally.
   - Serve with `npx serve` or Vite, whatever's fastest.
4. **Playwright break-testing** (`tests/` folder) — the user explicitly wants Playwright to try to BREAK the layout:
   - Viewports: 320, 375, 390, 768, 1024, 1280, 1440, 1920, 2560 wide.
   - Zoom simulation: run each viewport at deviceScaleFactor 1, 1.5, 2, and with CSS zoom / page.evaluate zoom at 50%, 80%, 100%, 125%, 150%, 200%. Screenshot each.
   - Assertions per screenshot state:
     a. `document.documentElement.scrollWidth <= window.innerWidth + 1` (no horizontal overflow).
     b. Grid layer visible: sample computed background on the grid layer, assert the background-image is present and the layer covers the viewport.
     c. No element with computed `background-color` of `rgb(10,10,10)` occupying > 20% of viewport area (catches black-band regressions) — except the video card.
     d. Marquee: assert the track element has a running animation (`getComputedStyle(...).animationName === 'fhmarq'` and `animationPlayState === 'running'`).
     e. Widget card: assert border-radius > 0, box-shadow non-none, and its bounding box width <= 940px on viewports >= 1024.
     f. Footer legal text has white (#fff/#FCFCFC) behind it, never the grid, never dark.
   - Visual regression: store baseline screenshots after the fix, fail on >0.5% pixel diff in future runs.
   - Output: `npx playwright test` green = layout holds under all zoom/viewport combos.
5. Do NOT touch: the video embed logic (muted autoplay + tap-for-sound restart works, leave it), the copy, the marquee phrase list, disclaimers, ghost-mark styling (user likes it as-is), or any URLs.

## Working method

1. Read all fragments first. Build the harness. Reproduce the grid-tear and floating-widget issues locally BEFORE changing code.
2. Fix Bug 1 (mechanical). Then Bug 3 (grid architecture) since Bug 2's floating cards depend on the grid layer being sane. Then Bug 2, 4, 5.
3. Run the Playwright suite. Iterate until green.
4. Emit fixes.md and the final fragments.

## APPENDIX A — resolved
The broken /apply bottom fragment now ships in this folder as `02b-apply-bottom-BROKEN.html`. Fix it in place per Bug 1 (close both keyframes, define the missing custom properties on `.fh-b`, remove hardcoded animation:none, restore the real logo base64 from 01-vsl.html).
```
