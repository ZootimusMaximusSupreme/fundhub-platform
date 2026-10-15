# Finish the 853 - batch 12 manifest

Branch `fin/b12`, built from `fin/base` (`2f4f574a0`). Tier 4, lane `gap-catalog-display`, 40 rows. Nothing was pushed or merged.
Generation 1 of at most 3. Tests only: no product file was edited.

## The numbers

| | Rows |
|---|---|
| Rows in this batch | 40 |
| Not proved before (`node scripts/pulse/count-not-proved.mjs`, offline) | 40 |
| Not proved after | 3 |
| Whole repo, before and after (all four lanes) | 853 and 816 |

Outcomes: 18 `live-check`, 19 `practice-test`, 3 `not-attachable`, 0 `na-verified`.

The three left are findings, each held to the repo by `fin-b12-rows.test.mjs` so the test goes red the day the reason stops being true:

1. documents.html Status filter select: the option "Generation failed" can never match anything.
2. galaxy.html Legend strip: size and brightness are moved on dice in the live sky.
3. galaxy.html Rail pulses and hand-off threads: a hand-off thread is labelled with a client picked at random.

## Every row

| # | Row | Outcome | File | What it checks |
|---|---|---|---|---|
| 1 | desks-b.json:creative-factory.html:Summary tiles: jobs in flight, failed jobs, awaiting review, library assets, active brand kits | live-check | `fin-b12-display-contracts.mjs` | cf-tiles: failed job with no reason, finished job with no time, running job with no start, in-flight job that is finished or a day old, blocked asset with no reasons, unknown review state, nameless or unknown-state brand kit. Tested over stand-in rows in fin-b12-live-contracts.test.mjs. |
| 2 | desks-b.json:creative-factory.html:Video performance table (YouTube views, watch time per video per day) and connection badge | live-check | `fin-b12-display-contracts.mjs` | cf-video-table: video_watch_stats rows with no video or day, negative views or minutes, average outside 0-100, or no YouTube connection of the company; badge in error or expired with no reason, or active with an error still saved. |
| 3 | desks-b.json:creative-factory.html:Video performance: Client ID, Client secret, Refresh token boxes and Connect button | live-check | `fin-b12-display-contracts.mjs` | cf-connect: analytics_connections credentials missing past pending, saved as plain JSON, not in the four-part encrypted form, or an active connection naming no channel. |
| 4 | desks-b.json:creative-factory.html:Video performance: Sync now button | live-check | `fin-b12-display-contracts.mjs` | cf-sync: video rows that are a made-up zero (0 views and 0 minutes), have no capture time, or belong to a connection that never synced; a synced connection still pending. |
| 5 | desks-b.json:creative-factory.html:Write a script and label it: words box, name, kind, angle, hook, offer (suggestion lists) and l | live-check | `fin-b12-display-contracts.mjs` | cf-script: ad_scripts written by chris or an agent: labels not in settled form, labels with no ad_labels entry, rewrite with no parent, wrong version or root, and a rewritten version still live. |
| 6 | desks-b.json:documents.html:Page itself loads (optionally ?client_id=); owner/admin with no client is redirected to the primary de | live-check | `fin-b12-display-contracts.mjs` | docs-page-load: listed documents naming a client outside the company, with no title or key, generated file never stamped, sent with no sent time, signed though not required; plus Demo Mode on with no primary demo client. |
| 7 | desks-b.json:documents.html:Status filter select (not generated, generation failed, not delivered, bounced, awaiting signature, si | not-attachable | `fin-b12-not-attachable.mjs` | The select offers Generation failed but documents.html maps generated_at to generated or queued only, and the documents table has no generation-failure column, so that option always shows an empty list. Held by fin-b12-rows.test.mjs. |
| 8 | desks-b.json:finance-os.html:Client picker select (up to 500 clients) | live-check | `fin-b12-display-contracts.mjs` | fos-picker: a client the picker lists with no name and no email (prints Unnamed client), and a company with more than 500 clients (the oldest cannot be picked). |
| 9 | desks-b.json:finance-os.html:Header text 'no client open' / client name | live-check | `fin-b12-display-contracts.mjs` | fos-header: a client with no name and no email, so the header prints the first eight letters of the id. |
| 10 | desks-b.json:finance-os.html:Page itself loads (with or without ?client_id=); owner/admin with no client is redirected to the prim | live-check | `fin-b12-display-contracts.mjs` | fos-page-load: Demo Mode on with no primary demo client (demo.client.01) for the owner redirect to land on. |
| 11 | desks-b.json:finance-os.html:Paydown simulator result block (pre-approval today vs estimate after, per-card split) | practice-test | `fin-b12-finance-os-page.test.mjs` | Real finance-os.html in Chromium; the fake server answer is the real simulator math. Checks the typed cash is parsed and sent, today vs estimate after with the difference, every summary row, the per-card split, bad input, no report, not entitled and zero cash. |
| 12 | desks-b.json:finance-os.html:Promo tracking panel (labelled NOT LIVE; nothing stored) | live-check | `fin-b12-display-contracts.mjs` | fos-promo: red when any card of the company has account_statement_cycles.promo_ends_on saved, because the panel says none is stored. Expected red wherever a promo was saved through the Alerts tab (migration 471): the NOT LIVE words are out of date. Product finding. |
| 13 | desks-b.json:financeos.html (frame):Back link ('Back to my portal' for a client, 'Back to Finance OS' for staff with ?client_id=) | practice-test | `fin-b12-frame-chrome.test.mjs` | Client sees Back to my portal with client-portal.html; staff with a client id sees Back to Finance OS with finance-os.html?client_id= and the click lands there. |
| 14 | desks-b.json:financeos.html (frame):Tab bar: 16 tabs (Overview, Next steps, Money helper, Money moves, Plan, Banks, Strategy, Fund | practice-test | `fin-b12-frame-chrome.test.mjs` | 16 tabs in order, #hash opens each tab and shows only its panel, unknown hash opens Overview, Left, Right, Home and End move along the bar and focus. |
| 15 | desks-b.json:financeos.html#accounts:'Add account' and 'Add a business' buttons that open the forms | practice-test | `fin-b12-frame-forms.test.mjs` | Add account opens only the by-hand account form with the cursor in Name; Add a business opens only the business form; neither sends anything. |
| 16 | desks-b.json:financeos.html#alerts:'Show all' on the texts-sent list, jump links, Try again | practice-test | `fin-b12-frame-forms.test.mjs` | Texts-sent list shows 3, Show all shows all 5, Show fewer returns; the Add the day and See it jump links put the cursor on their card; Try again re-reads alerts once. |
| 17 | desks-b.json:financeos.html#connections:Copy address / Copy key buttons | practice-test | `fin-b12-frame-forms.test.mjs` | Copy address copies the webhook and open API addresses exactly, Copy key copies the shown-once key, each says Copied then goes back; clipboard stubbed. |
| 18 | desks-b.json:financeos.html#credit:Try again; link to Setup | practice-test | `fin-b12-frame-chrome.test.mjs` | Try again re-reads credit once and repaints; with no pull on file the Set up a soft pull link carries the client and opens the Setup tab without leaving the page. |
| 19 | desks-b.json:financeos.html#fundability:Chart columns (hover or focus shows a month) and Try again | practice-test | `fin-b12-frame-chrome.test.mjs` | Try again re-reads fundability once and repaints; hover and focus on a chart column select it and show Today or in N months. |
| 20 | desks-b.json:financeos.html#helper:'Check again' button (when a turn looks stuck) and Try again | practice-test | `fin-b12-frame-chrome.test.mjs` | Try again re-reads the helper once; a turn that never finishes polls on a held clock, shows Still thinking with Check again after 100 polls, and Check again reads once and shows the answer. |
| 21 | desks-b.json:financeos.html#next:Links: 'Open your checklist', 'Check your accounts', 'Book a call' | practice-test | `fin-b12-frame-chrome.test.mjs` | Open your checklist carries the client and opens that tab; Check your accounts opens Accounts; Book a call opens the selling call in a new tab with noopener. |
| 22 | desks-b.json:financeos.html#next:Try again buttons (tasks, ready-to-fund) | practice-test | `fin-b12-frame-chrome.test.mjs` | Steps Try again re-reads only the steps; ready-to-fund Try again re-reads only that part; each failure leaves the other part loaded. |
| 23 | desks-b.json:financeos.html#overview:Try again button (overview failed to load) | practice-test | `fin-b12-frame-chrome.test.mjs` | Overview failing once shows Try again; pressing it asks for the same file again once and paints the file. |
| 24 | desks-b.json:financeos.html#plan:A pin (calendar chip or list row) opens its detail panel; '+N more'; Close; Esc; Tab stays inside | practice-test | `fin-b12-plan-strategy.test.mjs` | Chip and list row open the panel with title, amount and focus on Close; Tab and Shift+Tab stay inside; Esc and Close close it and return focus; +N more jumps to that day. |
| 25 | desks-b.json:financeos.html#plan:Link: 'Add an account' (empty state), 'See it on Payments' | practice-test | `fin-b12-plan-strategy.test.mjs` | Empty month shows Add an account to money-accounts with the client and opens the Accounts tab; a Clarity pin shows See it on Payments and opens the Payments tab. |
| 26 | desks-b.json:financeos.html#plan:Previous month / Next month / Today buttons | practice-test | `fin-b12-plan-strategy.test.mjs` | Previous and Next ask for the month before and after; Today appears off this month and asks for the month holding today. |
| 27 | desks-b.json:financeos.html#setup:Try again button | practice-test | `fin-b12-frame-chrome.test.mjs` | Setup failing once shows Try again; pressing it asks for setup again once and paints the steps. |
| 28 | desks-b.json:financeos.html#strategy:Method buttons (highest rate first, card use first, smallest balance first), monthly amount s | practice-test | `fin-b12-plan-strategy.test.mjs` | Method buttons press one at a time, change the note and the order debts are paid in; slider and box stay one number; goal select shows its date; Use button puts the minimum in the box; Show more months adds the next 24. |
| 29 | desks-b.json:financeos.html#transfers:Go back (cancels the review step) | practice-test | `fin-b12-plan-strategy.test.mjs` | Review this move opens the question and holds the From account; Go back closes it, frees the account and sends nothing; checked for one account and a choice of accounts. |
| 30 | public-pages.json:form:careers.html#apply-form:Job application form: role, name, email, phone, LinkedIn, how heard, website (a hid | live-check | `fin-b12-display-contracts.mjs` | careers-apply: applications filed 1 hour to 30 days ago with no candidate, no new-application task, or no follow-up cadence (candidate_outreach). The cadence is never started by the form (ensureOutreach has no non-test caller), so this is expected red on live applications. Product finding. |
| 31 | public-pages.json:form:consulting/index.html#consult-form:Consult request form: name, email, agency, help, note. It takes no card  | practice-test | `fin-b12-consult-form.test.mjs` | Real /consulting/ in Chromium: five fields and no card field, empty form does not leave, the typed words go into the mailto subject and body to the address shown on the page, and no /api request is made. |
| 32 | desks-b.json:galaxy.html:Legend strip (size, brightness, pace colors) | not-attachable | `fin-b12-not-attachable.mjs` | The legend says size is output today and brightness is working right now, but evActivity adds 1 to 3 to output at random and flips idle workers to active on dice, so the sky is not the day's numbers. Swatch colours do match. Held by fin-b12-rows.test.mjs. |
| 33 | desks-b.json:galaxy.html:Live feed on load: workers, clients, routes and numbers for the sky | live-check | `fin-b12-display-contracts.mjs` | galaxy-feed: person with two open shifts, shift open over 24 hours, shift or event naming nobody on staff, live agent with no go-live time, negative cash collected, call outcome naming a client of another company, funded client with no amount. |
| 34 | desks-b.json:galaxy.html:Page itself loads (full-screen canvas, clock, census, LIVE / WAITING pill) | live-check | `fin-b12-display-contracts.mjs` | galaxy-page-load: the company has no active person and no live agent to show, or a person the census counts has no name. |
| 35 | desks-b.json:galaxy.html:Rail pulses (six rails: Sales, Card Stacking, Optimization Rounds, Inquiry Removal, AR + Collections, Aff | not-attachable | `fin-b12-not-attachable.mjs` | Rail pulses name only a stage, but a hand-off thread is labelled with a real client picked at random from the feed (fillC), so it says a handoff happened that did not. Held by fin-b12-rows.test.mjs. |
| 36 | desks-c.json:hiring.html:Bench table: one row per role (closer, setter, sales_coordinator) with bench count, short-by, awaiting sc | live-check | `fin-b12-display-contracts.mjs` | hiring-bench: v_hiring_bench bench count vs an independent recount of open applications at one-on-one and offer, short-by vs target minus bench, hiring manager not on staff, active role with negative target or no name. |
| 37 | desks-c.json:hiring.html:Board card: click opens the application drawer (name, scores, flags, source, video/resume tags) | live-check | `fin-b12-display-contracts.mjs` | hiring-card: open application with candidate or role outside the company, video tag not a web address, resume tag pointing at a missing document; scores outside 1-4, flags not a list, score for another company, person-scored with no person. |
| 38 | desks-c.json:hiring.html:Board column: 1:1 Interview (one_on_one) | live-check | `fin-b12-display-contracts.mjs` | hiring-col-one-on-one: open application in 1:1 Interview with no decision that moved it there, or candidate or role outside the company. |
| 39 | desks-c.json:hiring.html:Board column: Applied (applied) | live-check | `fin-b12-display-contracts.mjs` | hiring-col-applied: open application in Applied that a decision already moved on, entered before it was filed, or with candidate or role outside the company. |
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
3. **Documents: the "Generation failed" filter can never match.** The loader maps `generated_at` to generated or queued only,
   and there is no failure column. Row left not proved.
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
