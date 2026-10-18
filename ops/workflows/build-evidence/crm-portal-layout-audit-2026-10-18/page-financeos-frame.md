# FinanceOS frame — page implementation evidence

Date: 2026-10-18. Scope: actual client `/app/financeos.html`; frame only. No deployment, backend change, real customer record, provider call or API write. All browser responses were intercepted safe samples.

## Changed files

- `public/app/financeos.html`: compact context header; three visible task groups; first group exposes Accounts and Payments; mobile section toggle; content skip link. Removed the duplicated wordmark and large FinanceOS introduction.
- `public/app/financeos-ios.css`: warm neutral frame, quiet lines, black selected state, measured desktop rail and phone navigation. No Overview-specific overrides remain; its final visual belongs to the Money builder.
- `public/app/financeos.js`: accessible mobile open/close and Escape; current-section labels; arrow navigation follows the visual groups; Up/Down added alongside the original Left/Right/Home/End support. Public TABS keys/labels are unchanged.
- `src/http/financeos-screen.test.mjs`: replaced obsolete strip-order expectations with task grouping and exact key/label/panel preservation checks.
- `e2e/page_financeos.spec.mjs`: canonical sample frame proof across every module and state at 1440, 390 and 320, plus staff context and compatibility links.

## Inventory and preservation matrix

| Group | Key / preserved tab and panel IDs | Existing loaded module | Existing read |
| --- | --- | --- | --- |
| Daily money | overview / tab-overview / fos-overview | money.js | /api/money/overview |
| Daily money | accounts / tab-accounts / fos-accounts | money-accounts.js | /api/money/accounts |
| Daily money | payments / tab-payments / fos-payments | money-payments.js | /api/money/payments |
| Daily money | transfers / tab-transfers / fos-transfers | money-transfers.js | /api/money/transfers |
| Daily money | alerts / tab-alerts / fos-alerts | money-alerts.js | /api/money/alerts |
| Credit & funding | next / tab-next / fos-next | money-next.js | /api/money/tasks + /api/money/ready-to-fund |
| Credit & funding | credit / tab-credit / fos-credit | money-credit.js | /api/money/credit |
| Credit & funding | fundability / tab-fundability / fos-fundability | money-fundability.js | /api/money/fundability |
| Credit & funding | strategy / tab-strategy / fos-strategy | money-strategy.js | /api/money/strategy |
| Credit & funding | banks / tab-banks / fos-banks | money-banks.js | /api/money/banks |
| Credit & funding | declines / tab-declines / fos-declines | money-declines.js | /api/blueprint/declines |
| Tools & documents | helper / tab-helper / fos-helper | money-helper.js | /api/money/helper |
| Tools & documents | plan / tab-plan / fos-plan | money-plan.js | /api/money/plan |
| Tools & documents | vault / tab-vault / fos-vault | money-vault.js | /api/money/vault |
| Tools & documents | connections / tab-connections / fos-connections | money-connections.js | /api/money/connections |
| Tools & documents | setup / tab-setup / fos-setup | money-setup.js | /api/money/setup |

All 35 original frame IDs remain; none removed. Added IDs: fos-current-section, fos-location, fos-main, fos-nav-toggle, fos-sections. All sixteen original hash keys, hrefs, module registration/mount contracts and section scripts remain. `money-trends.js` still loads and its Overview/Connections extras still mount. Section API methods, sign-in guards, token handling, staff `client_id` propagation, lazy mounting/cache and in-section standalone-link interception are unchanged. The standalone Money HTML pages remain intact and were not edited by this builder.

The new keyboard order follows the visible groups, beginning Overview → Accounts → Payments. Home still selects Overview; End still selects Setup. Existing Left/Right behavior is retained; Up/Down also work in the vertical grouped navigation. On phones all sixteen sections are available in a two-column menu; selection closes it, and Escape restores focus to the toggle. The default view spends no space on a second brand/hero.

## Checks

- `node --check public/app/financeos.js`: pass.
- `node --check e2e/page_financeos.spec.mjs`: pass.
- `node --test src/http/financeos-screen.test.mjs`: 11/11 pass. Includes lazy mounts, shared overview read, safe cash totals, staff scope and client/staff 401 destinations.
- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_financeos.spec.mjs --reporter=line`: 4/4 pass. Three viewport cases each exercise all sixteen module keys with full canonical responses, valid empty responses, 503 error feedback and held loading responses: 192 module/state/width transitions. Also checks keyboard navigation, local active state, all sixteen discoverable links, no duplicate hero/wordmark, staff query scope, one-time mount, and internal old-page links. No page overflow, browser JS error or API write.
- Safe source: `src/demo/client-portal-sample-bundle.json`. Applications uses a minimal explicit empty view because the canonical bundle has no `/api/blueprint/declines` read; this is not a claim of a populated application record. Some canonical full responses intentionally have honest empty sections (e.g. no Fundhub payment plan).
- Repo-wide lint/TypeScript and the integrated cross-page suite are root-owned checks; no new TypeScript was authored here.

## Marked visual evidence

Each width has a current frame screenshot, opened group navigation screenshot, and Overview empty/error/loading screenshots under this directory:

- `page-financeos-frame-{1440,390,320}.png`
- `page-financeos-navigation-{1440,390,320}.png`
- `page-financeos-{empty,error,loading}-{1440,390,320}.png`

Red boxes and short captions identify the compact work header, all sixteen grouped destinations, or the in-place state feedback. Desktop and 390/320 phone navigation were visually inspected. These are local mocked browser renders, not live acceptance or an iPhone hardware check.

## Pending integration

The shared Money builder is replacing `money-ios.css` with a section-scoped Overview design. The existing old stylesheet has broad `[data-client-ios]` rules, including a 64px `!important` heading and all-module card/header styles. It is deliberately **not loaded by FinanceOS yet**, to avoid applying those old rules to all sixteen modules. After that builder finishes, root should load `/app/money-ios.css` immediately after `/app/financeos-ios.css`, rerun this frame proof and inspect the integrated screenshots. The final shared Money visual recheck is pending; this note does not claim it has passed. No other integration risk was found in the frame proof.
