# ClickFunnels fragment polish V2

Drop-ins live in this folder. Paste into the matching Custom HTML/JS elements. Do not commit until Chris asks.

**Baseline:** LIVE fragments scraped 2026-08-11 from `apply.fundhub.ai` (four-container reset, flatten, `--cal-zoom:.8`, `.fh-a`/`.fh-b` on apply, `.fh-root` on book). V2 adds widget chrome polish on top.

## Live DOM selectors actually found

### Book — `AppointmentScheduler/V1`

| UI | Selector |
|----|----------|
| Confirm | `button.cf2__confirm-button` / `button.DTP__confirm-button` (not a div) |
| Book Appointment | `a.elButton` inside `.buttonRow` / `.elBTN` |
| Details sidebar | outer column `[class*="sm:w-1/3"]` with `bg-gray-50` (Funding Strategy Meeting / Chris / 30 min / Google Meet) |
| + Add Guest | `.add-guest` / `a.add-link` inside `.add-links` |
| + Add Additional Info | `.add-comments` / `a.add-link` |
| Time slots | `button.cf2__time-slot` / `button.DTP__time-slot` (in `li.cf2__slot-list--item`) |
| Icons | `i.fa-solid`, `i.fas`, `i[class*="fa-"]` — Font Awesome 6 Pro / 5 Free |
| Today marker | **no dedicated today class** — available/selected/focused only (`cf2__calendar-grid--focused`) |
| Flatten (keep) | `[data-page-element="AppointmentScheduler/V1"] div{background-color:transparent!important}` |

### Apply — `Survey/V1`

| UI | Selector |
|----|----------|
| Progress | `.elProgressBar` / `.progress` / `.progress-bar` (`ProgressBar/V1`) |
| Inputs | `input.elInput.elSurveyContactInput` |
| Radio options | `.elRadioWrapper` / `input.elRadioInput` / `.elRadioText` |
| Selected | `.elRadioWrapper:has(input:checked)` (live already painted `#188bf6`) |
| Next | `a.elButton` in `.elSurveyButtonNext` |

### Grey boxes below footer on `/apply` (mobile)

**Not present on live `/apply` at 375px (2026-08-11).** Page ends at `.fh-b` footer + ghost mark. No empty `Image/V1` / `Spacer/V1` / extra `SectionContainer/V1` below the bottom Custom HTML.

If Chris still sees two grey boxes in the **ClickFunnels editor preview**, delete empty elements below the bottom Custom HTML (`CustomHtmlJs/V1` class `id-6Z-4Lr4ed-877`). Do not CSS-hide blind.

## Per file

### `04a-book-top.html`
- Synced from LIVE (four-container reset, flatten, `--cal-zoom:.8` + `zoom` on child).
- **Confirm:** `#188bf6` bg, white text, 9px radius (targets real `button.cf2__confirm-button` — flatten only hits `div`).
- **Inter** on scheduler; Font Awesome restored on `i.fa-solid` / `i.fas` / `i[class*="fa-"]`.
- **HIDE** details sidebar (`[class*="sm:w-1/3"]`); expand calendar column.
- **HIDE** `.add-guest` / `.add-comments` / `.add-links`.
- Slot buttons: white + `#E4E4E7` border; hover `#F4F4F5`; selected blue; min-height 44px; list bullets removed.
- `@media (max-width:640px){ --cal-zoom:1 }` for usable taps.
- Cheap “today” underline via `--focused` day button (no real today class in DOM).
- Collision: top does **not** set `.fh-root{overflow-x:hidden}` (body overflow-x only) so bottom `100vw` marquee/footer is not clipped by fragment root.

### `04b-book-bottom.html`
- Synced from LIVE (keeps full-bleed `100vw` marquee/footer + approved ghost `vw` crop).
- No scheduler polish here (top owns page-global scheduler CSS). Card rules remain for sandwich resilience.

### `02a-apply-top.html`
- Synced from LIVE; keeps `.fh-a`.
- **No flatten** on Survey.
- Progress bar forced visible; bar fill `#188bf6`.
- Inputs / labels Inter.
- Radio hover `#F4F4F5`; selected `#188bf6` + white text.
- Next button CTA blue.

### `02b-apply-bottom.html`
- Synced from LIVE; keeps `.fh-b` + full-bleed white bands.

### Unchanged this pass
- `01-vsl.html`, `05-thank-you.html` (out of V2 widget scope).
- Task 6 add-to-calendar: **parked**.

## Harness / tests

```bash
cd clickfunnels-fragments
npm test
# 658 passed (2026-08-11)
```

- Real-DOM shells: `harness/widgets/scheduler-shell.html`, `harness/widgets/survey-shell.html`
- Grid A/B pages: `harness/grid-a-fixed.html`, `harness/grid-b-absolute.html`
- Artifacts: `tests/artifacts-v2/`

### Grid A/B paths (Chris picks — do not auto-choose)

| | Path |
|---|------|
| A fixed | `clickfunnels-fragments/tests/artifacts-v2/grid-a-fixed-1280.png` |
| B absolute + min-height 100% | `clickfunnels-fragments/tests/artifacts-v2/grid-b-absolute-1280.png` |
| B @ 150% zoom (tear check) | `clickfunnels-fragments/tests/artifacts-v2/grid-b-absolute-1280-zoom150.png` |

### Before / after

| | Live before | Harness after |
|---|-------------|---------------|
| Book 375 | `tests/artifacts-v2/book-live-before-375.png` | `tests/artifacts-v2/book-after-375.png` |
| Book 1440 | `tests/artifacts-v2/book-live-before-1440.png` | `tests/artifacts-v2/book-after-1440.png` |
| Apply 375 | `tests/artifacts-v2/apply-live-before-375.png` | `tests/artifacts-v2/apply-after-375.png` |
| Apply 1440 | `tests/artifacts-v2/apply-live-before-1440.png` | `tests/artifacts-v2/apply-after-1440.png` |

Also: `book-scheduler-320.png` (Confirm blue, sidebar hidden, slots usable).

Visual baselines updated; fail threshold `maxDiffPixelRatio: 0.005` (0.5%).
