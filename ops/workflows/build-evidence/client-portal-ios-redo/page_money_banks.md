# page_money_banks — standalone Banks

Builder owns `public/app/money-banks.html`, `public/app/money-banks-ios.css`, `e2e/page_money_banks.spec.mjs` and this page's evidence. Read AGENTS, relevant CLAUDE notes, UI/PERF rules, heartbeat flow, board prompt, approved visual HTML, original bank module and its existing screen proof. The page presents the client's bank strategy; its section remains shared with FinanceOS and unchanged.

## Before / after feature matrix

| Existing control, data or state | Preserved result |
| --- | --- |
| Portal back link | Original `money-back` ID/href; staff `client_id` changes it to Finance OS |
| Money, Plan, Accounts, Credit, Connections, Payments, Banks, Setup | Same eight hrefs and Banks current marker; staff query propagated; mobile pill grid |
| GET `/api/money/banks` | Same bearer/cookie transport, current-client scoping and staff explicit client query |
| Bank/location/source details | Original headings, location, matched-bank list, sources on hover, gaps and unknown values retained |
| Relationship setup and deposits | Original bank kind, status, planned/open date, months of history, deposit plan/history, seasoning source retained |
| Card stacking and next round | Original sequence, spacing, rationale, requirements, ready date and not-set disclosures retained |
| Empty business location | Original Add business info link to FinanceOS Accounts retained |
| Loading/empty/error/full | Original skeleton, empty explanations, alerts and full renderer retained |
| Retry | Original `data-act=retry` handler; keyboard Enter reload proved |
| Staff-only plan controls | Original plan bank, open account, deposit, skip confirmation and next sequence date handlers preserved; client sees no `.staff` controls |
| POST `/api/money/banks` | Original `plan_bank`, `open_account`, `record_deposit`, `set_state`, `set_next_sequence_date`, amount validation, Saving/response feedback unchanged |
| Sign-in/auth failures | Same client/staff redirects and server classifications |
| Combined FinanceOS Banks tab | Shared JS/CSS untouched; new CSS only loaded by standalone page |
| Staff display | Client theme activates only after shared verified client session; browser checks staff remains unthemed |

No sample account data is added. No uploads, signing, bank-connect, payments, booking, chat or course controls originated on this page. Existing navigation keeps their parent surfaces reachable.

## Verification

- `node --test src/http/money-banks-screen.test.mjs`: **15 passed, zero skipped**; rendering, source provenance, unknown amounts, client/staff controls, relationships, empty location, primary-action limit, cents validation, mount behavior and nav preserved.
- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_money_banks.spec.mjs --workers=1 --reporter=line`: **3 passed** at 1440/390/320. All four states exercised; retry triggered by keyboard; empty-location link focusable and correctly routed; all nav hrefs checked; no page overflow; client has no staff forms; staff contextual links and unthemed presentation proved.
- Screenshots `page_money_banks-{1440,390,320}.png`, plus `page_money_banks-{empty,error,loading}-{width}.png`: safe mocked fixture, not real account data. Draft deliverables with no defect annotation because no layout defect was observed. Mobile full-page image visually inspected.
- No API/DB behavior was modified. No real client writes, bank operations, payments or outbound sends run. Staff POST controls are preserved by leaving the module unchanged, but were not submitted in browser.
- Global lint/TypeScript and production-like throttled performance checks remain lead-owned; not claimed here. Adds one small cached stylesheet plus shared foundation, no dependencies or new API/routes.
