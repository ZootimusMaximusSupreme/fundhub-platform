# Tier 1 Banks — Fundhub's Top Picks

Owner rule, Chris, 2026-10-23: these are Fundhub's top picks. When we build a banking sequence, these banks go first.

Source: Chris's "Nation Wide - Tier 1 Banks" list (screenshot, 2026-10-23). Bureau in brackets is the bureau that bank pulls, per that list.

## Tier 1 (nationwide unless states are listed)

| # | Bank | Bureau pulled | Notes |
|---|------|---------------|-------|
| 1 | Chase | Experian | |
| 2 | Elan | TransUnion (mostly) | |
| 3 | American Express | Experian or no pull | |
| 4 | Wells Fargo | Experian | |
| 5 | Truist | TransUnion | |
| 6 | Bank of America | TransUnion | |
| 7 | Flagstar (FNBO underwriting) | Experian | AZ, CA, CT, FL, IN, MI, NJ, NY, NC, OH, WI |
| 8 | FNBO — First National Bank of Omaha | Experian | CO, IL, IA, KS, NE, SD, TX, WY |
| 9 | First Arkansas Bank & Trust | — | National |
| 10 | Intuit | Experian | Pre-approval |
| 11 | Barclays | TransUnion | |
| 12 | Citizens | Equifax | |
| 13 | FNBO | Experian | |
| 14 | Wings Credit Union | Experian | |
| 15 | Langley | — | |
| 16 | Navy Federal | — | |

## Recent problem banks

| Bank | Bureau pulled | Problem |
|------|---------------|---------|
| PNC Bank | Experian | Wants a checking account open for 45 days; if they don't put a certain amount in (rest of the note was cut off in the screenshot) |
| TCM Banks | Experian | Now requiring 2 years in business |

## How the system uses this

`lenders.priority_tier = 1` on every active row for these banks (migration `db/migrations/504_tier1_banks_2026_10_23.sql`). The lender match (`src/pulse/beats/lib/lenders-truth.mjs` `listLenders`) orders by `priority_tier NULLS LAST`, so Tier 1 banks come out first on every bank match and sequence plan. The usual filters (state, bureau rotation, inquiries, credit file) still apply on top.

## Open items

- Bureau differences vs. the lenders table: Truist (table says EQ, list says TU), Bank of America (table EX/TU/EQ, list TU), Chase and Wells Fargo (table EX/EQ/TU, list EX). The migration does not change `bureaus_pulled`; confirm which is right.
- Banks that may not have a row in the lenders table yet: First Arkansas Bank & Trust, Intuit, Barclays, Wings Credit Union, Langley, Navy Federal. The migration prints which ones it couldn't find; they need rows added on the Lenders screen.
- Finish the PNC note (what amount, by when).
