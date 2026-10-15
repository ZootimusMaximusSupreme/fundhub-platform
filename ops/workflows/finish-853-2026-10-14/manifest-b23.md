# Batch 23 manifest: page-read rows (lane gap-catalog-reads)

Branch `fin/b23`, work folder `.claude/worktrees/fin-b23`, generation 1. Nothing pushed, nothing merged.
Base: `fin/base` (2f4f574a0).

## Repair cycle 1: five checks that stayed green when the product broke

Branch `fin/b23`, same work folder, fresh repair agent. An independent checker broke the product five ways and
the attached practice test stayed green. Every one is a hole in the TEST, not a missing product feature. All five
rows keep their attachment (practice test, fake data, real page or real handler) and each hole now goes red. No
product file was changed. Nothing pushed, nothing merged. No shared file touched (`generated.json` is unchanged).

| Row | Outcome | What the old test missed | What now judges it |
|---|---|---|---|
| `catalog-read:campaign-fatigue-label` | practice-test | Only the Label button was judged. The four values (frequency, CTR, ROAS, next rotation), the recommendation badge and the row stripe were never read by this row's test. | New test reads every column of four different ads under its own header and checks all values, the badge tone and the stripe. |
| `catalog-read:portal-welcome-video` | practice-test | The fake server answered the second read for anyone. Sign-in and client id were judged on read 1 only; the retry flag reset, the resume place and "a video that played stays on screen" were untested. | Strict server (refuses no sign-in, hands another client's video to a read without the client id). Three new tests: retry carries same sign-in and client id, a later lapse gets a fresh link and resumes at 0.5 s, a played video stays when no fresh link exists (empty and refused). |
| `catalog-read:money-trends` | practice-test | The drawn lines were never judged: a flat line, a bridge across a missing day, lost dashes, no dots, a changed default range all passed. Test 4 also failed the day the page gained the script. | New test reads every polyline (point positions from the value scale, solid versus dashed runs, a break at the missing day, dots, axis words, table). New range test (default, button, remembered, junk, blocked storage, draw default). Test 4 is now conditional on whether the page loaded the script. |
| `catalog-read:social-oauth` | practice-test | The stand-in database never ran the SQL, and the provider answered with a token whatever it was asked. | Strict provider (needs app id, secret, code, redirect, grant). The saved SQL is read statement by statement: columns, values, `CASE` expiry, checked against `db/migrations/049_social.sql` (channels, states, required columns, active-needs-token, unique key). A reconnect of an expired channel is played. Signed state beats the query-string partner and the session company. |
| `catalog-read:ops-compliance` | practice-test, with a product finding | The fixture invented `client_name`, which the live read never sends, and then pinned the raw id. | The page is now fed by the REAL `api/read/messages.mjs` handler over a stand-in database. The rows carry exactly the columns that handler's `SELECT` lists, and the query (company, status, order, limit) is judged. |

### Breaks made on purpose this cycle (one text swap, test run, file restored)

Counted red unless marked.

- Fatigue: swapped frequency and ROAS cells, verdict fixed to "ok", CTR hard-coded 0.00%, frequency to one decimal, ROAS shows CTR, next rotation loses its "h", badge tone wrong, stripe wrong, null spend shown as 0.00, Label carries the ad name. 10 of 10 red.
- Welcome video: retry drops the client id, retry sends no sign-in, retry flag never given back after a good load, resume place removed, resume at half, give-up ignores "already loaded", no retry at all, retry keeps the old link, retry flag never set. 9 of 9 red.
- Trends: every point drawn at zero, line bridged across a missing day (two ways), dashed class removed, dots off, default range changed in four places (the `||` fallback, the initial value, the junk-value fallback, the draw default), range choice not remembered, x spacing off by one, debt chart loses its zero floor, estimated test looks only at the previous day, lone dots always round, a gap printed as $0.00, the client id dropped from the read, y axis flipped. 17 of 17 red. Also: `money.html` given the script tag (the page gaining the feature) stays green.
- Social OAuth: Facebook channel literal 'twitter', Facebook and Instagram state 'pending', Instagram literal 'facebook', LinkedIn state 'revoked', LinkedIn channel literal changed, expiry forced NULL, expiry param null, refresh token not saved, three reconnect updates that leave the old state and error, reconnect keeps old token and old expiry, partner taken from the query string, company taken from the staff session, three scope lists wrong, conflict key without channel, Facebook token saved plain, Meta exchange without secret or redirect or with the wrong app id, pages read with the wrong token, LinkedIn exchange without secret, without redirect, with the wrong grant. 28 of 28 red.
- Compliance: top 16, client name only, channel without dash fallback, reason order swapped, "when" shows channel, page asks for `failed`, page asks limit 10, endpoint stops selecting `client_id`, endpoint stops selecting `channel`, endpoint binds no company, endpoint orders oldest first, endpoint ignores status. 12 of 12 red.
  - One equal break stays green on purpose: the Client cell reading `client_id` only (no name). The live read sends no name, so the page output is the same. It is not a hole in the test.

### Product findings added or restated this cycle (nothing fixed)

1. **The Compliance Gate table's Client column prints a raw client id.** `api/read/messages.mjs` (status=blocked) selects `client_id` and no name, and `public/app/ops-admin.html` prints `r.client_name || r.client_id`. On the live page staff see a uuid. The row stays attached because the test now judges the live shape and the page does what its code says; the missing name is the finding. If the read ever joins a client name as `client_name`, the test follows it (it derives the expected cell from the rows the real handler returned).
2. (restated, finding 2 above) `public/app/money.html` loads no `money-trends.js`, so its Trends slot stays empty. The test no longer pins that: it requires an empty slot and no read when the script is absent, and the graphs when it is present.
3. Practice-test limit: a link that lapses in the middle of a play cannot be made by the stand-in media server, so the welcome-video tests fire the same `error` event the browser raises by hand. The real browser path (a range request refused) is not exercised.
4. Practice-test limit: the stand-in database does not run SQL. The OAuth test reads each saved statement with a small reader that only knows the forms in `api/social/oauth.mjs` (bound value, quoted literal, `NULL`, `now()`, the expiry `CASE`, `EXCLUDED.col`). A new form raises "cannot read this value" instead of passing.

### Commands run this cycle

| Command | Result |
|---|---|
| each of the 5 attached tests, alone | 44 of 44 pass across all `fin-b23-*.test.mjs` files |
| 77 breaks (list above), one at a time, file restored each time | 76 red, 1 equal break green (named above); `git status` clean of product edits after |
| `node scripts/pulse/count-not-proved.mjs` | total **840**, reads lane **2** (`present-send-lock`, `climate-map`), none of the five ids open |
| `npm run pulse:catalog` | `3975 mapped, 33 marked repeats, 3942 unique; 3919 wired, 23 red`; `generated.json` unchanged |
| `gap-catalog-reads.test`, `read-proof-cases.test`, `flow-read-contracts.test`, `door-flow-read-contracts-2.test` | 9 of 9 pass (the 76 proved read tests run for real, mine included) |
| `node --test` on `src/pulse/*.test.mjs`, `src/pulse/coverage/*.test.mjs`, `src/pulse/catalog/*.test.mjs` (not `.pg.`) | 2890 tests, 2871 pass, **0 fail**, 19 skipped (all "no DATABASE_URL") |
| `npm run lint` | `3574 file(s) and inline script(s) parse clean` |

---

## Generation 2 (resumed run): the two open rows, challenged

Branch `fin/b23`, same work folder. I was told to challenge every earlier "not-attachable" reason and attach a
check unless the reason is exactly true. I read the real page, the real handler and the real bundle myself. Both
reasons are exactly true. Both rows stay `not-attachable`. Nothing was pushed or merged.

| Row | Challenge | Result |
|---|---|---|
| `catalog-read:present-send-lock` | Read `public/app/present.js` `fire()` (line 1726) and `public/app/data.js` `write()` (line 409) side by side, then pressed the real buttons in the real page with a delivered answer (`{ ok: true, delivered: true, documentsStored: 2 }`). | Reason holds, and there is a SECOND break the first pass missed. See findings 1 and 1b. |
| `catalog-read:climate-map` | Read the shipped bundle (`public/climate/_next/static/chunks/375-*.js`), `public/climate/maps/us-states-paths.json`, `marketing/landing-pages/climate-front-door-2026-09-18/SPEC.md` and searched the whole repo and `credentials/` for state outlines. | Reason holds. The page draws five placeholder rectangles. The project's own SPEC calls the file "five placeholder rectangles". No 51-state outline exists anywhere in the repo, so there is nothing real to bundle. I will not invent map geometry. |

### Why present-send-lock cannot be attached, exactly

The page has **six** send controls (the first pass counted five): `pay`, `softpull`, `letters` (label "Generate
letters and email now", or "Send deliverables package now" on the education path), `send-letters`, `invoice`,
`contract`. The row's contract is: "Sending...", 4 second cooldown, "Sent at" line, count of sends.

| Control | Sending... | Cooldown | Sent at + count | Proved by |
|---|---|---|---|---|
| Send agreement + pay link | yes | yes | yes | `fin-b23-present-send-lock.test.mjs` |
| Invoice this client | yes | yes | yes | same |
| Send contract | yes | yes | yes | same |
| Send letters now | yes | yes | yes | same |
| Generate letters and email now | yes (in flight only) | **no** after a delivered pack | **no** | in-flight half only |
| Send soft pull ($32 + approval form) | **no** (plain button) | refuses a repeat press, shows nothing | **no** | refusal half only (new this pass) |

A row is only proved when a test of mine goes red if the product breaks AND the product meets the contract. Two of
six controls do not meet it, so a green row would be false.

**I proved the reason is exactly "a present.js change", and that the change is small.** In this folder I applied a
3-line change to `public/app/present.js` (read `r.data || r` in `fire()`, and draw the soft pull with `sendBtn`
instead of `ckBtn`), ran three extra cases against it, then reverted it with `git checkout`:

| Case (temporary file, deleted) | Today's product | With the 3-line change |
|---|---|---|
| Generate letters, delivered: locks, "Sent — hold on", Sent at, 4 s, "sent 2 times" | red (timeout) | green |
| Generate letters, not delivered: says "Nothing was sent — <the server's reason>", no Sent at, button usable | red (the server's reason is lost too) | green |
| Soft pull: locks, "Sent — hold on", Sent at, 4 s, "sent 2 times" | red (timeout) | green |

Those three cases use the existing `proveLock` helper in the test file. Once the product change lands, add them to
`fin-b23-present-send-lock.test.mjs`, move the row from `READ_GAPS` to `FIN_B23_READ_PROVED`, and the row is closed.
`present.js` is a product file, so per the brief I did not keep the change.

### What I added this pass (all in files owned by this batch)

- `fin-b23-present-send-lock.test.mjs`: two new tests for Send soft pull (the half that works today), and an
  `openDeck(..., { phase })` option. Soft pull: one press is one request with `action: send_soft_pull` and the
  client id; presses while it is out send nothing; a press right after the send, and one at 3.9 s, send nothing;
  a press after 4.0 s sends a second one. A failed soft pull starts no hold and works again at once.
  A press is a bare click event so a toast over the button cannot swallow it, and the test waits 150 ms of real
  time before it reads a count, so a stray request cannot arrive after the assert.
- `src/pulse/coverage/gap-catalog-reads.mjs`: the finding text of `present-send-lock` now names both broken
  controls (was: one). One string, nothing else.

### Breaks made on purpose this pass (each: one text swap in `public/app/present.js`, test run, file restored)

| Break | Soft pull "once per press" | Soft pull "failed is not a send" |
|---|---|---|
| cooldown 4000 ms to 1000 ms | red | green (not its job) |
| `fire()` no longer calls `markSending` | red | green |
| a failed send starts the cooldown | green | red |
| the click handler no longer asks `sendLocked` | red | green |

4 of 4 breaks are caught by exactly the test that owns them. `git status` after: only the test file differs.

### Numbers

| | Not proved (my 15 rows) |
|---|---|
| openBefore, measured at `fin/base` (detached folder, `count-not-proved.mjs`) | **15** |
| openAfter, measured at `fin/b23` | **2** (`present-send-lock`, `climate-map`) |

Lane totals: all lanes 853 to 840; reads lane 15 to 2.

### Product findings added

1b. **The soft pull button is drawn with `ckBtn`, not `sendBtn`** (`public/app/present.js` line 1241). Pressing it
    sends a real $32 pay link and approval form, but the button never says "Sending...", never shows a "Sent at"
    line and never counts repeats. The guard still refuses the second press (the click handler asks `sendLocked`),
    so a closer who presses again sees nothing happen. This is the same F24 complaint the page's own comment quotes.
1.  (restated, with the live result) After a delivered pack the page shows "Nothing was sent - the pack came out
    empty." and the server's `reason` is also lost, because `fire()` reads `r.delivered` / `r.reason` off the
    wrapper. The button stays usable, so a second press right away sends the pack again.

### Commands run this pass

| Command | Result |
|---|---|
| `count-not-proved.mjs` at `fin/base` and at `fin/b23` | 853 / reads 15, then 840 / reads 2 (my open rows: `present-send-lock`, `climate-map`) |
| `node --test src/pulse/catalog/proofs/fin-b23-*.test.mjs` | 37 of 37 pass (was 35) |
| `node --test` on `gap-catalog-reads.test`, `read-proof-cases.test`, `flow-read-contracts.test`, `door-flow-read-contracts-2.test` | 9 of 9 pass |
| `npm run pulse:catalog` | `3975 mapped, 33 marked repeats, 3942 unique; 3919 wired, 23 red`; `generated.json` unchanged |
| 4 breaks (table above) | 4 of 4 red, each file restored |
| temporary "after the fix" cases (table above) | 3 red today, 3 green with the 3-line change, change and file removed |
| `node --test` on `src/pulse/*.test.mjs`, `src/pulse/coverage/*.test.mjs`, `src/pulse/catalog/*.test.mjs` (139 files, not `.pg.`) | 2890 tests, 2871 pass, **0 fail**, 19 skipped (all "no DATABASE_URL") |
| `npm run lint` | `3574 file(s) and inline script(s) parse clean` |

---

## Generation 1 record

## Numbers

| | Not proved |
|---|---|
| openBefore (my 15 rows, `count-not-proved.mjs`) | **15** |
| openAfter (same script, same rows) | **2** (`present-send-lock`, `climate-map`) |

Lane total (all four lanes) before 853, after 840. `gap-catalog-reads` went 15 to 2. No other batch touches that lane.

## Every row

All 13 closed rows are **practice tests**: the real page (or the real handler) opened with fake data in a
stand-in server, judging the exact rendered or saved result. None of them reads live data, so none is a
"live check". Each test was broken on purpose (list below) and went red.

| Row id | Outcome | Test | Note |
|---|---|---|---|
| `catalog-read:campaign-fatigue-label` | practice-test | `fin-b23-campaign-fatigue-label.test.mjs` | Label button carries its own ad id, box names that ad, save sends exactly that ad |
| `catalog-read:portal-welcome-video` | practice-test | `fin-b23-portal-welcome-video.test.mjs` | player uses the returned link, one retry after expiry, "not available" after two failures |
| `catalog-read:closer-logbar` | practice-test | `fin-b23-closer-logbar.test.mjs` | note shown only once a call loaded; note shortens when "said" is on file |
| `catalog-read:present-send-lock` | not-attachable | (4 of 6 controls proved in `fin-b23-present-send-lock.test.mjs`) | findings 1 and 1b: Generate letters never shows success or starts a cooldown, and Send soft pull shows no Sending / Sent at |
| `catalog-read:money-helper-poll` | practice-test | `fin-b23-money-helper-poll.test.mjs` | 3 s beat, exactly 100 re-reads then stops, Check again |
| `catalog-read:plaid-link` | practice-test | `fin-b23-money-page.test.mjs` | script fetched only on press, exact address, no exchange without it |
| `catalog-read:money-trends` | practice-test | `fin-b23-money-page.test.mjs` | exact values on the frame page; standalone money.html leaves the slot empty (finding 2) |
| `catalog-read:ops-ar` | practice-test | `fin-b23-ops-admin.test.mjs` | rows, money, overdue words, top 25 + "N more", total line |
| `catalog-read:ops-consent` | practice-test | `fin-b23-ops-admin.test.mjs` | one row per returned person, Signed or Not yet signed, hidden line |
| `catalog-read:ops-compliance` | practice-test | `fin-b23-ops-admin.test.mjs` | stopped rows, top 15, age words, empty and failed words |
| `catalog-read:ops-failed-events` | practice-test | `fin-b23-ops-admin.test.mjs` | tile value and caption in the KPI grid, exact read query |
| `catalog-read:climate-map` | not-attachable | (`fin-b23-climate-map.test.mjs` proves the true parts) | page draws 5 state shapes, not 51 (finding 3) |
| `catalog-read:social-oauth` | practice-test | `fin-b23-social-oauth.test.mjs` | real handler, stand-in db and transaction: code exchange, tokens saved encrypted for the signed-state partner |
| `catalog-read:teleprompter-reread` | practice-test | `fin-b23-teleprompter.test.mjs` | paused clock: nothing at 4.999 s, one re-read + flush at 5 s, none while rolling |
| `catalog-read:teleprompter-fullscreen` | practice-test | `fin-b23-teleprompter.test.mjs` | first tap asks again once, later taps do not |

## Files added

- `src/pulse/catalog/proofs/fin-b23-browser-kit.mjs` (static page server, one Chromium, fake `/api`, no slot queue)
- `src/pulse/catalog/proofs/fin-b23-read-contracts.mjs` (the 13 proved read rows)
- `src/pulse/catalog/proofs/fin-b23-campaign-fatigue-label.test.mjs`
- `src/pulse/catalog/proofs/fin-b23-portal-welcome-video.test.mjs`
- `src/pulse/catalog/proofs/fin-b23-closer-logbar.test.mjs`
- `src/pulse/catalog/proofs/fin-b23-present-send-lock.test.mjs`
- `src/pulse/catalog/proofs/fin-b23-money-helper-poll.test.mjs`
- `src/pulse/catalog/proofs/fin-b23-money-page.test.mjs`
- `src/pulse/catalog/proofs/fin-b23-ops-admin.test.mjs`
- `src/pulse/catalog/proofs/fin-b23-climate-map.test.mjs`
- `src/pulse/catalog/proofs/fin-b23-social-oauth.test.mjs`
- `src/pulse/catalog/proofs/fin-b23-teleprompter.test.mjs`
- `ops/workflows/finish-853-2026-10-14/manifest-b23.md`

## Shared lines touched (smallest possible)

1. `src/pulse/coverage/gap-catalog-reads.mjs`: 13 `gap(...)` entries removed from `READ_GAPS`; the finding text of the two
   entries that stay (`present-send-lock`, `climate-map`) rewritten to say exactly what is missing.
2. `src/pulse/coverage/gap-catalog-reads.test.mjs`: `15` to `2` in three asserts (`READ_GAPS.length`, `CHECK_IDS.length`, unique size).
3. `src/pulse/catalog/proofs/read-proof-cases.mjs`: one import line, one `...FIN_B23_READ_PROVED,` line in `PROVED`,
   and one loop (plus a comment line) after the plugin loop so the rendered Label test outranks the older partial
   proof of the fatigue row.
4. `src/pulse/catalog/proofs/read-proof-cases.test.mjs`: `gapCount` 14 to 2; "64 proved" to "76 proved"
   (`READ_PROOF_CASES.length - 2`, `76`). Total stays 78 (13 rows moved from the red list to the proved list).
5. `src/pulse/catalog/proofs/flow-read-contracts.test.mjs`: partition numbers: `read` 15 to 2, `total` 38 to 25,
   `unproved` 37 to 25 (two places; the fatigue row used to sit in both lists, which is why it was 37 not 38), title "38-row" to "25-row".
   Batch 22 (flow rows) will edit the same object: expect a text conflict on `flow:`/`total:`.
6. `src/pulse/catalog/proofs/door-flow-read-contracts-2.test.mjs`: one line flipped. It asserted that the fatigue label
   row **stays** on the red list (the older proof only judged the values). It now asserts the row has left it,
   because the rendered Label test exists. Not a weakened test: the old assertion was the guard for exactly the gap this batch closes.
7. `src/pulse/catalog/generated.json`: regenerated with `npm run pulse:catalog`. Conflicts here are expected.

## Product findings (nothing fixed)

1. **Generate letters and email now never shows success and never starts its cooldown.** `public/app/present.js`
   `fire()` (about line 1749) reads `r.delivered`, `r.documentsStored`, `r.reason` straight off the object that
   `FHData.write()` returns, but `public/app/data.js` write() returns `{ ok, source, data, error }` with the
   server's answer under `data`. So `ok = r.delivered === true` is always false: the closer sees "Nothing was sent
   - the pack came out empty." even when the server delivered, no "Sent at" line appears, and because a failed send
   starts no cooldown the button can be pressed again at once. Verified in the real page. The other four send
   buttons (pay link, invoice, contract, send letters) lock and cool down correctly.
2. **`public/app/money.html` never loads `money-trends.js`.** It has the `data-trends-slot` but only `money.js`
   is a script on that page, so the Trends graph never draws there; it only draws in the one-page frame
   `financeos.html`. The control's own words say "when the page loaded it", and the test proves both pages
   (exact numbers where it loads, empty slot where it does not), so the row is closed.
3. **The climate page draws 5 state shapes, not 51.** The page bundle's path list holds AZ, CA, NY, TX and FL
   only (the `public/climate/maps/us-states-paths.json` file has the same five). The States table lists all
   returned states and the national number matches, which the test proves. The intended journey says 51 shapes.
4. **The climate map ignores the `color` the API sends.** `docs/journeys/climate-lead-magnet-intended.md` says each
   shape's `fill` equals the `color` the API sent for that state. The bundled page ignores that field and picks its
   own colour band from `score` (80 / 65 / 50 / 35). The two agree today only because the API's bands use the same
   cut points. `fin-b23-climate-map.test.mjs` sends `#000000` as `color` on every state and proves the painted
   fill follows the score band, so the test would go red if the page switched to the API colour or the cut points moved.
5. Small: the older `door-flow-read-contracts-2` / `display-contracts-teleprompter-4` tests passed with the
   teleprompter poll set to 15 seconds, because the page clock kept running in real time while the wait was 30 s.
   Not a product bug; the new test pins 5 s to the millisecond with a paused clock.

## Breaks made on purpose (all went red, then the file was put back)

Each line is one text swap in the product file, the attached test run, and the result. 62 breaks are listed and all
62 are red in the final state. One climate break first stayed green (weak fixture), and one logbar break stays green
because it is an equal break; both are said below.

- Fatigue Label: label button carries the ad name not its id, save sends a wrong ad id, number always sent, box does not name the ad, refused save shown as saved. 5 of 5 red.
- Welcome video: retry flag never set (loops), retry reuses the expired link, player gets an object not a link, title not applied, empty line stays hidden after failure, staff client id not forwarded. 6 of 6 red.
- Logbar: note wording changed, bar never shown, bar shown when there is no call, "said" note not shortened. 4 of 4 red. (A fifth break, "show the bar before checking the read", stayed green because `setEmpty` hides it again; it is an equal break, not a hole.)
- Send lock (the four proved buttons): cooldown 1 s, count never grows, failed send starts a cooldown, no pressed words, never disabled, Sent at wording, contract not locked while sending, invoice not locked while sending. 8 of 8 red.
- Money helper poll: poll 1 s, 200 polls, Check again reads nothing, no Check again button. 4 of 4 red.
- Plaid link: wrong script address, script loaded at page open, missing script treated as loaded. 3 of 3 red.
- Trends: a gap printed as $0.00, a gap bridged as zero. 2 of 2 red.
- Ops AR / compliance / failed events / consent: AR shows 30 rows, compliance shows 20, count off by one, everyone shown signed, "1 days", zero days shown as "0 days", hidden people not said, unknown amounts not said. 8 of 8 red.
- Social OAuth: Facebook token stored plain, Instagram token stored plain, LinkedIn refresh token stored plain, partner not taken from the signed state, state signature not checked, state expiry not checked, empty page list not refused. 7 of 7 red.
- Climate: national number off by one, one state row dropped, and six colour-band thresholds moved (80 to 70, 80 to 85, 65 to 60, 65 to 70, 50 to 55, 35 to 30). The first run of the colour break stayed green because none of the five painted shapes sat on that band; the fixture now puts scores on both sides of every boundary and all six go red. 8 of 8 red now.
- Teleprompter: poll at 15 s, poll at 4 s, poll does not flush, poll does not re-read, poll also while rolling, no first-tap listener, first-tap listener never removed. 7 of 7 red. (The older test for these two rows stayed green with the poll at 15 s.)


## Commands run

All from `.claude/worktrees/fin-b23` (branch `fin/b23`), no live database, no network, no secret.

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs b23-before.json` (intersect with `batch-23.json`) | total 853, reads lane 15, **15 of my 15 open** |
| each new test file alone with `node --test` | all pass: campaign label 2, welcome video 4, logbar 3, send lock 6, money helper poll 1, money page 5, ops admin 5, climate 2, social oauth 5, teleprompter 2 (35 tests) |
| 62 breaks, one at a time, each file restored after | all red in the final state (see list above) |
| `npm run pulse:catalog` | `3975 mapped, 33 marked repeats, 3942 unique; 3919 wired, 23 red`; `generated.json` changed on exactly 13 rows |
| `node scripts/pulse/count-not-proved.mjs b23-after.json` | total **840** (was 853), reads lane **2**; my open rows: `present-send-lock`, `climate-map` |
| `node --test` on `gap-catalog-reads.test`, `read-proof-cases.test`, `flow-read-contracts.test`, `door-flow-read-contracts-2.test` | 9 of 9 pass; `read-proof-cases` runs the 76 proved read tests for real, mine included |
| `node --test` on every `src/pulse/catalog/*.test.mjs`, `src/pulse/coverage/*.test.mjs`, `src/pulse/*.test.mjs` (not `.pg.`) | 2890 tests, 2871 pass, **0 fail**, 19 skipped (all say "no DATABASE_URL": gap SQL tests that need a Postgres) |
| `npm run lint` | `3574 file(s) and inline script(s) parse clean` |

### Second pass (resumed run, same branch, no product or test file changed)

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` | total **840**, reads lane **2** (`present-send-lock`, `climate-map`) |
| all 10 `fin-b23-*.test.mjs` files, one `node --test` run | 35 of 35 pass, 6 s |
| `npm run pulse:catalog` | same line as above, `generated.json` has no drift |
| `gap-catalog-reads.test`, `read-proof-cases.test`, `flow-read-contracts.test`, `door-flow-read-contracts-2.test` | 9 of 9 pass |
| `node --test` on `src/pulse/*.test.mjs`, `src/pulse/coverage/*.test.mjs`, `src/pulse/catalog/*.test.mjs` | 3071 tests, 2871 pass, **0 fail**, 200 skipped (every skip is a `.pg.test.mjs` with no `DATABASE_URL`) |
| 3 fresh breaks (teleprompter poll 5 s to 15 s, ops AR top 25 to 30, Facebook page token saved plain), each restored | all 3 red |
| `present.js fire()` read again against `public/app/data.js write()` and `api/closer-deck.mjs` | finding 1 holds: the server answers `delivered` at the top of its JSON, `write()` returns it under `data` |

Not run: the full `src/pulse/catalog/proofs/*` tree. The `display-*`, `s1-display-specs` and `s4-*` files start a
Playwright command line run each, and with 20 other agents on this Mac one hung for 12 minutes; I stopped it and
killed its leftover processes. Those files do not touch the read lane or any file I changed. The four focused
files that do touch it ran green.


## Left undone

- `catalog-read:present-send-lock`: needs the `present.js` change in findings 1 and 1b (about 3 lines: read the
  answer from `r.data || r` in `fire()`, and draw the soft pull with `sendBtn`). The three cases in the Generation 2
  section then close it. Verified in a temporary copy, reverted.
- `catalog-read:climate-map`: needs real outlines for 51 states in the climate bundle (the page draws 5 placeholder
  rectangles). `fin-b23-climate-map.test.mjs` already counts shapes from the bundle's own list, so it will count 51
  when they are there; then the row can be closed. The map also ignores the `color` the API sends (finding 4).
