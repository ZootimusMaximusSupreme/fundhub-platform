# Batch 18 manifest (finish the 853, tier 4, lane gap-catalog-display)

Branch `fin/b18`, built from `fin/base` (2f4f574a0), generation 1. Nothing was pushed or merged. Tests and test-side files only:
no product page, handler or migration was changed (`git diff fin/base` touches no file under `public/`, `api/`, `src/` product code or `db/`).

## The count

| | Rows |
|---|---|
| Rows in the batch | 40 |
| NOT_PROVED before (`count-not-proved.mjs`, this batch's ids) | 40 |
| NOT_PROVED after | 3 |
| Whole four-lane total before to after | 853 to 816 |

Outcomes: 6 live checks, 31 practice tests, 3 not-attachable, 0 na-verified.
Five of the six live-check rows also have their screen half pressed by a practice test, so a row can go red for the click or for the saved result.
The sixth (the server row of the C-suite task writer) is judged by the live check and by the real writer run through it.

## Every row

| Screen | Control | Outcome | File | What it judges (and how many product breaks it caught) |
|---|---|---|---|---|
| money.html | Back to my portal / Back to Finance OS (header link) | practice-test | `fin-b18-money-pages.test.mjs` | Client sees Back to my portal to client-portal.html; staff naming a client sees Back to Finance OS with the client id. 2 breaks red. |
| money.html | Money nav: Money (current), Accounts, Credit, Connections, Payments, Setup (6 links) | practice-test | `fin-b18-money-pages.test.mjs` | Six links in order, each to its own #tab, Money marked current, client id before the #tab for staff. 3 breaks red. |
| money.html | Try again (button on the error panel) | practice-test | `fin-b18-money-pages.test.mjs` | A failed overview read shows the error and Try again; pressing it reads the same client again and paints the page. 1 break red. |
| money-transfers.html | Back to my portal / Back to Finance OS (header link) | practice-test | `fin-b18-money-pages.test.mjs` | Same two cases as money.html. 1 break red. |
| money-transfers.html | Money nav: Money, Next steps, Plan, Accounts, Payments, Transfers, Setup (7 links to /a... | practice-test | `fin-b18-money-pages.test.mjs` | Seven links in order, Transfers current, client id carried for staff. 3 breaks red. |
| money-transfers.html | Try again (button on the error panel) | practice-test | `fin-b18-money-pages.test.mjs` | Failed read, Try again reads again and paints the table. 1 break red. |
| money-transfers.html | What happened (details toggle: ledger events in words) | live-check | `fin-b18-live-contracts.test.mjs` | Live: fin-b18-transfer-events (5 conditions: no approved line, a line with no words, a bank line with no side, a line of another company or client, current status never in the story). Screen half: the fold opens on click, every event in words on the right side, no empty fold (fin-b18-money-pages.test.mjs, 6 breaks red). |
| money-vault.html | Back to my portal / Back to Finance OS (header link) | practice-test | `fin-b18-money-pages.test.mjs` | Same two cases. 1 break red. |
| money-vault.html | Money nav: Money, Accounts, Credit, Applications, Funding papers (current), Connections... | practice-test | `fin-b18-money-pages.test.mjs` | Eight links, Funding papers is the current page and a page address, the rest go to their #tab; client carried for staff. 3 breaks red. |
| money-vault.html | Staff: Cancel (closes an open accept/reject/sort form) | practice-test | `fin-b18-money-pages.test.mjs` | Cancel shuts the accept, reject, sort-accept and sort-reject forms, clears the form message, sends nothing. 2 breaks red. |
| money-vault.html | Try again (button on the error panel) | practice-test | `fin-b18-money-pages.test.mjs` | Failed vault read, Try again reads again and paints the papers. 1 break red. |
| money-declines.html | Bank name text box (shown for Another bank) | practice-test | `fin-b18-money-declines-helper.test.mjs` | Another bank shows the box, a listed bank hides it, no name or spaces only is refused with focus on the box and nothing sent, a typed name is sent trimmed as bank with no application id. 5 breaks red. |
| money-declines.html | Your bank applications list | live-check | `fin-b18-live-contracts.test.mjs` | Live: fin-b18-applications-list (5 conditions: no bank name, no status, decline on another client's application, approved on reconsideration but application not Approved, still declined but not Denied). Screen half: bank and product text, decline words win over status words, 'A bank' fallback, empty sentence (fin-b18-money-declines-helper.test.mjs, 4 breaks red). |
| money-declines.html | Your steps list + Fundhub's steps expander (done / skipped / not done yet) | live-check | `fin-b18-live-contracts.test.mjs` | Live: fin-b18-decline-steps (5 conditions: no steps, step in another company, done or skipped with no actor, open step with a finished time, two steps sharing a place). Screen half: Done / Not done yet / Skipped marks, the fold's 'x of y done' count, no empty list or fold (fin-b18-money-declines-helper.test.mjs, 5 breaks red). |
| money-helper.html | Banner: helper stopped / not switched on | live-check | `fin-b18-live-contracts.test.mjs` | Live: fin-b18-helper-stop (4 conditions: stopped with no stopped turn, stop asked by the client with no text opt-out, message answered after the stop, client in another company). The 'not switched on' half reads the agent's own status, which saves nothing per client, so only the screen half judges it: banner words for stop, legal, off, stop-wins-over-off, and the Send box going away (fin-b18-money-declines-helper.test.mjs, 4 breaks red). |
| money-next.html | Check your accounts link (empty state) | practice-test | `fin-b18-money-next-pay-setup.test.mjs` | Empty list says nothing to do and links to Accounts (client id for staff), the link follows to the Money frame; a list with steps has neither. 3 breaks red. |
| money-next.html | Try again buttons (steps) and (ready card) | practice-test | `fin-b18-money-next-pay-setup.test.mjs` | Steps Try again reads steps and the ready card again; the ready card's own Try again reads only the ready card; the side card survives a steps failure. 4 breaks red. |
| money-payments.html | Empty state ('You do not owe Fundhub anything right now') and Error state with Try again | practice-test | `fin-b18-money-next-pay-setup.test.mjs` | No plans: the 'do not owe' sentence and no totals; a plan hides the sentence; a failed read offers Try again that asks for the same client again. 4 breaks red. |
| money-setup.html | Loading and error states with Try again | practice-test | `fin-b18-money-next-pay-setup.test.mjs` | Skeleton and 'Loading your setup' while the read is out, then the error with Try again, then four steps. 2 breaks red. |
| money-setup.html | Step 2: See my credit link (after a pull) | practice-test | `fin-b18-money-next-pay-setup.test.mjs` | Link only when the pull is done, nothing while waiting, the Run soft pull button before; the link goes to money-credit.html. 3 breaks red. |
| money-setup.html | Step 3: Add businesses and accounts / Add more link | practice-test | `fin-b18-money-next-pay-setup.test.mjs` | 'Add businesses and accounts' until there is a container, then 'Add more' with 'Done · N container(s)'; goes to money-accounts.html. 3 breaks red. |
| ops-admin.html | Affiliates + Hiring drawer (summary row with 'Open Affiliates' link; body is fixed text... | practice-test | `fin-b18-ops-admin.test.mjs` | Drawer starts shut, row shows the dash counts, opens to the two fixed sentences, no affiliate or hiring read is made, the link goes to affiliate.html. 3 breaks red. |
| ops-admin.html | AR column header sort (click or Enter on Client, Invoice, Amount owed, Overdue, Status) | not-attachable | `-` | Product problem, measured in Chromium: after the AR read paints, header clicks leave row order unchanged. The sort handlers are attached once at page parse to the first table row; paintAr then replaces the whole table with table.innerHTML, so the new header cells carry none (no sortable class, tabIndex -1). Needs a product change. |
| ops-admin.html | AR row expand (terms, payment method, owner, outstanding, collection history) | not-attachable | `-` | Product problem, measured in Chromium: rows drawn by paintAr have no data-ar attribute (0 found) and a click opens no detail row. The expand binds to tr[data-ar] once at parse, when the table holds only the Loading row. Needs a product change. |
| ops-admin.html | hire-closer (server): writes hire / diagnose / ads-review tasks and, when LinkedIn is c... | live-check | `fin-b18-live-writer.test.mjs` | Live: fin-b18-csuite-tasks (7 conditions: hire task off the sales manager's desk, review off the owner's desk, task on a client file, written twice, kind the brain does not write, closer post failed, post marked posted with no outside id or time). The real createCsuiteTask runs through the check and a replay adds nothing (fin-b18-live-writer.test.mjs). |
| ops-admin.html | Open the page (owner and admin only: ops-admin.html is in OWNER_ADMIN_ONLY and NAV_HIDD... | practice-test | `fin-b18-ops-admin.test.mjs` | Owner and admin stay on the page; sales manager, closer, funding advisor, inquiry specialist, CSM and setter are sent elsewhere. 1 break red. |
| ops-admin.html | Period pill: Today / Last 7 Days / Last 30 Days / Quarter to Date (menu, Escape closes) | practice-test | `fin-b18-ops-admin.test.mjs` | Four periods, current marked, Escape and click outside close it, a choice repaints and reads KPIs and briefs for that period, the same period again reads nothing, Quarter and Today. 7 breaks red. |
| ops-admin.html | Write today's C-suite tasks (button, shown only when the calendar is packed, a gap is s... | live-check | `fin-b18-live-contracts.test.mjs` | Live: fin-b18-csuite-tasks (same text as the server row). Screen half: shown only for packed, short or ad spend above zero (with ads connected), one POST with {}, locked while it works, the words for saved / already on file / nothing new / failed, briefs read again (fin-b18-ops-admin.test.mjs, 7 breaks red). |
| ops-admin.html | Zone tabs: Money / People | practice-test | `fin-b18-ops-admin.test.mjs` | Money first, People swaps it (hidden attribute, aria-selected, tab class), Money swaps back from the keyboard. 3 breaks red. |
| partner-galaxy.html | Message Blaster for Mac: Download button (locked gift, .dmg) | practice-test | `fin-b18-partner-galaxy.test.mjs` | Signed-in partner: GET with the bearer token and the disk-image accept header, button locked, MessageBlaster.dmg saved, status words; no token or demo token: 'Sign in to download.' and no request; a reason or a bare status in the failure words. 8 breaks red. |
| partner-galaxy.html | Sidebar rows a partner may open (Brand Studio only on this screen; Home, Social Studio,... | practice-test | `fin-b18-partner-galaxy.test.mjs` | Pins what a partner is shown: only Marketing is left in the rail, and it opens to Social Studio and Creative Factory; every staff desk row is hidden. See finding 3 (Home and Brand Studio rows are not drawn). 2 breaks red. |
| partner-galaxy.html | Sky canvas: click a cluster to zoom (5 static clusters: Fundhub fulfillment, Sales & Fu... | practice-test | `fin-b18-partner-galaxy.test.mjs` | Each of the five clusters (names read from the page's table) is a clickable mass at its resting spot and a click zooms on it. The canvas is read through the pointer: pointing hand on a cluster, zoom-out cursor once zoomed. 2 breaks red. |
| partner-galaxy.html | Sky canvas: click a worker to open the detail panel (NODES, CLIENTS and ROUTES are empt... | not-attachable | `-` | Product problem: NODES, CLIENTS and ROUTES are literal empty arrays and nothing ever pushes to them, so no worker is drawn or hit-tested. goWorker can never run, the panel can never open. Needs a product change. |
| partner-galaxy.html | Sky canvas: click empty space or press Escape to pull back; panel close button (esc) | practice-test | `fin-b18-partner-galaxy.test.mjs` | Click in empty space steps back from a cluster; Escape steps back; Escape at rest changes nothing. The panel close button is unreachable (no worker, finding 2), so the claim covers the two ways a person can pull back. 3 breaks red. |
| pipeline.html | Card: hover tooltip (last activity from the card footer) | practice-test | `fin-b18-pipeline.test.mjs` | Hover shows 'Last activity' with the owner in bold or 'unassigned' and the tier or 'funded'; sits beside the card; leave and pointer-down hide it. 6 breaks red. |
| pipeline.html | Clear all (button in the filter panel) | practice-test | `fin-b18-pipeline.test.mjs` | Every select back to its first choice, chips and count gone, every card shown, panel stays open. 3 breaks red. |
| pipeline.html | Clock (Arizona time) and LIVE pill in the header | practice-test | `fin-b18-pipeline.test.mjs` | Arizona time (MST) whatever the machine zone, ticks each second, shown down to 1100px and hidden on a phone; LIVE pill always. 3 breaks red. |
| pipeline.html | Drawer: Open full file link (client-control-panel.html?id=) | practice-test | `fin-b18-pipeline.test.mjs` | Card name opens the drawer; the link goes to client-control-panel.html?id= for that card's client, and follows the next card. 3 breaks red. |
| pipeline.html | Filter button (opens the panel; count of active filters) | practice-test | `fin-b18-pipeline.test.mjs` | Opens and shuts the panel with aria-expanded; the count shows each filter on, counts Sort too, stays when the panel is shut. 5 breaks red. |
| pipeline.html | Filter: Age (Any / Over 1h / Over 1d / Over 3d in stage) | practice-test | `fin-b18-pipeline.test.mjs` | Over 1h / 1d / 3d keep only cards with an arrival time older than that; a card with no date never counts; chip and its cross. 6 breaks red. |

## Generation 2: the three open rows, challenged again

A fresh agent re-read the real page and the real read for each of the three rows and tried to attach a live check or
a practice test. All three reasons are exactly true. No test was added, because every test that could be written is
either red today (the product is broken) or green only by pinning the break. Nothing in the product was changed.

| Row | Measured again (Chromium, the real page, fake answers) | What is missing, exactly |
|---|---|---|
| ops-admin.html: AR column header sort | Three open invoices (Zed Co, Amy Co, Mid Co) painted by the real `paintAr`. All five header cells carry no `sortable` class and `tabIndex` -1. A click on Client, a click on Amount owed and Enter on Client each left the order Zed, Amy, Mid. No page error. | The SORTABLE TABLES block binds each header cell once at page parse, to the cells that exist then. `paintAr` runs after the read and writes `table.innerHTML`, so the headers a person sees are new cells with no handler. A product change must bind after the paint (or delegate on the table). |
| ops-admin.html: AR row expand | The same three rows: 0 rows with `data-ar`. A click on a row opens no `ar-detail` row. | Two gaps, not one. The expand binds to `tr[data-ar]` once at parse, and `paintAr` rows carry no `data-ar` and none of `data-terms`, `data-method`, `data-owner`, `data-timeline` that `expand()` reads. And `GET /api/read/invoices` (api/read/invoices.mjs, view `v_invoice_aging`) returns no terms, no payment method and no owner at all (it does return payment_count, last_payment_at, reminder_count, escalated_at, sent_at, due_at). Rebinding alone would show Terms, Payment method and Owner as a dash. The row names five facts; two (Outstanding, and a history built from the dates above) could be shown, three have no source. |
| partner-galaxy.html: click a worker | `var NODES = []`, `var CLIENTS = []`, `var ROUTES = []` and nothing in the page (or in shell.js, data.js) writes to them: no `NODES.push`, no assignment, no feed. `hitTest` loops over NODES, so it can never return a worker, `goWorker` can never run and the panel can never open. | The staff screen (public/app/galaxy.html) has a boot that fetches `/api/read/company-activity` and fills NODES. The partner copy has no such fetch (its header says staff identities are never shown to a partner), so the control has no data for a partner. Needs a decision by Chris: give the partner screen a partner-scoped feed, or drop the control from the map. A test that pushes a made-up worker into NODES would run code a partner can never reach, so it is not attached. |

Why a pin was not written: a test that is green while the sort is dead (or while NODES is empty) would take the row out
of NOT_PROVED and the morning board would say the control is proved. It is not. Left in the lane, the row keeps saying
"Not proved" until the product is changed. When it is, a fresh agent attaches a real practice test (the recipe in
fin-b18-ops-admin.test.mjs: open the page as owner, answer `/api/read/invoices`, click a header, read the order).

Numbers, generation 2, this worktree: batch rows open before 40 (measured on `fin/base` in a throwaway checkout), after 3.
Four-lane total 853 to 816. Re-run of the whole batch on this branch: 36 non-browser tests and 42 browser tests pass,
0 fail, 0 skipped; catalog and lane tests 81 of 81; `compile-catalog.mjs --check` fresh; `npm run lint` clean.
Three fresh product breaks, each red then restored with `git checkout --`: pipeline.html Clear all no longer repaints the
cards (2 tests red), partner-galaxy.html Escape does nothing (3 red), money-setup.js step 3 words swapped (2 red).
Column names of the six live checks were re-read against db/migrations (blueprint_declines, blueprint_decline_steps,
money_helper_threads, opt_outs, money_transfer_events, hiring_job_postings): all present.

## What the live checks judge, and what they cannot

A live check is one read-only SQL text the display lane runs for the company. It returns `sample_count` and `bad_count`.
All six are `emptyAs: "quiet"`: green with the words "no saved results yet" until the first wrong result, red on it.
Each is a list of named conditions (`FIN_B18_CHECKS` in `fin-b18-display-contracts.mjs`). The test file builds a healthy set, then for each
condition breaks one row only that way and sees it counted, then drops the condition from the text and sees it no longer counted.
It also checks another company's broken row is never counted and that taking the company condition out would count it.

Honest limits, one line each:

- **The SQL ran on SQLite, not Postgres.** There is no local Postgres on this Mac. The text uses only spellings both share; the test kit turns the few Postgres ones (casts, `BTRIM`, `now() - interval`) into SQLite. The first real morning run is the Postgres proof. A statement Postgres refused would show as "not read" (skip), never green.
- **Windows.** Decline plans: last 180 days. Applications: last 90 days, client applications only, demo rows left out. Money moves: last 90 days. C-suite tasks and the closer job post: last 120 days. Older rows are not judged.
- **Applications can be red on the first run.** `applications.status` is allowed to be NULL (legacy rows). A recent client application with no status prints "Status not set" on the page. That is a real result the check will report.
- **"Not switched on" has no saved result.** The Money helper banner's second half reads the agent's own current status, which keeps nothing per client. Only its screen half judges it.
- **The task check accepts fire, raise and bonus kinds as known.** Those shapes exist in `src/ops/csuite-tasks.mjs` and no rule is locked; the check does not say whether one should exist.
- **No receipt keeps what a person typed.** The Bank name box and the Period pill leave nothing saved, so they are practice tests only.

## Files added (all new, named fin-b18-*)

- `src/pulse/catalog/proofs/fin-b18-display-contracts.mjs`: the six live checks (no imports), the registry entries, the live rows and cases
- `src/pulse/catalog/proofs/fin-b18-display-proofs.mjs`: the proof cases (live and practice) built from the row table
- `src/pulse/catalog/proofs/fin-b18-rows.json`: the practice-test row table, by test file
- `src/pulse/catalog/proofs/fin-b18-kit.mjs`: the row tracker, shared browser, flaky read, nav and back helpers
- `src/pulse/catalog/proofs/fin-b18-sql-kit.mjs`: test kit that runs a live check over stand-in rows (real column names from `db/`)
- `src/pulse/catalog/proofs/fin-b18-live-contracts.test.mjs`: the live checks, run over stand-in rows (30 tests)
- `src/pulse/catalog/proofs/fin-b18-live-writer.test.mjs`: the real `createCsuiteTask` run through the C-suite check, and the registry shape (3 tests)
- `src/pulse/catalog/proofs/fin-b18-money-pages.test.mjs`: money.html, money-transfers.html, money-vault.html (11 practice tests)
- `src/pulse/catalog/proofs/fin-b18-money-declines-helper.test.mjs`: money-declines.html, money-helper.html (4)
- `src/pulse/catalog/proofs/fin-b18-money-next-pay-setup.test.mjs`: money-next.html, money-payments.html, money-setup.html (6)
- `src/pulse/catalog/proofs/fin-b18-ops-admin.test.mjs`: ops-admin.html (5)
- `src/pulse/catalog/proofs/fin-b18-partner-galaxy.test.mjs`: partner-galaxy.html (4)
- `src/pulse/catalog/proofs/fin-b18-pipeline.test.mjs`: pipeline.html (6)
- `src/pulse/catalog/proofs/fin-b18-rows.test.mjs`: guards for the row table and the three rows left red (3)

## Shared lines I touched (the integrator must merge these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | one import line (`FIN_B18_RESULT_CONTRACTS`) and one `...FIN_B18_RESULT_CONTRACTS,` line at the end of `DISPLAY_RESULT_CONTRACTS` |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | one import line and one `...FIN_B18_DISPLAY_PROOF_CASES,` line at the end of the plugin list |
| `scripts/pulse/compile-catalog.mjs` | one import line (`FIN_B18_LIVE_CASES`) and `staffProofCases: [...STAFF_UI_PROOF_CASES, ...FIN_B18_LIVE_CASES]` |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | 40 to 46 (contracts, cases, shipped data, sum, unique controls); 27 to 33 (pass-capable, passing rows); 27 to 32 (SQL batches, reads). My increase: +6 contracts, +6 pass-capable, +5 SQL texts (the two Ops & Admin rows share one text). If other batches also add contracts, add the increases together and use the number the test prints |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 635 (my decrease is 37). If other batches also lower it, add the decreases together and use the number the test prints |
| `src/pulse/catalog/generated.json` | rebuilt with `npm run pulse:catalog`. Rebuild again after merging; do not hand merge |

## Product findings (left as found, nothing fixed)

1. **Ops & Admin: the AR column sort and the AR row expand never work for a person.** `public/app/ops-admin.html` attaches both once at page parse (to the header cells of the first table row, and to `tr[data-ar]`). `paintAr` then replaces the whole table with `table.innerHTML`, so the new header cells have no handler and the new rows have no `data-ar`. Measured in Chromium with three invoices: header clicks leave the order unchanged and a row click opens no detail row. Rows left NOT_PROVED.
2. **Partner Home: no worker can be drawn.** `NODES`, `CLIENTS` and `ROUTES` are literal empty arrays in `public/app/partner-galaxy.html` and nothing pushes to them. `goWorker` can never run, the detail panel can never open, and its close button can never be reached. Row left NOT_PROVED.
3. **Partner Home: a partner is shown two sidebar rows, not the ones the row names.** The shell hides the Home and Brand Studio rows from every sidebar (`NAV_HIDDEN`), and the Marketing group starts closed. A partner sees Social Studio and Creative Factory only, after opening Marketing. The row text (and the `setGroupDefault` comment in `shell.js`) say Brand Studio is the one row a partner may open on this screen. The practice test pins what is shown today.
4. **Pipeline: the 1600px rule that hides the clock is dead.** The page's own CSS hides `.clock` at 1600px and below, but the shell's injected CSS sets `display:inline-block !important` and only hides it at 1100px and below. A laptop shows the clock. Harmless; the map row text does not say either width.
5. **Ops & Admin: the Last 7 Days choice re-reads when it is already chosen; the other periods do not.** `pick()` has `id === current && id !== '7d'`. Small.
6. **Pipeline: pressing the middle of a card often lands on its SMS or email line, which does not open the drawer.** Only the name and the empty parts of the card open it. By design in the page's click rule, noted because a person may think the card is dead.

## Commands run (all in this worktree, Mac, other builders on the same machine)

- `node scripts/pulse/count-not-proved.mjs` before: 853 total, this batch 40 of 40 open. After: 816 total, this batch 3 of 40 open (`byLane` display 680 to 643).
- `npm run pulse:catalog`: 3975 mapped, 33 repeats, 3942 unique, 3919 wired, 23 red. `generated.json` committed. `compile-catalog.mjs --check`: fresh.
- Practice tests, six browser files and the three non-browser files, three rounds, `CI=1 S4_BROWSER_PLACES=14`: 78 of 78 pass each round, 0 fail, 0 skipped.
- `node --test src/pulse/catalog/*.test.mjs src/pulse/coverage/gap-catalog*.test.mjs src/pulse/coverage/modules.test.mjs`: 60 pass, 0 fail.
- `node --test src/pulse/catalog/proofs/display-proof-cases.test.mjs` (includes "the focused proof test runs every executable test named by every case", 612 seconds): 3 of 3 pass.
- `npm run lint`: 3575 files and inline scripts parse clean.

## Product breaks (each one made once in the real page or SQL text, the matching test run, then the file put back)

Practice tests: 123 breaks across 15 product files (money.js and .html, money-transfers.js and .html, money-vault.js and .html, money-declines.js, money-helper.js, money-next.js, money-payments.js, money-setup.js, ops-admin.html, shell.js, partner-galaxy.html, pipeline.html), every one turned the matching test RED.
Live checks: 21 breaks of the SQL text (a condition flipped, a window or scope dropped, a word taken from the list). 20 turned the live test RED at once. The 21st stayed green (a redundant `NOT IN` on a column the database already constrains), so that text was removed from the check and the break dropped.
After every run the file was put back with a full-file restore and `git status` showed only test-side files changed. The script is not kept.

## Not done, on purpose

- The three rows in `not-attachable` (product findings 1 and 2). A fresh agent can recheck them with a Chromium session: open `/app/ops-admin.html` as owner with an invoices answer of three items and click a header; for the galaxy, read `var NODES = []`.
- No `na-verified` row: no row here is a retired page or an inbound-only door.
