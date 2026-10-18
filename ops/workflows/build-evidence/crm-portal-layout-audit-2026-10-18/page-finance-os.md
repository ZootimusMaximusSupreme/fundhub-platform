# Staff Finance OS recovery evidence

Owner: /root/page_finance_os. Recovery branch: codex/recover-finance-os. Base: 0998ff49969c6e2663a6e1851b4634ab5896113d. Canonical repository: ZootimusMaximusSupreme/fundhub-platform.

This reconstructs the completed staff finance-os.html page from retained tool-argument history after executor/filesystem loss. It was reconciled against the branch's original production page, blob e7d0fb59f3093bd1f4417ebd9b495584e33831a4. No shared/client page, backend, API, auth, workflow or deployment files are changed. Shared header/font foundation belongs to PR71; the optional FHWorkspaceScope hook is safe before integration.

## Feature matrix

| Existing contract | Recovery |
| --- | --- |
| Client picker | Same IDs, local name/email filter, alphabetic 500-client book, UUID validation, Open/Already open, button-based Close and existing fh_client clearing; native disclosure changes presentation only |
| Scope | URL-selected client is named through successful detail/list reads; optional shared-scope call does not change selection, queries, records or permissions |
| Credit | Same seven computed rows; headline remains available revolving credit, explicitly not bank cash; no invented totals |
| Unknown/partial | Missing stays an em dash, real zero stays zero; only known partial sums gain +; ratio basis never claims a higher real number |
| Simulator | Same parser, payload, calculation response, busy/error/result IDs, allocations, before/after estimates and caveat; invalid cash/no plan/no report remain distinct |
| Payments/invoices | Integer-cent arithmetic and paid-status selection retained; failed/refunded rows stay listed; stored calendar-day behavior unchanged |
| Bank buckets | Personal/business/investment/unclassified remain separate; investment override and hand-entered warning retained |
| Suggestions | No plan, no pull, engine error, no findings and findings remain distinct; severity has text |
| Secondary detail | Promo unavailable state and missing success fee rate remain honest; no fabricated dates/rates |
| Loading/empty/error | Explicit inline states; duplicate fixed error banners removed so controls remain reachable |

Exact existing APIs remain: GET /api/dashboard/clients?limit=500; GET /api/read/finance-os?client_id=...; GET /api/dashboard/client?id=...; GET /api/finance/bank-accounts?client_id=...; GET /api/finance/bills?client_id=...; GET /api/read/finance-os-suggestions?client_id=...; POST /api/finance/paydown-simulator with only {client_id,cash_on_hand}. Existing bearer-token handling is unchanged.

The retained final CSS includes the right-anchored phone client picker, 320px label/value facts that keep cents together, four 44px section targets, and invoice filter:none to avoid the shared .inv logo filter. Available credit, paydown task and findings precede the detailed records.

## Verification status

NEW: recovered inline scripts parse in the connector orchestration JavaScript runtime. Production source and all focused test sources were read before editing. No browser, full unit suite, lint, TypeScript or live acceptance was run after recovery because the executor is unavailable.

HISTORICAL ONLY: the earlier filesystem build recorded 22 passing Playwright cases and 41 passing math/payment/browser proofs. These are not new recovery passes. The recovered focused spec retains 1440/390/320 full/empty/loading/error cases, keyboard/touch picker checks, actual-device-width overflow checks, exact simulator requests/refusals and partial/null semantics.

Historical marked screenshots and metrics were filesystem artifacts, unavailable through this text recovery. No screenshot is claimed recovered or current. Re-render and mark fresh integration evidence before visual acceptance. FINANCE_OS_EVIDENCE=1 enables raw screenshots and measured JSON in the recovered spec.

Fresh checks required on the lead's shared-foundation integration branch:

~~~sh
npx playwright test e2e/finance-os-workspace.spec.mjs e2e/finance-os-staff-clicks.spec.mjs --reporter=line
node --test --test-concurrency=1 src/pulse/catalog/proofs/s4-finance-os-panels.test.mjs src/pulse/catalog/proofs/fin-b12-finance-os-page.test.mjs src/pulse/catalog/proofs/fin-b12-repair-pages.test.mjs src/http/finance-os-money-in.test.mjs src/finance/os-grid.test.mjs
npm run lint
~~~

Existing Node browser proof harnesses require an installed Playwright Chromium; use CI's browser. Recovery is pushed with [skip ci] so the lead can run one integration verification. No customer inspection, real money/bank operation, outbound action, shared-file change, main update or deploy was performed.
