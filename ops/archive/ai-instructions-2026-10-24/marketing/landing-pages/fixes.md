# ClickFunnels fragment fixes

Drop-in files live in this folder. Paste each into the matching Custom HTML/JS element in ClickFunnels.

## Per file

### `01-vsl.html`
- Page background: single fixed grid via `body::before` (paper `#FCFCFC` + 44px lines). No black `html,body`.
- Removed `100vw` / `calc(50% - 50vw)` full-bleed hacks → `width:100%`.
- `.gridzone` is layout-only (no competing grid paint).
- Ghost mark uses `%` widths instead of `vw`.
- Content column stays `900px`.
- Video muted-autoplay + tap-for-sound left unchanged.

### `02a-apply-top.html` (new drop-in; was missing from pack)
- Same fixed grid layer + transparent CF wrappers.
- Header/hero normalized to book/VSL tokens (Inter / JetBrains, logo 124×25).
- Floating-card styles for `[data-page-element="Survey/V1"]` (and `.fh-widget-slot` for harness).

### `02b-apply-bottom.html` (was `02b-apply-bottom-BROKEN.html`)
- **Bug 1:** closed `@keyframes fhmarq` and `@keyframes fhpulse`.
- Defined CSS custom properties on `.fh-b` (`--line`, `--mono`, `--gray`, `--gray2`, `--ink2`, `--spectrum`, …).
- Removed hardcoded `.marq-track{animation:none}` / `.pulse::after{animation:none}` outside `prefers-reduced-motion`.
- Restored real logo base64 from VSL.
- Column `900px` (was 720). No `100vw` hacks.

### `04a-book-top.html`
- Body grid moved to `body::before` only (no `background-image` on `html,body` competing with fragments).
- No `100vw` hacks; `900px` column kept.
- Floating-card styles for `[data-page-element="AppointmentScheduler/V1"]` (live CF selector).

### `04b-book-bottom.html`
- Aligns with apply bottom: shared tokens, closed keyframes, white footer, no page-level black, no `100vw`.
- Does not re-paint the grid (top owns `body::before`).

### `05-thank-you.html` (from live scrape)
- **Bug 4:** removed `html,body{background:#0A0A0A!important}` → paper grid via `body::before`.
- Column `720` → `900`.
- Same marquee/footer/header norms as other pages.

## Architecture notes

1. **One grid.** `body::before { position:fixed; inset:0; z-index:-1 }` — survives zoom and sandwich gaps.
2. **Widgets.** Stable CF attributes: `Survey/V1`, `AppointmentScheduler/V1`. Card: white, `#E4E4E7` border, 14px radius, `0 18px 44px rgba(10,10,10,.10)`, max 900px.
3. **Originals** kept under `originals/` for diff.

## Harness / tests

```bash
cd clickfunnels-fragments
npm install
npx playwright install chromium
npm test
```

- `harness/` — CF-like shells (`watch`, `apply`, `book`, `thank-you`). Local server: `npm run serve` → http://127.0.0.1:4177
- `tests/layout.spec.mjs` — 648 viewport×DPR×zoom break cases + 6 visual baselines (654 total).
- CF transparent reset uses `:not(Survey/V1):not(AppointmentScheduler/V1)` so bottom fragments don’t wipe floating-card styles.
