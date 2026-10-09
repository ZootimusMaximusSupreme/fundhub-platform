# Closer gaps

Fundhub closer desk, Present, and closer context. Read only. One tripwire. No second watchdog. Do not start a call.

This lane does not repeat slice 27 (closer dashboard, Present, closer deck, and call outcome doors on the morning list) or slice 20 (the offer-bucket job). It also does not repeat the registry rows `reg:closer-dashboard` and `reg:present`, which go red when a page does not answer 2xx. Bookings and recordings are another lane.

## Checks

| id | Break | FAIL when |
|---|---|---|
| `closer:desk-pages` | Closer Dashboard, Present, or the Present script is not wired | A page answers 2xx and is the wrong page: the title is wrong, `shell.js` is gone from the dashboard, Present loads `shell.js` (the deck bounces), Present no longer loads `present.js`, or `present.js` no longer posts `log_disposition` to `/api/closer-deck`. Also FAIL when `present.js` itself is down (404, 500, or does not open): no registry row watches that file, and without it no disposition can be saved. A dashboard or Present page that does not answer 2xx is the registry's red (`reg:closer-dashboard`, `reg:present`), so that case skips and names the row. |
| `closer:held-disposition` | A disposition never landed in `call_outcomes` | (a) A client has a saved closer disposition, or a closer `call.completed` event, and `call_outcomes` has no row for that client. (b) The closer deck was used on a client (soft pull, ebook, or letters sent), the 2 hour wait is over, and no call outcome was logged from 12 hours before that send. Demo and synthetic clients are left out. Last 14 days for (b). |

The row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`. A FAIL names Present `log_disposition` as the one tripwire. That write is what puts the row in `call_outcomes`. This lane does not add another watcher and does not start a call.

No fetch in the run: pages skip. No database in the run: dispositions skip. The three pages are asked at the same time, each with an 8 second timeout, so a page that hangs cannot hold the whole lane.

## Files

- `src/pulse/coverage/gap-closer.mjs`
- `src/pulse/coverage/gap-closer.test.mjs`

## Prove

`node --test src/pulse/coverage/gap-closer.test.mjs`

## Review — Claude, 2026-10-08

**What was wrong**

- The page check read repo files from disk (`public/app/*.html`, `shell.js`, `present.js`, `netlify.toml`). The shipped function has none of those files. In production it would have read nothing and said FAIL "page route is dead" every morning, with the pages fine. On this Mac the files exist, so the live proof hid it.
- The database half could almost never fail. Present writes the `call_outcomes` row first and the client's disposition field second (`logDeckDisposition`). A client with a saved disposition and no outcome row only happens if the row was deleted later. The real failure, a closer who used the deck and whose disposition never saved, left no trace the check looked for.
- Page route and database facts were mashed into one row, so a database skip hid a page PASS.

**What changed**

- Pages are read over HTTP, the way a closer opens them: dashboard, Present, and the Present script. No file reads.
- Second pass (checker): `present.js` down is now a FAIL, not a skip. Nothing else watches that file, and it is the script that posts `log_disposition`. The two html pages stay skip-and-name, because the registry rows already go red for them.
- Second pass: each page fetch has an 8 second timeout and the three run at once.
- Second pass: this board was stale (it showed one check and a file-reading FAIL). It now matches the code.
- The page row is its own check. The database row keeps its old test (a) and gains test (b), the deck used with no outcome logged.
- Reads `ctx.fetchImpl`, then `ctx.fetch`.
- Tests now include a block that runs the real SQL on Postgres over fixture rows (skips without `DATABASE_URL`).

**Live proof (read-only, as `fundhub_app` inside `BEGIN READ ONLY`)**

- Prod mode: 2 PASS, 0 FAIL, 0 skip. Staff mode matches. Bare mode: 0 PASS, 0 FAIL, 2 skip (the pulse passes more than bare does). No SQL errors. No writes. Re-run after the second pass.
- The three pages answered 200 on https://fundhub.ai and each had the right markers (dashboard 82,555 bytes, Present 11,233, Present script 143,834).
- Why the database row is PASS: no client has used the closer deck or saved a disposition yet (0 rows), and `call_outcomes` is empty. Fixture run on the real engine: 17 cases, all matched. A saved disposition with no row is FAIL. Letters, soft pull, or ebook sent 3 hours ago with no outcome is FAIL. An outcome logged after, or in the 12 hours before, is PASS. An outcome from 5 days ago does not hide it. Inside the wait, older than 14 days, demo, synthetic, and a bad date are PASS.
- Tests: 16 pass, 0 fail without a database (the database block skips). 19 pass, 0 fail with `DATABASE_URL`.
- Mutation check on a scratch copy: send `present.js` down to the skip list, drop the timeout, give `present.js` a registry row, ignore a `present.js` error. All 4 broke the tests.

**Left for Chris (not a check problem)**

- The page markers (titles, script tags) are checked by words. If a page is redesigned on purpose, this row will say which marker moved. Update the marker in `PAGES`.
