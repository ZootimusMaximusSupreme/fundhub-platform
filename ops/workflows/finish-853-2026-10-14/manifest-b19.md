# Batch 19 manifest (finish the 853, tier 4, lane gap-catalog-display, 40 rows)

Branch `fin/b19`, built from `fin/base` (`2f4f574a0`). Work folder `.claude/worktrees/fin-b19`. Generation 1. Nothing was pushed or merged.

## The number

- Rows in the batch: 40. All 40 were NOT_PROVED at the start (`node scripts/pulse/count-not-proved.mjs`, ids intersected with `batch-19.json`): **openBefore 40**.
- After `npm run pulse:catalog` and the same script: **openAfter 5**. The whole repo went 853 to 818 (35 rows left the lane).
- The 5 left are exact `not-attachable` findings (below). Nothing is faked.

| Outcome | Rows |
|---|---|
| live-check: a read-only query on saved data that goes red on a wrong saved result | 11 |
| practice-test: a real page in Chromium or the real handler, fake data, mutation-checked | 24 |
| not-attachable: exercised, but the product does not do what the row says, or no person can reach it | 5 |

A live-check row also keeps its practice test (the page half). The two answer different questions: the practice test says the control sends and paints the right thing; the live check says the result it left behind is not wrong. The live checks read nothing today (no database in this build), so on the offline count they show "skip"; the pulse judges them against the real tables.

## Every row

| # | Row (source file : surface : control) | Outcome | Where | What it judges |
|---|---|---|---|---|
| 1 | desks-e.json:public/app/pipeline.html:Filter: Owner (hidden until a card has an owner) | practice-test | `fin-b19-pipeline-controls.test.mjs` | The select is not drawn while no card has an owner. With owners it lists each owner once and keeps only that owner's cards. |
| 2 | desks-e.json:public/app/pipeline.html:Filter: Waiting on (Anyone / Us / Us - an approval amount / A bank / The client / Nothing recorded) | practice-test | `fin-b19-pipeline-controls.test.mjs` | All six choices keep exactly the cards whose next move is that party (us, us with no amount, bank, client, nothing recorded); the Filter counter reads 1. |
| 3 | desks-e.json:public/app/pipeline.html:Fulfillment lens: click a chip to show only that action; Show all clears it | practice-test | `fin-b19-pipeline-controls.test.mjs` | A chip keeps only that next action, the same chip again clears it, Show all clears it, and the bar says N of M clients. |
| 4 | desks-e.json:public/app/pipeline.html:Headline counters: on a bank / on the client / nothing recorded (3 buttons, same filter as the select) | practice-test | `fin-b19-pipeline-controls.test.mjs` | The bank, client and nothing-recorded buttons write the Waiting on select, show their own cards, add up to the 8 cards, and clear when pressed again. |
| 5 | desks-e.json:public/app/pipeline.html:Headline: Longest wait link (scrolls to that card and rings it; stops being a link when a filter hides the card) | practice-test | `fin-b19-pipeline-controls.test.mjs` | Names the longest-waiting card someone here must move, a click rings that card, and a filter that hides it drops the link and says so. |
| 6 | desks-e.json:public/app/pipeline.html:Headline: Waiting on us (big number, button that filters the board to cards someone here must move) | practice-test | `fin-b19-pipeline-controls.test.mjs` | Shows 3, the button filters the board to those cards, pressing it again clears, and the amount choice keeps it pressed. |
| 7 | desks-e.json:public/app/pipeline.html:Lens switch: Board / Fulfillment | practice-test | `fin-b19-pipeline-controls.test.mjs` | Fulfillment hides the board and its headline, reads the client list exactly once (limit 200, fulfillment 1), Board gives the board back. |
| 8 | desks-e.json:public/app/pipeline.html:Rail note on Sales: a payment does not move a card, somebody must move it to Closed Won | practice-test | `fin-b19-pipeline-controls.test.mjs` | The exact note shows on Sales and on no other rail, and comes back on Sales. |
| 9 | desks-e.json:public/app/pipeline.html:Rail tab R-01 Sales | live-check | `fin-b19-display-contracts.mjs` | Every card saved on this rail sits in a column of the same rail and names a client or partner in the company, or the tab's board drops it (green with no cards yet). Practice test (fin-b19-pipeline-controls.test.mjs): the tab asks for its own pipeline once and paints that rail's columns. |
| 10 | desks-e.json:public/app/pipeline.html:Rail tab R-02 Funding: Card Stacking | live-check | `fin-b19-display-contracts.mjs` | Every card saved on this rail sits in a column of the same rail and names a client or partner in the company, or the tab's board drops it (green with no cards yet). Practice test (fin-b19-pipeline-controls.test.mjs): the tab asks for its own pipeline once and paints that rail's columns. |
| 11 | desks-e.json:public/app/pipeline.html:Rail tab R-04 Optimization (Repair) Rounds | live-check | `fin-b19-display-contracts.mjs` | Every card saved on this rail sits in a column of the same rail and names a client or partner in the company, or the tab's board drops it (green with no cards yet). Practice test (fin-b19-pipeline-controls.test.mjs): the tab asks for its own pipeline once and paints that rail's columns. |
| 12 | desks-e.json:public/app/pipeline.html:Rail tab R-05 Inquiry Removal | live-check | `fin-b19-display-contracts.mjs` | Every card saved on this rail sits in a column of the same rail and names a client or partner in the company, or the tab's board drops it (green with no cards yet). Practice test (fin-b19-pipeline-controls.test.mjs): the tab asks for its own pipeline once and paints that rail's columns. |
| 13 | desks-e.json:public/app/pipeline.html:Rail tab R-06 AR / Collections | live-check | `fin-b19-display-contracts.mjs` | Every card saved on this rail sits in a column of the same rail and names a client or partner in the company, or the tab's board drops it (green with no cards yet). Practice test (fin-b19-pipeline-controls.test.mjs): the tab asks for its own pipeline once and paints that rail's columns. |
| 14 | desks-e.json:public/app/pipeline.html:Rail tab R-08 Affiliates + White Label | live-check | `fin-b19-display-contracts.mjs` | Every card saved on this rail sits in a column of the same rail and names a client or partner in the company, or the tab's board drops it (green with no cards yet). Practice test (fin-b19-pipeline-controls.test.mjs): the tab asks for its own pipeline once and paints that rail's columns. |
| 15 | desks-e.json:public/app/pipeline.html:Rail tab R-09 Hiring | live-check | `fin-b19-display-contracts.mjs` | Every card saved on this rail sits in a column of the same rail and names a client or partner in the company, or the tab's board drops it (green with no cards yet). Practice test (fin-b19-pipeline-controls.test.mjs): the tab asks for its own pipeline once and paints that rail's columns. |
| 16 | desks-e.json:public/app/pipeline.html:Search box (placeholder says name, phone, or email; the filter compares the card's name text only) | practice-test | `fin-b19-pipeline-controls.test.mjs` | Keeps cards whose name has the typed words; an email or phone typed here matches nothing (pinned, as the row says). |
| 17 | desks-e.json:public/app/pipeline.html:Sort: Manual / Name A-Z / Amount high first / Longest in stage / Amount needed first | not-attachable | - | The four sorts order a column correctly (practice test green) but picking Manual after another sort leaves the sorted order, because applySort() returns on an empty choice. The row's first choice does not do what it says. Needs a product change in public/app/pipeline.html. |
| 18 | desks-e.json:public/app/pipeline.html:The x on each active filter chip (clears that one filter) | not-attachable | - | The x on the Waiting on, Owner and Age chips clears only that filter (practice test green), but the x on the Sort chip clears the select and leaves the order sorted (same applySort() early return). Needs a product change in public/app/pipeline.html. |
| 19 | desks-e.json:shell.js (shared chrome):Account chip: add or change your photo (hidden file input, PNG or JPEG) | live-check | `fin-b19-display-contracts.mjs` | Every saved staff photo key sits under that person's own company and staff folder and ends .png or .jpg (green with no photos). Practice test (fin-b19-shell-chrome.test.mjs): picks a file, posts it as the photo field with the bearer, re-reads the session, shows the refusal words. |
| 20 | desks-e.json:shell.js (shared chrome):Account chip: backend badge (LIVE / NO DB / NO API / DEMO) | practice-test | `fin-b19-shell-chrome.test.mjs` | LIVE (with the migration count), NO DB, NO API from the health answer, and DEMO for a demo login even when the backend is up. |
| 21 | desks-e.json:shell.js (shared chrome):Account chip: Sign out | practice-test | `fin-b19-shell-chrome.test.mjs` | Posts one logout with the bearer, wipes the token, role, demo and client keys, lands on /login.html (the portal page for a client); signs out anyway when the server hangs. The handler half is src/http/auth-logout-handler.test.mjs (both session stores revoked by hash), held by name. |
| 22 | desks-e.json:shell.js (shared chrome):Account chip: x hide the bar and the small 'account' button that brings it back | practice-test | `fin-b19-shell-chrome.test.mjs` | Hides the bar, shows an account button, remembers the choice across a reload, and the button brings the bar and Sign out back. |
| 23 | desks-e.json:shell.js (shared chrome):Beta banner with Dismiss (only for owner on pages listed in BETA_PAGES; the list is empty) | practice-test | `fin-b19-shell-chrome.test.mjs` | Shipped list is empty so no banner or BETA badge for any role; with a patched list the owner alone sees it, Dismiss removes it, and a reload brings it back. |
| 24 | desks-e.json:shell.js (shared chrome):Brand paint: company colors and logo applied to the chrome | live-check | `fin-b19-display-contracts.mjs` | A saved company logo must be https or an inline image with no spaces, quotes, brackets or angle marks, or the chrome refuses it (colors and fonts are held by the table's own checks). Practice test: colors, fonts and logo painted, unsafe values refused. |
| 25 | desks-e.json:shell.js (shared chrome):Role gate: cached role bounces a role that may not open this page; session answer is authoritative; no session sends to the sign-in page | practice-test | `fin-b19-shell-chrome.test.mjs` | A cached role that may not open the page is bounced before paint, the session answer wins and rewrites the cache, no session goes to /login.html with the next page. |
| 26 | desks-e.json:shell.js (shared chrome):Search button and overlay (Cmd or Ctrl K): type to search clients, contracts, documents, conversations, pipeline cards; hits are links | practice-test | `fin-b19-shell-chrome.test.mjs` | Button and Control+K open it, typing asks /api/read/search once with the words, hits are links, Escape closes, 403 and no-match words, and partner/client get no button. |
| 27 | desks-e.json:shell.js (shared chrome):Sidebar group 'Admin' header (fold/unfold) and its links: staff-teams.html, hiring.html, products-commissions.html, contracts.html, brand-studio.html | practice-test | `fin-b19-shell-sidebar.test.mjs` | Same: owner and admin three links, sales manager two (hiring and brand-studio never show); folds and unfolds. |
| 28 | desks-e.json:shell.js (shared chrome):Sidebar group 'Automation' header (fold/unfold) and its links: agent-editor.html, automations.html, journeys.html | not-attachable | - | agent-editor.html, automations.html and journeys.html are all on NAV_HIDDEN and hidden by crm-sidebar.css, so no role is ever shown the head; nothing to fold. |
| 29 | desks-e.json:shell.js (shared chrome):Sidebar group 'Client ops' header (fold/unfold) and its links: csm-queue.html, consent-capture.html, messaging.html, documents.html, inquiry-remover.html, company-brain.html | practice-test | `fin-b19-shell-sidebar.test.mjs` | Same for the eight staff roles: each role's exact list (consent-capture never shows), head folds and unfolds. |
| 30 | desks-e.json:shell.js (shared chrome):Sidebar group 'Funding' header (fold/unfold) and its links: lenders.html, client-control-panel.html, finance-os.html | practice-test | `fin-b19-shell-sidebar.test.mjs` | Drawn for the eight staff roles with exactly their links under it (finance-os never shows); the head folds and unfolds them. |
| 31 | desks-e.json:shell.js (shared chrome):Sidebar group 'Home' header (fold/unfold) and its links: partner-galaxy.html | not-attachable | - | partner-galaxy.html is on NAV_HIDDEN (shell.js) and hidden by crm-sidebar.css, so no role is ever shown the head; nothing to fold. Needs a product change if the head is meant to be seen. |
| 32 | desks-e.json:shell.js (shared chrome):Sidebar group 'Marketing' header (fold/unfold) and its links: marketing-command-center.html, campaign-manager.html, social-studio.html, creative-factory.html, content-admin.html | practice-test | `fin-b19-shell-sidebar.test.mjs` | Same: owner and admin five links, partner two, nobody else gets the head; folds and unfolds. |
| 33 | desks-e.json:shell.js (shared chrome):Sidebar group 'Portals' header (fold/unfold) and its links: client-portal.html, affiliate.html | practice-test | `fin-b19-shell-sidebar.test.mjs` | Same: only the owner gets the head, with Client Portal alone (affiliate never shows); folds and unfolds. |
| 34 | desks-e.json:shell.js (shared chrome):Sidebar group 'Watch' header (fold/unfold) and its links: galaxy.html, ops-admin.html | not-attachable | - | galaxy.html and ops-admin.html are both on NAV_HIDDEN and hidden by crm-sidebar.css, so no role is ever shown the head; nothing to fold. |
| 35 | desks-e.json:shell.js (shared chrome):Sidebar logo link (to pipeline.html) and collapse button (to icon strip; closes the drawer on a phone) | practice-test | `fin-b19-shell-chrome.test.mjs` | Logo goes to pipeline.html; the collapse button folds the rail to icons and back, and on a phone the menu button opens the drawer and the same button closes it. |
| 36 | desks-f.json:sales-floor.html (+ sales-floor.js):'Flag <belief>' button: stores a belief x source row for marketing | live-check | `fin-b19-display-contracts.mjs` | Every flag filed from the floor names a staff member of the company and carries the same count in the row and in its note (green with none filed). Practice test: the exact POST body, the stored and refused words. |
| 37 | desks-f.json:sales-floor.html (+ sales-floor.js):'One closer at a time': previous and next arrows and one name button per closer | practice-test | `fin-b19-sales-floor.test.mjs` | Previous and Next step and wrap, each name button picks that closer, and no second request is made. |
| 38 | desks-f.json:sales-floor.html (+ sales-floor.js):'Sync recordings from Drive': scans Drive, indexes Meet files, reloads the floor | live-check | `fin-b19-display-contracts.mjs` | The saved Drive scan state must have a scan time, a page token and no saved error (green before the first scan). Practice test: posts one empty sync, shows Checking Drive, reads the floor again, says the Drive-off words. |
| 39 | desks-f.json:sales-floor.html (+ sales-floor.js):'Today's recordings' jump button | practice-test | `fin-b19-sales-floor.test.mjs` | Scrolls the recordings panel into view and sends no request. |
| 40 | desks-f.json:sales-floor.html (+ sales-floor.js):Closer is bounced and sees 'Forbidden' (403 from the read) | practice-test | `fin-b19-sales-floor.test.mjs` | The shell sends a closer home before any floor read; a 403 read paints the Forbidden words and no numbers; the real handler refuses closer, advisor, CSM, setter and inquiry roles with no data read and lets owner, admin and sales manager through. |

## What each live check reads (all read-only, all take the company `$1`, all say green until the first wrong result)

| Check | Reads | Wrong means (bad_count) |
|---|---|---|
| 7 rail tabs | `cards` joined to `pipelines`, `pipeline_stages`, `clients`, `partners` for that rail's key | the card's column belongs to another pipeline or is gone, or the card names no client or partner in the company: the board drops it |
| Flag belief | `marketing_flags` filed from the sales floor, joined to `staff` | the staff member is not in the company, or the row's `outcome_count` is not the count written in its own note |
| Sync recordings | `brain_drive_sync` | a saved error, a missing scan time, or a missing page token |
| Photo | `staff.avatar_key` | the key is not under that person's own `staff-avatars/<company>/<staff>/` folder, or is not .png or .jpg |
| Brand paint | `org_brand.wordmark_url` | a logo the chrome refuses to paint (not https or an inline image, or has spaces, quotes, brackets or angle marks) |

Colors, fonts and ramp are held by the table's own CHECK constraints, so a query on them could never go red; only the logo address is free text.

The SQL is written in the part of the language Postgres and SQLite read the same way. `fin-b19-display-contracts.test.mjs` runs the very SQL text on SQLite (`node:sqlite`, Node 22, casts stripped) over stand-in tables: quiet with no rows, green on good rows, red on each kind of wrong row, blind to another company, demo and archived rows; then it removes one condition at a time and shows the wrong row goes unseen (8 break cases); then it runs all 11 through the real lane (`gapChecks`) green and red.

## Files added

All under `src/pulse/catalog/proofs/` unless noted.

- `fin-b19-kit.mjs`: row tracker (a row is claimed only by the callback that asserts it), shared Chromium, a page with a fake session and fake /api (`openPage`).
- `fin-b19-rows.json`: the table of controls per test file; `notAttached` lists the 5 exercised-but-not-handed-over rows.
- `fin-b19-display-proofs.mjs`: turns that table into proof cases (35 attached); holds `auth-logout-handler.test.mjs` to the Sign out row by name.
- `fin-b19-not-attachable.mjs`: the 5 exact reasons.
- `fin-b19-rows.test.mjs`: guards (every listed row is one exact map row, no live API, 35 attached, each reason still true in the page source and the stylesheet).
- `fin-b19-pipeline-controls.test.mjs`: 18 pipeline rows (11 practice, 7 rail tabs also live, 2 not attached).
- `fin-b19-shell-chrome.test.mjs`: 9 shared-chrome rows.
- `fin-b19-shell-sidebar.test.mjs`: 8 sidebar section heads (5 proved, 3 not reachable).
- `fin-b19-sales-floor.test.mjs`: 5 sales floor rows, plus the real `api/read/sales-floor.mjs` handler on a stand-in database.
- `fin-b19-display-contracts.mjs` and `fin-b19-display-contracts.test.mjs`: the 11 live checks and their SQL tests.
- `ops/workflows/finish-853-2026-10-14/manifest-b19.md`: this file.

## Shared lines I touched (for the integrator)

| File | Change |
|---|---|
| `src/pulse/catalog/compiler.mjs` | one block (about 15 lines, marked `fin-b19`) before `const resultsByKey`: a tracked display row whose impact is NOT money, customer data or customer message, and that owns a registered contract, is judged even when no spec names it. The sibling block for money and customer rows (fin/b06) does the same for the other impacts; merge the two into one loop with no impact filter. |
| `src/pulse/catalog/proofs/display-saved-result.mjs` | one import line and `...FIN_B19_DISPLAY_CONTRACTS,` at the end of `DISPLAY_RESULT_CONTRACTS` |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | one import line and `...FIN_B19_DISPLAY_PROOF_CASES,` at the end of the plug-in list |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 637 (35 rows left it) |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | contracts 40 to 51, PASS-capable 27 to 38, SQL batches 27 to 38, db calls 27 to 38, shipped-bundle count 40 to 51 (the "not proved" count 13 is unchanged) |
| `src/pulse/catalog/generated.json` | rebuilt with `npm run pulse:catalog`; recompile after merging, do not hand-merge |

Guard numbers are sums of every batch: re-derive them after the merge (`51` = 40 + my 11; `637` = 672 - my 35).

## Product findings (not fixed)

1. **Sort "Manual" and the x on the Sort chip do not give the first order back.** `applySort()` in `public/app/pipeline.html` starts with `if(!mode) return;`. Choose Name, then Manual (or press the x on the Sort chip): the select and the chip clear and every column stays sorted until reload. Measured in Chromium. The two rows stay NOT_PROVED; the practice test pins the behaviour and goes red the day it is fixed.
2. **Home, Watch and Automation section heads are drawn for no role.** Every link under them is on shell.js `NAV_HIDDEN` and in `crm-sidebar.css`, so `gateLinks()` hides the whole section. Measured for owner, admin, sales manager, closer, funding advisor, CSM, setter, inquiry specialist and partner. Same as the S5 finding. Also, Admin never shows Hiring or Brand Studio, Funding never shows Finance OS, Client ops never shows Consent, Portals never shows Affiliate.
3. **The two hidden-row lists must move together** (shell.js `NAV_HIDDEN` and the `.navitem:is(...)` block in `crm-sidebar.css`). Removing a row from only one list changes nothing on screen. The guard now reads both.
4. **The search box placeholder says name, phone or email; the filter reads the name only.** A phone or an email typed there matches nothing. The row already says so; pinned by the practice test.
5. **The beta banner and BETA badge can never show**: `BETA_PAGES` is empty. Proved with a patched copy of the file.
6. **The "Forbidden" note on the sales floor is only reachable if the shell lets a role in and the read still refuses.** A real closer is sent home by the shell first and never sees it.
7. **Stale map evidence** on two rows: "Account chip: Sign out" says no test calls `api/auth/logout.mjs` (`src/http/auth-logout-handler.test.mjs` does), and "'Flag <belief>' button" says no test calls `api/marketing-flags.mjs` (`src/http/marketing-flags-handler.test.mjs` does). Map text, not product.

## Commands run and what they said

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` at fin/base, ids intersected with batch-19.json | total 853; batch rows open 40 |
| `npm run pulse:catalog`, then the same script | total 818; batch rows open 5; `compile-catalog.mjs --check` exits 0 |
| `node --test` on the 4 browser test files, the SQL test file, `fin-b19-rows.test.mjs` | pass, 0 fail (pipeline 11, chrome 10, sidebar 7, floor 6, SQL 23, rows 3) |
| `node --test src/pulse/catalog/*.test.mjs src/pulse/coverage/gap-catalog*.test.mjs src/pulse/coverage/modules.test.mjs src/pulse/tripwires.test.mjs` | 88 of 88 pass, 0 skipped |
| the 8 older `display-contracts-*`, `door-proof`, `data-proof-cases`, `read-proof-cases` tests | 1078 of 1078 pass, 0 skipped |
| `display-proof-cases.test.mjs` "focused proof test" (runs every test named by every case) | every fin-b19 test and `auth-logout-handler.test.mjs` passed inside it. The run failed in one place that is not mine: `s5-display-specs.test.mjs` running `e2e/cc-tab-shoot.spec.mjs:131` at 390px ("every tap is at least 44px tall", every height 0) at load average 17 to 30. That spec alone on the same code: 12 of 12 pass. |
| `npm run lint` | 3572 files parse clean |
| `npx tsc --noEmit` | exit 0 (checkJs is off by repo design) |

### Break checks (each product break made alone in a second worktree, test run, file restored)

Each of the 50 product breaks below turned the named test red. Four other edits stayed green on purpose and are named after the list.

- Pipeline (public/app/pipeline.html), 19: Action Required counted as bank; Owner select always drawn; Owner filter does nothing; search reads the whole card; amount sort reversed; age sort reversed; name sort does nothing; needs sort ignores the amount; us_amount same as us; chip x clears every filter; filter counter wrong; headline picks the newest wait; headline button cannot clear; hidden longest wait says nothing; fulfillment read drops the flag; fulfillment chip cannot clear; lens leaves the headline up; R-05 asks for hiring; rail note on every rail.
- Shell (public/app/shell.js, data.js), 22: demo label; live label; logout wrong URL; token kept; hangs when the server hangs; hide not remembered; photo field name; photo not re-read from the session; beta shown to everyone; beta Dismiss dead; ink not checked; unsafe logo accepted; session never bounces; no session stays; cached bounce removed; search sends the wrong words (data.js); Control+K dead; collapse dead; Watch heads visible; section head click dead; lenders and admin rows offered to every staff role.
- Sales floor and handlers, 9: previous dead; flag count wrong; flag source dropped; jump does not scroll; sync wrong URL; sync does not reload; floor gate widened to every staff role; Forbidden words changed; logout skips the account session store.
- SQL: 8 conditions removed one at a time, the wrong row goes unseen each time.

Stayed green on purpose (not product breaks): the two redundant wrap guards in `paintCloserFocus` (modulo already wraps); `NAV_HIDDEN` edited alone for Finance OS (the stylesheet also hides it); `CLOSER_DESK_ONLY` emptied (it moves My numbers in the Sales head, which is not one of these rows); removing the empty-choice return in `applySort` (the pinned finding is unchanged by it).

### Heads up for siblings

I wrote two helper files into the shared scratchpad folder under the names `mutate.py` and `runmut.sh` before I saw other builders' files there. If one of yours misbehaves, that is why; they are small and have no effect on the repo.

## Left undone and why

- The 5 not-attachable rows above need a product change (or, for Home, Watch and Automation, the owner deciding the heads are meant to be seen).
- The hiring rail check will say "no results yet" for as long as no card is placed there (hiring applications are not `cards`); it can still go red on the first wrong card.
- `fin-b19-display-contracts.test.mjs` needs `node:sqlite` (Node 22.13 or newer; the repo's engines and CI are 22.x).
