# Batch 18 manifest (finish the 853, tier 4, lane gap-catalog-display)

Branch `fin/b18`, built from `fin/base` (2f4f574a0), generation 1. Nothing was pushed or merged. Tests and test-side files only:
no product page, handler or migration was changed (`git diff fin/base` touches no file under `public/`, `api/`, `src/` product code or `db/`).

## The count

| | Rows |
|---|---|
| Rows in the batch | 40 |
| NOT_PROVED before (`count-not-proved.mjs`, this batch's ids) | 40 |
| NOT_PROVED after | 5 |
| Whole four-lane total before to after | 853 to 818 |

Outcomes: 6 live checks, 29 practice tests, 5 not-attachable, 0 na-verified (repair cycle 1 took two practice-test rows off again, see "Repair cycle 1" below).
Five of the six live-check rows also have their screen half pressed by a practice test, so a row can go red for the click or for the saved result.
The sixth (the server row of the C-suite task writer) is judged by the live check and by the real writer run through it.

## Every row

| Screen | Control | Outcome | File | What it judges (and how many product breaks it caught) |
|---|---|---|---|---|
| money.html | Back to my portal / Back to Finance OS (header link) | practice-test | `fin-b18-money-pages.test.mjs` | Client sees Back to my portal to client-portal.html; staff naming a client sees Back to Finance OS with the client id. 2 breaks red. |
| money.html | Money nav: Money (current), Accounts, Credit, Connections, Payments, Setup (6 links) | practice-test | `fin-b18-money-pages.test.mjs` | Six links in order, each to its own #tab, Money marked current, client id before the #tab for staff. Repair 1: each link is also run through the one-page frame's own script (financeos.js), so a renamed tab that would land the person on Overview is red. Breaks red: gen 1 3, repair 1 2 more. |
| money.html | Try again (button on the error panel) | practice-test | `fin-b18-money-pages.test.mjs` | A failed overview read shows the error and Try again; pressing it reads the same client again and paints the page. Repair 1: the button's own words are read (the sentence above it also says "Try again"). Breaks red: gen 1 1, repair 1 2 more. |
| money-transfers.html | Back to my portal / Back to Finance OS (header link) | practice-test | `fin-b18-money-pages.test.mjs` | Same two cases as money.html. 1 break red. |
| money-transfers.html | Money nav: Money, Next steps, Plan, Accounts, Payments, Transfers, Setup (7 links to /a... | practice-test | `fin-b18-money-pages.test.mjs` | Seven links in order, Transfers current, client id carried for staff. Repair 1: each link's destination is run through financeos.js (tabForHref) and the frame's page (tab and panel ids), so a renamed or removed tab is red. Breaks red: gen 1 3, repair 1 2 more. |
| money-transfers.html | Try again (button on the error panel) | practice-test | `fin-b18-money-pages.test.mjs` | Failed read, Try again reads again and paints the table. Repair 1: the button's own words are read. Breaks red: gen 1 1, repair 1 1 more. |
| money-transfers.html | What happened (details toggle: ledger events in words) | live-check | `fin-b18-live-contracts.test.mjs` | Live: fin-b18-transfer-events (5 conditions: no approved line, a line with no words, a bank line with no side, a line of another company or client, current status never in the story; the word list is tied to the page's own table by a test). Screen half: the fold opens on click, every line is its time and exactly its words, on the right side (fin-b18-money-pages.test.mjs). Server half, repair 1 (fin-b18-server-reads.test.mjs): the read hands the page every line with its type, time, side, who and status (moneyTransfersView), and the page's own script is run for all 14 event words, all 7 bank words, both sides, the practice-run yes and the fallback. Breaks red: gen 1 6 (screen half), repair 1 11 more (9 in the server read and the page's words, 1 SQL word list, 1 timestamps). |
| money-vault.html | Back to my portal / Back to Finance OS (header link) | practice-test | `fin-b18-money-pages.test.mjs` | Same two cases. 1 break red. |
| money-vault.html | Money nav: Money, Accounts, Credit, Applications, Funding papers (current), Connections... | practice-test | `fin-b18-money-pages.test.mjs` | Eight links, Funding papers is the current page and a page address, the rest go to their #tab (each run through financeos.js, repair 1); client carried for staff. Breaks red: gen 1 3, repair 1 2 more (shared with the other two nav rows). |
| money-vault.html | Staff: Cancel (closes an open accept/reject/sort form) | practice-test | `fin-b18-money-pages.test.mjs` | Cancel shuts the accept, reject, sort-accept and sort-reject forms, clears the form message, sends nothing. Repair 1: each of the four buttons' own words is read before it is pressed. Breaks red: gen 1 2, repair 1 6 more (each of the four renamed or blanked alone, and all four together blank and renamed). |
| money-vault.html | Try again (button on the error panel) | practice-test | `fin-b18-money-pages.test.mjs` | Failed vault read, Try again reads again and paints the papers. Repair 1: the test used to match "Try again" anywhere on the panel (the sentence "Try again in a few minutes" satisfied it); it now reads the button. Breaks red: gen 1 1, repair 1 2 more. |
| money-declines.html | Bank name text box (shown for Another bank) | practice-test | `fin-b18-money-declines-helper.test.mjs` | Another bank shows the box, a listed bank hides it, no name or spaces only is refused with focus on the box and nothing sent, a typed name is sent trimmed as bank with no application id. 5 breaks red. |
| money-declines.html | Your bank applications list | live-check | `fin-b18-live-contracts.test.mjs` | Live: fin-b18-applications-list (6 conditions: no bank name, no status, decline on another client's application, approved on reconsideration but application not Approved, still declined but not Denied, apply again later but not Denied). Screen half: bank and product text, decline words win over status words, 'A bank' fallback, empty sentence (fin-b18-money-declines-helper.test.mjs). Server half, repair 1 (fin-b18-server-reads.test.mjs): readDeclines builds each row (lender name over bank, product, status words, decline id, decline words for every outcome) and recordOutcome leaves the application Approved, Denied and Denied for the three answers. Breaks red: gen 1 4 (screen) plus every SQL condition dropped and flipped, repair 1 5 more (3 server, 2 SQL). |
| money-declines.html | Your steps list + Fundhub's steps expander (done / skipped / not done yet) | live-check | `fin-b18-live-contracts.test.mjs` | Live: fin-b18-decline-steps (5 conditions: no steps, step in another company, done or skipped with no actor, open step with a finished time, two steps sharing a place). Screen half: Done / Not done yet / Skipped marks, the fold's 'x of y done' count, no empty list or fold (fin-b18-money-declines-helper.test.mjs). Server half, repair 1 (fin-b18-server-reads.test.mjs): clientDecline sorts the steps by who does them, carries each status, counts done and skipped as done, and leaks no staff script. Breaks red: gen 1 5 (screen) plus every SQL condition dropped and flipped, repair 1 3 more (server). |
| money-helper.html | Banner: helper stopped / not switched on | live-check | `fin-b18-live-contracts.test.mjs` | Live: fin-b18-helper-stop (5 conditions: stopped with no stopped turn, stop asked by the client with no text opt-out, message made after the stop and answered, message made BEFORE the stop and answered after it (repair 1), client in another company). Screen half: banner words for stop, legal, off, stop-wins-over-off, and the Send box going away (fin-b18-money-declines-helper.test.mjs). Server half, repair 1 (fin-b18-server-reads.test.mjs): GET /api/money/helper sends halted and its reason, and on is true only for a shadow or live agent (helperIsOn). The 'not switched on' half still leaves no saved result per client. Breaks red: gen 1 4 (screen) plus every SQL condition dropped and flipped, repair 1 5 more (3 server, 2 SQL). |
| money-next.html | Check your accounts link (empty state) | practice-test | `fin-b18-money-next-pay-setup.test.mjs` | Empty list says nothing to do and links to Accounts (client id for staff), the link follows to the Money frame; a list with steps has neither. 3 breaks red. |
| money-next.html | Try again buttons (steps) and (ready card) | practice-test | `fin-b18-money-next-pay-setup.test.mjs` | Steps Try again reads steps and the ready card again; the ready card's own Try again reads only the ready card; the side card survives a steps failure. Repair 1: both buttons' own words are read. Breaks red: gen 1 4, repair 1 2 more. |
| money-payments.html | Empty state ('You do not owe Fundhub anything right now') and Error state with Try again | practice-test | `fin-b18-money-next-pay-setup.test.mjs` | No plans: the 'do not owe' sentence and no totals; a plan hides the sentence; a failed read offers Try again that asks for the same client again. Repair 1: the error heading and the button's own words are read; and fin-b18-server-reads.test.mjs runs GET /api/money/payments so a client who owes is sent their plans (the page's empty state depends on that list). Breaks red: gen 1 4, repair 1 3 more (list always empty, Reload, heading). |
| money-setup.html | Loading and error states with Try again | practice-test | `fin-b18-money-next-pay-setup.test.mjs` | Skeleton and 'Loading your setup' while the read is out, then the error (heading and Try again button read on their own) with Try again, then four steps. Breaks red: gen 1 2, repair 1 1 more (Reload). |
| money-setup.html | Step 2: See my credit link (after a pull) | practice-test | `fin-b18-money-next-pay-setup.test.mjs` | Link only when the pull is done, nothing while waiting, the Run soft pull button before; the link goes to money-credit.html. 3 breaks red. |
| money-setup.html | Step 3: Add businesses and accounts / Add more link | practice-test | `fin-b18-money-next-pay-setup.test.mjs` | 'Add businesses and accounts' until there is a container, then 'Add more' with 'Done · N container(s)'; goes to money-accounts.html. 3 breaks red. |
| ops-admin.html | Affiliates + Hiring drawer (summary row with 'Open Affiliates' link; body is fixed text... | practice-test | `fin-b18-ops-admin.test.mjs` | Drawer starts shut, row shows the dash counts, opens to the two fixed sentences, no affiliate or hiring read is made, the link goes to affiliate.html. 3 breaks red. |
| ops-admin.html | AR column header sort (click or Enter on Client, Invoice, Amount owed, Overdue, Status) | not-attachable | `-` | Product problem, measured in Chromium: after the AR read paints, header clicks leave row order unchanged. The sort handlers are attached once at page parse to the first table row; paintAr then replaces the whole table with table.innerHTML, so the new header cells carry none (no sortable class, tabIndex -1). Needs a product change. |
| ops-admin.html | AR row expand (terms, payment method, owner, outstanding, collection history) | not-attachable | `-` | Product problem, measured in Chromium: rows drawn by paintAr have no data-ar attribute (0 found) and a click opens no detail row. The expand binds to tr[data-ar] once at parse, when the table holds only the Loading row. Needs a product change. |
| ops-admin.html | hire-closer (server): writes hire / diagnose / ads-review tasks and, when LinkedIn is c... | live-check | `fin-b18-live-writer.test.mjs` | Live: fin-b18-csuite-tasks (6 conditions: hire task off the sales manager's desk, review off the owner's desk, task on a client file, kind the brain does not write, closer post failed, post marked posted with no outside id or time). Repair 1: the real createCsuiteTask AND the real hire pass (actOnPacked: calendar, task, closer job post, LinkedIn answer) run through the check over stand-in rows, so a changed marker, channel or post stamp is seen by the check; the "written twice" condition was dropped because tasks_idempotency_idx makes it impossible on Postgres. Breaks red: gen 1 every SQL condition dropped and flipped, repair 1 4 more (marker gone, wrong channel, posted with no id, task on the wrong desk, all through the real writers). |
| ops-admin.html | Open the page (owner and admin only: ops-admin.html is in OWNER_ADMIN_ONLY and NAV_HIDD... | practice-test | `fin-b18-ops-admin.test.mjs` | Owner and admin stay on the page; sales manager, closer, funding advisor, inquiry specialist, CSM and setter are sent elsewhere. 1 break red. |
| ops-admin.html | Period pill: Today / Last 7 Days / Last 30 Days / Quarter to Date (menu, Escape closes) | practice-test | `fin-b18-ops-admin.test.mjs` | Four periods, current marked, Escape and click outside close it, a choice repaints and reads KPIs and briefs for that period, the same period again reads nothing, Quarter and Today. 7 breaks red. |
| ops-admin.html | Write today's C-suite tasks (button, shown only when the calendar is packed, a gap is s... | live-check | `fin-b18-live-contracts.test.mjs` | Live: fin-b18-csuite-tasks (same text as the server row). Screen half: shown only for packed, short or ad spend above zero (with ads connected), one POST with {}, locked while it works, the words for saved / already on file / nothing new / failed, briefs read again (fin-b18-ops-admin.test.mjs, 7 breaks red). |
| ops-admin.html | Zone tabs: Money / People | practice-test | `fin-b18-ops-admin.test.mjs` | Money first, People swaps it (hidden attribute, aria-selected, tab class), Money swaps back from the keyboard. 3 breaks red. |
| partner-galaxy.html | Message Blaster for Mac: Download button (locked gift, .dmg) | practice-test | `fin-b18-partner-galaxy.test.mjs` | Signed-in partner: GET with the bearer token and the disk-image accept header, button locked, MessageBlaster.dmg saved, status words; no token or demo token: 'Sign in to download.' and no request; a reason or a bare status in the failure words. Repair 1: the button's own words (Download) are read before and after. Breaks red: gen 1 8, repair 1 2 more. |
| partner-galaxy.html | Sidebar rows a partner may open (Brand Studio only on this screen; Home, Social Studio,... | practice-test | `fin-b18-partner-galaxy.test.mjs` | Pins what a partner is shown (only Marketing is left in the rail, and it opens to Social Studio and Creative Factory; every staff desk row is hidden) and, repair 1, which screens a partner may OPEN: the five on their list stay on the address (Home, Brand Studio, Social Studio, Creative Factory, Partner training) and seven staff screens send them back to Home. See finding 3. Breaks red: gen 1 2, repair 1 3 more (a screen taken off their list twice, a staff screen added). |
| partner-galaxy.html | Sky canvas: click a cluster to zoom (5 static clusters: Fundhub fulfillment, Sales & Fu... | not-attachable | `-` | Product problem, measured in Chromium at 1400 x 900 with the camera at rest: the sky is drawn 653 px tall but shown 472 px tall (the page sizes the canvas once, before the number tiles are drawn), so the picture is squeezed while the pointer is read unsqueezed. Clicking Inquiry Removal where it is shown zooms Sales & Funding; its own click area is centred below the bottom of the sky box, so only a thin strip at the bottom edge of its glow works. The other four zoom on their own name (judged by an unattached test in fin-b18-partner-galaxy.test.mjs, 4 breaks red). Needs a product change. |
| partner-galaxy.html | Sky canvas: click a worker to open the detail panel (NODES, CLIENTS and ROUTES are empt... | not-attachable | `-` | Product problem: NODES, CLIENTS and ROUTES are literal empty arrays and nothing ever pushes to them, so no worker is drawn or hit-tested. goWorker can never run, the panel can never open. Needs a product change. |
| partner-galaxy.html | Sky canvas: click empty space or press Escape to pull back; panel close button (esc) | not-attachable | `-` | The row names the panel close button, and it is behind a panel no person can open (NODES, CLIENTS and ROUTES are empty, so no worker can be drawn or hit). The two other ways to pull back (empty space, Escape) are judged by an unattached test in fin-b18-partner-galaxy.test.mjs, but the row as written is not proved. Needs a product change (a way to open the panel), or a narrower map row. |
| pipeline.html | Card: hover tooltip (last activity from the card footer) | practice-test | `fin-b18-pipeline.test.mjs` | Hover shows 'Last activity' with the owner in bold or 'unassigned' and the tier or 'funded'; sits beside the card; leave and pointer-down hide it. 6 breaks red. |
| pipeline.html | Clear all (button in the filter panel) | practice-test | `fin-b18-pipeline.test.mjs` | Every select back to its first choice (Owner too, repair 1: a card with an owner puts the Owner choice on the board), chips and count gone, every card shown, panel stays open. Breaks red: gen 1 3, repair 1 1 more. |
| pipeline.html | Clock (Arizona time) and LIVE pill in the header | practice-test | `fin-b18-pipeline.test.mjs` | Arizona time (MST) whatever the machine zone, ticks each second, hidden on a phone; LIVE pill always. Repair 1: the laptop clock is asked whether it is SHOWN (innerText comes back for a hidden element), at 1280 px. Breaks red: gen 1 3, repair 1 2 more (hide point moved, page rule hides it). |
| pipeline.html | Drawer: Open full file link (client-control-panel.html?id=) | practice-test | `fin-b18-pipeline.test.mjs` | Card name opens the drawer; the link goes to client-control-panel.html?id= for that card's client, and follows the next card. 3 breaks red. |
| pipeline.html | Filter button (opens the panel; count of active filters) | practice-test | `fin-b18-pipeline.test.mjs` | Opens and shuts the panel with aria-expanded; the count shows each filter on, counts Sort too, stays when the panel is shut. Repair 1: the Owner choice (shown when a card has an owner) is the fourth counted control, with its chip. Breaks red: gen 1 5, repair 1 1 more. |
| pipeline.html | Filter: Age (Any / Over 1h / Over 1d / Over 3d in stage) | practice-test | `fin-b18-pipeline.test.mjs` | Over 1h / 1d / 3d keep only cards with an arrival time older than that; a card with no date never counts; chip and its cross. Repair 1: two cards whose words round UP across a choice (23h 31m reads "24h in stage", 2d 13h reads "3d in stage") are NOT over 1d and NOT over 3d. Breaks red: gen 1 6, repair 1 2 more (age read from the words, filter off). |

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

## Repair cycle 1: 21 checks an independent checker found still green on a real break

A checker broke the product on purpose under each of 21 rows and the check stayed green. Every one of them was
re-done below: either the check now goes red on that exact break (proved by breaking and restoring), or the
attachment was taken off and the row went back to NOT_PROVED with the exact reason. No product file was changed.
Open rows of this batch: 3 before the cycle, 5 after (two practice-test rows came off again). Four-lane total 816 to 818.

What was found, in one line each, so the next agent knows the pattern: a practice test that feeds the page a fake
answer cannot judge the server read behind it; a match on a sentence is not a match on the button; a test that finds a
control by its action and never reads its words passes when the words are gone; and a canvas test that scans around a
guessed spot can pass on the wrong object.

| # | Row (screen: control) | Outcome | What was wrong, and what judges it now |
|---|---|---|---|
| 1 | money-declines: Your bank applications list | live-check | The SQL had no rule for the third answer: recordOutcome sets the application to Denied for apply-again-later too, and the healthy set blessed it left at Applied. Added the condition (its own name, its own break), fixed the healthy set. The server's `decline_words` was pinned by no attached test: `fin-b18-server-reads.test.mjs` runs `readDeclines` for every outcome and `recordOutcome` for all three answers (what the check expects of the application is what the writer does). |
| 2 | money-declines: Your steps list + Fundhub's steps expander | live-check | Nothing judged the server step that sorts steps into Your steps and Fundhub's steps. `fin-b18-server-reads.test.mjs` runs `clientDecline` and `readDeclines`: split by who does them, each status carried, done and skipped counted as done, no staff script or source in the client's read, each decline reads only its own steps. |
| 3 | money-helper: Banner helper stopped / not switched on | live-check | (a) The API feed was unguarded: `fin-b18-server-reads.test.mjs` runs GET /api/money/helper and reads `halted`, `halt_reason` and `on`. (b) The SQL compared the message's created time to the stop, so a message made before the stop and answered after it was not counted: the condition is now two named ones (made after the stop and answered; made before the stop and answered after it), each with its own break. (c) `helperIsOn` is run for shadow, live, draft, retired and no agent row. The "not switched on" half still keeps nothing saved per client. |
| 4 | money-next: Try again buttons | practice-test | Nothing read the buttons' words. Both buttons' own text is asserted ("Try again"), read on the button, not on the panel whose sentence also says it. |
| 5 | money-payments: Empty state and Error state with Try again | practice-test | The server answer the page's empty state depends on was unguarded: `fin-b18-server-reads.test.mjs` runs GET /api/money/payments so a client who owes is sent their plans (and a settled plan is listed but not counted as owed). The error heading and the button's own words are now read. |
| 6 | money-setup: Loading and error states with Try again | practice-test | The button's own words and the error heading are now read. |
| 7 | money-transfers: Money nav (7 links) | practice-test | The destination was not judged. Each link is now run through the one-page frame's own script (`financeos.js`, `tabForHref`) and the frame's page (`tab-` and `fos-` ids): a renamed or removed tab lands on Overview and is red. The same check is on the money.html and money-vault.html nav rows. |
| 8 | money-transfers: Try again | practice-test | The button's own words are read. |
| 9 | money-transfers: What happened | live-check | Only 7 of 14 event words and 2 of 7 bank words were asserted, and the server mapping (`eventView`: type, time, side, who, from and to status) was open. `fin-b18-server-reads.test.mjs` runs `moneyTransfersView` over a fake store and the page's own script for every word, both sides, the practice-run yes and the fallback; the word table in the test is tied to the page's own table. The SQL's word list is tied to the page's table by a test, so the two cannot drift. The browser test now reads each line as its time and exactly its words. The SQL still cannot judge what a word means. |
| 10 | money-vault: Staff Cancel | practice-test | The test found Cancel by its action and never read it. Each of the four Cancel buttons' own words is read before it is pressed. |
| 11 | money-vault: Try again | practice-test | The test matched `/Try again/` on the whole panel, which the sentence "Try again in a few minutes" satisfied. It reads the button. |
| 12 | money.html: Try again | practice-test | The button's own words are read. |
| 13 | partner-galaxy: Message Blaster Download button | practice-test | The test found the button by id and never read it. It reads "Download" before the press and after the download. |
| 14 | ops-admin: hire-closer (server) | live-check | The LinkedIn half was shown only on hand-made rows. `fin-b18-live-writer.test.mjs` now runs the real `actOnPacked` (calendar, task, closer job post, the real `postJob` with a fake LinkedIn answer) over stand-in rows and then the check: a changed marker, channel or post stamp is seen. Also: the "written twice" condition cannot fire on Postgres (`tasks_idempotency_idx` is unique on client, source and body, NULLS NOT DISTINCT), so it was dropped. |
| 15 | partner-galaxy: Sky canvas click a cluster | not-attachable | The old test could not tell the five clusters apart and never read the zoom. Read the way a person reads it (see below), four of the five zoom on their own name and Inquiry Removal does not: clicking it where it is shown zooms Sales & Funding (measured with the camera at rest). So the row goes back to NOT_PROVED. The test for the four that work is kept, unattached. |
| 16 | partner-galaxy: Sidebar rows a partner may open | practice-test | Only the painted rail was judged. The test now opens each of the five screens on a partner's list (stays on the address) and seven staff screens (sent back to Home). |
| 17 | partner-galaxy: pull back; panel close button | not-attachable | The close button is behind a panel no person can open, so the row as written cannot be proved. The attachment is taken off. The other two ways to pull back are judged by an unattached test. |
| 18 | pipeline: Filter Age | practice-test | Two cards whose words round up across a choice (23h 31m reads "24h", 2d 13h reads "3d") are not over 1d and not over 3d. |
| 19 | pipeline: Clock and LIVE pill | practice-test | The laptop clock is asked whether it is shown (`isVisible`), not for its `innerText`. |
| 20 | pipeline: Filter button | practice-test | A card with an owner puts the Owner choice on the board: it is the fourth counted control, with its chip. |
| 21 | pipeline: Clear all | practice-test | The Owner choice is set before Clear all and read after, and the cards with no owner are back. |

### How the sky is read now (rows 15 and 17)

The page keeps its zoom in a closure no test can reach. The test hooks the 2D context before the page loads and
records, per frame, every word the page draws and the size and place of every glow. From that it reads what a person
reads: the "Sky / <cluster>" line at the top left, the cluster names, and how big and where each cluster is. A click
zooms the right cluster when the trail names it, its glow grew about 2x and it sits in the middle. The cursor over
the sky (pointing hand, zoom-out hand) is read the same way as before.

Measured at 1400 x 900, camera at rest: the canvas is drawn 653 px tall and shown 472 px tall. The page sizes it once,
before the three number tiles above it are drawn, and never again, so the picture is squeezed while the pointer is
read in unsqueezed px. A person clicks where a cluster is shown. Lead, Sales & Funding, Client-Facing Agents and Ops
Agents zoom on their own name when clicked where they are shown. Inquiry Removal is drawn at y 524 and shown at y 379;
clicking there zooms Sales & Funding; its own click area is centred at y 524, below the bottom of the sky box (472),
so only a strip of about 40 px at the bottom edge of its glow works. The same squeeze holds at 1600 x 1000 (drawn 753, shown 572) and 1280 x 720 (drawn 464, shown 292).
That is why the old test passed: it scanned for any pointing hand near a guessed spot and zoomed whichever cluster it found.

### Breaks made in this cycle (each made once in the real file or SQL text, the matching test run, then the file put back)

62 breaks, 62 turned a test red (a script, `mutate.mjs`, in the scratchpad, not kept; after every run `git status` showed only test-side files changed):

- Server and page words (19): decline_words dropped, lender name ignored, client and Fundhub steps swapped, your steps forced open, done count ignoring skipped, apply-later no longer Denied, halted false, halt_reason null, helperIsOn always true, plans always empty, event type read from to_status, leg dropped, time dropped, five event or bank words made opposite, credit side told as debit.
- SQL text (5): apply-later condition off, apply-later wrong status, queued-before-stop condition off, made-after-stop condition off, word list drifting from the page.
- Real writers (4): marker gone from the post, post filed on another channel, posted with no outside id, hire task on the wrong desk.
- Page labels and links (21): Try again renamed or blanked on money.html, money-transfers.js, money-vault.js, money-next.js (both), money-payments.js, money-setup.js; each of the four Cancel buttons renamed or blanked alone, and all four together; the financeos.js transfers and plan tabs renamed; the time stamps removed from the "What happened" lines; the payments error heading changed; the Download button blank and renamed.
- Partner screen (7): brand-studio.html and partner-training.html taken off a partner's list, pipeline.html put on it; every click zooming Fundhub, the camera never zooming, the camera zooming the sky centre, Ops Agents not clickable (the last four against the unattached sky test).
- Pipeline and clock (6): age read from the rounded words, age filter off, Owner not counted, Clear all leaving the owner on, clock hidden below 1400 px, clock losing its `display:inline-block`.

Not caught, on purpose: `hitCluster` skipping Inquiry Removal. The attached test no longer covers that cluster because it cannot honestly be proved (row 15).

Numbers, repair cycle 1, this worktree: all 93 tests of the batch pass (51 non-browser, including the new server reads and
the real hire passes, and 42 browser), 0 fail, 0 skipped, 0 todo; catalog and lane tests 81 of 81;
`compile-catalog.mjs --check` fresh; `npm run lint` clean. `count-not-proved.mjs`: 818 total, display lane 645.

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
- **A word cannot be judged by SQL.** The transfer-events check can say "the page has words for this line", never "the words mean the same as the line". The words are pinned by a Node test over the page's own script and table (`fin-b18-server-reads.test.mjs`), not by the live check.
- **The helper check reads two clocks.** `answered_at` is written from the server's clock (the request's `now`), and `halted_at` from the database's. A message answered within a moment of the stop on a skewed clock could read either way. The made-after-the-stop condition uses only the database clock.
- **A re-application on the same row reads as red.** The apply-later and still-declined conditions read the application's own status. If staff move a Denied application back to Applied on the same row (instead of making a new one), the check reports it, as it already did for still declined.

## Files added (all new, named fin-b18-*)

- `src/pulse/catalog/proofs/fin-b18-display-contracts.mjs`: the six live checks (no imports), the registry entries, the live rows and cases
- `src/pulse/catalog/proofs/fin-b18-display-proofs.mjs`: the proof cases (live and practice) built from the row table
- `src/pulse/catalog/proofs/fin-b18-rows.json`: the browser practice-test row table, by test file
- `src/pulse/catalog/proofs/fin-b18-kit.mjs`: the row tracker, shared browser, flaky read, nav and back helpers
- `src/pulse/catalog/proofs/fin-b18-sql-kit.mjs`: test kit that runs a live check over stand-in rows (real column names from `db/`)
- `src/pulse/catalog/proofs/fin-b18-live-contracts.test.mjs`: the live checks, run over stand-in rows (31 tests)
- `src/pulse/catalog/proofs/fin-b18-live-writer.test.mjs`: the real `createCsuiteTask` and the real hire pass (task and closer job post) run through the C-suite check, and the registry shape (7 tests)
- `src/pulse/catalog/proofs/fin-b18-money-pages.test.mjs`: money.html, money-transfers.html, money-vault.html (11 practice tests)
- `src/pulse/catalog/proofs/fin-b18-money-declines-helper.test.mjs`: money-declines.html, money-helper.html (4)
- `src/pulse/catalog/proofs/fin-b18-money-next-pay-setup.test.mjs`: money-next.html, money-payments.html, money-setup.html (6)
- `src/pulse/catalog/proofs/fin-b18-ops-admin.test.mjs`: ops-admin.html (5)
- `src/pulse/catalog/proofs/fin-b18-partner-galaxy.test.mjs`: partner-galaxy.html (2 attached practice tests, 2 unattached sky tests)
- `src/pulse/catalog/proofs/fin-b18-pipeline.test.mjs`: pipeline.html (6)
- `src/pulse/catalog/proofs/fin-b18-rows.test.mjs`: guards for the row tables and the five rows left red (3)
- `src/pulse/catalog/proofs/fin-b18-server-reads.test.mjs`: repair 1, the server half of five rows, run in Node over stand-in data (10 tests)
- `src/pulse/catalog/proofs/fin-b18-server-rows.json`: repair 1, the rows that file reads, by test file
- `src/pulse/catalog/proofs/fin-b18-proof-rows.mjs`: repair 1, the row tracker split out of the kit so a Node test can use it without a browser

## Shared lines I touched (the integrator must merge these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | one import line (`FIN_B18_RESULT_CONTRACTS`) and one `...FIN_B18_RESULT_CONTRACTS,` line at the end of `DISPLAY_RESULT_CONTRACTS` |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | one import line and one `...FIN_B18_DISPLAY_PROOF_CASES,` line at the end of the plugin list |
| `scripts/pulse/compile-catalog.mjs` | one import line (`FIN_B18_LIVE_CASES`) and `staffProofCases: [...STAFF_UI_PROOF_CASES, ...FIN_B18_LIVE_CASES]` |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | 40 to 46 (contracts, cases, shipped data, sum, unique controls); 27 to 33 (pass-capable, passing rows); 27 to 32 (SQL batches, reads). My increase: +6 contracts, +6 pass-capable, +5 SQL texts (the two Ops & Admin rows share one text). If other batches also add contracts, add the increases together and use the number the test prints |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 637 (my decrease is 35, was 37 before repair cycle 1 took two rows off). If other batches also lower it, add the decreases together and use the number the test prints |
| `src/pulse/catalog/generated.json` | rebuilt with `npm run pulse:catalog`. Rebuild again after merging; do not hand merge |

## Product findings (left as found, nothing fixed)

1. **Ops & Admin: the AR column sort and the AR row expand never work for a person.** `public/app/ops-admin.html` attaches both once at page parse (to the header cells of the first table row, and to `tr[data-ar]`). `paintAr` then replaces the whole table with `table.innerHTML`, so the new header cells have no handler and the new rows have no `data-ar`. Measured in Chromium with three invoices: header clicks leave the order unchanged and a row click opens no detail row. Rows left NOT_PROVED.
2. **Partner Home: no worker can be drawn.** `NODES`, `CLIENTS` and `ROUTES` are literal empty arrays in `public/app/partner-galaxy.html` and nothing pushes to them. `goWorker` can never run, the detail panel can never open, and its close button can never be reached. Row left NOT_PROVED.
3. **Partner Home: a partner is shown two sidebar rows, not the ones the row names.** The shell hides the Home and Brand Studio rows from every sidebar (`NAV_HIDDEN`), and the Marketing group starts closed. A partner sees Social Studio and Creative Factory only, after opening Marketing. The row text (and the `setGroupDefault` comment in `shell.js`) say Brand Studio is the one row a partner may open on this screen. The practice test pins what is shown today.
4. **Pipeline: the 1600px rule that hides the clock is dead.** The page's own CSS hides `.clock` at 1600px and below, but the shell's injected CSS sets `display:inline-block !important` and only hides it at 1100px and below. A laptop shows the clock. Harmless; the map row text does not say either width.
5. **Ops & Admin: the Last 7 Days choice re-reads when it is already chosen; the other periods do not.** `pick()` has `id === current && id !== '7d'`. Small.
6. **Pipeline: pressing the middle of a card often lands on its SMS or email line, which does not open the drawer.** Only the name and the empty parts of the card open it. By design in the page's click rule, noted because a person may think the card is dead.
7. **Partner Home: the sky is drawn taller than it is shown, so clicks land away from the cluster that is drawn.** `public/app/partner-galaxy.html` measures the canvas once (`resize()`, before the number tiles above it are built) and again only on a window resize. When the tiles appear the box gets shorter (1400 x 900: drawn 653 px, shown 472 px), the picture is squeezed, and the mouse position is read in unsqueezed px. Clicking Inquiry Removal where it is shown zooms Sales & Funding. Row left NOT_PROVED.
8. **Money helper: a message made before STOP can be answered after it.** `processTurn` does not look at the stop, so a turn queued for the Mac runner (or one still running) is answered after the thread is halted. The live check now reports it. Not fixed.
9. **Closer job post: a LinkedIn answer with no posting id marks the post posted with no outside id.** `postJob` COALESCEs the id, so an answer of `{}` leaves `status = posted`, `external_id = NULL`. The live check reports it (the shape of LinkedIn's answer is still unverified). Not fixed.

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

## Commands run, repair cycle 1

- `node --test src/pulse/catalog/proofs/fin-b18-*.test.mjs` (CI=1 S4_BROWSER_PLACES=14): 93 tests, 93 pass, 0 fail, 0 skipped, 0 todo.
- `node --test src/pulse/catalog/*.test.mjs src/pulse/coverage/gap-catalog*.test.mjs src/pulse/coverage/modules.test.mjs`: 81 of 81.
- `node --test --test-name-pattern=... src/pulse/catalog/proofs/display-proof-cases.test.mjs`: the two guard tests pass with red count 637.
- `npm run pulse:catalog` (3975 mapped, 33 repeats, 3942 unique, 3919 wired, 23 red), then `compile-catalog.mjs --check` fresh. `npm run lint`: 3577 files parse clean.
- `node scripts/pulse/count-not-proved.mjs`: 818 total (display 645). Before the cycle: 816.

## Not done, on purpose

- The five rows in `not-attachable`: the AR sort and AR expand (finding 1), click a worker (finding 2), click a cluster (finding 7) and the panel close button (finding 2). A fresh agent can recheck them with a Chromium session: open `/app/ops-admin.html` as owner with an invoices answer of three items and click a header; for the galaxy, read `var NODES = []`, then hook the 2D context as `fin-b18-partner-galaxy.test.mjs` does and click Inquiry Removal where it is shown.
- No `na-verified` row: no row here is a retired page or an inbound-only door.
