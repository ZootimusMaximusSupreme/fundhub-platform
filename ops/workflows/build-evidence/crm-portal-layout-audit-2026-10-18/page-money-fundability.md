# Fundability professional layout — sole page builder

## Inventory / preservation matrix

| Feature before | After and proof |
| --- | --- |
| GET `/api/money/fundability` with existing bearer/same-origin read | Same module/request. All browser API traffic intercepted safely; zero writes |
| Real score, tier, funding estimate, later estimate, checks, null/unknown vs zero | Calculations, helpers, exact value rendering untouched; 75 focused existing tests pass |
| Engine priority tips in server order | Moved immediately below three score summaries. Sentences remain verbatim and existing section ID retained |
| Factors/pass/miss/unknown word and shape | Same factors renderer; neutral presentation retains readable status words |
| Current/future chart, assumptions, optional not-promised if-removed line | Same chart model/handlers. Keyboard Enter and touch point selection proved |
| Separate per-business estimates, projections, missing-data links | Same business renderer, tables and account links |
| Sample report disclosure | Same sample flag gating and words; only neutral presentation changed |
| Loading skeleton / empty soft pull / error retry | All preserved and captured at all three widths; retry and setup href checked |
| Native section navigation + existing links | Lead-owned picker used; hidden original nav links retained for staff/context propagation |
| Staff role behavior / client ID links / sign-in handling | No client styling for staff verified; back and navigation carry safe fixture ID; server permission code untouched |
| Combined FinanceOS section | CSS deliberately scopes all section rules to `body[data-client-ios] .fh-fundability`; `#fos-fundability` receives restrained title sizing. Lead must bundle this stylesheet |

## Implementation

`money-fundability-ios.css`: warm neutral canvas inherited from shared theme, white 18px cards, 32px title/34px metrics, compact 13px section labels, black/outlined controls, neutral priority panel. Removed all gradient/pastel card styling and oversized headline. Standalone chrome rules scope to page identity. Shared module rules also work in FinanceOS. `money-fundability.js` changes presentation order only: summary → priority improvement → checks/chart → limits → businesses. No scoring, API, permissions, links, handlers or data schema changes.

## Checks

- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_money_fundability.spec.mjs --workers=1`: **3 passed** at1440/390/320. Full/empty/loading/error, retry, soft-pull destination, native picker selected value, chart keyboard Enter and actual touch, staff link context, zero page overflow and zero writes.
- `node --test src/finance/fundability.test.mjs src/http/money-fundability-screen.test.mjs src/http/fin-b08-money-fundability.test.mjs`: **75 passed, 0 skipped**.
- Screenshots: `page-money-fundability-{full,empty,error,loading}-{1440,390,320}.png`; marked review copies: `page-money-fundability-review-{1440,390,320}.png`. Phone full state visually inspected.
- Safe canonical contract fixture only; no live account or DB acceptance claim. Backend authorization unchanged. No applications, messages, funding, bank operations or customer writes.
- Lead owns combined lint/TypeScript/performance and FinanceOS integration checks. This page adds no dependency or new endpoint. No deploy/commit by page builder.
