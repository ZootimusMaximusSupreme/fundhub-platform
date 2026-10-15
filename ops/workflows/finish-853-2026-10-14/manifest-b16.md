# Finish the 853, batch 16 (tier 4, lane gap-catalog-display, 40 rows)

Branch `fin/b16`, built from `fin/base` (`2f4f574a0`). Worktree `.claude/worktrees/fin-b16`. Nothing was pushed or merged.
Generation 3 (repair cycle 1). No product file was changed. Read the "Repair cycle 1" section first: an independent
checker broke the product on purpose in 25 places and the earlier checks stayed green; each one was answered below.

## Repair cycle 1 (generation 3): what the checker found, and what was done

The checker's break, for each id below, was made again in the product file (or the SQL text) after the repair, the
batch tests run, and the file put back byte for byte (`git status` shows no product file changed). Every break that
stayed green is now red. Three rows could not be made honest and were taken OFF (not attached), so they are
NOT_PROVED again: 3 rows, with the exact reason.

| # | Row (desks-c.json) | Outcome now | What was wrong, and the fix |
|---|---|---|---|
| 1 | Settings: quiet hours start and end | live-check + practice-test | The SQL judged only buzzes MADE inside quiet hours, so a buzz made at 8:59 pm and texted at 9:03 pm, or made at 8 pm and texted at 11:30 pm, stayed green. It now judges the saved result of the promise: when a buzz was TEXTED (`sent_at` inside the saved hours, for texts sent after the last save). The typed start and end boxes were never judged: new `fin-b16-cc-settings.test.mjs` types a different value in every box and reads the exact patch (start goes in `quiet_start`, end in `quiet_end`, alone and together, the live sentence names them). Limit written as a test: re-saving any setting moves `updated_at`, and a night text from before that save is no longer in the window. |
| 2 | Settings: schedule fields | live-check + practice-test | (1) Company filter: two more companies now carry a bad row in every branch, so a branch that forgets the filter turns the clean rows red. (2) New named results: a weekly batch released more than 2 hours after its drop time, a weekly batch still `planned`/`writing`/`ready` 2 hours after its drop time, and "the switch is on and 9 days after the last save no weekly batch exists" (a company with the switch off, or a save under 9 days old, is not judged). The 3 hour planning window is pinned from both sides. (3) A draft expired BEFORE its saved days is blamed, only for batches released after the last save (a raised number must not blame what the old number expired). (4) The screen half: `fin-b16-cc-settings.test.mjs` sends the weekday (Sunday = 0 too), time, per day, days, rule, each of the six kinds and the expiry, one at a time and all at once. |
| 3 | Shoot: checklist (4 boxes) | practice-test | Mirror on was never pressed. Each of the four boxes is now ticked alone: its own saved name, the only ticked box after a reload, unticked saved. Another shoot in the same browser starts empty and leaves the first one's boxes alone (the old "other shoot" check opened a fresh browser and proved nothing). |
| 4 | Shoot: plan row buttons | live-check + practice-test | The Up arrow was never pressed and the include box was only ever unticked. Up is pressed on a plan before a shoot (twice, and the first row's Up is off) and on an open shoot (the order it sends); the include box goes off, dims the row, goes on again, and with all three off Save is disabled. Down, Film first and Take off the plan were already red on breaks. The live SQL cannot see order (a permutation is a valid-looking row); the screen test is what judges the order. |
| 5 to 9 | Today flywheel steps 2 to 6 | practice-test (5 rows) | STALE ("Out of date") was never fed in, and no step's own sentence under the chip was asserted. New `fin-b16-cc-today-words.test.mjs` runs every step 2 to 6 in every state the page can show (done, done and approved, failed with each step's own reason, out of date with its own earlier step, out of date with no reason, waiting on steps, not run yet, and a state nobody named): chip word, chip tone, the sentence, and the "where this runs" line. Step 6 also has a review card, so its Read it / Hide it opens and closes (it was only ever a disabled button). |
| 10 | Today: Build the avatar | live-check + practice-test | The row's own words (cost sheet, run, live step words, Retry) were never pressed. New `fin-b16-cc-avatar.test.mjs`: the cost line, the sheet reads the cost again before it shows (the newest line), Start building sends campaign, stage, request id and the typed words, the row says Started and shows the step, the button is off with its reason, it asks again every 8 seconds and shows the server's step words, it stops asking and the button comes back when the run is done, Retry (plain or "keeps what it found") sends the stopped run's id, Not now sends nothing, and four refusals read in words. The SQL counted a call with no price (`cost_usd` NULL) as $0 while the run counts it at the highest known rate (invisible overspend on an unknown model): it now counts it the same way, and a test holds the rates to `HIGHEST_KNOWN_RATE`. A run with no stop amount saved on it is now a named bad result. |
| 11 | Today: Show more / Read it folds, links | practice-test | The offer card's own Show more (`#offerMore`) was never rendered. It is now (the page's offer read is answered): label, aria, hidden, the whole offer, stays open on the 5 minute reread, and an offer with nothing past its name has no fold. |
| 12 | Today: Waiting on you | practice-test | Approve and redo lines, a vanished out-of-date step, the Mac running state, "waiting since" the oldest day, "N or more", singular video, ads in number order, and the approve link that is live / ran out (the LATEST day) / never sent were unpinned. All are asserted word for word now. |
| 13 | Today: What is turned on | practice-test | Meta that never sent numbers, the marketing switch off, the budget used up, and parts nobody answered for ("The rest are not known yet.", never counted ready) are asserted. |
| 14 | Today: spend tiles | practice-test | Up, down, about the same (0.4% and 0.6% both ways), no number before, no number now, $0 before, same as $0, the coverage note at 5 of 7 and not at 7 of 7, today's number printed, and the line between fresh and old numbers at 47 and 49 hours. |
| 15 | messaging: Send this one to | live-check + practice-test | "Never written back" had no check that could see a break. New `fin-b16-compose-writes.test.mjs` runs the real `composeAndSend` with a database that records every statement: the typed address is on the message insert and nowhere else, and no statement writes to `clients` (6 breaks, all red; the existing source scan in `src/messaging/compose.test.mjs` caught 3 of those 6, and is attached beside it). Page side: an email shape, a space in an address, and a late read of the record never wipes what was typed. |
| 16 | messaging: Email / Text toggle | practice-test | The header name, the avatar, the footer name and the reply-owed words are now read after each switch (email thread answered, text thread owed, a channel with no thread), and a switch answered after the person moved on does not take the screen back. |
| 17 | messaging: Compose box | practice-test | The 8:00 pm and 8:00 am edges are pinned at 19:59, 20:00, 23:30, 07:59, 08:00; an empty or blank box sends nothing; the words go as typed (spaces kept); a held message empties the box and says when it goes; a stopped one keeps the words. |
| 18 | messaging: Deep links | NOT ATTACHABLE (removed) | See reason A below. |
| 19 | messaging: Reference disclosure | NOT ATTACHABLE (removed) | See reason B below. |
| 20 | messaging: Right panel | NOT ATTACHABLE (removed) | See reason A below. |
| 21 | messaging: Search box | practice-test | Capitals ("MARCUS", "tHaNkS", "SMS"), stray spaces, no extra note on the All tab when nothing more is waiting, and "Searching the N most recent conversations only." with and without "Searching everyone, not just Needs reply." |
| 22 | messaging: Tab Needs reply | practice-test (page + server) | Nothing judged which threads the server calls owed. New `fin-b16-inbox-read.test.mjs` runs the real `api/read/inbox.mjs` SQL (its own text) over stand-in rows: owed = the newest message came from the client, a thread with no messages is null, another company's thread is never in the answer, only an explicit 1 or true filters (9 breaks, all red). The page test also counts: a thread with no messages is a thread and is not counted as owed. |
| 23 | money-alerts: Show all N | practice-test | Four protections now (5, 4, exactly 3, 1 texts): the first three show first, exactly three has no button, one protection's open state does not move another's, closing one leaves the other open. |
| 24 | money-alerts: Jump links | practice-test | Each "Open Accounts" is judged where it sits (needs tile, personal cash box), so removing or re-pointing one is no longer hidden by the other; "Sort them in Accounts", "Set up FinanceOS", "Add an account" and "Add a card" are judged by place; the in-page jumps ("Add the day", "See it") are pressed and the focus is read. |
| 25 | present: Copy the sign link | practice-test | The "copying sends nothing" assertion read a list made earlier (it could never change). It now counts the writes after the press. The page file is read: the scripts it loads, in its order, and its `#app` (a page that loses `contract-send.js` has no Copy button, and the test sees it). A link with a quote, `<` and `&` is escaped in the box and copied raw. |

### Reasons for the three rows taken off

**A. messaging.html opened by `?conversation_id=` shows the wrong person (rows 18 and 20).** The default tab asks the
server for only the threads owed a reply (`?needs_reply=1`). Any thread that is not in that list and is opened by
`?conversation_id=` (the global-search link) opens a stub row with no client. Probed on the real page: the header reads
`Unnamed client`, the Their file link is `client-control-panel.html?id=null`, and the other threads are asked with
no `client_id` (`/api/read/conversations?limit=50`). The two rows' controls are exactly these (the deep link, and the
right panel's list and Their file link). A practice test either asserts the wrong words (a check that is green while
the product is wrong) or asserts the right ones (red on the product as it is today). Neither is allowed. The fix is a
product change: look up the conversation's client before drawing, or draw the stub without the link. The tests that
run today are kept as plain tests in `fin-b16-messaging.test.mjs` (not claimed by a row).

**B. The who-sent-it colour key (row 19).** `fundhub-brand.css` hides `#demozone` with `display:none !important`
(UI-STANDARDS section 5), so no person can see or press it. The earlier practice test pressed it through the page
(`element.click()`), which proves code behind a control nobody can use. Taken off. Product choice: show it or delete it.

## The numbers

| | Rows |
|---|---|
| Rows in the batch | 40 |
| Still NOT_PROVED before the whole batch | 40 (`node scripts/pulse/count-not-proved.mjs`, offline) |
| Still NOT_PROVED after generation 2 | 0 |
| Still NOT_PROVED after this repair (generation 3) | 3 (the three rows above) |
| The whole lane count | 853 before the batch, 816 now (37 rows closed) |
| Attached | 36: 6 live checks (each with its screen half), 30 practice tests |
| Retired page row | 1 (na-verified) |

## Every row and its final outcome

`live` = a read-only SQL contract the lane runs on the real saved rows (red on the first wrong one, green with "no saved
results yet" until the first result). `practice` = a real page in Chromium (or the deck script in a vm, or the real
handler over stand-in rows) with fake answers; it reads no live data.

| # | Row | Outcome | Where |
|---|---|---|---|
| 1 | marketing-command-center: Settings quiet hours start and end | live-check + practice | `fin-b16-display-contracts.mjs` `quietHoursSql`; `fin-b16-cc-settings.test.mjs` |
| 2 | marketing-command-center: Settings schedule fields | live-check + practice | `scheduleSql`; `fin-b16-cc-settings.test.mjs` |
| 3 | Shoot: Open the teleprompter link and the SLO Ads Drive link | practice-test | `fin-b16-cc-shoot.test.mjs` |
| 4 | Shoot: Save the plan | live-check + practice | `shootCreateSql`; `fin-b16-cc-shoot.test.mjs` |
| 5 | Shoot: checklist, four boxes | practice-test | `fin-b16-cc-shoot.test.mjs` (browser storage only, no server trace to read) |
| 6 | Shoot: plan row buttons | live-check + practice | `shootOrderSql`; `fin-b16-cc-shoot.test.mjs` |
| 7 | Today flywheel step 1 | practice-test | `fin-b16-cc-today.test.mjs` |
| 8 to 12 | Today flywheel steps 2 to 6 | practice-test (5 rows) | `fin-b16-cc-today.test.mjs`, `fin-b16-cc-today-words.test.mjs` |
| 13 | Today: Build the avatar | live-check + practice | `avatarSql`; `fin-b16-cc-avatar.test.mjs` |
| 14 | Today: Show more / Read it folds, links | practice-test | `fin-b16-cc-today.test.mjs`, `fin-b16-cc-today-words.test.mjs` |
| 15 | Today: Waiting on you | practice-test | same two files |
| 16 | Today: What is turned on | practice-test | same two files |
| 17 | Today: spend tiles and Old numbers | practice-test | same two files |
| 18 | messaging: Send this one to box | live-check + practice | `sendToSql`; `fin-b16-messaging.test.mjs`; `fin-b16-compose-writes.test.mjs`; `src/messaging/compose.test.mjs` |
| 19 | messaging: Email / Text toggle | practice-test | `fin-b16-messaging.test.mjs` |
| 20 | messaging: Compose box | practice-test | `fin-b16-messaging.test.mjs` |
| 21 | messaging: Deep links | not-attachable | reason A |
| 22 | messaging: Reference disclosure | not-attachable | reason B |
| 23 | messaging: Right panel | not-attachable | reason A |
| 24 | messaging: Search box | practice-test | `fin-b16-messaging.test.mjs` |
| 25 | messaging: Tab All | practice-test | `fin-b16-messaging.test.mjs` |
| 26 | messaging: Tab Needs reply | practice-test (page + server) | `fin-b16-messaging.test.mjs`, `fin-b16-inbox-read.test.mjs` |
| 27-30 | money-accounts: Try again, head buttons, Back link, Money nav | practice-test (4 rows) | `fin-b16-money-pages.test.mjs` |
| 31-34 | money-alerts: Show all N, Try again, Back link and nav, jump links | practice-test (4 rows) | `fin-b16-money-pages.test.mjs` |
| 35-36 | money-banks: Try again, Back link and 8-link nav | practice-test (2 rows) | `fin-b16-money-pages.test.mjs` |
| 37 | public-pages.json: Decline Autopsy sales page (SHELVED) | na-verified | `catalog-display-retired-autopsy`; `src/pulse/coverage/fin-b16-retired-page-row.test.mjs` |
| 38-40 | desks-f.json present.html: Copy the sign link, Other actions toggle, Show the full Blueprint stack | practice-test (3 rows) | `fin-b16-present.test.mjs` |

Counts: 6 live-check (all with a screen half), 30 practice-test, 1 na-verified, 3 not-attachable.

## Files added or changed in this repair (all `fin-b16-*` except where named)

New in `src/pulse/catalog/proofs/`: `fin-b16-cc-today-kit.mjs` (the fake answers and the open helper the two Today files share; the first Today file now imports it), `fin-b16-cc-today-words.test.mjs`, `fin-b16-cc-settings.test.mjs`, `fin-b16-cc-avatar.test.mjs`, `fin-b16-inbox-read.test.mjs`, `fin-b16-compose-writes.test.mjs`.
Changed (batch files): `fin-b16-display-contracts.mjs` (SQL: quiet hours, schedule, avatar), `fin-b16-live-contracts.test.mjs`, `fin-b16-live-contracts-2.test.mjs`, `fin-b16-cc-today.test.mjs`, `fin-b16-cc-shoot.test.mjs`, `fin-b16-messaging.test.mjs`, `fin-b16-money-pages.test.mjs`, `fin-b16-present.test.mjs`, `fin-b16-rows.json`, `fin-b16-rows.test.mjs`, `fin-b16-display-proofs.mjs` (a row pressed by several files lists them all; the existing `compose.test.mjs` is attached to Send this one to).

## Shared lines touched in this repair

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 633 to 636 (my change: +3, the three rows taken off) |
| `src/pulse/catalog/generated.json` | recompiled with `npm run pulse:catalog` (a conflict is expected; run it again after merging) |

Earlier generations' shared lines stand (see the previous list in git history of this file): the import and spread lines in
`display-saved-result.mjs`, `display-proof-cases.mjs`, `scripts/pulse/compile-catalog.mjs`, the one line in
`src/pulse/catalog/compiler.mjs`, and the six numbers in `src/pulse/coverage/gap-catalog-display.test.mjs`.

## Every check can go red (break the product or the SQL, see red, put it back)

Each break was made in the product file (or the SQL text), the test run, then the file put back byte for byte.

| What | Breaks tried | Red |
|---|---|---|
| Today tab, both files (public/app/marketing-cc-today.js) | 46: STALE word, STALE sentence and its fallback, unknown word, done / fail / blocked / missing sentences and words, the "waits for you" and "Redo the step" tails, the run line, the offer fold (label, never hidden, wrong id), a live / expired / no approve link three ways, STALE dropped from Waiting, Mac running words and branch, oldest day, "or more", singular, latest end day, ad order, approve and redo lines blank, Meta never sent, switch forced, rest not known, budget forced, compare always up, same removed, threshold 0.05 / 0.2 / 0.001, no prior, no current, prior zero, coverage at 7 of 7, fresh line 1 and 3 days, today's number | 46 of 46 |
| Settings page (marketing-cc-settings.js) | 13: end box reads start, start patched into end, end patched into start, weekday never sent / as text / Sunday skipped, rule never sent, per day reads days, expiry never sent, a style under another kind, drop time never sent, quiet line swapped, start box shows end | 13 of 13 |
| Shoot tab (cc-tab-shoot.js) | 10: Mirror key shared with Phone, Mirror never saved, Mirror always unticked, Remote key shared, Up arrow goes down, Up arrow sends the old list, Down goes up, include never re-ticked, include inverted, Film first sends the old list | 10 of 10 |
| Avatar row (marketing-avatar-row.js) | 16: Retry never shown, Start never allowed / always allowed, Retry label, Retry id dropped, poll 30 s, poll never stops, sheet cost stale, default words blank, typed words not sent, reason hidden, run sentence hidden, 401 words, server words ignored, cost line hidden, Not now sends | 16 of 16 |
| Messaging inbox (messaging.html) | 19: email shape any, late read overwrites, quiet start 21 and 19, quiet end 9 and 7, start edge, end edge, box cleared on a stop, empty guard, body trimmed, name dropped on switch, reply state dropped, moved-on guard, null counted owed, search case, search spaces, scope note, everyone note on All | 19 of 19 (each with exactly 1 failing test) |
| Inbox handler (api/read/inbox.mjs) | 9: column flipped, filter flipped, filter ignored, flag ignored, company filter dropped, oldest first (filter and join), inner join, any value filters | 9 of 9 |
| Compose handler (src/messaging/compose.mjs) | 6: UPDATE clients before the insert, `public."clients"` spelling, UPDATE after the send, typed address ignored, shape bypassed, typed address on a second statement | 6 of 6 for `fin-b16-compose-writes.test.mjs`; the existing `compose.test.mjs` source scan caught 3 of 6 |
| Money alerts (money-alerts.js) | 19: Show all at exactly 3, one open flag shared, last three first, wrong N, needs-tile Open Accounts to Setup / removed / client dropped, cash-box Open Accounts to Setup / removed / client dropped, Sort them in Accounts to Setup / client dropped, jump does nothing, Add the day and See it (short and unknown) aimed at the wrong box, jump never focuses, Add an account and Set up FinanceOS aimed at the wrong tab | 19 of 19 (two stayed green first: See it on short cash was never pressed, and the Sort them link had no own place; both were added and went red) |
| Present deck (present.js, present.html, contract-send.js) | 13: copy also sends, copy also makes a draft, escape dropped, copies nothing, always "copied", copy button before a send, box editable, script tag dropped, `#app` renamed, present.js dropped, order swapped, link from the wrong field, clipboard failure called success | 13 of 13 |
| live SQL (the text itself) | 41: quiet (saved-window guard, both edges, company filter, judged on made time, equal start and end), schedule (company filter in each of 4 branches, 3 hour window both ways, failed, kind, source twice, archived, style window, 9 days both ways, switch off, late 2 hours both ways, stuck 2 hours, stuck ready only, grace both ways, too-early guard and threshold), avatar (usage company filter, priced counted twice, unpriced dropped, kind, company, cap equal), send-to (company, record changed, 90 days, on-file address, staff only, sms shape) | 41 of 41 (one stayed green first, the 90 day window, because the record-changed guard also hid the old row; a client with an old record was added and it went red) |

## Product findings (nothing was fixed)

1. `messaging.html` Reference disclosure (who-sent-it colour key) can never be seen: `fundhub-brand.css` hides `#demozone` with `display:none !important`, so staff cannot open the colour key. Product choice (show it or delete it).
2. `money-alerts.html`: the row names jump links 'Add the close day' and 'Connect a bank'. The page has neither. Its real jump links are 'Open Accounts', 'Sort them in Accounts', 'Add an account', 'Add a card' (to Accounts) and 'Set up FinanceOS' (to Setup); the close day is an inline form. The practice test judges the real links. The row words are stale.
3. Shoot tab: the row names 'Remove from shoot' and 'Add to the end'. The page says 'Take off the plan' and 'Add to the plan'. Row words stale; the test judges the real buttons.
4. `messaging.html`: the Email / Text toggle block carries `hidden`, but its own `display:flex` shows it before any thread is open (both buttons disabled, with the note "Switch Email or Text to open that conversation."). Small.
5. Quiet hours are held when a buzz is queued and when a failed send is retried, but `sendDueBuzzes` (`src/marketing/notify.mjs`) does not look at quiet hours at send time. A buzz queued a minute before quiet hours and picked up a few minutes later goes out inside them. The live check now judges this (`sent_at` inside the hours), so it will go red the first time it happens.
6. The Scripts tab order (`POST marketing/scripts/order`) changes `film_order` but not the open shoot's `root_script_ids`, so the Shoot tab and the Scripts tab can show two orders while the header says "one order, two tabs". By reading the code.
7. `savePlan` (`src/marketing/planner-data.mjs`) clears the one-time override by writing `marketing_settings.updated_at`, so "settings last saved" moves whenever the machine plans a week that used an override. The schedule check allows for this (it judges a weekly batch only when the whole planning window began after the last save), and the quiet hours check loses the earlier night texts on every such save (limit stated in the contracts file and held by a test).
8. NEW, `messaging.html` `?conversation_id=` for a thread that is not in the loaded list (the default tab loads only owed threads, so every answered thread) opens a stub with no client: header `Unnamed client`, Their file link `client-control-panel.html?id=null`, other threads asked with no `client_id`. Reproduced on the real page. This is reachable from the global-search link. Product change needed: look up the client for a conversation id before drawing.
9. The schedule live check now goes red when the weekly switch is on and nine days pass with no weekly batch (the machine did not plan). It is quiet while the switch is off (it ships off).

## Commands run, and their results

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs out.json` (start of the repair, on `fin/b16`) | `{"total":813,...,"gap-catalog-display":640,...}`; batch rows open: 0 of 40 |
| every break in the "Every check can go red" table, one at a time, the file put back each time (a small script that applies one text change, runs the named tests, restores the file) | all red; the ones that stayed green first are named in that table, and were fixed and re-run |
| `node --test src/pulse/catalog/proofs/fin-b16-*.test.mjs src/pulse/coverage/fin-b16-retired-page-row.test.mjs` | 130 tests, 130 pass, 0 fail, 0 skipped (about 20 seconds) |
| `node --test src/pulse/coverage/gap-catalog-display.test.mjs src/pulse/catalog/*.test.mjs src/messaging/compose.test.mjs` | 69 of 69 |
| `node --test --test-name-pattern "unmapped display rows stay red\|every display proof case names" src/pulse/catalog/proofs/display-proof-cases.test.mjs` | 2 of 2; red count 636 (633 + the 3 rows taken off) |
| `node --test --test-name-pattern "the focused proof test runs every executable" src/pulse/catalog/proofs/display-proof-cases.test.mjs` (runs the test file of every case in every batch, about 9 minutes) | 1 of 1, exit 0 |
| `npm run pulse:catalog`, then `node scripts/pulse/compile-catalog.mjs --check` | `3975 mapped, 3919 wired, 23 red`; fresh |
| `node scripts/pulse/count-not-proved.mjs` (end of the repair) | `{"total":816,"byLane":{"gap-door-batch-routes":135,"gap-catalog-display":643,"gap-catalog-flow":23,"gap-catalog-reads":15}}`; batch rows open: 3 of 40 (Deep links, Reference disclosure, Right panel) |
| `npm run lint` | `lint: 3582 file(s) and inline script(s) parse clean` |
| probe of the real `messaging.html?conversation_id=` (a thread not in the loaded list), a scratch test, deleted | header `Unnamed client`; Their file link `client-control-panel.html?id=null`; other threads read `/api/read/conversations?limit=50` |


## Left undone, and what is not claimed

- Three rows are NOT_PROVED again (Deep links, Reference disclosure, Right panel). Each has the exact reason above and needs a product decision or change.
- Rows 1, 2 and 13 judge what the page SAVES (and now the page's boxes and buttons by a practice test). They do not claim a person pressed them on the live site.
- The quiet hours live check cannot see a night text that was sent before the settings were last saved; the schedule check does not judge a plan with a one-time override or with no active funnel on its count, and it waits until a weekly batch's whole planning window came after the last save.
- The "Send this one to" live check judges the SHAPE of a typed destination on the saved message. "Never written back to the record" has no saved trace to read afterwards; it is judged by the statement trace in `fin-b16-compose-writes.test.mjs` (the real `composeAndSend` against a recording database, stopped at the dispatcher's claim) and by the existing source scan. A write-back placed only on the provider-sent branch is not reached by the statement trace; the source scan covers the plain `UPDATE clients` spelling.
- The live checks were run against stand-in rows (SQLite, real column names). They were not run on the live database (the brief forbids it). The first live read happens when the morning pulse runs the lane.

## Next

Integrator: merge, run `npm run pulse:catalog`, re-derive the guard number (`display-proof-cases.test.mjs`; the red count is 636 on this branch). Chris decisions waiting: the two product changes in findings 1 and 8, and whether to fix finding 5 (the quiet hours check will go red when it happens).
