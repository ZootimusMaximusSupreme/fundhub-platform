# Sales manager gaps

Fundhub. Sales manager view only. Team numbers, show rate, close rate, and the floor.

Read only. No page was edited.

Recon (AG-07) is the one tripwire. No second watchdog.

Slice 20 already lists the sales jobs (s-00 through s-08). This lane does not check those again.

The registry already pings the signed-out doors every morning: `read/sales-floor`, `read/my-numbers`, and the two pages. This lane does not repeat that ping.

Another lane owns the closer desk and call recordings. This lane does not open that desk and does not read tapes.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-sales-manager.mjs` returns 3 rows. Shape is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`. It needs `db` and `orgId`. The pulse passes both. With no database all three rows skip.

| id | What it reads | FAIL when |
|---|---|---|
| `sales-manager:read-api` | The two data reads behind the doors, run in this process: the sales floor and my numbers, the same code the pages call once you are signed in | Either read throws, runs past 12 seconds, comes back empty or without the pieces the page paints, or cannot be printed as JSON. That is the 500 a signed-in manager would see. |
| `sales-manager:totals` | The team numbers the sales floor returns: team cash, booked, held, deposits, show rate, close rate, deposit to funded rate | The floor read fails, or any of those is not a number (or a rate is outside 0 to 1). A zero month is still a pass. |
| `sales-manager:dropped-closer` | Active closers who took a deposit or cash this month, against the floor rollup (`closerRoster`) | An active closer who belongs on the floor has sales and the rollup leaves them off. Practice names, demo people, and suspended people are left out. |

The floor read tries to attach loose Drive recordings to calls, and that is a write. Here that write is dropped (`readOnlyDb`). Only a plain read runs: after any notes it must start with SELECT, WITH or VALUES, it may not change a row, take a lock (`FOR UPDATE`, `FOR SHARE`), write a table (`SELECT INTO`), call a function that changes state (`nextval`, `set_config`, advisory locks), or run a second statement. Every other statement gets an empty answer and nothing is saved. A write hidden behind a note or a WITH is held back too. A SELECT that calls an app function that itself writes cannot be seen from the text; the reads here call only built-in read functions (checked on the 38 SQL texts the live run sends).

## Rules kept

- Read only. No GET to the site. No POST.
- One tripwire: existing Recon (AG-07). No second watchdog.
- HTML was not edited.
- Slice 20 jobs were not checked again.
- The closer desk and call recordings were not checked.

## What this check cannot see

- It cannot see a login or role problem (a manager who is let in wrongly, or locked out). The signed-out ping and the page rows are the only cover for that.
- The company has no call outcomes at all, ever (0 rows in `call_outcomes`). Every number on the floor is zero today, so the dropped-closer row has nothing to catch yet. It is proven on made-up outcomes (below), not on real ones.
- The dropped-closer row can only flip if the roster code itself changes. It asks "does an active closer who belongs on the board and has sales appear in `closerRoster`", and `closerRoster` filters with the same rules (role, status, blocked names). No data alone makes it fail. It is a guard on that code, not a data watcher. The data watchers are the totals and read rows.

## Files

- `src/pulse/coverage/gap-sales-manager.mjs`
- `src/pulse/coverage/gap-sales-manager.test.mjs`

## Test

`node --test src/pulse/coverage/gap-sales-manager.test.mjs`

- tests 22
- pass 22
- fail 0
- skipped 0

Wired into the shared pulse runner: yes, it is on the list in `src/pulse/coverage/modules.mjs`.

## Review — Claude, 2026-10-08

What was wrong:

- **It read FAIL every morning in the shipped function.** The first check read three source files from disk. The shipped function does not hold them, so it said "route file could not be read" and went red. Proven by running the lane from a built bundle: `sales-manager:read-api` FAIL before, PASS after.
- **It repeated the registry and could not see the real break.** It sent a signed-out GET to the two doors. The registry already does that. A signed-out ping gets a 401 whether or not the data works, so a 500 behind sign-in could never show. The board said the 500 was covered. It was not.
- **Totals ran a copy of the SQL, not the real page numbers.** The copy could pass while the page was broken, and it could only fail if the query threw.
- **A suspended closer would have gone red for the rest of the month.** The floor lists active closers only, on purpose. Suspended closers exist right now. One of them (Mock Closer Sign) is not on the blocked-name list, so a sale for that person would have read "the rollup drops them" until the month turned over.

What changed:

- `read-api` now runs the real `salesFloor` and `closerMyNumbers` reads in this process, with a database that drops writes. It also checks the answer has what the page needs and can be printed as JSON, and gives each read 12 seconds.
- `totals` checks the numbers `salesFloor` returns, not a copy.
- `dropped-closer` skips suspended people. The rest is the same.
- The file read, the GET to the site, `TOTALS_SQL`, `salesManagerRoutesWired`, and the `readText` hook are gone.

Live result after (read only, as the app role): prod 3 pass, 0 fail, 0 skip. Staff run 3 pass, 0 fail, 0 skip. Bare run (no company id) 3 skip. Plain and staff reads match, and the policies on these tables are open, so the role is not blind. 0 query errors, 0 write tries. About 56 reads, 0.4 to 0.8 seconds on a real pool. From a built bundle with no source files: 3 pass.

Made-up outcomes, run on the live database in a read-only transaction (call outcomes shadowed in with VALUES):

- Every active closer took a deposit and the floor lists them: 3 pass.
- The roster broken so active closers fall off the floor: `dropped-closer` FAIL, names 3 closers.
- Only suspended closers have sales: 3 pass.
- A table the floor reads is gone, or the funnel read breaks: `read-api` and `totals` FAIL with the error.
- The staff table breaks: all three FAIL.

Tests: 19 pass, 0 fail, 0 skipped. 7 deliberate breaks of the code were tried in a scratch copy. All 7 were caught. The tests run the real `salesFloor`, `closerMyNumbers`, and `closerRoster` against a database that answers by SQL text.

Left for Cursor (not a break in the company): `src/lib/no-unfenced-transmit.test.mjs` lists `src/pulse/coverage/gap-sales-manager.mjs` on `ALLOWED_RAW_FETCH` because the old check called the site. This lane no longer does. The test "no ALLOWED_RAW_FETCH entry is stale" now fails on that line and says to remove it. That file is outside this lane, so it was not touched.

No real break was found.

## Review 2 — Claude, 2026-10-08

What the checker found, and what changed:

- **The write guard did not do what its note said.** It looked at the first word only. A write behind a note (`/* tag */ UPDATE ...`, `-- c` then `DELETE`), a WITH that ends in a write, a second statement, or a `SELECT pg_advisory_xact_lock(1)` all went straight to the production database. Today no reachable write hits it (the recordings writes all start with UPDATE, and the live run shows 0 write tries), but one future note in front of one write in the floor path would have written to production every morning with the suite green. Now `readOnlyDb` runs a plain read only (see "Checks"). Notes and quoted words are blanked first, so a word like `update` inside a string is not read as a command and a command cannot hide behind a note. A real SELECT is never held: all 38 SQL texts the live run sends, the two lane queries, and the real floor, my numbers, roster, and demo reads all pass the guard (one test runs them through it and expects nothing held).
- **The fence test is red because of this lane.** `src/lib/no-unfenced-transmit.test.mjs` lists `src/pulse/coverage/gap-sales-manager.mjs` on `ALLOWED_RAW_FETCH`. This lane no longer calls the site, so "no ALLOWED_RAW_FETCH entry is stale" fails and says to remove that line. Still outside this lane's three files, so not touched. **Action for Cursor: delete that one line.** (That test also has a second failure that is not from this lane: `src/pulse/funnel-doors.mjs` and `src/pulse/instant-watch.mjs` are not fenced.)
- **Two small branches had no test.** The JSON-print check on the my numbers answer, and a closer with cash but no deposit (or a deposit but no cash). Both are covered now.
- **The dropped-closer row could only flip if the roster code changed.** Not said before. It is said above, under "What this check cannot see".

Live result after (read only, as the app role): prod 3 pass, 0 fail, 0 skip. Staff run 3 pass, 0 fail, 0 skip. Bare run (no company id) 3 skip. 0 query errors, 0 write tries. From a built bundle run in an empty folder: 3 skip with no database (as expected), no load error.

Tests: 22 pass, 0 fail, 0 skipped. 29 deliberate breaks of the code were tried in a scratch copy (the guard, JSON checks, timeout, shapes, rate bounds, the roster, the suspended skip): all caught. One survived the first try (a second statement the write words do not name, such as `DROP TABLE`); a test for it was added and it is caught now.

