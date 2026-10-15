# Batch 23 manifest: page-read rows (lane gap-catalog-reads)

Branch `fin/b23`, work folder `.claude/worktrees/fin-b23`, generation 1. Nothing pushed, nothing merged.
Base: `fin/base` (2f4f574a0).

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
| `catalog-read:present-send-lock` | not-attachable | (4 of 5 buttons proved in `fin-b23-present-send-lock.test.mjs`) | see product finding 1: Generate letters never shows success or starts a cooldown |
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
4. Small: the older `door-flow-read-contracts-2` / `display-contracts-teleprompter-4` tests passed with the
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

Not run: the full `src/pulse/catalog/proofs/*` tree. The `display-*`, `s1-display-specs` and `s4-*` files start a
Playwright command line run each, and with 20 other agents on this Mac one hung for 12 minutes; I stopped it and
killed its leftover processes. Those files do not touch the read lane or any file I changed. The four focused
files that do touch it ran green.


## Left undone

- `catalog-read:present-send-lock`: needs the `present.js` change in finding 1. Then the four tests already written
  cover the rest and the fifth button needs one more case (success shows Sent at, cooldown, count).
- `catalog-read:climate-map`: needs the 51 state paths in the climate bundle. `fin-b23-climate-map.test.mjs` already
  counts shapes from the bundle's own list, so it will count 51 when they are there; then the row can be closed.
