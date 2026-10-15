# Finish the 853 - batch 12 manifest

Branch `fin/b12`, built from `fin/base` (`2f4f574a0`). Tier 4, lane `gap-catalog-display`, 40 rows. Nothing was pushed or merged.
Generation 1 attached 37 rows. Generation 2 challenged the 3 that were left, kept all 3 as not attachable with exact
reasons, and added a real-page test that holds each reason. **Repair cycle 1 (the last section of this file)** answers an
independent checker that broke 19 attached rows and found each stayed green: it strengthened 10 practice tests, added
practice tests of the real page for 9 live checks that could not see what their page paints, removed live conditions that
could never go red, and removed one live check that could not be honest. Tests only: no product file was edited.

## The numbers

| | Rows |
|---|---|
| Rows in this batch | 40 |
| Not proved before (`node scripts/pulse/count-not-proved.mjs`, offline) | 40 |
| Not proved after | 3 |
| Whole repo, before and after (all four lanes) | 853 and 816 |

Outcomes after repair cycle 1: 8 `live-check` only, 29 `practice-test` (9 of them also keep a live check), 3 `not-attachable`,
0 `na-verified`. (Generation 1 said 18 / 19 / 3. The 17 live checks now are the 8 live-only rows plus the 9 that also have a
practice test; the finance-os.html header row gave up its live check and is a practice test only.)

The three left are findings, each held to the repo by `fin-b12-rows.test.mjs` (page source) and `fin-b12-held-reasons.test.mjs`
(the real page in Chromium) so the tests go red the day the reason stops being true:

1. documents.html Status filter select: two of the six options, "Generation failed" and "Not generated", can never list a saved document.
2. galaxy.html Legend strip: size and brightness are moved on dice in the live sky (and the census and worker panel read the dice).
3. galaxy.html Rail pulses and hand-off threads: a hand-off thread is labelled with a client picked at random.

## Every row

| # | Row | Outcome | File | What it checks |
|---|---|---|---|---|
| 1 | desks-b.json:creative-factory.html:Summary tiles: jobs in flight, failed jobs, awaiting review, library assets, active brand kits | practice-test | `fin-b12-repair-creative.test.mjs` (+ live check `cf-tiles`, jobs only) | Real creative-factory.html with rows in every state: JOBS IN FLIGHT counts queued plus running, FAILED JOBS counts only failed, AWAITING REVIEW is live pending + live blocked + campaigns, LIBRARY ASSETS leaves archived out, ACTIVE BRAND KITS counts only active, each with its words and colour. Live check kept for the saved jobs only (the database refuses every bad asset and kit state). |
| 2 | desks-b.json:creative-factory.html:Video performance table (YouTube views, watch time per video per day) and connection badge | practice-test | `fin-b12-repair-creative.test.mjs` (+ live check `cf-video-table`) | Real page: for each of five connection states the badge word, its colour and its caption; each table cell (title or untitled, day, views, watch time in hours and minutes, seconds, percent); no connection; failed read. Live check kept, with the 'average over 100' false red and the 'no day' (NOT NULL) condition removed. |
| 3 | desks-b.json:creative-factory.html:Video performance: Client ID, Client secret, Refresh token boxes and Connect button | live-check | `fin-b12-display-contracts.mjs` | cf-connect: analytics_connections credentials missing past pending, saved as plain JSON, not in the four-part encrypted form, or an active connection naming no channel. |
| 4 | desks-b.json:creative-factory.html:Video performance: Sync now button | live-check | `fin-b12-display-contracts.mjs` | cf-sync: video rows that are a made-up zero (0 views and 0 minutes), have no capture time, or belong to a connection that never synced; a synced connection still pending. |
| 5 | desks-b.json:creative-factory.html:Write a script and label it: words box, name, kind, angle, hook, offer (suggestion lists) and l | live-check | `fin-b12-display-contracts.mjs` | cf-script: ad_scripts written by chris or an agent: labels not in settled form, labels with no ad_labels entry, rewrite with no parent, wrong version or root, and a rewritten version still live. |
| 6 | desks-b.json:documents.html:Page itself loads (optionally ?client_id=); owner/admin with no client is redirected to the primary de | practice-test | `fin-b12-repair-pages.test.mjs` (+ live check `docs-page-load`) | Real documents.html: an owner or admin with no client is sent to the demo client, an open client is left alone, a closer and Demo Mode off are left alone, and the page then asks for that client's documents and lists them. Live check kept without the 'never stamped' condition (NOT NULL). |
| 7 | desks-b.json:documents.html:Status filter select (not generated, generation failed, not delivered, bounced, awaiting signature, signature expired) | not-attachable | `fin-b12-not-attachable.mjs` | Four options work (Not delivered, Bounced, Awaiting signature, Signature expired). Generation failed and Not generated can never list a saved document: the loader sets gen from generated_at only (generated or queued), the table has no generation failure column, and documents.generated_at is NOT NULL DEFAULT now(), so queued never happens. Held by fin-b12-held-reasons.test.mjs and fin-b12-rows.test.mjs. |
| 8 | desks-b.json:finance-os.html:Client picker select (up to 500 clients) | practice-test | `fin-b12-repair-pages.test.mjs` (+ live check `fos-picker`, the 500 count only) | Real finance-os.html: asks for limit=500, lists each client by name (email, then Unnamed client), sorted, with the open one selected; the count line; the find box; Open sends the page to the picked client. Live check kept for the over-500 book only. |
| 9 | desks-b.json:finance-os.html:Header text 'no client open' / client name | practice-test | `fin-b12-repair-pages.test.mjs` (live check removed) | Real finance-os.html: the header says the open client's own name from the client read for that client, the email when there is no name, the first eight letters when the read failed, and no client open only when none is. |
| 10 | desks-b.json:finance-os.html:Page itself loads (with or without ?client_id=); owner/admin with no client is redirected to the prim | practice-test | `fin-b12-repair-pages.test.mjs` (+ live check `fos-page-load`) | Same redirect cases as documents.html, and once there the page reads that client. Live check kept: demo mode on needs this company's primary demo client. |
| 11 | desks-b.json:finance-os.html:Paydown simulator result block (pre-approval today vs estimate after, per-card split) | practice-test | `fin-b12-finance-os-page.test.mjs` | Real finance-os.html in Chromium; the fake server answer is the real simulator math. Checks the typed cash is parsed and sent, today vs estimate after with the difference, every summary row, the per-card split, bad input, no report, not entitled and zero cash. |
| 12 | desks-b.json:finance-os.html:Promo tracking panel (labelled NOT LIVE; nothing stored) | live-check | `fin-b12-display-contracts.mjs` | fos-promo: red when any card of the company has account_statement_cycles.promo_ends_on saved, because the panel says none is stored. Expected red wherever a promo was saved through the Alerts tab (migration 471): the NOT LIVE words are out of date. Product finding. |
| 13 | desks-b.json:financeos.html (frame):Back link ('Back to my portal' for a client, 'Back to Finance OS' for staff with ?client_id=) | practice-test | `fin-b12-frame-chrome.test.mjs` | Client sees Back to my portal with client-portal.html; staff with a client id sees Back to Finance OS with finance-os.html?client_id= and the click lands there. |
| 14 | desks-b.json:financeos.html (frame):Tab bar: 16 tabs (Overview, Next steps, Money helper, Money moves, Plan, Banks, Strategy, Fund | practice-test | `fin-b12-frame-chrome.test.mjs` | Tab ids in order, every tab link pressed with the mouse, ArrowRight walks all 16 and wraps, ArrowLeft walks back and wraps from the first, End and Home, every hash. |
| 15 | desks-b.json:financeos.html#accounts:'Add account' and 'Add a business' buttons that open the forms | practice-test | `fin-b12-frame-forms.test.mjs` | Add account opens only the by-hand account form with the cursor in Name; Add a business opens only the business form; neither sends anything. |
| 16 | desks-b.json:financeos.html#alerts:'Show all' on the texts-sent list, jump links, Try again | practice-test | `fin-b12-frame-forms.test.mjs` | Five texts of one kind among other kinds: first three newest, Show all lists all five and nothing else, Show fewer; each See it lands on the cash box its sentence names; Add the day lands on the named card's day box; Try again keeps the client. |
| 17 | desks-b.json:financeos.html#connections:Copy address / Copy key buttons | practice-test | `fin-b12-frame-forms.test.mjs` | Copy address copies the webhook and open API addresses exactly, Copy key copies the shown-once key, each says Copied then goes back; clipboard stubbed. |
| 18 | desks-b.json:financeos.html#credit:Try again; link to Setup | practice-test | `fin-b12-frame-chrome.test.mjs` | Try again re-reads credit once and repaints; with no pull on file the Set up a soft pull link carries the client and opens the Setup tab without leaving the page. |
| 19 | desks-b.json:financeos.html#fundability:Chart columns (hover or focus shows a month) and Try again | practice-test | `fin-b12-frame-chrome.test.mjs` | Four columns with different scores, tiers, estimates, dates and assumptions plus if-removed points: each hovered column shows its own head, plan line, if-removed line and assumptions; focus; aria-labels; Try again keeps the client. |
| 20 | desks-b.json:financeos.html#helper:'Check again' button (when a turn looks stuck) and Try again | practice-test | `fin-b12-frame-chrome.test.mjs` | On the held clock: no ask before 3 seconds, one ask per 3 seconds, no Check again until the 100th ask, no more asks by itself, and Check again on a turn that is still pending resets the count and polling resumes; every ask carries the client. |
| 21 | desks-b.json:financeos.html#next:Links: 'Open your checklist', 'Check your accounts', 'Book a call' | practice-test | `fin-b12-frame-chrome.test.mjs` | Open your checklist carries the client and opens that tab; Check your accounts opens Accounts; Book a call opens the selling call in a new tab with noopener. |
| 22 | desks-b.json:financeos.html#next:Try again buttons (tasks, ready-to-fund) | practice-test | `fin-b12-frame-chrome.test.mjs` | Steps Try again re-reads both parts (as the page does), ready-to-fund Try again re-reads only that part and leaves the steps on the page; every read carries the client. |
| 23 | desks-b.json:financeos.html#overview:Try again button (overview failed to load) | practice-test | `fin-b12-frame-chrome.test.mjs` | Overview failing once shows Try again; pressing it asks for the same file again once and paints the file. |
| 24 | desks-b.json:financeos.html#plan:A pin (calendar chip or list row) opens its detail panel; '+N more'; Close; Esc; Tab stays inside | practice-test | `fin-b12-plan-strategy.test.mjs` | Every pin, from its chip and from its list row, opens its own panel (title, day, kind, amount, status, bank, whose box, source, why); Esc and Close return focus to what opened it; Tab trap; scrim; a crowded day not first on the list shows the first two pins and the exact +N, and +N more lands on that day. |
| 25 | desks-b.json:financeos.html#plan:Link: 'Add an account' (empty state), 'See it on Payments' | practice-test | `fin-b12-plan-strategy.test.mjs` | Empty month shows Add an account to money-accounts with the client and opens the Accounts tab; a Clarity pin shows See it on Payments and opens the Payments tab. |
| 26 | desks-b.json:financeos.html#plan:Previous month / Next month / Today buttons | practice-test | `fin-b12-plan-strategy.test.mjs` | Previous and Next across the year end both ways (Dec to Jan and back), the neighbour words on the buttons, Today from any month and gone on this month. |
| 27 | desks-b.json:financeos.html#setup:Try again button | practice-test | `fin-b12-frame-chrome.test.mjs` | Setup failing once shows Try again; pressing it asks for setup again once and paints the steps. |
| 28 | desks-b.json:financeos.html#strategy:Method buttons (highest rate first, card use first, smallest balance first), monthly amount s | practice-test | `fin-b12-plan-strategy.test.mjs` | Method buttons and pay order; slider and box; goal sentence and Use amount compared with the shared plan math for a date that fits and one that does not; cash-cap Use and Safe tile; below-minimum Use; Show more months adds exactly 24 each press to the last month. Page work waited on by animation frame, not a guess. |
| 29 | desks-b.json:financeos.html#transfers:Go back (cancels the review step) | practice-test | `fin-b12-plan-strategy.test.mjs` | Review this move opens the question and holds the From account; Go back closes it, frees the account and sends nothing; checked for one account and a choice of accounts. |
| 30 | public-pages.json:form:careers.html#apply-form:Job application form: role, name, email, phone, LinkedIn, how heard, website (a hid | live-check | `fin-b12-display-contracts.mjs` | careers-apply: applications filed 1 hour to 30 days ago with no candidate, no new-application task, or no follow-up cadence (candidate_outreach). The cadence is never started by the form (ensureOutreach has no non-test caller), so this is expected red on live applications. Product finding. |
| 31 | public-pages.json:form:consulting/index.html#consult-form:Consult request form: name, email, agency, help, note. It takes no card  | practice-test | `fin-b12-consult-form.test.mjs` | Every request the page makes after load, to any address by any method, is recorded: only the one mailto hand-off is allowed. |
| 32 | desks-b.json:galaxy.html:Legend strip (size, brightness, pace colors) | not-attachable | `fin-b12-not-attachable.mjs` | After the feed loads the page moves size (evActivity adds 1 to 3 to output) and brightness (idle workers flip to active at random, and never back) on dice, and the census and the worker panel read the same dice. Also: the feed never sends blocked, and an agent size is 3 or 1 by sort order. Swatch colours do match the canvas palette. Held by fin-b12-held-reasons.test.mjs and fin-b12-rows.test.mjs. |
| 33 | desks-b.json:galaxy.html:Live feed on load: workers, clients, routes and numbers for the sky | live-check | `fin-b12-display-contracts.mjs` | galaxy-feed: person with two open shifts, shift open over 24 hours, shift or event naming nobody on staff, live agent with no go-live time, negative cash collected, call outcome naming a client of another company, funded client with no amount. |
| 34 | desks-b.json:galaxy.html:Page itself loads (full-screen canvas, clock, census, LIVE / WAITING pill) | practice-test | `fin-b12-repair-galaxy.test.mjs` (+ live check `galaxy-page-load`) | Real galaxy.html: asks the exact feed path with the sign-in, shows WAITING and a zero census while it waits, then LIVE and the census of each state from the feed; nobody, failed feed and signed out stay WAITING and say why; the canvas fills the window. |
| 35 | desks-b.json:galaxy.html:Rail pulses (six rails: Sales, Card Stacking, Optimization Rounds, Inquiry Removal, AR + Collections, Affiliates + Hiring) and hand-off threads | not-attachable | `fin-b12-not-attachable.mjs` | Rail pulses name only a stage, but the feed sends routes: [], so the page invents routes between list neighbours and labels each thread with a client picked at random (fillC): the sky says a hand-off happened that was never saved. Held by fin-b12-held-reasons.test.mjs and fin-b12-rows.test.mjs. |
| 36 | desks-c.json:hiring.html:Bench table: one row per role (closer, setter, sales_coordinator) with bench count, short-by, awaiting sc | practice-test | `fin-b12-repair-hiring.test.mjs` and `fin-b12-repair-hiring-bench-sql.test.mjs` (+ live check `hiring-bench`, a lock on the view) | Page: each role row prints its bench, short-by, open, awaiting screen, awaiting group, manager and flags; the four tiles are the sums. Handler: api/hiring/bench.mjs's own query over stand-in rows works out awaiting screen, awaiting group, short, unrouted, manager, order and company. Live check kept as a lock on the view's definition, plus manager and role-target conditions. |
| 37 | desks-c.json:hiring.html:Board card: click opens the application drawer (name, scores, flags, source, video/resume tags) | practice-test | `fin-b12-repair-hiring.test.mjs` (+ live check `hiring-card`) | Real hiring.html: each card shows its own score, who scored, flags, source, video and resume tags; pressing a card asks for that application and the drawer shows its own contact, source, video, resume, score history and flags. Live check kept without the two states the database refuses; cross-company rows are built as another company's rows. |
| 38 | desks-c.json:hiring.html:Board column: 1:1 Interview (one_on_one) | live-check | `fin-b12-display-contracts.mjs` | hiring-col-one-on-one: open application in 1:1 Interview with no decision that moved it there, or candidate or role outside the company. |
| 39 | desks-c.json:hiring.html:Board column: Applied (applied) | practice-test | `fin-b12-repair-hiring.test.mjs` (+ live check `hiring-col-applied`) | Real page: Applied holds exactly the Applied stage's people, newest first, with the right count and rail number; a person moved to Screening leaves it. Live check now has the arrival rule (an open application never moved by a decision must sit in Applied), reads the LATEST decision, and leaves seeded Demo Mode people out. |
| 40 | desks-c.json:hiring.html:Board column: Group Interview (group_interview) | live-check | `fin-b12-display-contracts.mjs` | hiring-col-group: open application in Group Interview with no decision that moved it there, one holding a group-interview yes or maybe that never moved on, or candidate or role outside the company. |

Live checks are read-only SQL that the display lane runs for the company (`DISPLAY_RESULT_CONTRACTS`). Each is green with
"no saved results yet" until the first result exists (`emptyAs: "quiet"`) and red on the first wrong one. They are tested
over stand-in rows only; none has been run against live data from this branch.

## How each kind was tested

**Live checks (18)** - `src/pulse/catalog/proofs/fin-b12-display-contracts.mjs`, tested by `fin-b12-live-contracts.test.mjs`
(22 tests). For every check the test runs the exact SQL text on a stand-in database (SQLite, tables built from the real
column names in `db/schema` and `db/migrations`, so a made-up column fails). For every named bad condition it shows:
the good rows read green with the right sample count; one wrong row goes red; the same row is NOT caught once that single
condition is left out of the text (so no condition is dead or double-counted); and the wrong row in another company is never
read. It also checks the text is read-only, binds only the company, and that the registry holds the same text.

**Practice tests (19 rows, 5 files)** - a real page in Chromium over the S4 harness, fake `/api` answers, one press, and a
judgement of the exact request and words painted. They read no live data.

| File | Rows | Tests |
|---|---|---|
| `fin-b12-frame-chrome.test.mjs` | 9 | back link, 16-tab bar, Try again on Overview, Setup, Credit (and its Setup link), Fundability (and chart hover), Money helper (Check again), Next steps links and Try again |
| `fin-b12-plan-strategy.test.mjs` | 5 | Plan pins, panel keys, month buttons and links; Strategy controls; Money moves Go back |
| `fin-b12-frame-forms.test.mjs` | 3 | Accounts add buttons, Alerts Show all / jump / Try again, Connections Copy buttons |
| `fin-b12-finance-os-page.test.mjs` | 1 | Paydown simulator result block, with the answer built by the real simulator math |
| `fin-b12-consult-form.test.mjs` | 1 | consult form opens an email, takes no card, sends nothing |

## Break checks (product or SQL broken on purpose, test run, put back with `git checkout`)

All 42 went red. `git status` was clean after every run.

- Frame chrome (12): back link href, End key, Overview / Setup / Credit / Fundability / Helper (Try again and Check again) /
  Next (two buttons) handlers made dead, hover removed, Check your accounts pointed at Plan.
- Forms (5): Add account opens the business form, Show all never expands, jump link goes nowhere, Alerts Try again dead,
  Copy copies nothing.
- Plan, Strategy, Money moves (13): Esc and Tab trap removed, month buttons reload this month, Add an account and See it on
  Payments links changed, list row does not open the panel, method button inert, Use button sets 1, Show more months adds none,
  goal date hidden, Go back keeps the question, From account not held.
- Credit link, Next links (3): soft-pull link points at Payments, checklist link drops the client, Book a call opens same tab.
- Paydown (2): page sends zero cash, estimate after shows today's figure.
- Consult (2): body drops the agency, form posts to the server.
- Live SQL (6): blank-reason test loosened, org condition removed, `<>` flipped, `IS NOT NULL` flipped, a condition replaced by
  `1 = 0`, picker limit moved to 5000.

## Shared lines touched (the integrator merges these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | 1 import line and `...FIN_B12_DISPLAY_CONTRACTS,` at the end of `DISPLAY_RESULT_CONTRACTS` |
| `src/pulse/catalog/compiler.mjs` | +14 lines in `compileDisplayRuntimeData`: a tracked row that owns a contract marked `anyImpact: true` is judged even though no money or customer proof names it. The text is the same as batch 15's, so a merge keeps one copy. Without it, staff-only and no-impact rows are never read. |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | 1 import line and `...FIN_B12_DISPLAY_PROOF_CASES,` in the plug-in list |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 653 (19 practice-test rows attached). Re-derive after the merge: it is the sum of every batch's drops. |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | contracts 40 to 58, pass-capable 27 to 45, unmeasured stays 13, SQL batches 27 to 45 (+18 live checks). Re-derive after the merge. |
| `src/pulse/catalog/generated.json` | rebuilt with `npm run pulse:catalog`. Expected to conflict: recompile after merging. |

## Files added (all in `src/pulse/catalog/proofs/`)

- `fin-b12-display-contracts.mjs` - the 18 live checks and the list the registry spreads
- `fin-b12-live-contracts.test.mjs` - the stand-in guard for every live check
- `fin-b12-sql-kit.mjs` - tests only: real table and column names from the migrations, a SQLite stand-in, Postgres-to-SQLite spellings
- `fin-b12-kit.mjs`, `fin-b12-rows.json`, `fin-b12-display-proofs.mjs` - the practice-test row tracker, row table and proof cases
- `fin-b12-frame-chrome.test.mjs`, `fin-b12-plan-strategy.test.mjs`, `fin-b12-frame-forms.test.mjs`,
  `fin-b12-finance-os-page.test.mjs`, `fin-b12-consult-form.test.mjs` - the practice tests
- `fin-b12-not-attachable.mjs`, `fin-b12-rows.test.mjs` - the three reasons and the guard that holds them
- `ops/workflows/finish-853-2026-10-14/manifest-b12.md` - this file

## Product findings (not fixed)

1. **The careers form never starts the follow-up cadence it says it starts.** `submitApplication` calls `apply()` and the
   EEO invite and stops. `ensureOutreach` (`src/hiring/outreach.mjs`) has no caller outside tests, and `candidate_outreach`
   has no other writer. So no applicant gets the four-touch follow-up. The `careers-apply` live check is expected red on any
   application filed through the form between 1 hour and 30 days ago.
2. **Finance OS "Promo tracking ... NOT LIVE; nothing stored" is out of date.** Migration 471 added
   `account_statement_cycles.promo_ends_on` and the Alerts tab saves promo end dates there. The panel in `finance-os.html`
   still says none are stored. The `fos-promo` live check is red for any company that has saved one.
3. **Documents: two filter options can never match.** "Generation failed": the loader maps `generated_at` to generated or queued
   only, and there is no failure column. "Not generated": `documents.generated_at` is `NOT NULL DEFAULT now()` (030_documents.sql,
   never relaxed), so every saved document is generated and "queued" is never set. Both always show "Nothing matches that filter."
   Row left not proved.
4. **Galaxy invents output and activity.** `evActivity` adds 1 to 3 to a worker's output on a timer and flips idle workers to
   active at random (`evHandoff` too). The legend says size is output today and brightness is working right now.
5. **Galaxy hand-off threads name a random real client.** `fillC` picks any client from the feed, and the routes are just
   neighbours in the worker list, so the sky says worker A handed client X to worker B when it did not. The no-invented-money
   test (`galaxy-no-invented-money.test.mjs`) only holds rail pulses, not hand-offs.
6. **Finance OS client picker silently stops at 500.** `/api/dashboard/clients` caps at 500 newest, and the page says
   "N clients on file". The `fos-picker` check goes red when the company passes 500.
7. **Seen in passing, not checked further:** opening `finance-os.html?client_id=` in the test with a `funding_advisor` session, the shell sent the page to `client-control-panel.html`. The test uses an owner session. No row names it.
8. **Product-side oddity, not a row:** the hiring bench read (`api/hiring/bench.mjs`) filters on the default company
   (`is_default`), not the signed-in company. The `hiring-bench` check reads the signed-in company, so on a second company the
   page and the check would disagree. Same finding as S5 finding 3.

## The group run (measured on this Mac while other builders were running; load average 23 to 45)

Command: `CI=1 node --test src/pulse/catalog/*.test.mjs src/pulse/catalog/proofs/*.test.mjs src/pulse/coverage/gap-catalog*.test.mjs src/pulse/coverage/gap-door-batch*.test.mjs`

- 577 results at the top level. 3 are `not ok`, 574 pass. Every batch 12 test passes (all 8 files, 56 tests).
- `npm run lint`: 3,574 files parse clean.
- The 3 that fail are not batch 12 files, and none names a batch 12 test:
  1. `display-proof-cases.test.mjs` "the focused proof test runs every executable test named by every case". Its child
     run ends with exit 1 and no failing test named. The same child run on an untouched `fin/base` checkout does the same
     (609 tests ok, exit 1, no `not ok`), so it was not caused by this batch. Already listed as a flake in the S4 manifest.
  2. `flow-result-proofs.test.mjs` "every test named by a flow proof passes with fake data or local reads": names
     `src/sales/closer-deck.test.mjs`, the load timeout listed in the S1 and S4 manifests.
  3. `read-reviewed-e2e.test.mjs` "the 64 proved read rows run their real focused result tests": same child-run shape as
     item 1. Not re-run on `fin/base`.

## Commands run

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` before and after | batch rows 40 then 3; whole repo 853 then 816 |
| `node --test src/pulse/catalog/proofs/fin-b12-live-contracts.test.mjs` | 22 of 22 pass |
| `node --test src/pulse/catalog/proofs/fin-b12-rows.test.mjs` | 6 of 6 pass |
| the five practice-test files, each, `CI=1` | all pass |
| `node --test src/pulse/coverage/gap-catalog-display.test.mjs` | 11 of 11 pass |
| `npm run pulse:catalog` | rebuilt `generated.json`; 3942 unique, 23 red |
| 42 break checks (above) | 42 of 42 red |

## Generation 2: the three rows challenged

Brief: read the real page or handler, and attach a live check or practice test unless the earlier reason is exactly true.
Result: all three reasons are true, and two of them were too small. Nothing was attached. Each is now held by a real-page
test, not only by patterns over the page source.

| Not proved | Before gen 2 | After gen 2 |
|---|---|---|
| Batch 12 rows (`count-not-proved.mjs`, intersected with `batch-12.json`) | 3 | 3 |
| Whole repo, all four lanes | 816 | 816 |

(Generation 1 took the batch from 40 to 3 and the repo from 853 to 816. Generation 2 made no further attachment, on purpose.)

### What was challenged and what was found

1. **documents.html Status filter select.** Challenge: attach a practice test of the select. Why not: a test with fake rows
   would prove the page logic over a state the database cannot hold. Facts read: `documents.generated_at` is `timestamptz NOT NULL
   DEFAULT now()` (`db/migrations/030_documents.sql`, no later migration changes it), and `api/read/documents.mjs` returns it as
   saved. The loader sets `gen` from `generated_at` only. So "Not generated" is dead as well as "Generation failed" (generation 1
   named only the second). Four options work. A fake-data test over the four working options would be green while two of the six
   options in the row's own name are dead, so the row would read proved when it is not.
2. **galaxy.html Legend strip.** Challenge: attach a live check on the feed. Why not: the feed (`src/galaxy/company-activity.mjs`)
   is judged on load by the `galaxy-feed` check, and the legend breaks AFTER load, on the page, where nothing is saved. Read in
   the page: `evActivity` adds 1 to 3 to `n.out` and flips idle to active with `Math.random`, `evHandoff` flips the next worker
   to active at random, and the only flip back needs a pool line that begins with "Idle", which the feed never sends. Shown in
   Chromium with the feed held still: the worker panel's Total events climbs past its own Events today plus Calls today, and the
   census counts two people with no open shift as working. Extra gaps in the same strip: the feed never sends `blocked` (state is
   only active or idle) so the blocked swatch cannot light; an agent's size is 3 or 1 by `sort_order`, not output. The swatch
   colours do match the canvas palette (checked from computed styles).
3. **galaxy.html Rail pulses and hand-off threads.** Challenge: the rail pulses carry no client (true, `evMove` says so), so attach
   that half. Why not: the row's name includes the hand-off threads, and those are invented: the feed sends `routes: []`, the page
   makes neighbour routes with the label `handoff — {C}`, and `fillC` fills `{C}` with a client picked at random. Shown in
   Chromium: with `routes: []` and no worker holding a file, the canvas draws `Casey Reed  →  Jordan Lee` with `handoff — Dana
   Whitfield` under it.

### The test that holds the three reasons

`src/pulse/catalog/proofs/fin-b12-held-reasons.test.mjs` (5 tests, about 18 seconds). The real page in Chromium, fake `/api` answers
shaped exactly like the saved rows, fixed dice, a fake clock, and a spy on the canvas text. Each test is GREEN while the product is
wrong and goes RED the day it is fixed, which is the signal to attach the row for real. It is a held finding. It is not a proof and
it is not attached to any row.

| Test | What it shows |
|---|---|
| documents status filter, real-shaped rows | Seven saved-shape rows. Not delivered, Bounced, Awaiting signature and Signature expired list exactly their documents (positive control). Not generated and Generation failed list nothing. The option list is exactly Any plus the six. |
| documents table | `generated_at` NOT NULL in 030_documents.sql, no generation failure column, and no later migration drops NOT NULL or adds one. |
| galaxy legend, dice | Feed held still. Total events climbs past saved Events today plus Calls today. The census counts a worker with no open shift as working. |
| galaxy legend, swatches and blocked | Swatch colours equal the canvas palette. The feed builder only ever sets active or idle. Agent size is the 3 or 1 constant. |
| galaxy rails | With `routes: []` the sky draws a thread between two workers labelled with a real client's name. |

### Break checks for generation 2 (product or source broken on purpose, test run, put back; `git status` clean after each)

| Break | Result |
|---|---|
| galaxy: output no longer bumped (`n.out += ...` removed) | legend test RED |
| galaxy: the idle to active flip removed from `evActivity` only | still green: `evHandoff` flips workers too (correct, two flip sites) |
| galaxy: both flips removed | legend test RED on "counted as working" |
| galaxy: thread label no longer carries a client | rails test RED |
| documents: delivery_status failed mapped to gen failed | filter test RED |
| documents: Bounced option broken | filter test RED (positive control works) |
| feed: sends `blocked` | swatch and blocked test RED |
| galaxy: green swatch recoloured | swatch test RED |
| migration text: `generated_at` made nullable | table test RED |

### Files added or touched in generation 2

- Added: `src/pulse/catalog/proofs/fin-b12-held-reasons.test.mjs`
- Edited (batch 12's own file): `src/pulse/catalog/proofs/fin-b12-not-attachable.mjs` (three reasons restated exactly)
- Edited: this manifest
- Shared lists touched: none. `generated.json` rebuilt with `npm run pulse:catalog` and is byte-identical.

### Commands run in generation 2

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` before and after | repo 816 and 816; batch rows 3 and 3 |
| `CI=1 node --test src/pulse/catalog/proofs/fin-b12-*.test.mjs` | 58 of 58 pass (9 files, including the new one) |
| `node --test src/pulse/coverage/gap-catalog-display.test.mjs` | 11 of 11 pass |
| `npm run pulse:catalog` | 3942 unique, 23 red, `generated.json` unchanged |
| 9 break checks (above) | 8 red as expected, 1 correctly green (two flip sites) |

### New product findings (one line each, not fixed)

1. Documents: "Not generated" can never list a document (`generated_at` is NOT NULL). Generation 1 named only "Generation failed".
2. Galaxy: the worker panel's Total events and the census "working" count both read the dice, so they disagree with the saved rows on the same panel (Events today, Calls today, Open shift).
3. Galaxy: the feed never sends `blocked`, so the blocked swatch in the legend can never light on live data.
4. Galaxy: an agent's size is 3 or 1 by `sort_order` in `buildAgentNode`, not its output, while the legend says size is output today.
5. Galaxy: "output today" counts from `date_trunc('day', now())` in the database session and the page clock is Arizona time. No time zone is set in the repo. Not verified on the live database.
6. Seen in an earlier round, not changed: `display-contracts-ab.test.mjs` draws the QUEUED badge from a document with `generated_at: null`, a state the table cannot hold.

### Group run after generation 2 (this Mac, other builders running)

`CI=1 node --test src/pulse/catalog/*.test.mjs src/pulse/catalog/proofs/*.test.mjs src/pulse/coverage/gap-catalog*.test.mjs src/pulse/coverage/gap-door-batch*.test.mjs`
gave 1741 tests, 1739 pass, 2 `not ok`, 0 skipped, 861 s. Neither failure names a batch 12 test, and both are the flakes already
listed above: `display-proof-cases.test.mjs` "the focused proof test runs every executable test named by every case" and
`flow-result-proofs.test.mjs` "every test named by a flow proof passes with fake data or local reads".
`npm run lint`: 3575 files parse clean.

## Repair cycle 1: an independent checker broke 19 attached rows and each stayed green

The checker mutated the product (and the SQL) for 19 rows. Every row below stayed green on a break that is a real wrong
result. Nothing in this cycle touched a product file. Each row ended as a `practice-test`. None is `not-attachable`,
none is `na-verified`. Where a live check also stays, it is said, and what it can and cannot see is in the row.

### The honest rule used for every row

1. A live check reads SAVED rows. It cannot see what a page paints. For nine rows the saved-row check stays, and a practice
   test of the real page was added beside it (tiles, table and badge, page load and redirect, picker, bench, card, column,
   sky). Those nine rows are both on purpose and are named in `fin-b12-rows.test.mjs` (`BOTH`), so the overlap cannot grow.
2. A condition the database already refuses can never go red, so it was removed from the SQL: asset review state, blocked
   asset with no reasons, brand kit name and state (`045_creative_factory.sql`), `documents.generated_at` (NOT NULL),
   `video_watch_stats.stat_date` (NOT NULL), score average outside 1 to 4 and a person's score with no person
   (`051_hiring.sql`). Ghost ids that a foreign key refuses were rebuilt as rows of ANOTHER company.
3. A condition that is the page's own designed fallback is not a wrong result. "Unnamed client" and the eight-letter id
   header are the page's answer to a client with no name and no email. Those two conditions were removed. That left the
   finance-os.html header row with no honest live check, so its live check was removed and it is a practice test only.
4. A condition that would go red on a legal state was removed or reshaped: YouTube reports an average watched above 100 for
   a looping short (the old check called it wrong); the Applied column called a person moved back to Applied through the
   API wrong (it now reads the latest decision); Demo Mode's seeded people sit in stages with no decision behind them
   (`src/demo/seed-ui-coverage.mjs`), so the three board-column checks now leave `candidates.is_demo` people out.

### What each row ended as

| # | Row | Why it stayed green | Fix |
|---|---|---|---|
| 1 | creative-factory.html Summary tiles | SQL read rows, never the tile totals; 4 of 9 conditions refused by the database | Practice test of the five tiles over rows in every state. Live check cut to jobs. |
| 2 | creative-factory.html Video table and badge | SQL judged rows, never the badge or the watch-time words; false red above 100 | Practice test of badge word, colour, caption and every cell. Live check relaxed. |
| 6 | documents.html Page loads | SQL never saw the redirect or the load; one condition could not fire | Practice test of the owner redirect, the leave-alone cases and the client read. |
| 8 | finance-os.html Picker | Judged the clients table, not the list; unnamed is a designed fallback | Practice test of limit=500, names, sort, selection, count, find, Open. Live check is the 500 count only. |
| 9 | finance-os.html Header | A copy of the picker's data test; the header's own result never judged | Practice test of the header (own name, email, id start, no client open). Live check removed. |
| 10 | finance-os.html Page loads | Only proved the redirect target exists | Practice test of the redirect. Live check pinned to this company's demo client. |
| 14 | financeos.html Tab bar | Arrow order comes from the JS list, only the HTML order was pinned | Full lap both ways, wrap from the first, every tab link pressed, ids in order. |
| 16 | financeos.html#alerts | See it target, sent-list order and kind, retry client not judged | Fixture with two cash boxes, mixed kinds and five texts; client on retry. |
| 19 | financeos.html#fundability | A column's detail never compared with its data | Four distinct columns and if-removed points; every detail judged in full. |
| 20 | financeos.html#helper | 100 polls and 3 s were not pinned; the still-pending case never ran | Held clock: exact interval, exact 100th ask, stop, still-pending Check again. |
| 22 | financeos.html#next | Retry did not carry the client; the manifest's "re-reads only the steps" was wrong | Every read judged for the client; steps retry re-reads both, ready retry only its part. |
| 24 | financeos.html#plan pins | Only the first pin was ever clicked | Every pin by chip and by row, full panel; crowded day not first; exact +N and its day. |
| 26 | financeos.html#plan months | Never crossed the year end | Dec to Jan and back, neighbour words, Today. |
| 28 | financeos.html#strategy | Weak asserts (+1 month per press, goal words never read) and a flaky wait | Judged against the shared plan math, every Use button clicked, animation-frame settle, +24 per press. 3 runs clean. |
| 31 | consulting form | Only /api paths were recorded | Every request, any address, any method. Only the mailto hand-off is allowed. |
| 34 | galaxy.html Page loads | SQL read people and agents, nothing the page does at load | Practice test: feed path and sign-in, WAITING hold, LIVE, census by state, nobody, failure, signed out, canvas. |
| 36 | hiring.html Bench | The "short-by" and "bench" numbers were a copy of the view's own formula, and awaiting, short, unrouted never read | Page practice test, plus the handler's own query over stand-in rows. The SQL check says it is a lock on the view. |
| 37 | hiring.html Card | Six of eight conditions used states the database refuses; cross-company rows never built | Page practice test of card and drawer; two refused conditions removed; cross-company rows built. |
| 39 | hiring.html Applied column | No arrival rule; a legal move back read as wrong; demo rows | Page practice test; arrival rule, latest decision, demo left out. |

### Break checks (product or SQL broken on purpose, test run, put back; `git status` clean on every product file after)

| Group | Breaks | Red |
|---|---|---|
| FinanceOS frame, plan, strategy, alerts, helper, fundability, next (rows 14, 16, 19, 20, 22, 24, 26, 28) | 32 | 32 |
| Creative Factory tiles and video table (rows 1, 2) | 14 | 14 |
| Documents and Finance OS page load, picker and header (rows 6, 8, 9, 10) | 11 | 11 |
| Galaxy page load (row 34) | 6 | 6 (one needed a stricter fake feed first: see below) |
| Hiring bench page, card and drawer, Applied column (rows 36, 37, 39) | 12 | 12 |
| Hiring bench handler query (row 36) | 9 | 9 |
| Consult form: a POST to another path, a beacon to an outside host, an image ping, a POST to /api, an XHR (row 31) | 5 | 5 |

One break survived the first run and the test was fixed, not the break: the Galaxy page asking for
`/api/read/company-activity-x` was still answered, because the fake server matches a path by "contains". The fake now
answers only the exact path, and the same break is red.

A few reds are a 30 second wait that never ends (the page never reaches the state the test waits for), for example swapped
tab order, a feed that is never applied, a drawer that opens the wrong person. They are red for the right reason and are
listed by their wait in the run output; the rest fail on an assertion that names the cell, number or word.

### The SQL, mutated

`sqlmut.py` (kept in the scratchpad, not in the repo) changed one operator or constant at a time in the live checks of the
rows above and ran the live-contract test (comparison flipped, `AND` to `OR`, `IS NULL` to `IS NOT NULL`, `EXISTS` to
`NOT EXISTS`, one day to two, the 500, the lists of states, `DESC` to `ASC`).

| Round | Sites | Red | Survived | What the survivors were |
|---|---|---|---|---|
| 1 (before this cycle's fixtures) | 223 | 193 | 30 | boundary at exactly one day; 0 versus below 0; connection owner leg; error state leg; client ownership; title-or-key; whole-book count equals; galaxy agent legs; bench recount legs; Applied sub-selects; "moved into" sub-select |
| 2 (after fixtures) | 218 | 211 | 7 | 5 equivalent mutants (the 500 appears in the part's WHERE and its bad expression, and in a requirement sentence; `>` against `>=` where the value is subtracted to 0) and 2 Applied sub-select legs |
| 3 (final, all eleven changed checks) | 218 | 202 | 16 | 12 are inside comments or requirement sentences (the digit 500, not SQL), 1 equivalent (`> 0` against `>= 0` where the value is subtracted to 0), 3 real: the Applied sub-select for another application's decision and two attendee legs of the Group check |
| 3b (the three hiring column checks again, after fixtures for those 3) | 84 | 84 | 0 | none |

Each real survivor got a fixture that kills it (a decision of another application in the same company; an attendee 'yes' of
somebody who moved on; a decision filed under another company; a boundary at exactly one day; a zero that is not below zero).
The equivalent and comment-only mutants are listed, not hidden.

### What the live checks of this batch still cannot see (said plainly)

* hiring-bench: the SQL is a lock on the view's definition, and a check of the manager and the target. It goes red only
  if someone changes the view or a manager sits in another company. The numbers the page paints are checked by the page
  practice test and by the handler query test, both on stand-in rows. Nothing judges them on saved data from this branch.
* galaxy-page-load: "nobody to show" cannot happen in a company that has an owner row. The page's behaviour is the
  practice test.
* A practice test reads no saved data. Nothing in this cycle was run against live data.

### Product findings (one line each, not fixed)

1. Hiring board at 1280 px wide: a card's "resume" tag sits on top of the card below it and takes its mouse press, so a
   press on the lower card can land on the card above (Playwright reported the intercept). The test uses a dispatched click.
2. `api/demo/mode.mjs` returns `primary_client_id` even when Demo Mode is off, so the redirect script is held back only by
   the flag. Worth knowing; the redirect already checks the flag.
3. Demo Mode's seeded candidates are placed in stages with no decision (`seed-ui-coverage.mjs`). Anything that reads
   "how did this person get here" from decisions will call them wrong unless it leaves `candidates.is_demo` out.

### Files added or changed in this cycle

Added (all in `src/pulse/catalog/proofs/`): `fin-b12-repair-creative.test.mjs`, `fin-b12-repair-pages.test.mjs`,
`fin-b12-repair-galaxy.test.mjs`, `fin-b12-repair-hiring.test.mjs`, `fin-b12-repair-hiring-bench-sql.test.mjs`.

Changed (batch 12's own files): `fin-b12-display-contracts.mjs`, `fin-b12-live-contracts.test.mjs`, `fin-b12-rows.json`,
`fin-b12-rows.test.mjs`, `fin-b12-display-proofs.mjs` (a control named under two files keeps both as evidence),
`fin-b12-frame-chrome.test.mjs`, `fin-b12-plan-strategy.test.mjs`, `fin-b12-frame-forms.test.mjs`,
`fin-b12-consult-form.test.mjs`, this manifest.

### Shared lines touched (the integrator merges these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 653 to 643 (ten live-check rows now also have an exact practice test). Re-derive after the merge. |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | contracts 58 to 57, pass-capable 45 to 44, SQL batches 45 to 44 (the header row lost its live check). Unmeasured stays 13. Re-derive after the merge. |
| `src/pulse/catalog/generated.json` | rebuilt with `npm run pulse:catalog`. Expected to conflict: recompile after merging. |

No other shared list was touched in this cycle.

### Numbers (repair cycle 1)

| | Rows |
|---|---|
| Rows in this batch | 40 |
| The 19 rows this cycle repaired | 19 (all `practice-test`; 9 also keep a live check) |
| Not proved before (`node scripts/pulse/count-not-proved.mjs`, offline), batch 12 | 3 |
| Not proved after, batch 12 | 3 (the same three, each a justified `not-attachable`) |
| Whole repo, before and after (all four lanes) | 816 and 816 |

The 19 rows were not on the open list before this cycle either: they had an attachment that stayed green on a break. The
count is the same because the repair made each attachment honest, it did not remove one.

### Commands run (repair cycle 1)

| Command | Result |
|---|---|
| `CI=1 node --test src/pulse/catalog/proofs/fin-b12-*.test.mjs src/pulse/coverage/gap-catalog-display.test.mjs` | 87 of 87 pass |
| `node --test --test-name-pattern="unmapped display rows stay red" src/pulse/catalog/proofs/display-proof-cases.test.mjs` | pass, red count 643 |
| `CI=1 node --test src/pulse/catalog/*.test.mjs src/pulse/catalog/proofs/*.test.mjs src/pulse/coverage/gap-catalog*.test.mjs src/pulse/coverage/gap-door-batch*.test.mjs` | 1759 tests, 1759 pass, 0 fail, 0 skipped, 719 s, this Mac with other builders running |
| `npm run lint` | 3580 files parse clean |
| `npm run pulse:catalog` | 3942 unique, 23 red; run twice, `generated.json` byte-identical the second time |
| `node scripts/pulse/count-not-proved.mjs` | repo 816 and 816; batch rows 3 and 3 |
| 32 + 43 + 9 + 5 product and handler breaks (list above) | 89 of 89 red after the one test fix named above |
| SQL mutation survey (3 rounds) | see the table above |
| strategy test, 3 runs in a row | 3 of 3 pass |
