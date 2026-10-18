# Transfers — professional Mac workspace refinement

Retained single builder `/root/page_money_transfers`. Read assigned prompt, AGENTS, shared board, WelcomeView, existing module/render/action tests and money-transfers intended journey. No shared header, account menu, chat, rail, section picker or API changes.

Changed presentation from a dark gradient total plus tall individual metric cards to a neutral segmented summary; on phones totals share a compact bordered list. Waiting proposals retain prominent amounts, provenance, reasons and explicit account/date facts; the actual review/approval controls stay adjacent to those facts. Blocked card/loan information remains visible. History and audit details remain expandable and readable. Typography follows rounded system family, 30px title, 28–34px metrics, 13–15px body/detail, neutral borders, 18px cards and 11–12px controls. No invented progress, balances or success.

## Before / after preservation

| Existing feature/API/control/state | Result |
|---|---|
| GET `/api/money/transfers`, own-client server scope; staff `?client_id=` | Unchanged JS and endpoints |
| POST action `approve`, exact amount/from/to/scheduled date, second explicit yes | Unchanged; standalone and combined browser tests assert exact request |
| Source account selection and frozen choice during review; Back | Unchanged; existing browser tests cover selection and no-POST Back |
| POST `cancel`; native confirmation naming amount; Not now / Stop / staff Take off list | Unchanged; browser tests prove dismissal does nothing and confirmed exact proposal cancellation |
| Staff proposal amount/date/destination/source/title and POST `propose` | Unchanged; browser tests prove cents conversion, exact staff client scope and invalid amount sends nothing |
| Staff cannot approve; client cannot propose | Retained and browser-tested on standalone and combined tab |
| Sandbox/off/live truth, disabled/blocked card/loan, transfer limits | Retained in original renderer; Node tests include off and blocked controls |
| Null balance is dash, integer cents, schedule vs moving, history status/events/approval provenance | Computation functions untouched; existing Node tests retained and passing |
| Loading skeleton / empty / backend error / retry / full data | Rendered/screenshotted at 1440, 390, 320; retry recovers full |
| Links, hidden original back-link ID, shared section picker/account/chat and compatibility route | Retained; page CSS no longer overrides shared chrome |
| Combined FinanceOS Transfers tab | Same scoped appearance under `#fos-transfers`; full screen/no overflow at all three widths |

## Files

- `public/app/money-transfers.css`: appended professional section presentation scoped to `#transfers-root` and `#fos-transfers`.
- `public/app/money-transfers-ios.css`: removed old gradient/page-wide and navigation rules; standalone main spacing only.
- `src/http/money-transfers-screen.test.mjs`: replaced obsolete ban on pixel font sizes and comma-splitting selector assumption with two-root scope and restrained legible typography checks; all financial feature assertions retained.
- `scripts/page_money_transfers-browser.mjs`: evidence folder updated; scoped history expansion avoids opening global Account menu, mobile touch enabled, combined tab width checks added.
- Evidence: this note, `page_money_transfers-browser.json`, 15 `page_money_transfers-*.png` captures in this folder (full/loading/empty/error plus combined-tab full at each width).

## Exact verification

- `node --test src/http/money-transfers-screen.test.mjs`: **22 passed, 0 failed, 0 skipped**.
- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/money-transfers-clicks.spec.mjs e2e/s1-money-transfers-tab.spec.mjs --workers=1 --reporter=line`: **18 passed**. Existing safe API-intercepted click tests; no actual bank writes.
- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium node scripts/page_money_transfers-browser.mjs`: **3/3 width scenarios pass**. Each scenario includes verified `principal: client` activation, loading/full/empty/503 error, retry, keyboard Enter review, Back, safe rejected approval error, history expansion, staff no client chrome and no client approval, combined-tab full/no page overflow. Touch `.tap()` review explicitly passed at 390 and 320.
- Visually inspected 390 full and 1440 combined captures; clear hierarchy, no clipping. All captures use repository synthetic test fixture and are review evidence, not live-client/account/payment proof.

Root owns integrated lint, TypeScript, broader regressions and final independent review. No production performance, real database authorization or real transfer success claim from mock UI tests. No commit, deploy, credentials, customer writes or shared-file changes.
