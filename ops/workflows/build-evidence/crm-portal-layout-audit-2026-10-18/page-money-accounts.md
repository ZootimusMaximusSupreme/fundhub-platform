# Accounts — professional layout refinement

One existing builder resumed in `fundhub-layout`. Inventory completed before editing, from HTML/module and existing nine feature tests. Scope: own `money-accounts-ios.css`, focused browser proof script and this evidence only; existing HTML/module/API/navigation contracts unchanged.

## Visual work

Replaced pastel background, 56px promotional heading, large pill controls and heavy 28px cards with the owner's warm neutral working-product direction. Title is 32px desktop/28px phone, section labels 19px, account balances 32px, detail captions 13px. Account identity, masked number, amount and classification remain together. Thin dividers separate business details and account rows. Business creation/manual addition remain native progressive disclosures without nested cards. Connection action is a simple ruled section. Shared Money picker and global navigation remain entirely lead-owned.

Selectors are scoped to verified client body and either `#accounts-root` or `#fos-accounts`. The FinanceOS owner needs to include this page stylesheet after its existing inline section styles for embedded polish; requested from lead. No staff styling is activated by this module stylesheet. No invented balances, status, totals or demo data added.

## Before / after preservation matrix

| Existing behavior | Refined behavior |
| --- | --- |
| GET /api/money/accounts; staff client_id context | Unchanged module/API; browser proves staff contextual links and client-only theme |
| Businesses, personal containers, unsorted bank accounts | Same renderers, classifications and count/billing data |
| Balance vs amount owed, credit limits, loan payment/due date | Same real fields, now stronger balance/detail typography |
| Unknown vs zero values and closed-account exclusion | Unchanged; existing tests prove dash/privacy/closed handling |
| Create business and edit legal/EIN-last4/entity/formation/address/contact details | Same complete forms, IDs, validation and create_business/save_business POST |
| Create personal container | Same native form and create_personal POST |
| Manual checking/savings/card/loan addition | Same add_account form/POST, conditional limit/due/payment fields |
| Assign/unassign account | Same selectors and assign/unassign POST; credit-report immovable behavior preserved |
| Plaid Link | Same /api/banking/link-token and /api/banking/link-exchange; no real bank action tested |
| Loading, empty, full, error and retry | Same renderers; all four captured at all three widths |
| Saving, rejected write feedback, sign-in redirect | Same handlers; refused browser POST proves no false success |
| Back link and compatibility navigation | Existing markup unchanged; verified client uses lead's 16-section native picker |
| Keyboard and touch-sized controls | Native disclosure/button/form; keyboard focus/open/save/retry and >=44px targets retained |
| Shared embedded section | Same mount(ctx), no module behavior change; scoped rules support #fos-accounts |

No upload/download, consent/signature, payment execution, course/chat/booking controls exist on this standalone surface; portal/FinanceOS paths remain intact.

## Exact checks

- `node --test src/http/money-accounts-screen.test.mjs`: 9 passed, 0 failed, 0 skipped.
- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium node scripts/page_money_accounts-layout-browser.mjs`: 1440/390/320 all passed real shared session activation, all four states, no horizontal overflow, 16-section picker, keyboard disclosure/focus, loan/card conditional fields, refused mocked save, retry and staff isolation/context navigation. Static server starts in the same script/network namespace as Chromium; all APIs intercepted before page navigation.
- Fifteen screenshots: `page_money_accounts-{full,empty,error,loading,marked}-{1440,390,320}.png` in this folder. Marked versions draw a red review box and caption around the preserved identity/balance/classification area. Reviewed actual desktop/phone captures.
- Fixture APIs are intercepted sample data only. No real customer, payment, bank, database or outbound writes.
- Root owns combined lint/TypeScript/integration. Live backend authorization/Plaid, physical touch-device checks and measured performance remain unrun; mocked UI proof does not substitute for these.
