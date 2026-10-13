# Heartbeat repair: exact red catalog rows — 2026-10-13

Shared board: `ops/workflows/heartbeat-tripwire-repair.md`.

## What stays red

The compiled catalog has 3,975 mapped rows, 33 marked repeats, and 3,942 unique items. 3,919 link to the required proof or an explicit red monitor. **23 still fail the proof-depth rule.** Wired means a check is linked; it does not mean the customer result passed. Another 531 sensitive items explicitly carry `proofVerdict:red`. No row was promoted and no baseline was weakened in this repair.

All 23 below have browser-level proof (L2). Each touches money, messages, or customer records, so the rule asks for deep result proof (L3). The existing local browser tests use a local static server and fake destination/API replies. Those tests are useful, but do not prove these live results.

| Catalog id | Named path/control | Exact missing proof | Existing evidence |
|---|---|---|---|
| `09900ba878d3aff9b245` | public/app/my-numbers.html — Owed by you: unlogged calls and quiet deposits, each row a link to closer-dashboard.html?client_id=&task_id= | The browser test paints owed links from a fake /api/read/my-numbers reply. No live proof compares each owed client/task with the actual call or deposit debt and opens that exact authorized closer record. | `src/http/closer-ui-honest.test.mjs`; `src/pulse/catalog/proofs/display-contracts-ef-public-2.test.mjs` |
| `13120425dd5806539508` | public/app/partner-training.html — No write control exists on purpose (a partner cannot mark their own training) | The browser test checks that the training body has no write controls using a fake partner reply. No selected deep proof exercises a real partner authorization boundary and proves that partner-originated training changes are refused. | `e2e/partner-training.spec.mjs`; `src/pulse/catalog/proofs/display-contracts-ef-public-2.test.mjs` |
| `941299e8010b7c318b5d` | public/app/payment-success.html — Open the page after checkout (?ref=<payment reference>&client_id=<uuid>; no sign-in needed to load) | The browser test loads a local page and replaces entitlement replies. The portal lane checks other portal facts; it does not prove that a real checkout reference maps to this client and that this page shows only the resulting active entitlement. | `src/payments/commas-api.test.mjs`; `src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs`; `src/pulse/coverage/gap-portal.mjs` |
| `d00cbba31d2f71b4516c` | journey:optimize-intended#2-book-without-form — the mapped deep journey check stays healthy | The browser test clicks Book a call with blank fields, then replaces the ClickFunnels destination with a proof calendar. It never reads the real booking page or its usable calendar result. | `src/http/optimize-html.test.mjs`; `src/pulse/catalog/proofs/flow-read-contracts.test.mjs` |
| `e02a2404a30fc5610afb` | link:404.html -> /app/ — Link 'The CRM sign-in required' to /app/ | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real /app/ result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs` |
| `aa163ac5ea8a062b9340` | link:404.html -> /login.html — Link 'Sign in staff and demo access' to /login.html | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real /login.html result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs` |
| `e9720def3de87ce88990` | link:affiliates/index.html -> /login.html — Link 'Log in' to /login.html | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real /login.html result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs` |
| `73bde33ad6b137fa3dca` | link:affiliates/index.html -> /partner/menu/ — Link 'SEE EVERY WAY IN →' to /partner/menu/ | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real /partner/menu/ result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs` |
| `d6960aeba1adbc711ab7` | link:affiliates/index.html -> /partner/ — Link 'See the white-label offer' to /partner/ | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real /partner/ result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs` |
| `7bf90626e053bd0c2d15` | link:education/index.html -> /login.html — Link 'Log in' to /login.html | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real /login.html result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs` |
| `a03437e62a8c7683ee39` | link:education/index.html -> /education/enroll/?program=credit-mastery — Link 'Enroll in Credit Mastery' to /education/enroll/?program=credit-mastery | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real /education/enroll/?program=credit-mastery result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs` |
| `ee2d2652971dbf64b17a` | link:education/index.html -> /education/enroll/?program=capital-strategy — Link 'Enroll in Capital Strategy' to /education/enroll/?program=capital-strategy | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real /education/enroll/?program=capital-strategy result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs` |
| `b6d230597e460f3f6441` | link:index.html -> /login.html — Link 'Log in' to /login.html | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real /login.html result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs` |
| `27eae87c629dcb08a487` | link:optimize-plan.html -> https://apply.fundhub.ai/schedule/phonecall — Link 'Book my call' to https://apply.fundhub.ai/schedule/phonecall | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real https://apply.fundhub.ai/schedule/phonecall result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public-2.test.mjs` |
| `bb52ed26b096a7862073` | link:optimize.html -> https://smartcredit.com/cblp/?PID=29056 — Link 'Get My Credit Report' to https://smartcredit.com/cblp/?PID=29056 | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real https://smartcredit.com/cblp/?PID=29056 result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public-2.test.mjs` |
| `fd22dfe0aaad06bc2dd7` | link:optimize.html -> https://apply.fundhub.ai/schedule/phonecall — Link 'Or book a call first' to https://apply.fundhub.ai/schedule/phonecall | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real https://apply.fundhub.ai/schedule/phonecall result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public-2.test.mjs` |
| `f7b6906f374944bd6948` | link:partner/menu/index.html -> /partner/board/ — Link 'See the Winner's Board →' to /partner/board/ | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real /partner/board/ result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs` |
| `4bc6aa6b4e9d0507742f` | link:partner/menu/index.html -> /partner/trial/ — Link 'See the Live Trial →' to /partner/trial/ | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real /partner/trial/ result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs` |
| `fbf4d929476ce49caee9` | link:partner/menu/index.html -> /partner/ — Link 'See the Partnership →' to /partner/ | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real /partner/ result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs` |
| `47caa3a9f6980a2d7a34` | link:partner/trial/index.html -> /partner/ — Link 'Skip This — Go Straight to the Partnership' to /partner/ | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real /partner/ result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs` |
| `fcd52ab239186412d528` | link:reset-password.html -> /login.html — Link 'Sign in now →' to /login.html | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real /login.html result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public-2.test.mjs` |
| `148c20a684de4e3bc9ec` | link:roadmap/index.html -> /roadmap/pay.html — Link 'Show Me What I Qualify For —' to /roadmap/pay.html | The local browser test clicks this link and checks the requested address. Its destination is replaced with a fake page. No selected deep proof reads the real /roadmap/pay.html result and proves the named customer outcome or authorization there. A destination ping alone does not fill that gap. | `src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs` |
| `f111bbe076624d4b7dcd` | button:unsubscribe.html#go — Unsubscribe me: posts to /api/public/unsubscribe, which records the opt-out (a GET only reports state). | The browser click posts to a fake unsubscribe reply. The separate database test writes test rows when DATABASE_URL is set; it was not run against production. The selected proof does not link this exact real click to a persisted opt-out and the production send gate. | `src/http/unsubscribe-public.pg.test.mjs`; `src/messaging/unsubscribe.test.mjs`; `src/pulse/catalog/proofs/display-contracts-ef-public-2.test.mjs`; `src/pulse/coverage/gap-opt-out.mjs` |

## The older checklist and the 111

The old October 9 checklist is a Markdown snapshot, not a second runner. The current compiler reads the 20 JSON maps under `ops/workflows/coverage-every-surface-2026-10-10/`, saves `src/pulse/catalog/generated.json`, and the live morning lane `src/pulse/coverage/gap-catalog.mjs` imports that built data. I checked all **75** money/customer route names in section O of `ops/workflows/heartbeat-complete-2026-10-09-map/08-routes-pages.md`: every one has an exact current catalog surface. This proves list inclusion, not live result correctness.

The exact **111** list does exist: `src/pulse/beats/legacy-unbeaten-tripwires.json`, explained by `ops/workflows/launch-heartbeat-2026-10-11.md:70`. It is the backlog of existing tripwire surfaces with no hourly beat. It is not a temporary-only catalog list. I loaded the current beat list and compared its `covers` with `TRIPWIRES`: all 111 are still tripwires and none has hourly beat coverage. The compiler now puts the current uncovered list in `generated.json.hourlyUncoveredSurfaces`. It is computed from all current `TRIPWIRES` minus the actual loaded beats' `covers`, so a new gap joins the morning red too; it does not depend on the old 111 baseline. The morning catalog lane reports `catalog:hourly-proof-linked` red until the list is empty. These missing hourly checks remain a real gap; existing morning tripwires stay in place. Building missing hourly business checks is still needed; adding their names to unrelated beats would not prove them.

Exact pending hourly surfaces:

- `desk:affiliate.html`
- `desk:brand-studio.html`
- `desk:campaign-manager.html`
- `desk:client-portal.html`
- `desk:csm-queue.html`
- `desk:hiring.html`
- `desk:inquiry-remover.html`
- `desk:messaging.html`
- `desk:money-accounts.html`
- `desk:money-alerts.html`
- `desk:money-banks.html`
- `desk:money-connections.html`
- `desk:money-helper.html`
- `desk:money-payments.html`
- `desk:money-setup.html`
- `desk:money-transfers.html`
- `desk:ops-admin.html`
- `desk:pipeline.html`
- `desk:products-commissions.html`
- `desk:sales-floor.html`
- `desk:soft-pull-approve.html`
- `job:affiliate-payout-run`
- `job:blueprint-finance-os-alerts`
- `job:c-00-crs-soft-pull-request`
- `job:c-03-inquiry-removed-resume-or-hold`
- `job:doc-check`
- `job:doc-check-retry-sweeper`
- `job:f-07-funding-locked`
- `job:finance-os-card-due-reminders`
- `job:finance-os-money-transfers`
- `job:inquiry-call-sweeper`
- `job:merchant-pull-sweeper`
- `job:plaid-transactions-sweeper`
- `job:repair-bureau-response-reader`
- `job:s-00-welcome`
- `job:s-01-new-lead-intake`
- `job:s-02-incomplete-survey-nudge`
- `job:s-04-call-booked`
- `job:s-04b-booking-reminders`
- `job:slo-genuine-checkout-sms`
- `job:slo-genuine-followup`
- `job:slo-infinite-drip`
- `job:slo-no-reply-197`
- `job:slo-pack-delivery`
- `job:slo-paid-form-nudge`
- `job:subscription-billing-sweeper`
- `page:portal-login.html`
- `page:progress.html`
- `page:roadmap/index.html`
- `page:roadmap/pay.html`
- `page:roadmap/pull.html`
- `route:ai-bureau-config`
- `route:applications`
- `route:auth/magic-link`
- `route:auth/magic-link-verify`
- `route:auth/send-portal-link`
- `route:banking/link-exchange`
- `route:banking/link-token`
- `route:banking/revoke`
- `route:banking/sync-accounts`
- `route:banking/sync-liabilities`
- `route:banking/sync-transactions`
- `route:bookings`
- `route:campaigns/write`
- `route:commission-rules`
- `route:commissions`
- `route:consent/capture`
- `route:contracts/sign`
- `route:dashboard/client-archive`
- `route:dashboard/pipeline`
- `route:dashboard/seed`
- `route:documents-upload`
- `route:finance/cards`
- `route:finance/subscriptions`
- `route:inquiries`
- `route:inquiry`
- `route:inquiry-cases`
- `route:marketing/funnels/push-live`
- `route:messages-outbound`
- `route:money/alerts`
- `route:money/connections`
- `route:money/helper`
- `route:money/payments`
- `route:money/setup`
- `route:money/tasks`
- `route:money/transfers`
- `route:partner-addons`
- `route:partner-brand`
- `route:partner-pages`
- `route:partners/approve`
- `route:payment-links`
- `route:pii`
- `route:pipeline-cards`
- `route:pipeline-clients`
- `route:privacy/erasure`
- `route:public/affiliate-click`
- `route:public/slo-checkout`
- `route:public/slo-interest`
- `route:public/slo-pull`
- `route:public/survey-submit`
- `route:read/affiliates`
- `route:read/client-progress`
- `route:read/entitlements`
- `route:read/portal-summary`
- `route:repair/enroll`
- `route:repair/generate`
- `route:repair/inbound-mail`
- `route:repair/send`
- `route:slo-connections`
- `route:soft-pull-approve`
- `send:src/metro2/delivery/send.mjs`

## Build data repair and checks

The compiler now saves the display lane's exact result and tracking arrays in the built catalog. The live lane can read those arrays without importing proof builders that open repository files. I compared both saved arrays with the original lane from Git HEAD: **45 result cases and the original 1,121 tracking cases matched exactly**, including order, ids, saved-result contracts, and retired flags. The final build also restores two named red checks that the old generic kind filter dropped: the documents Remind and Void controls. Both remain red for missing exact receipts. The final lane has 1,123 tracking cases and retains all original ids. The item ids, proof fields, counts, and states did not change. The built catalog also carries all 111 currently uncovered hourly surfaces for the morning red aggregate.

- Compiler tests: 13 passed, 0 failed, 0 skipped.
- Catalog rebuild: 3,975 mapped / 3,942 unique / 3,919 wired / 23 red.
- Catalog freshness check: passed after rebuilding the saved display arrays.
- These are local build checks. Live morning and scheduled-beat proof are recorded by the main workflow. No database write, customer message, deploy, or secret change was made in this lane.
