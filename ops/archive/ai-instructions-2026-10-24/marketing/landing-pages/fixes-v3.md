# Fundhub funnel fragments — fixes V3

**Date:** 2026-08-11  
**Baseline:** V2 drop-ins live on `apply.fundhub.ai` (`fundhub-funnel-dropins-v2.zip`)  
**Do not touch (kept):** flatten rule, card shell, `--cal-zoom`, hidden sidebar, hidden add-links, slot buttons, marquee, footer, ghost mark, FAQ copy, disclaimers, `/watch`

## Live-DOM selectors found (booking form step)

| What | Real selector |
|------|----------------|
| Form shell | `#formContainer.flex` (starts as `.flex.hidden`, shown after Confirm) |
| Dead left rail | `#formContainer > .flex-grow` (empty spacer) |
| Field column | `#formContainer [class~="w-4/5"]` / `.space-y-4.w-4/5` |
| Labels | `#formContainer label.ml-0` (Phone Number / Name / Email) |
| Phone | `input.appointment_schedule_request_field.iti__tel-input[name="phone_number"]` |
| Name / Email | `input.appointment_schedule_request_field[name="name"\|email"]` |
| Flag dropdown | `.iti__selected-country` + `.iti__dropdown-content` (intl-tel-input) |
| Slot Confirm | `button.cf2__confirm-button.DTP__confirm-button` (appears after picking a time) |
| Book submit | `a.elButton` (“Book Appointment”) |
| Slot ISO start/end/tz | `#appointment_schedule_request_start_on`, `#appointment_schedule_request_end_on`, `#appointment_schedule_request_tzid` |
| Cronofy confirm token | `section.cf2` / `section.DTP` CSS var `--buttonConfirm` (was `#ffffff`) |

## Per-file changes

### `04a-book-top.html`
- Confirm: force `--buttonConfirm:#188bf6` + filled blue pill on `button.cf2__confirm-button` / `button.DTP__confirm-button` (verified live: `rgb(24,139,246)` before click).
- Form labels: Inter 600 on `#formContainer label`.
- Form inputs: white bg, `1px #E4E4E7`, radius 9px, `box-shadow:none`, focus border `#188bf6`, Inter 400.
- Center form: hide `#formContainer > .flex-grow`; `#calContainer{display:block}`; form column max-width 560px, margin auto.
- Phone flag dropdown: explicit `.iti__dropdown-content` surface/z-index (verified opens after polish).
- Capture script: persist `{start,end,tz,name,email,phone,timeString}` to `localStorage` + `sessionStorage` key `fh_booking_v1` on Confirm / Book / field changes.

### `05-thank-you.html`
- Synced from **live** thank-you (steps + prep + 9-FAQ) — local file was stale.
- Merged `.cal-cta` **after** `.prep`, **before** `.faq` (FAQ copy untouched).
- Google Calendar + `.ics` buttons; hidden unless `fh_booking_v1` has start/end.
- Meta Pixel: `fbq('trackCustom','AddToCalendar')` guarded with `typeof fbq !== 'undefined'`.

### `02a-apply-top.html`
- Same input chrome on Survey `elInput` / `elSurveyContactInput` (border/radius/shadow/focus) + labels 600.

### Untouched
- `02b`, `04b`, `01-vsl` (except reading `.btn` shadow for cal CTA parity)

## Screenshots
`tests/artifacts-v3/`
- `book-form-live-before-1440.png` / `book-form-after-1440.png`
- `book-form-live-before-375.png` / `book-form-after-375.png`
- `thank-you-no-booking-1440.png` / `thank-you-with-booking-1440.png` (+ 375 with booking)

## Paste order
1. `/funding-book-call` TOP → `04a-book-top.html`
2. `/thank-you` Custom HTML → `05-thank-you.html` (replace whole fragment)
3. `/apply` TOP → `02a-apply-top.html` (optional but included)

Zip: `fundhub-funnel-dropins-v3.zip`

## V3.1 — strip interior widget CSS (2026-08-11)
- `02a` / `04a`: removed flatten, zoom dial, Confirm/slot/form/survey interior rules. Kept page chrome + floating card shell.
- `04a`: kept add-to-calendar capture script (not CSS).
- Live CF already stripped the same; repo matched.

## V3.2 — thank-you live sync (2026-08-11)
- Replaced `05-thank-you.html` with current live fragment: always-visible calendar CTA, Google favicon, inbox deep-link by email domain, .ics shown when booking handoff exists.
