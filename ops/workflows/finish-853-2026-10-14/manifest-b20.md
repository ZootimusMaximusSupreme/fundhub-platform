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
| 1 | desks-a / shell.js chrome — Sidebar: 9 group header buttons (fold) + collapse burger + 32 links (one inline copy per desk file) | practice-test | fin-b20-sidebar.test.mjs and fin-b20-repair-sidebar.test.mjs: the file holds nine sections and 32 links; shell.js carries the same markup; the exact set of 32 desks that load shell.js with a rail is named (and the two pages that load it with none), each carries one rail equal to the file, so a desk that loses its rail goes red; each role's rail is pinned; all nine section heads fold and unfold (the six an owner sees on a wide screen, then Home, Watch and Automation in a served copy of shell.js and the rail stylesheet with the hidden rows shown, then three heads inside the phone drawer); the collapse button and the phone drawer work. |
| 2 | desks-a / shell.js chrome — Global search button and overlay (types a name, opens a hit) | practice-test | fin-b20-shell-chrome.test.mjs (search through data.js) and fin-b20-repair-shell.test.mjs (search on lenders.html, which loads no data.js, so the shell's own request runs): the typed word arrives whole with the saved token (ampersand, hash, question mark, percent), 401 and 403 both read as signed out, a server error, a not-ok answer, a page that is not JSON and no network each read as could not run, a demo session is told to sign in and nothing is asked, and a title, subtitle, address and the typed word are drawn as words and never as markup; groups come back in the shell's order with counts; Ctrl+K, Escape, the backdrop; client, affiliate and partner get no search. |
| 3 | desks-a / shell.js chrome — Account chip: sign out | live-check | Live: SESSION_SQL (a session seen after the moment it was revoked; the expiry arm was removed because verifySession slides expires_at in the statement that stamps last_seen_at, so it could never fire). Screen: fin-b20-shell-chrome.test.mjs and fin-b20-repair-shell.test.mjs (the server is told first with the saved token; token, role, remembered client, remembered entity and a demo person are all cleared, for a real session and for a demo session, and the next load asks for a sign-in). Server: src/http/auth-logout-handler.test.mjs (the real handler revokes in both session stores, by hash) and src/auth/session.test.mjs (the one statement refuses revoked and expired rows). |
| 4 | desks-a / shell.js chrome — Account chip: avatar upload | live-check | Live: staff-photo path (AVATAR_SQL). Screen half fin-b20-shell-chrome.test.mjs: the picked picture goes as the "photo" field with the token, the chip then shows the saved photo, a refusal shows the reason, a demo session is told to sign in, a client/affiliate/partner have no control. |
| 5 | desks-b / shell.js shared chrome — Sidebar navigation: 32 static links in each desk, replaced at load by the role-filtered copy  | practice-test | fin-b20-sidebar.test.mjs and fin-b20-repair-sidebar.test.mjs: each role's visible links pinned (nine roles); the 11 hidden rows are in the markup and gated for every role; the static copy equals the shell's copy on every desk of the exact named set. |
| 6 | desks-b / shell.js shared chrome — Sidebar group headers (Home, Sales, Funding, Client ops, Watch, Automation, Marketing, Admin, | practice-test | fin-b20-sidebar.test.mjs and fin-b20-repair-sidebar.test.mjs: the six visible heads flip their group closed and open on one click and restore on the second; only the group holding the open screen starts open; Home, Watch and Automation have no head for any role (finding 3), so they are folded and unfolded in a served copy of shell.js and the rail stylesheet with the hidden rows shown; three heads fold inside the phone drawer. |
| 7 | desks-b / shell.js shared chrome — Account chip: Sign out | live-check | Live: SESSION_SQL. Screen and server halves: the same tests as the desks-a sign-out row. |
| 8 | desks-b / shell.js shared chrome — Account chip: add or change your photo (file picker) | live-check | Live: AVATAR_SQL. Screen half fin-b20-shell-chrome.test.mjs (same photo tests). |
| 9 | desks-b / shell.js shared chrome — Session check on every page load (decides which links and desks this role may see; signs out  | live-check | Live: SESSION_SQL (a session seen after its revoke moment). Page: fin-b20-shell-gate.test.mjs and fin-b20-repair-shell.test.mjs (no session goes to the sign-in with the page remembered and the remembered role cleared; the session's role overrides the remembered one and rewrites it; a real session clears a demo person left in storage; a demo session opens the page; an unknown role gets the shared staff surface) and fin-b20-repair-gate.test.mjs (a remembered role bounces a forbidden page before the session has answered, with the session held open). Server: src/auth/session.test.mjs. |
| 10 | desks-b / shell.js shared chrome — Owner-only beta banner and demo-mode banner mounted by shell.js | practice-test | fin-b20-shell-gate.test.mjs: the shipped shell lists no beta screen so no desk draws the banner; with a screen listed (the test serves shell.js with BETA_PAGES set) only the owner gets it plus a BETA badge and Dismiss removes it; Demo Mode on never paints a demo banner (removed on purpose 2026-08-01). The row text overclaims, see finding 4. |
| 11 | desks-c / shell.js — Sidebar nav: links in 9 groups (Home, Sales, Funding, Client ops, Watch, Automation, Marketing, Admin, Port | practice-test | fin-b20-sidebar.test.mjs: same role-rail and hidden-row tests as the desks-b navigation row, with NAV_HIDDEN named. |
| 12 | desks-c / shell.js — Sidebar group heads (collapse/expand), burger collapse, mobile menu button + scrim | practice-test | fin-b20-sidebar.test.mjs: heads fold, the collapse button shrinks to icons and opens every group, a second press restores, and on a phone Menu opens the drawer with a scrim that Escape, the scrim, the close button and a link all close. |
| 13 | desks-c / shell.js — Global Search button + overlay input (type to search clients, contracts, documents, conversations, cards) | practice-test | fin-b20-shell-chrome.test.mjs and fin-b20-repair-shell.test.mjs: same search tests as the desks-a row (all five groups: Clients, Contracts, Documents, Conversations, Pipeline; and the shell's own request on a desk with no data.js). |
| 14 | desks-c / shell.js — Avatar photo upload (click avatar, choose image) | live-check | Live: AVATAR_SQL. Screen half fin-b20-shell-chrome.test.mjs. |
| 15 | desks-c / shell.js — Top bar status chip: LIVE / NO API / DB DOWN word (reads /api/health on load) | practice-test | fin-b20-shell-chrome.test.mjs and fin-b20-repair-shell.test.mjs: the word comes from the bodies the REAL /api/health sends (healthState() over stand-ins: up, behind with migrations missing, unconfigured, unreachable, broken), LIVE only when ok is true and db is up, with its colour (mint, peach, rose); NO API for a missing answer or one that is not JSON; DEMO is never painted in the real-data colour. The shipped word is "NO DB", not "DB DOWN" (finding 4); its hint ignores the body's `error` and `state` (finding 9). |
| 16 | desks-c / shell.js — Beta banner Dismiss button (owner only) | practice-test | fin-b20-shell-gate.test.mjs: the control is dormant (BETA_PAGES is empty). With a screen listed in a served copy of shell.js the owner sees the banner with Dismiss and Dismiss removes it; an admin never sees it. No shipped desk draws it today. |
| 17 | desks-f / sales-floor.html — Roster row click and Enter/Space (selects that closer in the focus panel and scrolls to it) | practice-test | fin-b20-sales-floor.test.mjs and fin-b20-repair-floor.test.mjs: a click, Enter and Space each pick that closer in the focus panel and move the page to it by the page's own scrollIntoView call (judged by that call AND by the position, with the browser's own scroll-into-view out of the way: the row is clicked by the page's own event and focused without scrolling); Enter and Space are taken from the page; another key picks nobody; the panel's own arrows and name buttons pick without moving the page or asking again. |
| 18 | desks-f / sales-floor.html — Panel 'Which belief failed' (this period vs last period) | live-check | Live: BELIEF_SQL (every call that names a failed belief belongs to a client of this company). Screen and read half fin-b20-sales-floor.test.mjs: this period against last, bars against the biggest, hot only when up and three or more, empty line. |
| 19 | desks-f / sales-floor.html — Panel 'Where it is coming from' (lead source, held, close, desire) | live-check | Live: SOURCE_SQL (every logged call belongs to a client of this company; last 60 days; demo left out; the outcome-word arm was removed because the table CHECK makes it impossible to fire). Read and screen: fin-b20-sales-floor-reads.test.mjs (lead source is campaign, then source, then channel, then unknown, each step its own row; held excludes no-shows; close rate; desire sorts first) and fin-b20-sales-floor.test.mjs (at most eight rows, an honest empty line). |
| 20 | desks-f / sales-floor.html — Recording rows: name, client, 'Words ready / Waiting for words', 'Open in Drive' link (https drive. | live-check | Live: RECORDING_SQL (Drive or Docs address only, company client, Words ready backed by words; another Google host such as sites, script or mail, and a lookalike subdomain, each read wrong). Screen: fin-b20-sales-floor.test.mjs and fin-b20-repair-floor.test.mjs (name, client or "Not matched yet", Today label, Words ready / Waiting for words; a link only for https on drive.google.com or docs.google.com, in a new tab with rel noopener; "No link" for http, sites, script, mail, lookalikes, script scheme and none; the excerpt shown as words; the time in Arizona time). |
| 21 | desks-f / sales-floor.html — Panel 'Compliance' (call recording flags: shows the reason text only) | practice-test | fin-b20-sales-floor.test.mjs: the panel shows only the read's sentence (or the plain default) with no rows, chips or buttons; salesFloor() builds the sentence from recordings in three states (words on file, in Drive without words, none). |
| 22 | desks-f / sales-floor.html — Panel 'Floor discipline': calls not logged, calls not recorded, shifts late, follow-ups overdue, lo | live-check | Live: DISCIPLINE_SQL, both counted lines: a past-due booking task counted as not logged that has a disposition under its booking reference, and a held call counted as having no recording and no transcript that carries a transcript (product finding 1; the check judges exactly the calls the chip counts, and fin-b20-sales-floor-reads.test.mjs runs the real read and the real check text over the same stand-in rows and asserts the two agree). Read and screen: fin-b20-sales-floor-reads.test.mjs (listUnloggedCalls, listUnrecordedCalls, hasTape in both spellings) and fin-b20-repair-floor.test.mjs (the page is fed what the REAL salesFloor() read sends, so the shifts-late line is the page's own sentence over the read's empty list, and the follow-up and log-lag lines are the read's own words). |
| 23 | desks-f / sales-floor.html — Header chips: 'N closers on shift' and the signed-in name | practice-test | fin-b20-sales-floor.test.mjs: "N closers on shift" counts on-shift closers from the read (0 reads "0 closers on shift"); the name chip is the session's staff name, a dash when none. |
| 24 | desks-f / sidebar.fragment.html — 9 section head buttons (Home, Sales, Funding, Client ops, Watch, Automation, Marketing, Admin, | practice-test | fin-b20-sidebar.test.mjs and fin-b20-repair-sidebar.test.mjs: the nine are in the file; all nine fold and unfold (see the desks-a sidebar row). |
| 25 | desks-f / sidebar.fragment.html — Nav link: Home > Home (partner-galaxy.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 26 | desks-f / sidebar.fragment.html — Nav link: Funding > Finance OS (finance-os.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 27 | desks-f / sidebar.fragment.html — Nav link: Client ops > Consent (consent-capture.html) | practice-test | fin-b20-sidebar.test.mjs and fin-b20-repair-gate.test.mjs: in its group with its label, hidden from every rail; the page opens by its address for owner, admin, closer, funding advisor and CSM, and is closed (sent to the role's own home) for setter, sales manager, inquiry specialist, client, partner and affiliate; the whole gate table (every role against every screen) is held. Nobody can click the row (finding 3). |
| 28 | desks-f / sidebar.fragment.html — Nav link: Watch > Galaxy (galaxy.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 29 | desks-f / sidebar.fragment.html — Nav link: Watch > Ops & Admin (ops-admin.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 30 | desks-f / sidebar.fragment.html — Nav link: Automation > Agent Editor (agent-editor.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 31 | desks-f / sidebar.fragment.html — Nav link: Automation > Workflows (automations.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 32 | desks-f / sidebar.fragment.html — Nav link: Automation > Journeys (journeys.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 33 | desks-f / sidebar.fragment.html — Nav link: Admin > Hiring (hiring.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 34 | desks-f / sidebar.fragment.html — Nav link: Admin > Brand Studio (brand-studio.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 35 | desks-f / sidebar.fragment.html — Nav link: Portals > Affiliate (affiliate.html) | practice-test | fin-b20-sidebar.test.mjs: in the named group of the file with its label, points at a real screen, is on NAV_HIDDEN and gated for all nine roles with a rail, and the page still opens by its address (owner; partner for partner Home; affiliate for Affiliate). It cannot be clicked by anyone, which is the product's state (finding 3). |
| 36 | desks-f / shell.js chrome — Role gate: shell.js bounces a role that may not open this screen and hides its sidebar rows (ROLE_TA | practice-test | fin-b20-shell-gate.test.mjs and fin-b20-repair-gate.test.mjs: the 31 first-cycle role-and-page cases, plus the whole table (allowedFor() lifted out of the real shell.js and run for every role and every screen against a hand-written table), plus real Chromium cases for Hiring, Staff & Teams, Social Studio, Journeys, Contracts, Company Brain and the Consent desk, plus the remembered-role bounce before the session answers. |
| 37 | desks-f / shell.js chrome — Account chip: name, role, backend source, 'Sign out' button, hide/show chip | practice-test | fin-b20-shell-chrome.test.mjs and fin-b20-repair-shell.test.mjs: name before address, role, an unknown role marked "?", the backend word with its migration count, the x hides the bar (aria-hidden both ways) and "account" brings it back, kept across a reload; Sign out clears the token, role, remembered client, remembered entity and demo person. |
| 38 | desks-f / shell.js chrome — Avatar upload in the account chip | live-check | Live: AVATAR_SQL. Screen half fin-b20-shell-chrome.test.mjs. |
| 39 | desks-f / shell.js chrome — Chat widget (staff modes: Ask the knowledge base; message a staff peer) | live-check | Live: CHAT_PEER_SQL (person-to-person thread shape: no client, two staff of this company, key made of them, only their internal notes from a staff sender; demo threads and threads quiet for 60 days left out). Screen: fin-b20-shell-chat.test.mjs and fin-b20-repair-chat.test.mjs (the three staff modes; a refused teammate note says "Not sent (reason)."; a teammate's new note appears within the four second poll and the asking stops when the panel closes; a teammate's name, a note, an answer and its sources are drawn as words). Ask and Knowledge save nothing, so those two modes have no saved result. |
| 40 | desks-f / shell.js chrome — Clock chip, health chip and brand paint (read-only chrome) | live-check | Live: BRAND_SQL (wordmark exactly as shell.js safeWordmark() accepts it: trimmed, https then characters that are not whitespace, quote, angle bracket or parenthesis, or an image data address with a base64 body; ink unlike paper; ramp of none or six). Screen: fin-b20-shell-gate.test.mjs (clock in Arizona time, date when wide, time only when narrow, gone under 1100px, none for a client; brand paint applies and refuses) and fin-b20-repair-shell.test.mjs (no office clock for staff on the client portal or the consent desk; the brand read carries the saved token; the health word and colour). |

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
9. (cycle 1) The status chip's hint ignores what the health body says. shell.js reads a `message` field the real /api/health body never carries (it sends `error` and `state`), so a deployment that is behind on migrations, has no database address, cannot reach it or errored all read "NO DB" with the hint "The database is not reachable right now." The word is right (not LIVE); the hint can name the wrong cause.
10. (cycle 1) A sign-out press leaves no receipt (no event, no column), and a wrongly accepted expired token leaves no trace (verifySession and its account twin slide expires_at forward in the statement that stamps last_seen_at). The live check can only see a revoked token that kept being used for five minutes or more; the handler and statement are held by the existing practice tests instead.
11. (cycle 1) "Calls not logged" (`listUnloggedCalls`) has no demo filter while "Calls not recorded" does, so a demo booking task is counted on the floor panel. The live check leaves demo tasks out on purpose.
12. (cycle 1) Finding 2 is still open: the page escapes only the recording excerpt. The new tests pin that, and nothing else; lead source, file names, client names and closer names are still drawn as HTML.

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

## Repair cycle 1 (2026-10-15, branch fin/b20 continued)

An independent checker broke the product on purpose against 18 of the 40 rows and found each one stayed green. Every one was fixed by strengthening the SQL or the test, then broken again and seen red. None is removed and none is marked not attachable. The numbers do not move: 13 live checks, 27 practice tests, 0 not attachable; 40 of 40 batch rows still leave NOT_PROVED (all four lanes 813 open, `gap-catalog-display` 640).

### What each finding needed

| Row # | What stayed green | What changed |
|---|---|---|
| 22 | Calls not recorded was wrong in the product and judged nowhere; the shifts line was pinned with a shape the read never sends; demo-task filter and blank booking-reference guard were unproved | DISCIPLINE_SQL now judges both counted lines (the chip's own rows, with a transcript = wrong); the page is fed the REAL `salesFloor()` read; both directions of finding 1 are pinned in one test that also asserts the check's sample is the chip's number, row for row; demo task and blank-body rows added |
| 19 | Lead-source order never pinned; window and outcome arm untested | one row per step of the order; demo and window rows; the outcome arm is removed (the table CHECK makes it impossible to fire) |
| 20 | Only drive and docs: no other Google host in any fixture; target, excerpt escape and time zone unpinned | sites, script, mail, bare google and a lookalike subdomain in the page and SQL fixtures; widened-host break proved red; new tab, excerpt as words and Arizona time pinned |
| 17 | "Scrolls to it" never judged | judged by the page's own `scrollIntoView` call and by position, with the browser's own scroll out of the way; Enter and Space taken from the page; the panel's own controls shown not to move the page |
| 2, 13 | The shell's own request (27 desks load no data.js) never ran; encoding and escaping unjudged | tests on lenders.html: whole-word encoding, token, 401 and 403, server error, non-JSON, no network, demo, escaping |
| 15 | The state the chip exists to catch (ok false, db up, behind) was not a fixture; fixture carried a field the body never has | bodies come from the real `healthState()`; colours pinned; DEMO never in the real-data colour |
| 37 | Sign-out storage assertion vacuous; name-before-address and aria-hidden unpinned | all keys read after sign-out for a real and a demo session; both name cases; aria-hidden both ways |
| 36 | Gate never opened Hiring, Staff & Teams, Social Studio or any owner-only desk; pass 1 deletable | whole table for every role and screen from the real `allowedFor()`; Chromium cases for the named screens; pass 1 proved with the session held open |
| 3, 7 | Server side of sign-out unguarded; storage keys unread | existing handler and session tests attached; storage keys read; expiry arm removed from SESSION_SQL (could never fire) |
| 9 | Expiry arm blind; pass 1, demo cleanup and role clear untested | expiry arm removed and named as a limit; pass 1, demo cleanup and role clear tested; session statement test attached |
| 40 | BRAND_SQL looser than the shell's own rule; token, customer-screen clock and health word unpinned | BRAND_SQL is `safeWordmark()` word for word (regex, run through one JavaScript function in the stand-in); the other three pinned |
| 39 | Failed teammate send, polling and name escaping untested; three SQL clauses had no fixture | all three page tests; demo, window and sender-kind fixtures |
| 1, 5, 24 | "One inline copy per desk" only checked desks that already had a rail, with a floor of 30 | the exact set of 32 desks and the two pages with none are named; a desk that loses its rail goes red |
| 24 | Home, Watch, Automation never folded; phone drawer never clicked a head | folded in a served copy of shell.js and the rail stylesheet with the hidden rows shown; three heads folded in the phone drawer |
| 27 | Only the owner was ever sent to the Consent desk | the five roles that use it open it; the six that do not are sent home; whole gate table |

### Files added in cycle 1

- `src/pulse/catalog/proofs/fin-b20-repair-floor.test.mjs` (4 tests, Chromium): real-read discipline panel, recording rows, excerpt and time, roster scroll.
- `src/pulse/catalog/proofs/fin-b20-repair-shell.test.mjs` (11 tests, Chromium): search without data.js, status word from real health bodies, sign out, chip, clock, brand token, session.
- `src/pulse/catalog/proofs/fin-b20-repair-gate.test.mjs` (5 tests): whole gate table, Hiring, Staff & Teams, Social Studio and owner desks, Consent, pass 1.
- `src/pulse/catalog/proofs/fin-b20-repair-chat.test.mjs` (3 tests, Chromium).
- `src/pulse/catalog/proofs/fin-b20-repair-sidebar.test.mjs` (3 tests, Chromium).

### Files changed in cycle 1 (all mine, none shared)

`fin-b20-sql.mjs` (SESSION_SQL, BRAND_SQL, SOURCE_SQL, DISCIPLINE_SQL), `fin-b20-sql-kit.mjs` (regex operators in the stand-in), `fin-b20-display-contracts.mjs` (new test lists, three requirement sentences), `fin-b20-live-contracts.test.mjs`, `fin-b20-live-floor.test.mjs`, `fin-b20-sales-floor-reads.test.mjs`. `src/pulse/catalog/generated.json` is recompiled (shared; recompile after merging). No guard number moved. No product file was changed.

Two existing product tests are now attached (not edited): `src/http/auth-logout-handler.test.mjs` and `src/auth/session.test.mjs`.

### Break checks, cycle 1 (each break made alone in the product or SQL file, tests run, file restored and compared)

Every row below went red. None stayed green.

| Break | Went red in |
|---|---|
| hasTape stops counting a transcript | sales-floor-reads |
| listUnrecordedCalls selects o.transcript (the product fix) | sales-floor-reads (finding 1, pinned both ways) |
| grace window 5 minutes | sales-floor-reads |
| shifts-late fallback sentence changed | repair-floor |
| DISCIPLINE_SQL: demo-task filter removed; blank booking-reference guard removed; transcript arm removed | live-floor |
| lead-source order reversed (both queries) | sales-floor-reads, repair-floor |
| SOURCE_SQL: window removed; demo filter removed | live-floor |
| safeDriveUrl: any .google.com host; sites.google.com added | repair-floor, sales-floor |
| link without target blank; excerpt unescaped; time zone UTC | repair-floor |
| RECORDING_SQL: host rule widened to any subdomain | live-floor |
| roster: scrollIntoView removed; click and Enter scroll flag false (each); preventDefault removed | repair-floor |
| shell search: wrong address; term not encoded; title, subtitle, address, empty line unescaped; 403 as server error; token dropped; demo not short-circuited | repair-shell |
| status chip: ok check dropped; ok only; tolerant check; LIVE colour swapped; DEMO word dropped | repair-shell |
| sign out: demo person, remembered client, remembered entity each left behind | repair-shell |
| chip: email before name; aria-hidden not set | repair-shell |
| api/auth/logout.mjs: both revokes removed; account revoke removed | auth-logout-handler |
| SESSION_SQL: revoked-after-seen arm removed | live-contracts |
| src/auth/session.mjs: revoked check removed; expiry check removed | session.test |
| gate: staff-teams off FINANCE_ONLY; social-studio off OWNER_ADMIN_ONLY; HIRING_ONLY empty; pass 1 deleted | repair-gate |
| gate: closer, funding advisor, CSM each lose the consent desk; admin blocked from it | repair-gate |
| session check: demo person not cleared; remembered role not cleared | repair-shell |
| clock: customer-screen rule removed; brand read without the token | repair-shell |
| BRAND_SQL: apostrophe, `<`, `>`, `(`, `)`, double quote, whitespace each allowed; https rule widened; data rule widened or deleted; blank test loosened | live-contracts |
| chat: refused note not shown; poll removed; teammate name, note body unescaped | repair-chat |
| CHAT_PEER_SQL: demo filter, window, sender-kind arm removed | live-contracts |
| documents.html: rail renamed so the desk has none | repair-sidebar |
| head fold skips Home, Watch, Automation; head click ignored on a phone | repair-sidebar |

### Commands run, cycle 1

| Command | Result |
|---|---|
| the thirteen `fin-b20-*.test.mjs` files plus the two attached product tests in one `node --test` run | 122 tests, 122 pass, 31 seconds |
| `node --test src/pulse/catalog/*.test.mjs src/pulse/coverage/gap-catalog-{display,flow,reads}.test.mjs src/pulse/coverage/gap-door-batch-routes.test.mjs` | 70 tests, 70 pass |
| tests 1 and 2 of `display-proof-cases.test.mjs` by name | both pass |
| test 3 of `display-proof-cases.test.mjs` (runs every named test file in the branch, 2,006 tests, 8.5 minutes on a busy Mac) | 2,005 pass, 1 fail. The one failure is `e2e/teleprompter-take-flow.spec.mjs:1419` ("recording still paints and rolls on a browser without video-frame callbacks"), inside `display-batch-staff-ui.test.mjs`'s 380-spec browser run. It fails alone too and touches no file this batch changed (no product file, only proofs, the catalog and this manifest); it is not this batch's to fix. |
| `npm run pulse:catalog` | 3,975 mapped, 3,919 wired, 23 red (same as before) |
| `node scripts/pulse/count-not-proved.mjs` | 813 open in all, `gap-catalog-display` 640; 0 of the 40 batch rows open |
| `npm run lint`; `npx tsc --noEmit` | 3,581 files parse clean; no type errors |

### Left undone, cycle 1

- The live SQL has still not run against the live database. The new red that is expected on first run is the transcript half of the floor discipline check, if any held call has words and no recording address (finding 1, a real product break, not fixed here).
- When the read starts selecting `o.transcript`, `fin-b20-sales-floor-reads.test.mjs` fails at that moment; retire the transcript half of DISCIPLINE_SQL in the same change.
- Three clauses of CHAT_PEER_SQL are redundant with others (sender id null, and the scoping filters inside the participants join, kept for the size of the read). They are not a gap.

