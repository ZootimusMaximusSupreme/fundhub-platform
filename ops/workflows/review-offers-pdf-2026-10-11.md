# Workflow board — offer PDF and financial model review

Date: 2026-10-11  
Status: done

## Task list

| Unit | Status |
|---|---|
| Extract offer map from the supplied PDF | done |
| Compare PDF prices with GitHub `origin/main` | done |
| Add screenshot financial model | done |

## Sources

- `/Users/chrisstanbridge/Downloads/fundhub-offers-2026-10-10.pdf`
- User-supplied financial model screenshot in chat
- GitHub: `https://github.com/ZootimusMaximusSupreme/fundhub-platform`
- `origin/main:marketing/offers/fundhub-offers-2026-10-10.md`
- `origin/main:docs/finance/slo-offer-model-2026-09-18.md`

## Change manifest

- Added `docs/finance/fundhub-offers-review-2026-10-11.md`.
- No client-facing offer prices were changed.
- No application code changed.
- No live financial values were changed.

## Verification

- Extracted all 10 PDF pages with `pypdf`.
- Checked the four main offers and the $32 call-level step.
- Confirmed the public prices match the GitHub offer markdown.
- Recomputed the screenshot model using unrounded values.
- Confirmed the displayed $30,435 cash, $4,565 sales cost, $29,565 total
  cost, $10,870 net profit, 2.03 ROAS, and 1.03 net ROAS.
