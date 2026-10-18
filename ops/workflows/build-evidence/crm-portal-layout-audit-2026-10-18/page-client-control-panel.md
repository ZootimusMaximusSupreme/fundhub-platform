# Client Control Panel — page build evidence

Scope: `public/app/client-control-panel.html`, its page CSS/JS, and focused browser proofs. Local source and synthetic API fixtures only. No real customer, bureau, outbound, payment, database or hosting writes.

## Inventory before editing

- Shared rail and header: embedded sidebar fallback; shell-provided search, account and role gating; duplicated Fundhub wordmark, clock and LIVE indicator.
- Client identity: `ccp-name`, email/key, `ccp-pick`; `id`, `client_id` and `client` address aliases; first-paint skeleton and honest empty/error states.
- Computed next step: `ccp-next-action`, explanation/note and inquiry names; saved record value kept under Details; compatibility mirror retained.
- Blockers: count, severity, age, full cards, business birth-date edits, open/hard-stop wording.
- Funding round: status/finalized/approved/hold/opened/all-round history, submit/fund/close moves, inline funded amount and refusal feedback.
- Applications: honest waiting-for-amount count, confirmed sum, recorded-only caveat, match count/25-row limit, lender logos/links, approach, amounts, bank yes/no, exclusion and bank-email amount suggestion controls.
- Credit: consent and identity gates, approval URL and copy, three separate bureau pulls, result/refusal status, Inquiry Removal issuance.
- Access: owner/admin-only portal sign-in send, sent vs not-queued result, representative add/remove and fallback link.
- Records: eight client reference facts, sample-data labels, full inquiry names, removal missing-document handoff, businesses, other-client inquiry queue, agent context, credit/hold/income caveat, contact/tier/path, editable notes, staff upload and upload feedback.
- Related tools: Pipeline, Closer Deck/Credit Snapshot aliases, Messaging, Inquiry Remover, role-gated FinanceOS, Funding Matrix, Bank Inbox.
- Blueprint: combined/partner prequal, partner link and own consent, partner creation, ready date, tracker offer/revoke, bank todo add/update, declines and outcome/reapply/notes.
- System facts and diagnostics: last pull/scores/round/funded, source, org/client IDs, clock.

Read: AGENTS.md, CLAUDE.md, UI-STANDARDS (as existing implementation context; owner design instruction takes precedence), funding advisor/inquiry remover/client intended journeys, funding round/client progress/heartbeat journeys, focused ccp browser tests and harness.

## Before / after matrix

| Before | After | Feature proof |
| --- | --- | --- |
| Multiple scrolling columns and long stack | One client workspace with five stable sections | New section/anchor/keyboard/phone tests |
| Next task competes with two launch stacks and source codes | Named client and computed next task lead; related tools sit in a quiet menu | Existing computed-step and first-paint proofs retained |
| Bank work and pulls below unrelated boxes | Funding and Credit have direct section navigation | Existing application, pull and decline assertions retained |
| Portal and representative controls mixed with paid bureau actions | Access is a separate role-gated section | Existing exact-body and role-matrix tests retained |
| Notes, upload and business data buried after funding | Records holds client facts, notes, businesses and documents | Focused notes/upload proof plus existing flow coverage |
| Uppercase mono everywhere, black chrome, dense bordered boxes | Off-white canvas, light chrome, rounded system type, quiet rules and black primary action | 1440 / 390 / 320 rendered review |

## Verification

Pending build and browser run.

## Completed verification — 2026-10-18

- All 181 pre-existing static element IDs retained. No API endpoint, request body, consent/identity rule, role gate, fee/money rule or saved-data source changed.
- `ccp-first-paint`, `ccp-headline`, `ccp-present-param-aliases`, `fin-b01-ccp-pulls-declines`, `s2-ccp-portal-access`, plus the first 12 workspace cases: **114 passed**. After adding explicit error retry, all 13 workspace cases plus 4 first-paint cases: **17 passed**.
- `bank-amount-suggestion`, `funded-amount`, `proxy-apply`, `controls-persist`: **51 passed**. Changes to these specs are destination hash setup only; assertions retained.
- Node source/decline checks plus catalog's real-browser CCP proof: **97 passed, 0 skipped**. `src/http/client-panel-screen.test.mjs` layout-only assertion was updated by the lead to describe the Funding panel. Catalog setup now opens the proper section/tool menu; feature assertions are retained.
- External navigation script parsed; all 13 inline scripts parsed; changed-file whitespace check passed.
- All five sections checked at 1440, 390 and 320 pixels. Phone tabs stack into two rows at 320; no sideways page scroll. Primary action is at least 44 pixels tall.
- Keyboard arrows/Home/End, browser Back, `#notes`/`#bp-declines` links, role-hidden Access, native shared Account/Related tools toggles, note persistence across sections, safe mocked note save, safe mocked upload/download link, loading/empty/read-failure and working error retry all proved.
- A native-details issue found during testing was repaired: revealing a field is confined to workspace panels, so it cannot pre-toggle shared account menus or closed decline summaries.
- Server focus requests reveal the correct panel before focusing an action's field. No live data, bureau pull, email, upload, payment or database write was performed.

### Review images

- [Before, desktop](ccp-before-1440-marked.png)
- [After, desktop](ccp-after-1440-overview-marked.png)
- [After, 390px phone](ccp-after-390-overview-marked.png)
- [After, 320px phone](ccp-after-320-overview-marked.png)
- [Credit controls, desktop](ccp-after-1440-credit-marked.png)
- [Credit controls, 390px](ccp-after-390-credit-marked.png)
- [Credit controls, 320px](ccp-after-320-credit-marked.png)
- [Empty](ccp-after-320-empty-marked.png), [loading](ccp-after-320-loading-marked.png), [read failure and retry](ccp-after-320-error-marked.png)

### Changed files

- `public/app/client-control-panel.html`
- `public/app/ccp-workspace.css`, `public/app/ccp-workspace.js`
- `e2e/ccp-headline.spec.mjs`, `e2e/ccp-workspace-layout.spec.mjs`, `e2e/fin-b01-ccp-pulls-declines.spec.mjs`, `e2e/s2-ccp-portal-access.spec.mjs`
- `e2e/bank-amount-suggestion.spec.mjs`, `e2e/funded-amount.spec.mjs`, `e2e/proxy-apply.spec.mjs`, `e2e/controls-persist.spec.mjs` (section hashes only)
- `src/pulse/catalog/proofs/fin-b10-client-control-panel.test.mjs` (section/menu setup only)
- This page inventory, screenshot evidence and marking helper.

Risk: the shared floating Chat button can cover a small part of a phone action while scrolling; reported to the shared-shell owner. The layout itself has no sideways overflow. Synthetic fixtures do not prove production permissions or data availability. No deployment or commit performed, as directed.

Left undone: live account and deployment checks are outside this build's authorization. All page build and local safe checks are complete.
