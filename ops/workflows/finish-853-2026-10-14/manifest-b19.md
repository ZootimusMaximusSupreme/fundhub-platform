# Batch 19 manifest (finish the 853, tier 4, lane gap-catalog-display, 40 rows)

Branch `fin/b19`, built from `fin/base` (`2f4f574a0`). Work folder `.claude/worktrees/fin-b19`. Generation 1 (resumed once after the Mac was shut down; the first pass is the earlier commits, the resume pass added the hidden-head check below), generation 2 (the challenge pass on the Sort rows), and **generation 3, repair cycle 1** (an independent checker broke the product under 23 attached rows and they stayed green; this pass is at the bottom and its table wins over any older cell above). Nothing was pushed or merged.

## The number

- Rows in the batch: 40. All 40 were NOT_PROVED at the start (`node scripts/pulse/count-not-proved.mjs`, ids intersected with `batch-19.json`): **openBefore 40**.
- After `npm run pulse:catalog` and the same script (generation 3): **openAfter 3**. The whole repo is at 816 (it was 815 before the repair cycle: the search box went back to not proved).
- The 3 left are exact `not-attachable` findings (below): the two Sort rows (one page bug) and the search box (a placeholder that promises phone and email). Nothing is faked.

| Outcome | Rows |
|---|---|
| live-check: a read-only query on saved data that goes red on a wrong saved result | 11 |
| practice-test: a real page in Chromium or the real handler, fake data, mutation-checked | 23 |
| na-verified: nothing to judge, and the computer re-reads the live shared chrome (the list AND the code that applies it) every run | 3 |
| not-attachable: exercised, but the product does not do what the row says | 3 |

A live-check row also keeps its practice test (the page half). The two answer different questions: the practice test says the control sends and paints the right thing; the live check says the result it left behind is not wrong. The live checks read nothing today (no database in this build), so on the offline count they show "skip"; the pulse judges them against the real tables.

## Every row

| # | Row (source file : surface : control) | Outcome | Where | What it judges |
|---|---|---|---|---|
| 1 | desks-e.json:public/app/pipeline.html:Filter: Owner (hidden until a card has an owner) | practice-test | `fin-b19-pipeline-controls.test.mjs` | The select is not drawn while no card has an owner. With owners it lists each owner once, in alphabetical order (the board meets them in another order), tells two owners with one first name apart, and keeps only that owner's cards. Cards are read by what the browser DRAWS (display and a box), never by the page's own `filtered` class. |
| 2 | desks-e.json:public/app/pipeline.html:Filter: Waiting on (Anyone / Us / Us - an approval amount / A bank / The client / Nothing recorded) | practice-test | `fin-b19-pipeline-controls.test.mjs` | The six choices have exactly their six words; each choice is picked BY ITS WORDS and must keep the cards of that party (us, us with no amount, bank, client, nothing recorded); the chip says the same words; the Filter counter reads 1. Cards read as drawn. |
| 3 | desks-e.json:public/app/pipeline.html:Fulfillment lens: click a chip to show only that action; Show all clears it | practice-test | `fin-b19-pipeline-controls.test.mjs` | A chip keeps only that next action (rows read as drawn), lights, the same chip again clears and goes out, a chip two clients share lights both, Show all (by its words) clears it, and the bar says N of M clients. |
| 4 | desks-e.json:public/app/pipeline.html:Headline counters: on a bank / on the client / nothing recorded (3 buttons, same filter as the select) | practice-test | `fin-b19-pipeline-controls.test.mjs` | Each button is named by its words ("2 on a bank", "1 on the client", "2 nothing recorded"), writes the Waiting on select, keeps its own cards as drawn, its chip says the select's words, and clears when pressed again. |
| 5 | desks-e.json:public/app/pipeline.html:Headline: Longest wait link (scrolls to that card and rings it; stops being a link when a filter hides the card) | practice-test | `fin-b19-pipeline-controls.test.mjs` | Names the longest-waiting card someone here must move, a click rings that card, a filter that hides it drops the link and says so, and (new) on a column of 41 cards where that card sits below the fold the click SCROLLS the column until the card is in view. |
| 6 | desks-e.json:public/app/pipeline.html:Headline: Waiting on us (big number, button that filters the board to cards someone here must move) | practice-test | `fin-b19-pipeline-controls.test.mjs` | The big number is named "Waiting on us" and reads 3, the button filters the board to those cards as drawn, pressing it again clears, and the amount choice keeps it pressed. |
| 7 | desks-e.json:public/app/pipeline.html:Lens switch: Board / Fulfillment | practice-test | `fin-b19-pipeline-controls.test.mjs` | Fulfillment hides the board, the headline and every other board-only control (search, Filter, New Client, chips, summary, filter panel, Sales note), reads the client list once, and Board gives each back exactly as it was: the shut panel stays shut, the open panel and its chip come back, the filter is kept. |
| 8 | desks-e.json:public/app/pipeline.html:Rail note on Sales: a payment does not move a card, somebody must move it to Closed Won | practice-test | `fin-b19-pipeline-controls.test.mjs` | The exact note shows on Sales and on no other rail, and comes back on Sales. |
| 9 | desks-e.json:public/app/pipeline.html:Rail tab R-01 Sales | live-check | `fin-b19-display-contracts.mjs` | The company has this pipeline with columns (its own row is one saved result, so a missing rail or a rail with no columns is red even with no card), and every card on it sits in a column of the same rail, on this company's pipeline, and names a client or partner of this company, or the tab's board drops it. Practice test (`fin-b19-pipeline-controls.test.mjs`): the tab says its code and its name, asks for its own pipeline once, paints that rail's own columns. |
| 10 | desks-e.json:public/app/pipeline.html:Rail tab R-02 Funding: Card Stacking | live-check | `fin-b19-display-contracts.mjs` | The company has this pipeline with columns (its own row is one saved result, so a missing rail or a rail with no columns is red even with no card), and every card on it sits in a column of the same rail, on this company's pipeline, and names a client or partner of this company, or the tab's board drops it. Practice test (`fin-b19-pipeline-controls.test.mjs`): the tab says its code and its name, asks for its own pipeline once, paints that rail's own columns. |
| 11 | desks-e.json:public/app/pipeline.html:Rail tab R-04 Optimization (Repair) Rounds | live-check | `fin-b19-display-contracts.mjs` | The company has this pipeline with columns (its own row is one saved result, so a missing rail or a rail with no columns is red even with no card), and every card on it sits in a column of the same rail, on this company's pipeline, and names a client or partner of this company, or the tab's board drops it. Practice test (`fin-b19-pipeline-controls.test.mjs`): the tab says its code and its name, asks for its own pipeline once, paints that rail's own columns. |
| 12 | desks-e.json:public/app/pipeline.html:Rail tab R-05 Inquiry Removal | live-check | `fin-b19-display-contracts.mjs` | The company has this pipeline with columns (its own row is one saved result, so a missing rail or a rail with no columns is red even with no card), and every card on it sits in a column of the same rail, on this company's pipeline, and names a client or partner of this company, or the tab's board drops it. Practice test (`fin-b19-pipeline-controls.test.mjs`): the tab says its code and its name, asks for its own pipeline once, paints that rail's own columns. |
| 13 | desks-e.json:public/app/pipeline.html:Rail tab R-06 AR / Collections | live-check | `fin-b19-display-contracts.mjs` | The company has this pipeline with columns (its own row is one saved result, so a missing rail or a rail with no columns is red even with no card), and every card on it sits in a column of the same rail, on this company's pipeline, and names a client or partner of this company, or the tab's board drops it. Practice test (`fin-b19-pipeline-controls.test.mjs`): the tab says its code and its name, asks for its own pipeline once, paints that rail's own columns. |
| 14 | desks-e.json:public/app/pipeline.html:Rail tab R-08 Affiliates + White Label | live-check | `fin-b19-display-contracts.mjs` | The company has this pipeline with columns (its own row is one saved result, so a missing rail or a rail with no columns is red even with no card), and every card on it sits in a column of the same rail, on this company's pipeline, and names a client or partner of this company, or the tab's board drops it. Partner cards are held to the partner's own company. Practice test (`fin-b19-pipeline-controls.test.mjs`): the tab says its code and its name, asks for its own pipeline once, paints that rail's own columns. |
| 15 | desks-e.json:public/app/pipeline.html:Rail tab R-09 Hiring | live-check | `fin-b19-display-contracts.mjs` | Same as the other rails, plus: every job application saved on a Hiring column is one the tab can never show (the tab reads `cards`, and no applicant can be a card), so each application counts as wrong. Red on the first applicant, green with none. Product finding 8. Practice test: the tab says its code and name and paints its columns. |
| 16 | desks-e.json:public/app/pipeline.html:Search box (placeholder says name, phone, or email; the filter compares the card's name text only) | not-attachable | page-gap contract in `fin-b19-display-contracts.mjs`; exercised in `fin-b19-pipeline-controls.test.mjs` | Keeps the cards whose name has the typed words (by surname and from the middle of a name too), but an email or phone typed in the box finds nothing, although the placeholder promises both. The only test that can be written pins the bug as the right answer and goes red on the fix, so it is NOT attached (same class as the Sort rows). |
| 17 | desks-e.json:public/app/pipeline.html:Sort: Manual / Name A-Z / Amount high first / Longest in stage / Amount needed first | not-attachable | page-gap contract in `fin-b19-display-contracts.mjs` (names it on the board); exercised in `fin-b19-pipeline-controls.test.mjs` | The four sorts order a column correctly (practice test green) but picking Manual after another sort leaves the sorted order, because applySort() returns on an empty choice. The row's first choice does not do what it says. Needs a product change in public/app/pipeline.html. |
| 18 | desks-e.json:public/app/pipeline.html:The x on each active filter chip (clears that one filter) | not-attachable | page-gap contract in `fin-b19-display-contracts.mjs` (names it on the board); exercised in `fin-b19-pipeline-controls.test.mjs` | The x on the Waiting on, Owner and Age chips clears only that filter (practice test green), but the x on the Sort chip clears the select and leaves the order sorted (same applySort() early return). Needs a product change in public/app/pipeline.html. |
| 19 | desks-e.json:shell.js (shared chrome):Account chip: add or change your photo (hidden file input, PNG or JPEG) | live-check | `fin-b19-display-contracts.mjs` | Every saved staff photo key sits under that person's own company and staff folder and ends .png or .jpg (green with no photos). Practice test (fin-b19-shell-chrome.test.mjs): picks a file, posts it as the photo field with the bearer, re-reads the session, shows the refusal words. |
| 20 | desks-e.json:shell.js (shared chrome):Account chip: backend badge (LIVE / NO DB / NO API / DEMO) | practice-test | `fin-b19-shell-chrome.test.mjs` | Every answer /api/health can give: LIVE (mint, with the migration count), NO DB (peach) for down, for ok:false with the database up (behind its migrations) and for ok:true with the database down, NO API (rose) for 404, for an unreachable door and for a body that is not JSON; DEMO for a demo login, drawn in the NO DB colour and never in the LIVE one. Label and colour are read off the screen. |
| 21 | desks-e.json:shell.js (shared chrome):Account chip: Sign out | practice-test | `fin-b19-shell-chrome.test.mjs` | Posts one logout with the bearer, wipes the token, role, demo and client keys, lands on /login.html (the portal page for a client); signs out anyway when the server hangs. The handler half is src/http/auth-logout-handler.test.mjs (both session stores revoked by hash), held by name. |
| 22 | desks-e.json:shell.js (shared chrome):Account chip: x hide the bar and the small 'account' button that brings it back | practice-test | `fin-b19-shell-chrome.test.mjs` | Hides the bar, shows an account button, remembers the choice across a reload, and the button brings the bar and Sign out back. |
| 23 | desks-e.json:shell.js (shared chrome):Beta banner with Dismiss (only for owner on pages listed in BETA_PAGES; the list is empty) | practice-test | `fin-b19-shell-chrome.test.mjs` | Shipped list is empty so no banner or BETA badge for any role; with a patched list the owner alone sees it, Dismiss removes it, and a reload brings it back. |
| 24 | desks-e.json:shell.js (shared chrome):Brand paint: company colors and logo applied to the chrome | live-check | `fin-b19-display-contracts.mjs` | A saved company logo (and a partner's APPROVED logo) must be what the chrome's own `safeWordmark` paints: https with no whitespace, quote, bracket or angle mark (any case), or a base64 image with nothing else in it, after trimming. The test cuts `safeWordmark` out of the shipped shell.js and runs it beside the SQL on 24 values. Page half: the brand read carries the signed-in token (the fake door answers 401 without it), the two faces ask Google Fonts by name in one link, colours and logo paint, and every unsafe value leaves the default. |
| 25 | desks-e.json:shell.js (shared chrome):Role gate: cached role bounces a role that may not open this page; session answer is authoritative; no session sends to the sign-in page | practice-test | `fin-b19-shell-chrome.test.mjs` | As before, plus the boundary: a client, an affiliate and a partner are each sent back to their own door from a CRM screen both by the cached role (before the session answers) and by the session (when the cache says owner); a client with no session goes to the portal sign-in page; and the whole ROLE_TABS table, read out of the real shell.js, equals the table the owner signed off, with the questions that matter asked of `allowedFor` for every role (no outside role opens any of 18 CRM screens; the sales floor is the owner's, the admin's and the sales manager's; the three portals each have exactly their openers). |
| 26 | desks-e.json:shell.js (shared chrome):Search button and overlay (Cmd or Ctrl K): type to search clients, contracts, documents, conversations, pipeline cards; hits are links | practice-test | `fin-b19-shell-chrome.test.mjs` | Run twice, once on a screen with the data helper and once on a screen without it (lenders.html, the raw-request path that about 25 screens use): one request with the typed words and the token, all FIVE groups in order with their heads and counts, hits are links, text a client typed is written as text (no tag built, nothing runs, the address kept whole), 403 and 500 say their words; no search button and no Control+K for a partner, a client or an affiliate, and a closer has it. |
| 27 | desks-e.json:shell.js (shared chrome):Sidebar group 'Admin' header (fold/unfold) and its links: staff-teams.html, hiring.html, products-commissions.html, contracts.html, brand-studio.html | practice-test | `fin-b19-shell-sidebar.test.mjs` | Same: owner and admin three links, sales manager two (hiring and brand-studio never show); folds and unfolds. |
| 28 | desks-e.json:shell.js (shared chrome):Sidebar group 'Automation' header (fold/unfold) and its links: agent-editor.html, automations.html, journeys.html | na-verified | `fin-b19-hidden-head.mjs`, code `catalog-display-hidden-section-head` | agent-editor.html, automations.html and journeys.html are all on NAV_HIDDEN AND the gate that applies the list is still written the way the check reads it, so shell.js hides the whole section and no role is ever shown the head. Goes back to not proved the day a row is shown or the gate changes. |
| 29 | desks-e.json:shell.js (shared chrome):Sidebar group 'Client ops' header (fold/unfold) and its links: csm-queue.html, consent-capture.html, messaging.html, documents.html, inquiry-remover.html, company-brain.html | practice-test | `fin-b19-shell-sidebar.test.mjs` | Same for the eight staff roles: each role's exact list (consent-capture never shows), head folds and unfolds. |
| 30 | desks-e.json:shell.js (shared chrome):Sidebar group 'Funding' header (fold/unfold) and its links: lenders.html, client-control-panel.html, finance-os.html | practice-test | `fin-b19-shell-sidebar.test.mjs` | Drawn for the eight staff roles with exactly their links under it (finance-os never shows); the head folds and unfolds them. |
| 31 | desks-e.json:shell.js (shared chrome):Sidebar group 'Home' header (fold/unfold) and its links: partner-galaxy.html | na-verified | `fin-b19-hidden-head.mjs`, code `catalog-display-hidden-section-head` | partner-galaxy.html is on NAV_HIDDEN AND the gate that applies the list is still written the way the check reads it, so shell.js hides the whole section and no role is ever shown the head; nothing to fold. Re-read from the live shell.js every run. |
| 32 | desks-e.json:shell.js (shared chrome):Sidebar group 'Marketing' header (fold/unfold) and its links: marketing-command-center.html, campaign-manager.html, social-studio.html, creative-factory.html, content-admin.html | practice-test | `fin-b19-shell-sidebar.test.mjs` | Same: owner and admin five links, partner two, nobody else gets the head; folds and unfolds. |
| 33 | desks-e.json:shell.js (shared chrome):Sidebar group 'Portals' header (fold/unfold) and its links: client-portal.html, affiliate.html | practice-test | `fin-b19-shell-sidebar.test.mjs` | Same: only the owner gets the head, with Client Portal alone (affiliate never shows); folds and unfolds. |
| 34 | desks-e.json:shell.js (shared chrome):Sidebar group 'Watch' header (fold/unfold) and its links: galaxy.html, ops-admin.html | na-verified | `fin-b19-hidden-head.mjs`, code `catalog-display-hidden-section-head` | galaxy.html and ops-admin.html are both on NAV_HIDDEN AND the gate is still written the way the check reads it, so shell.js hides the whole section and no role is ever shown the head. Re-read from the live shell.js every run. |
| 35 | desks-e.json:shell.js (shared chrome):Sidebar logo link (to pipeline.html) and collapse button (to icon strip; closes the drawer on a phone) | practice-test | `fin-b19-shell-chrome.test.mjs` | Logo goes to pipeline.html; the collapse button folds the rail to icons and back, and on a phone the menu button opens the drawer and the same button closes it. |
| 36 | desks-f.json:sales-floor.html (+ sales-floor.js):'Flag <belief>' button: stores a belief x source row for marketing | live-check | `fin-b19-display-contracts.mjs` | Every flag filed from the floor names a staff member of the company, says in its note the same belief and the same count the row saved, and names a lead source and a setter that some call of the company really has (a flag with no source, or a made-up one, is red). Practice test: with three beliefs and three sources on the board the button names the TOP belief and sends the top belief, the top source and that belief's own two counts. |
| 37 | desks-f.json:sales-floor.html (+ sales-floor.js):'One closer at a time': previous and next arrows and one name button per closer | practice-test | `fin-b19-sales-floor.test.mjs` | Three closers who share no number: after every Previous, Next and name button the name, the lit button, the shift line ("On shift · 1h 1m" / "Off shift" / "On shift · 10m"), the place, all four figures, the action and the offer note are that closer's own, and no second request is made. |
| 38 | desks-f.json:sales-floor.html (+ sales-floor.js):'Sync recordings from Drive': scans Drive, indexes Meet files, reloads the floor | live-check | `fin-b19-display-contracts.mjs` | The saved Drive scan state must have a scan time, a page token and no saved error (green before the first scan). Practice test: posts one empty sync, shows Checking Drive, reads the floor again, says the Drive-off words. |
| 39 | desks-f.json:sales-floor.html (+ sales-floor.js):'Today's recordings' jump button | practice-test | `fin-b19-sales-floor.test.mjs` | Scrolls the recordings panel into view and sends no request. |
| 40 | desks-f.json:sales-floor.html (+ sales-floor.js):Closer is bounced and sees 'Forbidden' (403 from the read) | practice-test | `fin-b19-sales-floor.test.mjs` | The shell sends a closer home before any floor read; a 403 read paints the Forbidden words and no numbers; the real handler refuses closer, advisor, CSM, setter and inquiry roles with no data read and lets owner, admin and sales manager through. |

## What each live check reads (all read-only, all take the company `$1`, all say green until the first wrong result)

| Check | Reads | Wrong means (bad_count) |
|---|---|---|
| 7 rail tabs | the company's own `pipelines` and `pipeline_stages` row for that rail's key, and `cards` joined to `pipelines`, `pipeline_stages`, `clients`, `partners` (the Hiring tab also reads `candidate_applications`) | the company has no such pipeline or it has no columns (the tab answers `unknown_pipeline`); the card's column belongs to another pipeline; the card's pipeline belongs to another company; the client or partner it names belongs to another company (the board drops it); on Hiring, every job application, which no card can show |
| Flag belief | `marketing_flags` filed from the sales floor, joined to `staff`, and the company's `call_outcomes`, `clients`, `client_custom_fields` | the staff member is not in the company; the note's belief is not the row's belief; the note's count is not the row's `outcome_count`; or the row's lead source and setter are not a pair some call of the company has (NULL matches nothing) |
| Sync recordings | `brain_drive_sync` | a saved error, a missing scan time, or a missing page token |
| Photo | `staff.avatar_key` | the key is not under that person's own `staff-avatars/<company>/<staff>/` folder, or is not .png or .jpg |
| Brand paint | `org_brand.wordmark_url` and the `wordmark_url` of every APPROVED `partner_brand` row | a logo the chrome's own `safeWordmark` refuses to paint, judged with the same two patterns and the same trim |

Colors, fonts and ramp are held by the table's own CHECK constraints, so a query on them could never go red; only the logo address is free text.

The SQL is written in the part of the language Postgres and SQLite read the same way. `fin-b19-display-contracts.test.mjs` runs the very SQL text on SQLite (`node:sqlite`, Node 22, casts stripped) over stand-in tables: quiet with no rows, green on good rows, red on each kind of wrong row, blind to another company, demo and archived rows; then it removes one condition at a time and shows the wrong row goes unseen (8 break cases); then it runs all 11 through the real lane (`gapChecks`) green and red.

## The hidden-head check (resume pass)

The three heads are drawn for no role, so there is no control to prove and no saved result to read. "Nothing to judge" is only allowed when the computer can check it again, so this is the same shape as the retired Decline Autopsy row and batch 06's not-shipped row:

- `src/pulse/coverage/fin-b19-hidden-head.mjs` (no imports, GET only): reads the live `/app/shell.js` once (redirects not followed), takes the built-in sidebar (`SIDEBAR_HTML`) and the `NAV_HIDDEN` list out of it, finds the head by its key and its words, and looks at every row under it.
  - every row under the head is on NAV_HIDDEN: row says `na` with code `catalog-display-hidden-section-head`;
  - one row is not on the list, or the head lists no rows: `NOT_PROVED` (the head can be drawn now);
  - the head's key or words are gone: `NOT_PROVED` (a renamed head is still a head, absence is never read as hidden);
  - anything unreadable (no GET client, non-200, not the shared chrome, a list or sidebar the reader does not understand): `skip` with the reason, never `na`.
- The claim rides on the row's contract (`contract.hiddenHead = { path, section, label }`, mode `always-red`), the way batch 06's `notShipped` does. The morning audit calls the lane's `naVerify["catalog-display-hidden-section-head"]`, which runs the same read again.
- One GET answers all three heads in a run (the audit asks one head at a time, so it makes one GET per head).
- Verified live on this Mac once: the live shell.js reads hidden for all three, same as the repo file.

## Files added

All under `src/pulse/catalog/proofs/` unless noted.

- `fin-b19-kit.mjs`: row tracker (a row is claimed only by the callback that asserts it), shared Chromium, a page with a fake session and fake /api (`openPage`).
- `fin-b19-rows.json`: the table of controls per test file; `notAttached` lists the 5 exercised-but-not-handed-over rows.
- `fin-b19-display-proofs.mjs`: turns that table into proof cases (35 attached); holds `auth-logout-handler.test.mjs` to the Sign out row by name.
- `fin-b19-not-attachable.mjs`: the 2 exact page-bug reasons (each with the sentence the board shows), and the 3 hidden heads (key, words, links) that the contract and the guards read.
- `fin-b19-rows.test.mjs`: guards (every listed row is one exact map row, no live API, 35 attached, each reason still true in the page source, and every link under the three heads still on NAV_HIDDEN, in the stylesheet, and in the sidebar fragment).
- `fin-b19-pipeline-controls.test.mjs`: 18 pipeline rows (11 practice, 7 rail tabs also live, 2 not attached).
- `fin-b19-shell-chrome.test.mjs`: 9 shared-chrome rows.
- `fin-b19-shell-sidebar.test.mjs`: 8 sidebar section heads (5 proved, 3 not reachable and judged by the hidden-head check).
- `fin-b19-sales-floor.test.mjs`: 5 sales floor rows, plus the real `api/read/sales-floor.mjs` handler on a stand-in database.
- `fin-b19-display-contracts.mjs` and `fin-b19-display-contracts.test.mjs`: the 11 live checks and their SQL tests, plus (resume pass) 3 hidden-head contracts and 2 page-gap contracts, all `always-red` with no SQL.
- `src/pulse/coverage/fin-b19-hidden-head.mjs` and `src/pulse/coverage/fin-b19-hidden-head.test.mjs` (resume pass): the hidden-head reader and its 10 practice tests (real shell.js in, broken on purpose, answer changes).
- `ops/workflows/finish-853-2026-10-14/manifest-b19.md`: this file.

## Shared lines I touched (for the integrator)

| File | Change |
|---|---|
| `src/pulse/catalog/compiler.mjs` | one block (about 15 lines, marked `fin-b19`) before `const resultsByKey`: a tracked display row whose impact is NOT money, customer data or customer message, and that owns a registered contract, is judged even when no spec names it. The sibling block for money and customer rows (fin/b06) does the same for the other impacts; merge the two into one loop with no impact filter. |
| `src/pulse/catalog/proofs/display-saved-result.mjs` | one import line and `...FIN_B19_DISPLAY_CONTRACTS,` at the end of `DISPLAY_RESULT_CONTRACTS` |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | one import line and `...FIN_B19_DISPLAY_PROOF_CASES,` at the end of the plug-in list |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 637 (35 rows left it) |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | contracts 40 to 56, PASS-capable 27 to 38, SQL batches 27 to 38, db calls 27 to 38, always-red (unmeasured) 13 to 18, shipped-bundle count 40 to 56; in the whole-lane tests "not proved" 13 to 15 (the two pipeline gap contracts) and a new line says the three heads are "skip" under that test's stub (it answers the menu page, not shell.js) |
| `src/pulse/coverage/gap-catalog-display.mjs` | resume pass, 3 lines: one import of `fin-b19-hidden-head.mjs`; `const hiddenHeads = await judgeHiddenHeads(DISPLAY_TRACKING_CASES, ctx);` and `if (hiddenHeads.has(entry.id)) return hiddenHeads.get(entry.id);` as the first line of `judge`; one entry `[HIDDEN_HEAD_CODE]: ...verifyHiddenHead(...)` in `naVerify`. Batch 06 adds the same three lines for `fin-b06-not-shipped.mjs`: keep both (two imports, two `const` lines, two `if` lines, two `naVerify` entries). |
| `src/pulse/na-conditions.mjs` | resume pass: one new code `catalog-display-hidden-section-head` in `NA_CONDITIONS`, just before `no-sender`, `verify: "lane"`, about 18 lines. Batches 03 and 06 add codes in the same list: keep all. |
| `src/pulse/na-conditions.test.mjs` | resume pass, four edits that keep the closed list honest: the sorted code list gains the code and the title says "fifteen"; the lane-code loop gains it and the title says "ten lane codes"; one sentence sample. If another batch also adds a code, merge the arrays by hand and fix the two titles. |
| `src/pulse/catalog/generated.json` | rebuilt with `npm run pulse:catalog`; recompile after merging, do not hand-merge |

Guard numbers are sums of every batch: re-derive them after the merge (`56` = 40 + my 11 + 3 hidden heads + 2 page gaps; `18` unmeasured = 13 + 3 + 2; `637` = 672 - my 35). The hidden-head and page-gap rows are tracked rows that are not on the red-count list (they own a contract but no proof case), so the 637 number does not move for them.

## Product findings (not fixed)

1. **Sort "Manual" and the x on the Sort chip do not give the first order back.** `applySort()` in `public/app/pipeline.html` starts with `if(!mode) return;`. Choose Name, then Manual (or press the x on the Sort chip): the select and the chip clear and every column stays sorted until reload. Measured in Chromium. The two rows stay NOT_PROVED; the practice test pins the behaviour and goes red the day it is fixed.
2. **Home, Watch and Automation section heads are drawn for no role.** Every link under them is on shell.js `NAV_HIDDEN` and in `crm-sidebar.css`, so `gateLinks()` hides the whole section. Measured for owner, admin, sales manager, closer, funding advisor, CSM, setter, inquiry specialist and partner. Same as the S5 finding. The three rows now say "nothing to judge" and are re-checked from the live shell.js every run; if the owner means the heads to be seen, taking a row off `NAV_HIDDEN` (and out of `crm-sidebar.css`) puts the rows back to not proved on the next run. Also, Admin never shows Hiring or Brand Studio, Funding never shows Finance OS, Client ops never shows Consent, Portals never shows Affiliate.
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
| resume pass: `node --test src/pulse/coverage/fin-b19-hidden-head.test.mjs` | 10 of 10 pass (and each of the six breaks above turns it red) |
| resume pass: `npm run pulse:catalog`, `compile-catalog.mjs --check`, then the count script | total 815; batch rows open 2 (Sort Manual, the x on the Sort chip); check exits 0 |
| resume pass: `node --test src/pulse/coverage/gap-catalog-display.test.mjs src/pulse/na-conditions.test.mjs src/pulse/self-audit.test.mjs src/pulse/scorecard.test.mjs src/pulse/coverage/modules.test.mjs src/pulse/tripwires.test.mjs src/pulse/catalog/proofs/fin-b19-rows.test.mjs src/pulse/catalog/proofs/fin-b19-display-contracts.test.mjs` | all pass, 0 skipped (`self-audit.test.mjs` "a real database timeout stops later serial checks" failed once at load average 300 and passed alone and in the repeat) |
| resume pass: the 8 older `display-contracts-*`, `door-proof`, `data-proof-cases`, `read-proof-cases` tests again | 1091 of 1091 pass, 0 skipped |
| resume pass: the fast tests in the first line of this pass again (catalog, gap-catalog, modules, tripwires, na-conditions, self-audit, scorecard, hidden-head, rows, display-contracts) | 296 of 296 pass, 0 skipped |
| resume pass: `display-proof-cases.test.mjs`, the two guard tests only (every case names one exact row; red count 637) | 2 of 2 pass. The "focused proof test" in the same file was not re-run: nothing it runs changed in this pass (no proof case was added or moved), and the Mac was at load average 300 or more |
| resume pass: the 4 browser test files again (pipeline, chrome, sidebar, floor) | 34 of 34 pass, 0 skipped (11, 10, 7, 6) |
| `npm run lint` | first pass 3572 files parse clean; resume pass 3574 files and inline scripts parse clean (exit 0) |
| `npx tsc --noEmit` | exit 0 on both passes (checkJs is off by repo design) |

### Break checks (each product break made alone in a second worktree, test run, file restored)

Each of the 50 product breaks below turned the named test red. Four other edits stayed green on purpose and are named after the list. The resume pass added six more, for the hidden-head check, listed after the first block.

- Pipeline (public/app/pipeline.html), 19: Action Required counted as bank; Owner select always drawn; Owner filter does nothing; search reads the whole card; amount sort reversed; age sort reversed; name sort does nothing; needs sort ignores the amount; us_amount same as us; chip x clears every filter; filter counter wrong; headline picks the newest wait; headline button cannot clear; hidden longest wait says nothing; fulfillment read drops the flag; fulfillment chip cannot clear; lens leaves the headline up; R-05 asks for hiring; rail note on every rail.
- Shell (public/app/shell.js, data.js), 22: demo label; live label; logout wrong URL; token kept; hangs when the server hangs; hide not remembered; photo field name; photo not re-read from the session; beta shown to everyone; beta Dismiss dead; ink not checked; unsafe logo accepted; session never bounces; no session stays; cached bounce removed; search sends the wrong words (data.js); Control+K dead; collapse dead; Watch heads visible; section head click dead; lenders and admin rows offered to every staff role.
- Sales floor and handlers, 9: previous dead; flag count wrong; flag source dropped; jump does not scroll; sync wrong URL; sync does not reload; floor gate widened to every staff role; Forbidden words changed; logout skips the account session store.
- SQL: 8 conditions removed one at a time, the wrong row goes unseen each time.

Hidden-head check (resume pass), each edit made alone, `fin-b19-hidden-head.test.mjs` run, file restored:

- reader always says "hidden": 5 tests red (real file, take-a-row-off, whole lane, audit, verifyNa);
- an unreadable page read as "hidden": 2 tests red (unread is not hidden, audit);
- a head that is gone read as "hidden": 1 test red (renamed or re-keyed head);
- the lane stops calling the reader: 2 tests red (whole lane, verifyNa);
- the lane's audit door removed: 2 tests red (audit, verifyNa);
- the page itself: `journeys.html` taken off `NAV_HIDDEN` in the real `public/app/shell.js`: 5 tests red across `fin-b19-hidden-head.test.mjs` and `fin-b19-rows.test.mjs` (the Automation head can be drawn now). File restored.

Stayed green on purpose (not product breaks): the two redundant wrap guards in `paintCloserFocus` (modulo already wraps); `NAV_HIDDEN` edited alone for Finance OS (the stylesheet also hides it); `CLOSER_DESK_ONLY` emptied (it moves My numbers in the Sales head, which is not one of these rows); removing the empty-choice return in `applySort` (the pinned finding is unchanged by it).

### Heads up for siblings

I wrote two helper files into the shared scratchpad folder under the names `mutate.py` and `runmut.sh` before I saw other builders' files there. If one of yours misbehaves, that is why; they are small and have no effect on the repo.

## Left undone and why

- The 2 not-attachable rows (Sort Manual, and the x on the Sort chip) need a product change in `public/app/pipeline.html`: `applySort()` has to give the first order back on an empty choice. Until then they stay NOT_PROVED, and the board now shows the exact sentence (a page-gap contract) instead of "no contract attached".
- The three hidden-head rows are only as good as the live read: if fundhub.ai cannot be reached from the pulse they show `skip`, never `na`.
- The hiring rail check will say "no results yet" for as long as no card is placed there (hiring applications are not `cards`); it can still go red on the first wrong card.
- `fin-b19-display-contracts.test.mjs` needs `node:sqlite` (Node 22.13 or newer; the repo's engines and CI are 22.x).

## Generation 2: the challenge pass on the two open rows (Sort, and the x on the Sort chip)

Asked to challenge every earlier "not attachable" reason and attach unless the reason is exactly true. No source file changed in this pass. Result: the reason is exactly true, so both rows stay `not-attachable`.

What was checked, and what it said:

| Check | Result |
|---|---|
| `git diff fin/base main -- public/app/pipeline.html` | empty: `main` has the same page, nobody fixed it since |
| Read `applySort()` and the chip x handler in `public/app/pipeline.html` | `applySort()` starts with `var mode=fSort.value; if(!mode) return;`. The chip x handler sets the select to empty and calls `applySort()` for the Sort chip on purpose (`if(c.el===fSort) applySort();`), so the page's own author meant "give the order back". The call does nothing. |
| The page keeps no copy of the first order | Cards are moved with `insertBefore`, and nothing records where they were. So even removing the early return would not restore anything (the comparator answers 0 and the sort is stable). It needs a page change that remembers the first position of each card. |
| `fin-b19-pipeline-controls.test.mjs` in Chromium, real page, fake `/api` | 11 of 11 pass: the four sorts order a column correctly, and Manual and the Sort chip x both leave the columns in the last sorted order (pinned) |
| Tripwire flip, done once and put back: a 3-line edit to `applySort()` (stamp each card's first position in a data attribute, sort by it on an empty choice) | tests 4, 5 and 11 go red with the words "If this fails the product was fixed: attach the Sort row" and "...attach the chip row". `git checkout public/app/pipeline.html` put the page back; `git status` clean. So the day the page is fixed, a person is told exactly what to do. |
| Could a live check read a saved result instead? | No. Sort and chips "call no request", write no row, and keep nothing in storage. The only result is the order of the cards on screen. |
| Could a practice test be attached for the part that works? | Not honestly. A green test on the four working sorts would take the row off the board while the first choice, Manual, still does not do what its name says. A test that passes because the bug is there goes red on the fix. Neither is allowed. |

How to attach the two rows the day the page is fixed (nothing to invent):

1. In `fin-b19-pipeline-controls.test.mjs`, flip the two pinned assertions to expect the first order (`["Zed Zane", "Alice Adams", "Finn Fox", "Dan Dyer"]` in `new_lead`).
2. Move the two ids out of `notAttached` in `fin-b19-rows.json` so the proof chain attaches them, and delete the two entries in `fin-b19-not-attachable.mjs` and the two page-gap contracts in `fin-b19-display-contracts.mjs`.
3. `npm run pulse:catalog`. Both rows leave the lane.

Numbers for this generation: `openBefore` 40 (re-measured at `fin/base`, 853 total), `openAfter` 2 (815 total).

Commands run this pass, all exit 0, 0 skipped:

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` at `fin/base`, ids intersected with `batch-19.json` | total 853, batch rows open 40 |
| the same on `fin/b19` | total 815, batch rows open 2 (the two Sort rows) |
| `node scripts/pulse/compile-catalog.mjs --check` | exit 0 (3975 mapped, 3919 wired, 23 red) |
| `node --test` pipeline controls, shell chrome, shell sidebar, sales floor | 11 + 10 + 7 + 6 pass |
| `node --test` rows, display contracts, hidden head, gap-catalog-display, na-conditions, modules, tripwires | 94 of 94 pass |
| `node --test src/pulse/catalog/*.test.mjs` with the three browser files above | 65 of 65 pass |

## Generation 3: repair cycle 1 (an independent checker broke the product under 23 attached rows and they stayed green)

The checker's words were: every one of these checks "stays green when the product breaks". Each is now held by a test that goes red on that exact break (broken and restored, see the list below), or has had its attachment removed.

Numbers (`node scripts/pulse/count-not-proved.mjs`, ids intersected with `batch-19.json`): batch rows open at the start of this pass **2** (the two Sort rows), at the end **3** (the two Sort rows and the search box). Repo total 815 to 816. Nothing was pushed or merged.

### The 23 rows

| # | Row | Final outcome | What was wrong, and what holds it now |
|---|---|---|---|
| 1 | Filter: Owner | practice-test | Cards were read by the page's `filtered` class. Now read by what is drawn. Owner list order and two owners with one first name are held (fixture: met as Reed, Blake, Stone). |
| 2 | Filter: Waiting on | practice-test | Option words were never asserted. Now each choice is picked by its words and must keep that party's cards; the six words are pinned; the chip says the same. |
| 3 | Fulfillment lens chip | practice-test | Rows read by the class; the lit chip never asserted. Now rows read as drawn, the lit chip is asserted for one and two clients and goes out on clear. |
| 4 | Headline counters | practice-test | Button words never asserted. Now "2 on a bank" / "1 on the client" / "2 nothing recorded" are pinned, with drawn cards and the chip words. |
| 5 | Longest wait link | practice-test | Scroll never asserted (all cards were inside the screen). New test: 41 cards in one column, the named card at the bottom; the click must scroll the column until it is in view. |
| 6 | Waiting on us | practice-test | Eyebrow words and the drawn cards were not asserted. Both are now. |
| 7 | Lens switch | practice-test | Only the board row and headline were asserted. Now all eight board-only controls are asserted hidden while the lens is up and restored exactly (shut panel stays shut, open panel and chip come back, filter kept, Sales note away and back). |
| 8 | Rail tab R-01 Sales | live-check | Missing rail read green; company-match arms never held; tab word not asserted. SQL rewritten (see below), cross-company arms seeded and broken one at a time, tab code and name asserted for all seven tabs. |
| 9 | Rail tab R-02 Funding | live-check | Same as row 8. |
| 10 | Rail tab R-04 Optimization | live-check | Same as row 8. |
| 11 | Rail tab R-05 Inquiry Removal | live-check | Same as row 8. |
| 12 | Rail tab R-06 AR / Collections | live-check | Same as row 8. |
| 13 | Rail tab R-08 Affiliates + White Label | live-check | Same as row 8, with the partner-in-company arm held (the one that matters most on this rail). |
| 14 | Rail tab R-09 Hiring | live-check | The check read `cards`, which nothing writes for hiring, so it could never leave green. Now it also counts every job application on a Hiring column as a person the tab cannot show. Red on the checker's stand-in (25 applications, no card). Product finding 8. |
| 15 | Search box | **not-attachable** | The test pinned the bug (an email or phone matches nothing) as correct. Attachment removed; the row is NOT_PROVED with the exact sentence on the board; the test stays as a tripwire that says "attach the Search row" the day the filter reads phone and email. |
| 16 | Account chip: backend badge | practice-test | Only three health answers and no colour. Now five answers plus unreachable and not-JSON, label and colour read off the screen, DEMO never in the LIVE colour. |
| 17 | Brand paint | live-check | Fake door ignored the token; SQL looser than the chrome and blind to `partner_brand`; font link and inline images unchecked. All four closed (the chrome's own `safeWordmark` runs beside the SQL in the test). |
| 18 | Role gate | practice-test | Only closer, owner and sales manager on one page. Now the three outside principals are bounced both ways, and the whole role table is pinned and questioned through `allowedFor`. |
| 19 | Search button and overlay | practice-test | Two of five groups, one request path, no escaping check, one outside role. Now all five groups, both request paths, hostile text, and all three outside roles. |
| 20 | Sidebar group 'Home' | na-verified | The live reader read only the list and the markup. Now it also reads the code that applies the list; the checker's three breaks send all three heads back to NOT_PROVED. |
| 21 | Sidebar group 'Watch' | na-verified | Same as row 20. (Automation shares the reader and is covered the same way.) |
| 22 | 'Flag <belief>' | live-check | Both halves were blind to the belief and the source. Fixture now has three beliefs and three sources and must send the top of each; the SQL judges belief, count and source pair. |
| 23 | 'One closer at a time' | practice-test | Closers had identical numbers. Now three closers share no figure, and every figure, the shift line and the offer note follow the pick. |

Outcome totals for these 23: live-check 9 (rows 8 to 14, 17 and 22), practice-test 11 (rows 1 to 7, 16, 18, 19 and 23), na-verified 2 (rows 20 and 21), not-attachable 1 (row 15).

### The new SQL, in words

- Rail tab (all seven): one result row for the company's own pipeline-and-columns (wrong when missing), plus one per card on the rail. A card is wrong when its column belongs to another pipeline, its pipeline belongs to another company, or the client or partner it names belongs to another company. The arms the live database cannot hold (stage NULL, no person: NOT NULL, the foreign keys and `cards_client_or_partner_chk` forbid them) are not written. Demo cards, demo clients and archived clients are left out as the board leaves them out. Hiring adds one wrong row per job application.
- Flag belief: staff in company; the note starts with the row's belief; the note's count is the row's count; the (lead source, setter) pair exists on some call of the company logged before the period ended. A NULL source or setter matches no call, so it is red by the same test. Edge: a flag goes red if every call that carried its source is later deleted.
- Brand logo: `org_brand` and approved `partner_brand` logos, trimmed, then the chrome's two patterns (`regexp_replace` as a function so Postgres and the SQLite stand-in read the same text). Whitespace is `\s`; exotic Unicode spaces depend on the Postgres collation.

### Break checks for this pass (each made alone, the named test run, the file restored)

Product breaks, run with a scratch runner that restores the file in a `finally`: 38 in `public/app/pipeline.html`, `public/app/shell.js` and `public/app/sales-floor.js`, every one turned its test red.

- Pipeline (16): `.card.filtered` rule removed; `.fh-lens-row.filtered` rule removed; lit chip never lit; bank and client words swapped; "Nothing recorded" reworded; approval-amount reworded; bank button reworded; nothing-recorded button reworded; eyebrow reworded; scroll removed; restore springs controls open; Sales note not put away; Sales tab renamed; Hiring tab renamed; owner list unsorted; owner matched by first letter.
- Shell (17): health `ok` guard removed; unreachable health reads LIVE; non-JSON health reads LIVE; LIVE drawn rose; demo tone same as live; bearer dropped from the brand read; data-logo rule loosened to `^data:`; font link broken; client may open everything; partner may open the sales floor; session pass skips the bounce for a partner; setter may open everything; conversations dropped from search; contracts labelled Documents; hit title unescaped; search skip list narrowed to partner; fallback search asks the wrong words.
- Sales floor (5): flag sends the last belief; flag sends the last source; close-rate tile from the first closer; shift line from the first closer; cash tile from the first closer.
- SQL breaks (in `fin-b19-display-contracts.test.mjs`, 16 cases, each shows the wrong row go unseen when one condition is removed): stage of another pipeline; pipeline of another company; client of another company; partner of another company; client-named-but-missing arm; missing-rail arm; Hiring applications arm; flag count; flag belief; flag source; flag setter; flag staff; https rule loosened; inline-image rule loosened; partner approval gate; trim.
- Hidden heads (10 edits in `fin-b19-hidden-head.test.mjs`, each for all three heads, plus a decoy test and a whole-lane test): hide condition stops reading the mark; section never put away; list emptied after it is written; list emptied at run time; list cut with splice; row never marked; marked row put away with no mark; section counts a put-away row as shown; session pass never runs the gate; built-in sidebar no longer mounted.

### Commands run and what they said

| Command | Result |
|---|---|
| `npm run pulse:catalog` | exit 0: 3975 mapped, 3942 unique, 3919 wired, 23 red (regenerated three times, the last after the final contract text change; no diff on the last run) |
| `node scripts/pulse/count-not-proved.mjs` | total 816; batch rows open 3 |
| `node --test` on the 4 browser test files, `fin-b19-display-contracts.test.mjs`, `fin-b19-rows.test.mjs`, `fin-b19-hidden-head.test.mjs`, `gap-catalog-display.test.mjs`, `na-conditions.test.mjs` | 132 of 132 pass, 0 skipped (pipeline 12, chrome 10, sidebar 7, floor 6, SQL 34, rows 3, hidden head 13, gap lane and na codes the rest) |
| `node --test src/pulse/catalog/*.test.mjs src/pulse/coverage/modules.test.mjs src/pulse/tripwires.test.mjs` | 53 of 53 pass, 0 skipped |
| `display-proof-cases.test.mjs`, the two guard tests (every case names one exact row; red count) | 2 of 2 pass after the red count moved 637 to 638 |
| `display-proof-cases.test.mjs` "focused proof test" (runs every attached test of every batch) | NOT re-run in this pass. It hung at 0 percent CPU for 7 minutes on `display-batch-staff-ui.test.mjs`, which starts `@playwright/test` from this worktree; sibling agents were running the same suite at the same time on the same Mac. I killed that run. Every test file of this batch ran on its own (line 3). |
| `npm run lint` | 3574 files and inline scripts parse clean |

### Shared lines touched in this pass

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 637 to 638 (the search box is red again) |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | contracts 56 to 57; always-red (unmeasured) 18 to 19; whole-lane "not proved" 15 to 16 (twice); shipped-bundle count 56 to 57. PASS-capable 38 and SQL batches 38 are unchanged. |
| `src/pulse/na-conditions.mjs` | the comment and `claim()` sentence of `catalog-display-hidden-section-head` now say the chrome still applies the list |
| `src/pulse/catalog/generated.json` | rebuilt with `npm run pulse:catalog`; recompile after merging |

All other new logic is in files already named in this manifest (`fin-b19-*`).

### Product findings added by this pass (not fixed)

8. **The Hiring tab (R-09) on the pipeline board can never show an applicant.** It reads `cards` (`/api/dashboard/pipeline?key=hiring`). Job applicants are `candidate_applications` with their own stage; a card must name a client or a partner (`cards_client_or_partner_chk`), so no applicant can be a card. A person who opens Hiring on the board sees 11 empty columns while `hiring.html` lists the applicants. The R-09 live check goes red on the first application.
9. **The NO DB badge hint is wrong for a database that is behind its migrations.** `/api/health` answers `ok:false, db:"up", state:"behind"` with the words in `error`; the chip reads `message`, finds none, and says "The database is not reachable right now." The label NO DB is right; the sentence under it is not.
10. **The brand writer and the brand chrome disagree on the case of `https`.** `api/org-brand.mjs` refuses `HTTPS://...` when it is written; `safeWordmark` in shell.js paints one that is already stored. It also validates the trimmed logo and saves the untrimmed text. Both are harmless; the live check follows the chrome and trims.
11. **No table rule holds a partner's logo address.** `partner_brand.wordmark_url` has no CHECK, so an approved partner can hold a logo the chrome refuses and silently see the Fundhub logo. The live check now judges approved partner logos.

### Left undone and why

- The Chromium test "Home, Watch and Automation are drawn for no role" is not attached to the three head rows. They are judged by the live reader every run; the Chromium test runs in the suite. The reader reads code shapes, not behaviour: a refactor of `gateLinks` in shell.js will send the three rows to NOT_PROVED until the shapes in `APPLY_SHAPES` (in `fin-b19-hidden-head.mjs`) are updated to the new code. That is the safe direction.
- The three not-attachable rows (Sort Manual, the x on the Sort chip, the search box) need page changes in `public/app/pipeline.html`.
- The R-09 live check will be red as soon as the first job application exists, until the tab is made to show applicants or is removed. That is the finding, not a flaw in the check.
- The "focused proof test" that runs every batch's attached tests together was not re-run (see above).
