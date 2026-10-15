# Finish the 853 — batch 20 manifest (tier 4, lane gap-catalog-display, 40 shell chrome, rail and sales-floor rows)

Builder: Sonnet, generation 1. Branch `fin/b20`, built from `fin/base` (`2f4f574a0`). Not pushed, not merged. Tests and catalog data only. No product file was changed.

## The numbers

| | Rows |
|---|---|
| Rows in batch 20 | 40 |
| `openBefore` (NOT_PROVED in this batch, `count-not-proved.mjs` on this branch before the work) | 40 |
| `openAfter` (same script, after) | 0 |
| All four lanes together | 853 before, 813 after (all 40 in `gap-catalog-display`: 680 to 640) |

Outcomes: 13 live checks, 27 practice tests, 0 verified N/A, 0 not attachable.

A live check here is a read-only SQL text the display lane judges over the real saved rows, with `emptyAs: "quiet"`: a control nobody has used in the window reads green with "no saved results yet" and goes red on the first wrong result. A practice test is a fake-data test: the real page script in a real Chromium (fake answers, every other address blocked), or the real read module over a stand-in database that carries the real column names. None of them is a live deep check of a live page; the 13 live checks are the only rows judged on live data, and the SQL has not run against the live database (no database access by design).

## Every row

| # | Row (control) | Outcome | What judges it |
|---|---|---|---|
| 1 | desks-a / shell.js chrome — Sidebar: 9 group header buttons (fold) + collapse burger + 32 links (one inline copy per desk file) | practice-test | fin-b20-sidebar.test.mjs: the file holds nine sections and 32 links; shell.js carries the same markup and so does every desk's inline copy (checked against the fragment); each role's rail is pinned; the six heads a person sees fold and unfold; the collapse button and the phone drawer work. Three of the nine heads (Home, Watch, Automation) never show for any role, so "9 fold" is true of six. |
| 2 | desks-a / shell.js chrome — Global search button and overlay (types a name, opens a hit) | practice-test | fin-b20-shell-chrome.test.mjs: the typed word is what is asked for (with the saved token), groups come back in the shell's order with counts, a hit opens its page, Ctrl+K and Escape and the backdrop work, a late answer never replaces a newer one, no match / signed out / server error each say so, client, affiliate and partner get no search. |
| 3 | desks-a / shell.js chrome — Account chip: sign out | live-check | Live: session-after-sign-out (SESSION_SQL in fin-b20-sql.mjs). Screen half fin-b20-shell-chrome.test.mjs: the server is told first with the saved token, token and role are cleared, a server that never answers does not strand the person, a client goes to the portal sign-in. |
| 4 | desks-a / shell.js chrome — Account chip: avatar upload | live-check | Live: staff-photo path (AVATAR_SQL). Screen half fin-b20-shell-chrome.test.mjs: the picked picture goes as the "photo" field with the token, the chip then shows the saved photo, a refusal shows the reason, a demo session is told to sign in, a client/affiliate/partner have no control. |
| 5 | desks-b / shell.js shared chrome — Sidebar navigation: 32 static links in each desk, replaced at load by the role-filtered copy  | practice-test | fin-b20-sidebar.test.mjs: each role's visible links pinned (nine roles); the 11 hidden rows are in the markup and gated for every role; the static copy equals the shell's copy on every desk. |
| 6 | desks-b / shell.js shared chrome — Sidebar group headers (Home, Sales, Funding, Client ops, Watch, Automation, Marketing, Admin, | practice-test | fin-b20-sidebar.test.mjs: the six visible heads flip their group closed and open on one click and restore on the second; only the group holding the open screen starts open; Home, Watch and Automation have no head for any role (finding 3). |
| 7 | desks-b / shell.js shared chrome — Account chip: Sign out | live-check | Live: SESSION_SQL. Screen half fin-b20-shell-chrome.test.mjs (same sign-out tests as the desks-a row). |
| 8 | desks-b / shell.js shared chrome — Account chip: add or change your photo (file picker) | live-check | Live: AVATAR_SQL. Screen half fin-b20-shell-chrome.test.mjs (same photo tests). |
| 9 | desks-b / shell.js shared chrome — Session check on every page load (decides which links and desks this role may see; signs out  | live-check | Live: SESSION_SQL (a session never seen after its revoke or expiry moment). Screen half fin-b20-shell-gate.test.mjs: no session goes to the staff or portal sign-in with the page remembered, the session's role overrides the remembered one and rewrites it, a demo session opens the page, an unknown role gets the shared staff surface. |
| 10 | desks-b / shell.js shared chrome — Owner-only beta banner and demo-mode banner mounted by shell.js | practice-test | fin-b20-shell-gate.test.mjs: the shipped shell lists no beta screen so no desk draws the banner; with a screen listed (the test serves shell.js with BETA_PAGES set) only the owner gets it plus a BETA badge and Dismiss removes it; Demo Mode on never paints a demo banner (removed on purpose 2026-08-01). The row text overclaims, see finding 4. |
| 11 | desks-c / shell.js — Sidebar nav: links in 9 groups (Home, Sales, Funding, Client ops, Watch, Automation, Marketing, Admin, Port | practice-test | fin-b20-sidebar.test.mjs: same role-rail and hidden-row tests as the desks-b navigation row, with NAV_HIDDEN named. |
| 12 | desks-c / shell.js — Sidebar group heads (collapse/expand), burger collapse, mobile menu button + scrim | practice-test | fin-b20-sidebar.test.mjs: heads fold, the collapse button shrinks to icons and opens every group, a second press restores, and on a phone Menu opens the drawer with a scrim that Escape, the scrim, the close button and a link all close. |
| 13 | desks-c / shell.js — Global Search button + overlay input (type to search clients, contracts, documents, conversations, cards) | practice-test | fin-b20-shell-chrome.test.mjs: same search tests (all five groups: Clients, Contracts, Documents, Conversations, Pipeline). |
| 14 | desks-c / shell.js — Avatar photo upload (click avatar, choose image) | live-check | Live: AVATAR_SQL. Screen half fin-b20-shell-chrome.test.mjs. |
| 15 | desks-c / shell.js — Top bar status chip: LIVE / NO API / DB DOWN word (reads /api/health on load) | practice-test | fin-b20-shell-chrome.test.mjs: LIVE with the migration count, NO DB with the server's words, NO API when the answer is missing or not JSON, DEMO for a demo session. The shipped word is "NO DB", not "DB DOWN" (finding 4). |
| 16 | desks-c / shell.js — Beta banner Dismiss button (owner only) | practice-test | fin-b20-shell-gate.test.mjs: the control is dormant (BETA_PAGES is empty). With a screen listed in a served copy of shell.js the owner sees the banner with Dismiss and Dismiss removes it; an admin never sees it. No shipped desk draws it today. |
| 17 | desks-f / sales-floor.html — Roster row click and Enter/Space (selects that closer in the focus panel and scrolls to it) | practice-test | fin-b20-sales-floor.test.mjs: a click, Enter and Space pick that closer in the focus panel and move the page to it with no second read; the panel's own arrows wrap and its name buttons pick. |
| 18 | desks-f / sales-floor.html — Panel 'Which belief failed' (this period vs last period) | live-check | Live: BELIEF_SQL (every call that names a failed belief belongs to a client of this company). Screen and read half fin-b20-sales-floor.test.mjs: this period against last, bars against the biggest, hot only when up and three or more, empty line. |
| 19 | desks-f / sales-floor.html — Panel 'Where it is coming from' (lead source, held, close, desire) | live-check | Live: SOURCE_SQL (every logged call belongs to a client of this company). Screen and read half fin-b20-sales-floor.test.mjs: lead source falls back campaign then source then channel then unknown, held excludes no-shows, close rate, desire sorts first, at most eight rows. |
| 20 | desks-f / sales-floor.html — Recording rows: name, client, 'Words ready / Waiting for words', 'Open in Drive' link (https drive. | live-check | Live: RECORDING_SQL (Drive address, company client, Words ready backed by words). Screen half fin-b20-sales-floor.test.mjs: name, client or "Not matched yet", Today label, Words ready / Waiting for words, link only for https on drive.google.com or docs.google.com, "No link" for http, look-alike hosts, script and none. |
| 21 | desks-f / sales-floor.html — Panel 'Compliance' (call recording flags: shows the reason text only) | practice-test | fin-b20-sales-floor.test.mjs: the panel shows only the read's sentence (or the plain default) with no rows, chips or buttons; salesFloor() builds the sentence from recordings in three states (words on file, in Drive without words, none). |
| 22 | desks-f / sales-floor.html — Panel 'Floor discipline': calls not logged, calls not recorded, shifts late, follow-ups overdue, lo | live-check | Live: DISCIPLINE_SQL, the "not logged" half (a call logged by booking reference alone must not be counted as unlogged). Read and screen half fin-b20-sales-floor.test.mjs: listUnloggedCalls and listUnrecordedCalls over the real columns (20 minute grace, no-shows, demo and other companies left out), red chips above zero, an unknown count is a dash. Shifts late, follow-ups overdue and log lag print a dash and a reason because the product has no source for them (nothing to judge); transcript-only calls: finding 1. |
| 23 | desks-f / sales-floor.html — Header chips: 'N closers on shift' and the signed-in name | practice-test | fin-b20-sales-floor.test.mjs: "N closers on shift" counts on-shift closers from the read (0 reads "0 closers on shift"); the name chip is the session's staff name, a dash when none. |
| 24 | desks-f / sidebar.fragment.html — 9 section head buttons (Home, Sales, Funding, Client ops, Watch, Automation, Marketing, Admin, | practice-test | fin-b20-sidebar.test.mjs: same head tests; the nine are in the file, six fold, three never show. |
| 25 | desks-f / sidebar.fragment.html — Nav link: Home > Home (partner-galaxy.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 26 | desks-f / sidebar.fragment.html — Nav link: Funding > Finance OS (finance-os.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 27 | desks-f / sidebar.fragment.html — Nav link: Client ops > Consent (consent-capture.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 28 | desks-f / sidebar.fragment.html — Nav link: Watch > Galaxy (galaxy.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 29 | desks-f / sidebar.fragment.html — Nav link: Watch > Ops & Admin (ops-admin.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 30 | desks-f / sidebar.fragment.html — Nav link: Automation > Agent Editor (agent-editor.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 31 | desks-f / sidebar.fragment.html — Nav link: Automation > Workflows (automations.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 32 | desks-f / sidebar.fragment.html — Nav link: Automation > Journeys (journeys.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 33 | desks-f / sidebar.fragment.html — Nav link: Admin > Hiring (hiring.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 34 | desks-f / sidebar.fragment.html — Nav link: Admin > Brand Studio (brand-studio.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 35 | desks-f / sidebar.fragment.html — Nav link: Portals > Affiliate (affiliate.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 36 | desks-f / shell.js chrome — Role gate: shell.js bounces a role that may not open this screen and hides its sidebar rows (ROLE_TA | practice-test | fin-b20-shell-gate.test.mjs: 31 role-and-page cases (each of 11 roles opens what it may and is sent to its own home from the rest, including admin from partner Home and a closer from the sales floor); the rail hides rows a role may not open (closer, sales manager, funding advisor, setter, owner). |
| 37 | desks-f / shell.js chrome — Account chip: name, role, backend source, 'Sign out' button, hide/show chip | practice-test | fin-b20-shell-chrome.test.mjs: name and role, an unknown role is marked "?", the backend word with its migration count, the x hides the bar and "account" brings it back, kept across a reload. |
| 38 | desks-f / shell.js chrome — Avatar upload in the account chip | live-check | Live: AVATAR_SQL. Screen half fin-b20-shell-chrome.test.mjs. |
| 39 | desks-f / shell.js chrome — Chat widget (staff modes: Ask the knowledge base; message a staff peer) | live-check | Live: CHAT_PEER_SQL (person-to-person thread shape: no client, two staff of this company, key made of them, only their internal notes). Screen half fin-b20-shell-chat.test.mjs: the three staff modes, Ask and Knowledge send the mode with the question and show sources, Message lists teammates, opens an existing thread, sends into it or starts one, "Pick a teammate first.", partner and affiliate get no widget. Ask and Knowledge save nothing, so those two modes have no saved result. |
| 40 | desks-f / shell.js chrome — Clock chip, health chip and brand paint (read-only chrome) | live-check | Live: BRAND_SQL (wordmark the shell accepts, ink unlike paper, ramp of none or six). Screen half fin-b20-shell-gate.test.mjs (clock in Arizona time, date when wide, time only when narrow, gone under 1100px, none for a client, ticks; brand paint applies ink, paper, six stops, faces, https wordmark, and refuses bad values) and fin-b20-shell-chrome.test.mjs (health chip words). |

## Shared files I touched (the integrator merges these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | 1 import line (`FIN_B20_RESULT_CONTRACTS`) and 1 spread line `...FIN_B20_RESULT_CONTRACTS,` at the end of `DISPLAY_RESULT_CONTRACTS` |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | 1 import line and 1 spread line `...FIN_B20_DISPLAY_CASES,` at the end of `PLUGIN_DISPLAY_PROOF_CASES` |
| `scripts/pulse/compile-catalog.mjs` | 1 import line; `staffProofCases: [...STAFF_UI_PROOF_CASES, ...FIN_B20_LIVE_CASES]` (a row is a lane-judged result case only when it is in this list) |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | guard numbers: contracts and cases 40 to 53 (+13, title "all 40" to "all 53"), pass-capable 27 to 40 (+13), SQL batches 27 to 35 (+8, the four photo rows share one text and the three session rows share one), `db.calls` 27 to 35, focused PASS rows 27 to 40, shipped-bundle cases 40 to 53. Always-red stays 13. Add the other batches' increases and use the numbers the test prints |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | `redCount` 672 to 632 (-40). Same rule: sum the decreases and use the number the test prints |
| `src/pulse/catalog/generated.json` | recompiled with `npm run pulse:catalog`. A conflict is expected; recompile after merging, do not hand-merge |

Row ids that left the lane's tracking list: the 27 practice rows are proved directly and no longer appear in `DISPLAY_TRACKING_CASES`. The 13 live rows stay in it, with their contract.

## Files added

- `src/pulse/catalog/proofs/fin-b20-rows.mjs`: the 40 exact map rows.
- `src/pulse/catalog/proofs/fin-b20-sql.mjs`: the 8 SQL texts.
- `src/pulse/catalog/proofs/fin-b20-display-contracts.mjs`: the 13 contracts, the live and practice cases, which test holds each screen half.
- `src/pulse/catalog/proofs/fin-b20-sql-kit.mjs`, `fin-b20-live-kit.mjs`, `fin-b20-browser-kit.mjs`: test kits (stand-in database with real column names; helpers; the Chromium lab built on `s5-browser-kit.mjs`).
- `src/pulse/catalog/proofs/fin-b20-live-contracts.test.mjs` (11 tests: shape guard, schema guard, photo, session, brand, chat threads) and `fin-b20-live-floor.test.mjs` (8: belief, lead source, calls not logged, recording rows).
- `src/pulse/catalog/proofs/fin-b20-sales-floor-reads.test.mjs` (5, no browser) and `fin-b20-sales-floor.test.mjs` (7, Chromium).
- `src/pulse/catalog/proofs/fin-b20-shell-chrome.test.mjs` (11), `fin-b20-shell-gate.test.mjs` (12), `fin-b20-shell-chat.test.mjs` (4), `fin-b20-sidebar.test.mjs` (8): all Chromium.
- this manifest.

## How a live check works here (so a reviewer can challenge it)

Each SQL text takes the company as `$1::uuid` and answers `sample_count` and `bad_count`. The test kit builds a stand-in database whose tables hold the real column names read from `db/schema` and `db/migrations`, runs the exact text, and for every wrong-result case does four things: a right result is counted and none is wrong; no rows reads 0 of 0; one wrong row is counted as exactly the number expected; and the same SQL with the named clause switched off reads that wrong row clean. Another company's wrong row and a demo row are never counted. `fin-b20-live-contracts.test.mjs` also checks every table and column the texts name against the schema.

What each live check can and cannot see, said plainly:

- Photo, session, brand, chat peers: they judge saved rows against the shape the code that wrote them promises. They cannot tell whether a particular press wrote its row; no per-press receipt exists.
- Session: it cannot tell that a given "Sign out" press revoked its session. It goes red when a session was seen after its revoke or expiry moment (the token kept working), which is exactly the failure the shell's own comment describes.
- Belief and lead-source panels: the table CHECKs the belief words, so the live part judges the one thing it cannot check (the call's client is this company's, or the panel's join drops the call). The arithmetic is held by the practice tests over the real read module.
- Calls not logged: judges the "not logged" half only. The other chips are held by the read and page tests.
- Recording rows: Drive-synced files only (uploaded and generated Company Brain files carry no Drive address by design).

## Product findings (nothing fixed)

1. "Calls not recorded" counts a call that has a transcript and no recording address. `listUnrecordedCalls` (`src/sales/unrecorded.mjs`) selects no transcript column and filters on `recording_url`, so `hasTape()` can never see the transcript; the panel's own words say "no recording and no transcript". The tests do not pin this (a transcript-only call is left out of the fixture).
2. `public/app/sales-floor.js` paints lead source, file names, client names and closer names as HTML without escaping (only the excerpt is escaped). Verified in Chromium: markup in a `utm_campaign` value, a Drive file name and a client name is drawn as elements. A visitor controls `utm_campaign`, so this reaches the sales manager's screen.
3. Eleven rail rows (Home, Galaxy, Ops & Admin, Agent Editor, Workflows, Journeys, Consent, Finance OS, Hiring, Brand Studio, Affiliate) are in the file but hidden from every role by `NAV_HIDDEN` (owner-set 2026-08-19), and three of the nine section heads (Home, Watch, Automation) never show. The rows are attached as guards of that decision; no one can click them, so there is no click path to prove. Same as slice 5 findings 1 and 2.
4. Stale row text: the status word is "NO DB", not "DB DOWN"; the demo-mode banner no longer exists (removed 2026-08-01, `e2e/demo-mode.spec.mjs` is its inverted guard) and shell.js lists no beta screen, so neither banner nor Dismiss is drawn on any shipped desk.
5. "Words ready" on a recording is derived from `needs_transcription = false` alone (`src/sales/recordings.mjs` `excerptFor`), not from words. The new recording check goes red on a file shown that way with no indexed words and no transcript on that client's call.
6. A call logged by booking reference alone (no task id) leaves its booking task in "Calls not logged" forever (`listUnloggedCalls` joins by `task_id` only). The new "calls not logged" check goes red on such a task.
7. The shell draws no clock on desks with no top bar (Sales floor, My numbers). By design per its comment (those get the shared account row); noted because the row says "Clock chip".
8. The chat widget's Ask and Knowledge modes save nothing, so those two modes have no saved result to judge (the same note as batch 04).

## Break checks (each break made alone in the product or SQL file, the test run, the file put back with a restore; `git status` showed only my files afterwards)

37 breaks, 37 red.

| # | Break | Test that went red |
|---|---|---|
| B1 | search: stale-answer guard removed | shell-chrome |
| B2 | client offered search | shell-chrome |
| B3 | sign out never tells the server | shell-chrome (2) |
| B4 | sign out keeps the token | shell-chrome (2) |
| B5 | photo sent under the wrong field name | shell-chrome |
| B6 | client offered the photo control | shell-chrome |
| B7 | status word changed | shell-chrome |
| B8 | chip hide not remembered | shell-chrome |
| B9 | admin allowed partner Home | shell-gate |
| B10 | sign-in forgets where you were | shell-gate |
| B11 | brand ink not validated | shell-gate |
| B12 | http wordmark accepted | shell-gate |
| B13 | beta banner for any role | shell-gate |
| B14 | clock in UTC | shell-gate |
| B15 | chat ask sent without its mode | shell-chat |
| B16 | chat thread send ignores the open thread | shell-chat |
| B17 | partner offered chat | shell-chat |
| B18 | Hiring row no longer hidden | sidebar (2) |
| B19 | section heads do not fold | sidebar |
| B20 | collapse button does nothing | sidebar |
| B21 | Hiring link points elsewhere | sidebar (2) |
| B22 | http recording link opens | sales-floor |
| B23 | belief runs hot at one | sales-floor |
| B24 | chip counts every closer | sales-floor |
| B25 | compliance default sentence changed | sales-floor |
| B26 | desire counted from the wrong belief | sales-floor-reads |
| B27 | grace window five minutes | sales-floor-reads |
| B28 | logged call counted as not logged | sales-floor-reads |
| B29 | Space no longer picks a closer | sales-floor |
| B30 | not-logged chip never red | sales-floor |
| S1 | photo SQL: demo staff counted | live-contracts |
| S2 | session SQL: window removed | live-contracts |
| S3 | brand SQL: company condition removed | live-contracts |
| S4 | chat SQL: every kind of thread counted | live-contracts |
| S5 | belief SQL: demo calls counted | live-floor |
| S6 | calls-not-logged SQL: other roles' tasks counted | live-floor |
| S7 | recording SQL: window removed | live-floor |

Inside the live tests every clause of every SQL is also switched off one at a time (`without` / `loosen` / `cut`) and the wrong row must read clean; that is another 30 or so breaks that are part of the test itself.

## Commands run (this Mac, other builders running browsers at the same time)

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs out.json` on this branch before the work, intersected with `batch-20.json` | 853 open in all; 40 of the 40 batch rows open |
| the same after | 813 open in all (`gap-catalog-display` 680 to 640); 0 of the 40 batch rows open |
| `npm run pulse:catalog` and `node scripts/pulse/compile-catalog.mjs --check` | clean (3,919 wired, 23 red, same as before) |
| the eight `fin-b20-*.test.mjs` files in one `node --test` run | 66 tests, 66 pass, 33 seconds |
| each of the five Chromium files alone, three times each | 15 of 15 runs pass |
| `node --test src/pulse/catalog/*.test.mjs src/pulse/coverage/gap-catalog-{display,flow,reads}.test.mjs src/pulse/coverage/gap-door-batch-routes.test.mjs` | 70 tests, 70 pass |
| tests 1 and 2 of `display-proof-cases.test.mjs`, reproduced as scripts (every case names one exact row and real test files; the red count) | 956 cases ok; red count 632 |
| `npm run lint` | 3,573 files parse clean |
| 37 product or SQL breaks, one at a time | 37 red (table above) |

## Left undone

- Nothing in batch 20 is open: 40 of 40 left NOT_PROVED.
- The live SQL has not run against the live database; a Postgres-only mistake would show as `skip` ("was not read") on the report, not as a false PASS. First-run reds are possible and would be real: calls not logged (finding 6), recording rows (a closer-typed off-Drive link, finding 5), photo and session are expected green.
- The whole focused proof test (`display-proof-cases.test.mjs`, about 13 minutes, runs every named file in the repo) was not run end to end; the first two of its three tests were reproduced as scripts and pass, and the eight files of this batch were run together as that test would run them (66 of 66).
