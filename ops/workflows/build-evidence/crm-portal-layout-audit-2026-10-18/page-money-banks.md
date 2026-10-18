# Banks professional refinement

Sole retained builder: `/root/page_money_banks`. Owned files: `public/app/money-banks-ios.css`, `public/app/money-banks.js` (presentation only), `e2e/page_money_banks.spec.mjs`, page evidence. HTML required no change. Read assigned prompt, AGENTS, shared board and original renderer/tests before replacement. Previous UI/PERF/heartbeat rules were already read during this same builder's first pass; new owner direction is the visual authority.

## Inventory and before/after matrix

| Before | After / retained contract |
| --- | --- |
| Eight local Money links, contextual staff back link | Shared lead-owned 16-section native picker now active for verified clients; full original standalone link markup/context propagation retained for staff |
| Banks title/location/client name | Same real data; compact 32px desktop / 28px phone heading |
| Funding date, estimated amount, relationship count | Same null-vs-zero handling, sources, data and counts; neutral bordered panels, no pastel rainbow |
| Matched banks, products, tier, deposit, seasoning and served state | Same server matches/data, readable two-column desktop / single-column phone bank list |
| Bank relationship steps and rationale | Native per-bank details disclosure; all source content preserved, keyboard Enter and pointer opening/closing verified |
| Card stacking sequence, products, inquiry, spacing, relationship gates, funding criteria | Same ordering and content, quiet list hierarchy and black sequence markers |
| Next sequence, estimate, step, gaps | Same date/amount/source and unknown handling; no invented approval or funding promises |
| Relationship tracker/deposits/status/seasoning | Same columns and source data; table scroll stays inside own region |
| Staff plan/open/deposit/skip/date actions | Same forms/IDs/handlers, exact GET/POST `/api/money/banks`, actions `plan_bank`, `open_account`, `record_deposit`, `set_state`, `set_next_sequence_date`; no auth/transport changes |
| Loading / empty / error / full | Same skeleton, clear empty explanations, retry alert, renderer; native details introduced only within full-bank criteria |
| Permissions/session, sign-in redirect, no client staff controls | Same gates, current-client API scope and staff query behavior; shared theme client-only |
| FinanceOS combined Banks section | Styles scoped to verified-client `#banks-root` or `#fos-banks`; no other section targeted. Root must bundle stylesheet for combined host |
| Existing uploads/signatures/payments/booking/referrals | None originate in this standalone page; no parent links or controls removed |

No customer data or samples added. No pricing, bank approvals, new APIs, backend handlers or writes added. No changes to bank match or funding computation.

## Exact verification

- `node --test src/http/money-banks-screen.test.mjs`: **15 passed, zero skipped**. Original sources, unknown monetary values, relationship tracker, client/staff controls, amount conversion, renderer, mount and navigation behavior intact.
- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_money_banks.spec.mjs --workers=1 --reporter=line`: **3 passed**, 1440/390/320, all four states, no page overflow, 16 shared-picker destinations/current Banks selection, host link, keyboard and pointer criteria disclosure, retry by Enter, empty-address link, no client staff controls, staff contextual link and mocked failed plan submission with error feedback and enabled retry control.
- Initial browser run correctly failed obsolete eight-link count after root activated the shared native picker. Updated assertion now proves all 16 destinations and Banks selection; no feature assertion removed.
- Screenshots: `page_money_banks-{1440,390,320}.png` full plus `page_money_banks-{empty,error,loading}-{width}.png`. Safe fixture API intercepts only; not live account proof. Desktop/phone review crops mark criteria grouping with red boxes and captions. Full desktop rendering inspected; default banking details visibly reduced with all criteria accessible through disclosure.
- No real bank/application/payment/client-record/outbound operations. Staff failed submit intercepted with 503; no success claimed.
- Root owns combined lint/TypeScript/regressions and final FinanceOS bundling. Production throttled performance and live database/session verification were not run by this page builder. No new routes or heartbeat surfaces.
