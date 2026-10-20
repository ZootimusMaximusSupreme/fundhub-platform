# Astra customer portal lane

Owner approval: whole CRM, customer portal and affiliate Astra direction. Lane B owns only the 25 client HTML pages below, `public/app/fundhub-astra-client.css`, and this report. Root owns integration and release. Shared contract: `.fh-astra`, shared CSS after legacy CSS, then the client sheet. No script, endpoint, entitlement, price or offer changes.

## Screen jobs recorded before implementation

| Existing page | Role | One job | First question |
| --- | --- | --- | --- |
| app/client-portal | Client or authorized file representative | Show their file and next action | Where is my file, and what do I do next? |
| app/financeos | Client; existing staff preview remains scoped | Manage their money workspace | What needs my attention today? |
| app/money | Client | Review balances and next due item | What is due and where is my money? |
| app/money-accounts | Client | Organize accounts by personal or business container | Which accounts belong to which business? |
| app/money-alerts | Client | Review and manage file protection alerts | Which alerts protect my file? |
| app/money-banks | Client; finance staff controls stay gated | Review the bank plan | Which bank relationship is next? |
| app/money-connections | Client | Manage linked financial accounts | Which connections need attention? |
| app/money-credit | Client | Review credit position and history | Where does my credit stand? |
| app/money-declines | Client | Review applications and submit a decline letter | What happened to my application? |
| app/money-fundability | Client | Review funding readiness | What affects my funding readiness? |
| app/money-helper | Client | Ask the existing money helper | What should I do about my money? |
| app/money-next | Client | Act on the next money task | What should I do next? |
| app/money-payments | Client | Review bills and payment actions | What is due next? |
| app/money-plan | Client | Review the money plan | What does my plan call for? |
| app/money-setup | Client | Complete Money setup | What is left to set up? |
| app/money-strategy | Client | Review debt payment strategy | Which balance should I work on? |
| app/money-transfers | Client | Review proposed money moves | Which move needs my decision? |
| app/money-vault | Client | Manage funding papers | Which papers are needed? |
| app/payment-success | Returning checkout client | Explain the current account state | What opened after checkout? |
| app/soft-pull-approve | Signed-link recipient | Complete the existing authorization form | What am I approving? |
| login | Returning account holder | Sign in with a password | How do I enter my account? |
| portal-login | Client | Request a single-use sign-in link | How do I enter my portal? |
| reset-password | Invite/reset recipient | Set the account password | How do I set my password? |
| contract | Signed-link recipient | Read and sign the sent document | What am I signing? |
| progress | Client | Review file progress and next task | Where is my file now? |

## Build

All 25 pages now opt in to shared Astra and the scoped client stylesheet. Portal status and next action use a clear two-part workspace; FinanceOS and standalone money modules share grouped balances, restrained tabs/panels, and the existing next-due priority. At intermediate widths, FinanceOS uses its existing expandable section selector so two navigation rails cannot squeeze the task. Phone fields and actions stay readable in one column.

The portal welcome is now the semantic page heading. Reset password now has a plain title and explicit field labels. Existing loading, empty, error and full state handlers remain unchanged. No new scripts, actions, endpoints, dependencies, prices or offers.

Phone requirement: 16px body and inputs, captions at least 13px, interactive targets at least 44px and primary actions at least 48px. Check 390px, iPhone 17 Pro Max 440px, and intermediate widths. Emulation is not proof on a physical device.

## Evidence

- Source comparison with HEAD: all 25 pages retain identical script blocks and every pre-existing ID/data attribute, and all 25 have both Astra stylesheet links and the opt-in class.
- `E2E_PORT=43241 npx playwright test e2e/client-portal-ux.spec.mjs e2e/page_financeos.spec.mjs e2e/page_money.spec.mjs e2e/page_login.spec.mjs e2e/page_portal_login.spec.mjs e2e/page_contract.spec.mjs e2e/page_progress.spec.mjs --reporter=line`: **61 passed (1.3m)**. This covers existing portal entitlement gates and controls, FinanceOS all 16 modules and four states, money details, entry errors and sessions, signed agreement flow, progress controls, 1440/390/320 layouts.
- The first attempt did not start because the sandbox denied the local server (`listen EPERM`). The same test command ran with the permitted local-server escalation and passed. No test was changed.
- Existing suites save marked 1440/390/320 screenshots under `ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/`. Inspected the money next-due/FinanceOS frames at 390 and 1440. These use fictional controlled responses, not live customer data.
- `E2E_PORT=43241 npx playwright test e2e/page_money_*.spec.mjs e2e/soft-pull-approve-clicks.spec.mjs e2e/money-transfers-clicks.spec.mjs --reporter=line --output=test-results/astra-client`: **70 passed, 4 failed (1.3m)**. All intercepted transfer, payment and soft-pull action checks passed. Three failures are the existing credit-page native-selector keyboard checks at 1440/390/320. The fourth asserted the previous 18px payment panel radius, while the approved Astra radius is 10px.
- Root updated only that payment radius expectation to 10px, retaining the other checks. `E2E_PORT=43241 npx playwright test e2e/page_money_payments.spec.mjs --grep 'professional hierarchy' --reporter=line --output=test-results/astra-client-payment`: **1 passed (1.2s)**.
- Native keyboard diagnostic used an isolated local server on 43244 and fictional controlled responses. On Mac Chromium at 390px, both HEAD and Astra kept the credit URL and selected value unchanged after `focus → ArrowDown → Enter`; `Space → ArrowDown → Enter` also stayed unchanged for both. On WebKit, the same original keyboard sequence stayed unchanged for HEAD and Astra at desktop 1440 and the iPhone 17 Pro Max 440px profile (four comparisons). These three automated keyboard failures remain **red**, not waived or replaced. The observed behavior is also present before this change; Linux CI may differ.
- Separate native selection-event check: the current Astra selector focused correctly, exposed all 16 existing choices, and `selectOption('/app/money-payments.html')` navigated to that exact URL. This proves the existing change handler, **not physical keyboard operation**.
- Chromium 440px readability checks found no page overflow across all 16 FinanceOS modules. Two actual HTML text-size misses were corrected in the cohort stylesheet: strategy goal selector 15→16px, setup/connections state text 12→13px. A follow-up scan of strategy, connections, setup, portal, progress, password login, link login and reset password found no visible HTML text below 13px, no fields below 16px and no page overflow. SVG plot labels use viewBox units and are not included in the HTML font-floor claim.
- After those text-size fixes, `E2E_PORT=43241 npx playwright test e2e/page_money_strategy.spec.mjs e2e/page_money_connections.spec.mjs e2e/page_money_setup.spec.mjs --reporter=line --output=test-results/astra-client-readability`: **20 passed (17.1s)**.
- Root owns independent review, final lint/TypeScript, broader iPhone 17 Pro Max WebKit evidence, and release. Physical iPhone and Mac wrapper proof remain separate, and no production claim is made.
