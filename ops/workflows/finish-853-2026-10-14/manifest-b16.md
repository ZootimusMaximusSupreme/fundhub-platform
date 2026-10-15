# Finish the 853, batch 16 (tier 4, lane gap-catalog-display, 40 rows)

Branch `fin/b16`, built from `fin/base` (`2f4f574a0`). Worktree `.claude/worktrees/fin-b16`. Nothing was pushed or merged.
Generation 1 of 3. No product file was changed.

## The numbers

| | Rows |
|---|---|
| Rows in the batch | 40 |
| Still NOT_PROVED before | 40 (`node scripts/pulse/count-not-proved.mjs`, offline) |
| Still NOT_PROVED after | 1 (one justified `not-attachable`) |
| The whole lane count | 853 before, 814 after (39 rows closed) |

## Every row and its outcome

`live` = a read-only SQL contract the lane runs on the real saved rows (red on the first wrong one, green with "no saved results yet" until the first result). `practice` = a real page in Chromium (or the deck script in a vm) with fake answers; it reads no live data.

| # | Row (desks-c.json unless noted) | Outcome | Where |
|---|---|---|---|
| 1 | marketing-command-center: Settings quiet hours start and end | live-check | `fin-b16-display-contracts.mjs` `quietHoursSql` (buzzes made inside quiet hours must not be texted before they end) |
| 2 | marketing-command-center: Settings schedule fields | live-check | `scheduleSql`: weekly batch weekday and time in the saved zone, saved count rule and scripts a day x days, machine script style per kind, machine drafts past the expiry days |
| 3 | Shoot: Open the teleprompter link and the SLO Ads Drive link | practice-test | `fin-b16-cc-shoot.test.mjs` |
| 4 | Shoot: Save the plan | live-check | `shootCreateSql`; the screen half is also pressed in `fin-b16-cc-shoot.test.mjs` |
| 5 | Shoot: checklist, four boxes | practice-test | `fin-b16-cc-shoot.test.mjs` (browser storage only, no server trace to read) |
| 6 | Shoot: plan row buttons | live-check | `shootOrderSql`; the screen half is also pressed in `fin-b16-cc-shoot.test.mjs` |
| 7-12 | Today flywheel steps 1 to 6, chip and Read it / Hide it | practice-test (6 rows) | `fin-b16-cc-today.test.mjs` (one claim per step) |
| 13 | Today: Build the avatar | live-check | `avatarSql` (spend over the saved stop amount, finished run not on its last step, finished run with no saved files, cap stop with no sentence) |
| 14 | Today: Show more / Read it folds, Campaigns and Creative Factory links | practice-test | `fin-b16-cc-today.test.mjs` |
| 15 | Today: Waiting on you | practice-test | `fin-b16-cc-today.test.mjs` |
| 16 | Today: What is turned on tile and health list | practice-test | `fin-b16-cc-today.test.mjs` |
| 17 | Today: spend tiles and the Old numbers lead | practice-test | `fin-b16-cc-today.test.mjs` |
| 18 | messaging: Send this one to box | live-check | `sendToSql`; the screen half is also pressed in `fin-b16-messaging.test.mjs` |
| 19 | messaging: Email / Text toggle | practice-test | `fin-b16-messaging.test.mjs` |
| 20 | messaging: Compose box | practice-test | `fin-b16-messaging.test.mjs` |
| 21 | messaging: Deep links | practice-test | `fin-b16-messaging.test.mjs` |
| 22 | messaging: Reference disclosure (who-sent-it colour key) | **not-attachable** | `fin-b16-not-attachable.mjs`, held true by `fin-b16-rows.test.mjs` |
| 23 | messaging: Right panel | practice-test | `fin-b16-messaging.test.mjs` |
| 24 | messaging: Search box | practice-test | `fin-b16-messaging.test.mjs` |
| 25 | messaging: Tab All | practice-test | `fin-b16-messaging.test.mjs` |
| 26 | messaging: Tab Needs reply | practice-test | `fin-b16-messaging.test.mjs` |
| 27-30 | money-accounts: Try again, head buttons, Back link, Money nav | practice-test (4 rows) | `fin-b16-money-pages.test.mjs` |
| 31-34 | money-alerts: Show all N, Try again, Back link and nav, jump links | practice-test (4 rows) | `fin-b16-money-pages.test.mjs` |
| 35-36 | money-banks: Try again, Back link and 8-link nav | practice-test (2 rows) | `fin-b16-money-pages.test.mjs` |
| 37 | public-pages.json: Decline Autopsy sales page (SHELVED) | na-verified | `catalog-display-retired-autopsy`: the lane GETs the old address and the menu on every run (compiler now reads `file` as well as `page`); `src/pulse/coverage/fin-b16-retired-page-row.test.mjs` |
| 38-40 | desks-f.json present.html: Copy the sign link, Other actions toggle, Show the full Blueprint stack | practice-test (3 rows) | `fin-b16-present.test.mjs` |

Counts: 6 live-check, 32 practice-test, 1 na-verified, 1 not-attachable.

### Why row 22 is not attachable

The button and its colour key are in `messaging.html` (`#demoToggle` inside `#demozone`), but `public/app/fundhub-brand.css` lists `#demozone` among the placeholders that never render (UI-STANDARDS section 5) with `display:none !important`, and the page loads that sheet. A person cannot see the button. A test that un-hides it first would prove a control nobody can use. `fin-b16-rows.test.mjs` fails the day the stylesheet stops hiding it, and says to attach the row then.

## Files added (all new, all `fin-b16-*`)

`src/pulse/catalog/proofs/`: `fin-b16-display-contracts.mjs`, `fin-b16-live-contracts.test.mjs`, `fin-b16-live-contracts-2.test.mjs`, `fin-b16-live-harness.mjs`, `fin-b16-sql-kit.mjs` (stand-in Postgres text on SQLite), `fin-b16-kit.mjs`, `fin-b16-rows.json`, `fin-b16-rows.test.mjs`, `fin-b16-display-proofs.mjs`, `fin-b16-not-attachable.mjs`, `fin-b16-money-pages.test.mjs`, `fin-b16-messaging.test.mjs`, `fin-b16-present.test.mjs`, `fin-b16-cc-today.test.mjs`, `fin-b16-cc-shoot.test.mjs`.
`src/pulse/coverage/fin-b16-retired-page-row.test.mjs`.
`ops/workflows/finish-853-2026-10-14/manifest-b16.md`.

## Shared lines touched (the integrator merges these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | 1 import line + `...FIN_B16_RESULT_CONTRACTS,` at the end of `DISPLAY_RESULT_CONTRACTS` |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | 1 import line + `...FIN_B16_DISPLAY_PROOF_CASES,` at the end of the plug-in list |
| `scripts/pulse/compile-catalog.mjs` | 1 import line + `...FIN_B16_LIVE_CASES` spread into `staffProofCases` |
| `src/pulse/catalog/compiler.mjs` | 1 line: `retired: String(row.page \|\| row.file \|\| "") === ...` (the page row names its file under `file`) |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | contracts 40 to 46, pass-capable 27 to 33, SQL batches 27 to 33, calls 27 to 33, PASS 27 to 33, shipped cases 40 to 46 (my change: +6 each) |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 634 (my change: -38) |
| `src/pulse/catalog/generated.json` | recompiled with `npm run pulse:catalog` (a conflict is expected; run it again after merging) |

## Every check can go red (break the product or the SQL, see red, put it back)

Each break was made in the product file (or the SQL text), the test run, then the file put back byte for byte. `git status` shows no product file changed.

| What | Breaks tried | Red |
|---|---|---|
| money pages (Accounts, Alerts, Banks) | 20 (retry buttons dead, wrong form opened, no focus, back link to the portal, nav loses the tab or the client, Credit goes to Setup, Show all never expands or counts the wrong number, Alerts not current, jump links to the wrong place, client dropped from a link, Plan dropped from the nav) | 20 of 20 |
| messaging inbox | 18 (search keeps asking for owed only, typing never asks again, search matches everything, All asks for owed, email toggle opens the text thread, wrong button lit, Shift+Enter sends, texting hours never closed, email thread shows the rule, empty box sends `to: ""`, empty box stops a send, malformed number does not stop a send, channel deep link ignored, any conversation id opens, other threads include the open one, Their file link wrong, box filled from the wrong field, idempotency key lost) | 18 of 18 |
| Present deck | 11 (Other actions never closes or keeps one label, copy button before a send, link box editable, link not copied on send, copy button copies nothing, copy failure says copied, Blueprint button on every offer, opens the wrong piece, words changed, link read from the wrong field) | 11 of 11 |
| Today tab | 25 (step words and tones for all six steps, hide label, card open from the start, toggle label never changes, a repaint folds an open card, 7 day tile shows 30 days, up and down swapped, Old numbers never leads, a three day old pull is fresh, no-spend prints as saved, unknown parts counted as ready, approved steps listed as waiting, count words, video failure goes quiet, copy never folds by lines and by length, both links swapped, a card-less step with a live Read it or no sentence) | 25 of 25 (one stayed green first: the fold-by-lines break, because the long fixture also folded by length; three more fixtures were added and it went red) |
| Shoot tab | 15 (link takes any address, Roll it loses its script, key kept for any shoot, Drive folder changed, Drive opens in this tab, checklist not saved, checklist shared by every shoot, label changed, starts unticked, Save the plan reversed, arrow wrong way, Film first sends it last, Take off the plan removes nothing, Add to the plan puts it first, On the plan checkbox inverted) | 15 of 15 |
| live SQL contracts (named conditions) | for each named condition: a row that breaks only it is counted, and the text without that condition does not count it (42 tests in `fin-b16-live-contracts.test.mjs`) | all |
| live SQL contracts (the text itself) | 13 edits of the SQL (wrapping window read flat, made-time ignored, buzzes judged since forever, no wait for the planning window, failed batches judged, done shoot counted as open, archived version asked for a film order, spend equal to the cap red, other job kinds judged, record changed later blamed, on-file address judged, demo messages judged, non-staff messages judged) | 13 of 13 (one stayed green first, the on-file address condition, because no clean row had a record with an old-style number; the row was added and it went red) |
| retired page row | compiler reads only `page` | red (`fin-b16-retired-page-row.test.mjs` test 2) |

## Product findings (nothing was fixed)

1. `messaging.html` Reference disclosure (who-sent-it colour key) can never be seen: `fundhub-brand.css` hides `#demozone` with `display:none !important`. Row 22 stays not proved.
2. `money-alerts.html`: the row names jump links 'Add the close day' and 'Connect a bank'. The page has neither. Its real jump links are 'Open Accounts', 'Sort them in Accounts', 'Add an account', 'Add a card' (to Accounts) and 'Set up FinanceOS' (to Setup); the close day is an inline form. The practice test judges the real links. The row words are stale.
3. Shoot tab: the row names 'Remove from shoot' and 'Add to the end'. The page says 'Take off the plan' and 'Add to the plan' (the message says "to the end of the plan"). Row words stale; the test judges the real buttons.
4. `messaging.html`: the Email / Text toggle block carries `hidden`, but its own `display:flex` shows it before any thread is open (both buttons disabled, with the note "Switch Email or Text to open that conversation."). Small.
5. Quiet hours are held when a buzz is queued and when a failed send is retried, but `sendDueBuzzes` (`src/marketing/notify.mjs`) does not look at quiet hours at send time. A buzz queued a minute before quiet hours and picked up a few minutes later goes out inside them. Found by reading the code. The live check does not blame that case (it judges only buzzes made inside quiet hours).
6. The Scripts tab order (`POST marketing/scripts/order`) changes `film_order` but not the open shoot's `root_script_ids`, so the Shoot tab and the Scripts tab can show two orders while the header says "one order, two tabs". By reading the code. The live check does not compare the two for that reason; it asks only that every script on an open shoot has a film order.
7. `savePlan` (`src/marketing/planner-data.mjs`) clears the one-time override by writing `marketing_settings.updated_at`, so "settings last saved" moves whenever the machine plans a week that used an override. The schedule check allows for this (it judges a weekly batch only when the whole planning window began after the last save).

## Commands I ran, and their results

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs out.json` (before, on `fin/base`) | `{"total":853,"byLane":{"gap-door-batch-routes":135,"gap-catalog-display":680,"gap-catalog-flow":23,"gap-catalog-reads":15}}`; batch rows open: 40 of 40 |
| `npm run pulse:catalog` then the same count | `{"total":814,...,"gap-catalog-display":641,...}`; batch rows open: 1 of 40 (row 22) |
| `node scripts/pulse/compile-catalog.mjs --check` | fresh |
| `node --test src/pulse/catalog/proofs/fin-b16-*.test.mjs src/pulse/coverage/fin-b16-retired-page-row.test.mjs`, three runs in a row | 84 tests, 84 pass, 0 fail, 0 skipped, each run (about 14 seconds each, load average 16 to 60) |
| `node --test src/pulse/coverage/gap-catalog-display.test.mjs` | 11 of 11 |
| `node --test src/pulse/catalog/*.test.mjs` | 42 of 42 |
| `node --test --test-name-pattern "unmapped display rows stay red" src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 634 (672 before) |
| `npm run lint` | `lint: 3575 file(s) and inline script(s) parse clean` |
| `node --test` over every file in `src/pulse/catalog/**`, `src/pulse/coverage/gap-catalog*`, `gap-door-batch*` and `fin-b16-retired-page-row` (121 files, one run, load average 50 to 110) | 1,767 tests, 1,765 pass, 2 fail, 0 skipped. Neither failure is a batch 16 file: (1) inside "the focused proof test runs every executable test named by every case", the S1 spec `e2e/marketing-cc-settings.spec.mjs` ("the weekly switch: off ...") hit its 30 second limit; alone it passes 17 of 17. (2) "every test named by a flow proof passes" lost `src/sales/closer-deck.test.mjs` to a time-out, the same load failure the S1, S2 and S4 manifests list. Every batch 16 test passed inside that run. |

## Left undone, and what is not claimed

- Row 22 is not attached (finding 1).
- Rows 1, 2 and 13 are proved by what they SAVE. Their screen halves (the time boxes and the "a bad box is named in plain words" sentence on Settings; the cost sheet, live step words and Retry on the avatar row) are not claimed here. Older specs press them (`e2e/marketing-cc-settings.spec.mjs`, `e2e/marketing-avatar-row.spec.mjs`) but this batch did not bind them to the rows.
- The schedule check does not judge the saved "scripts a day" and "days in a batch" for a plan with a one-time override or with no active funnel, and it waits until a weekly batch's whole planning window came after the last save. A week that did not fit those cases is the week it judges.
- The "Send this one to" check judges the SHAPE of a typed destination on the saved message. "Never written back to the record" has no saved trace to read; the page half (the page writes only the message) is pressed by the practice test, and the server half is `src/messaging/compose.test.mjs`.
- The live checks were run against stand-in rows (SQLite, real column names). They were not run on the live database (the brief forbids it). The first live read happens when the morning pulse runs the lane.

## Next

Integrator: merge, run `npm run pulse:catalog`, re-derive the two guard numbers (`gap-catalog-display.test.mjs`, `display-proof-cases.test.mjs`).
