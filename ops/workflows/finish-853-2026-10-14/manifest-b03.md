# Batch 03 manifest — route row, closer-deck send_ebook

Branch `fin/b03`, built from `fin/base` at `2f4f574a0`. Nothing was pushed or merged.
Lane: `gap-door-batch-routes`. Rows in the batch: 1. Product code changed: none.
Repair cycle 1 (independent checker found the live read could stay green when the SQL broke): done, see below.

## Numbers

| | Before | After |
|---|---|---|
| Rows of this batch that say NOT_PROVED (`node scripts/pulse/count-not-proved.mjs`, offline) | 1 | 0 |
| All four lanes, same script | 853 | 852 (route lane 135 to 134) |

Offline, with no database, the row says `skip` ("no database in this run"). On the live pulse it says
`na` (nothing to judge) or `FAIL`. It cannot say `PASS`. If the read fails on Postgres it says `skip` with the
database's own error, never `na`.

## The row

| Row id | Outcome | What it is |
|---|---|---|
| `catalog-route:routes-1.json:route:closer-deck:POST action=send_ebook {client_id, amount_cents} (mint an ad-hoc priced pay link and send it)` | **na-verified**, backed by a live read of three saved traces that goes `FAIL` on the first wrong result | The action is gone. See below. |

### Why this row is not a "prove the route works" row

The owner retired the e-book offer on 2026-10-11 (commit `9b9f6fa88`, `docs/journeys/CHANGELOG.md`, 2026-10-11 line).
`api/closer-deck.mjs` now answers `send_ebook` with 400 `unknown_action`, and `sendDeckEbook` is deleted. The row
still describes "mint an ad-hoc priced pay link and send it", a result that no longer exists. No fake-data test can
prove it, and attaching the existing refusal test as "proof" of the row would be false. The earlier slice 1
builder left it NOT_PROVED for that reason (finding 1 in `manifest-s1.md`), and
`s1-door-contracts.test.mjs` still guards that no test is attached as a proof of it. That guard is unchanged and
still passes, because the row stays in the red lane.

What is left to judge is that the retired action **stays off**, and it leaves traces.

## Repair cycle 1: what the checker found, what changed

The checker's finding: the old live read counted only `clients.custom_fields.closer_deck_ebook_sent_at`, and no
test ever ran its SQL (a stand-in matched fragments of the SQL text and re-computed the answer in JS). Three SQL
breaks stayed green (16 of 16): the judging `OR` flipped to `AND`, `AND false` appended, `FROM` pointed at another
table. And the old action wrote the marker LAST, so a send that made the pay link and sent the email but did not
write the marker left the check at "na".

| Finding | Fix |
|---|---|
| No test ran the SQL | The statements are run **unchanged on a real SQL engine** (`node:sqlite`, built into Node 22) against tables built per case, in `fin-b03-route-retired.sql.test.mjs`. The regex stand-in is gone. The same strings also run on **real Postgres** in `fin-b03-route-retired.pg.test.mjs` (see "Not proved here"). |
| SQL judged (OR / cutoff / shape) | The SQL no longer judges anything. Each trace is one plain `SELECT` of saved times. Before or after the cutoff, and readable or not, is decided in code (`judgeTimes`), where every break below goes red. |
| Only the marker was read | Three traces are read: the marker, the pay link (`payment_links`, purpose custom, description says e-book), the email (`messages.provider_ref` starts `staff:ebook-send:`). A send with no marker still goes red. |
| Dialect | The statements stay in the subset Postgres and SQLite both run (no casts, no regex operator, no collation). The scratch engine is set to case-sensitive `LIKE`, as Postgres is, so a dropped `lower()` shows. |

Other changes in the same file, all tested: the cutoff is `2026-10-12T16:36:00.000Z` with its zone (a time with no
zone is read as UTC on any machine); a trace with more than 1,000 rows is `skip`, not judged from a part.

### The live check (what the morning pulse runs)

`src/pulse/coverage/fin-b03-route-retired.mjs`, called from `gap-door-batch-routes.mjs` `gapChecks(ctx)`:

- Three read-only SELECTs, one per trace, scoped to the company when the pulse names one (`$1`), each capped at
  1,001 rows:
  1. `clients.custom_fields->>'closer_deck_ebook_sent_at'` where present (the marker, written last by the old action)
  2. `payment_links.created_at` where purpose is `custom` and the description says e-book at the start of a word
     ("Facebook" is not an e-book; the description is typed by staff, so this is the looser trace)
  3. `messages.created_at` where `provider_ref` starts `staff:ebook-send:` (fixed in code by the old action)
- A saved time at or after `2026-10-12T16:36:00Z`, or a marker with no readable time, is wrong. The cutoff is the
  first live ship that carried the retirement commit (`bfd16774`, logged 2026-10-12 09:36 Arizona in
  `ops/ship-log.md`; the test checks the constant against that log line).
- Nothing wrong: `na`, code `catalog-route-retired-action`, with what was saved before it went off in the sentence.
- Anything wrong: `FAIL` by row id, naming each trace ("1 pay link described as an e-book; 1 email sent as an
  e-book send").
- A failed read, a missing table, more than the cap, or no database: `skip` with the reason. Never `PASS`.
- `naVerify["catalog-route-retired-action"]` runs the same read each morning so the "nothing to judge" claim is
  re-checked true. It cannot be talked into a different action, control, map or route.

### The practice test (fake data, runs in CI)

`src/pulse/coverage/fin-b03-route-retired.test.mjs`: the real handler, a stand-in database, `fetch` trapped. For
closer, sales manager, owner and admin it answers 400 `unknown_action`, does not list the e-book in the refusal,
and inserts or updates nothing (no payment link, no message, no marker). A second test shows a served action on
the same stand-in is not refused as unknown, so the refusal is the action's own.

## Break it on purpose (every break made, test run, red seen, file put back)

Run against `fin-b03-route-retired.sql.test.mjs` unless noted. A runner applied each text change to the real file,
ran the test file, and restored it (`cmp` against a saved good copy and `git diff` confirmed after).

| # | Break | Result |
|---|---|---|
| S1a | link trace: one `OR` flipped to `AND` | RED, 8 of 18 |
| S1b | link trace: both `OR`s flipped to `AND` | RED, 8 of 18 |
| S1c | link trace: `purpose AND (words)` flipped to `OR` | RED, 3 of 18 |
| S2a | marker: `FROM clients` pointed at `clients_archive` | RED, 17 of 18 |
| S2b | link: `FROM payment_links` pointed at `payment_links_archive` | RED, 17 of 18 |
| S2c | message: `FROM messages` pointed at `messages_archive` | RED, 15 of 18 |
| S3a | marker: `AND false` appended | RED, 9 of 18 |
| S3b | link: `AND false` appended | RED, 8 of 18 |
| S3c | message: `AND false` appended | RED, 7 of 18 |
| S4 | marker: `IS NOT NULL` turned into `IS NULL` | RED, 10 of 18 |
| S5 | link: purpose `custom` turned into `deposit` | RED, 9 of 18 |
| S5b | link: purpose filter dropped | RED, 2 of 18 |
| S6 | message: key prefix changed | RED, 8 of 18 |
| S7 | link: word-start match made a substring match (Facebook counted) | RED, 2 of 18 |
| S8 | company filter flipped (`=` to `<>`) | RED, 12 of 18 |
| S8b | company filter dropped from the SQL, parameter still sent | RED, 16 of 18 |
| S9 | row cap off by one | RED, 1 of 18 |
| S10 | link: `lower()` dropped (a case-sensitive miss) | RED, 1 of 18 |
| S11 | marker: select column renamed | RED, 6 of 18 |
| S12 | marker: select reads a wrong key | RED, 6 of 18 |
| S13 | link: select reads a wrong column | RED, 16 of 18 |
| S14 | message: select reads a wrong column | RED, 14 of 18 |
| J1 | cutoff compare `<=` (the cutoff itself passes) | RED, 3 of 18 |
| J2 | judged by `>` only (unreadable and equal pass) | RED, 5 of 18 |
| J3 | only the marker trace counts toward bad | RED, 6 of 18 |
| J4 | verify swallows an error as true | RED, 1 of 18 |
| J5 | a time with no zone read as the machine's own time | RED, 1 of 18 |
| J6 | row cap never trips | RED, 1 of 18 |
| J7 | company parameter dropped | RED, 13 of 18 |
| J8 | only the first trace is read | RED, 15 of 18 |
| J9 | judge ignores wrong results | RED, 9 of 18 |
| J10 | a failed trace read swallowed as empty | RED, 2 of 18 |
| J11 | readable-time shape check dropped | RED, 1 of 18 |
| J12 | cutoff moved two days early | RED, 4 of 18 |
| J13 | cutoff moved one hour late | RED, 4 of 18 |
| J14 | no database says `na` | RED, 1 of 18 |
| W1 | lane ignores the retired row (`fin-b03-route-retired.test.mjs`) | RED, 4 of 11 |
| W2 | lane `naVerify` always true | RED, 3 of 11 |
| W3 | lane drops the database from the call | RED, 4 of 11 |
| P1 | `api/closer-deck.mjs` serves `send_ebook` again | RED, 1 of 11 |
| P2 | the refusal message lists `send_ebook` again | RED, 1 of 11 |

The three the checker named (S1, S2, S3 families) are all red now, on each of the three traces.

## Not proved here (said plainly)

- **Postgres itself was not run.** There is no Postgres on this Mac and the brief forbids the live database.
  `src/pulse/coverage/fin-b03-route-retired.pg.test.mjs` runs the same SQL strings and the same judge on Postgres
  (same read-only, shadow-table method as `gap-msg.pg.test.mjs`: `BEGIN READ ONLY`, the three real tables shadowed
  by CTEs holding only made-up rows). It skips without `DATABASE_URL` (7 skipped here). It has not been
  run by anyone. Its first real run is the CI job "suite (real Postgres - blocks)". Read that result before
  trusting the Postgres side. `node --check` passes; it was written by copying the sibling file's helpers.
- **What would differ on Postgres, and how it fails.** A statement Postgres rejects makes the row `skip` with the
  database's error, so a syntax or type problem is loud, not green. The silent differences were pinned in the
  scratch engine: `LIKE` is case sensitive there too, `->>` returns text, timestamps are handled as text or Date.
- The pay-link trace depends on the words staff typed. A re-implementation that mints a link labelled something
  else, under another email key, and does not write the marker, would leave no trace this check can see.

## Files added or rewritten

- `src/pulse/coverage/fin-b03-route-retired.mjs` (rewritten: the traces, the SELECT builder, the judge, the verifier)
- `src/pulse/coverage/fin-b03-route-retired.sql.test.mjs` (18 tests, SQL and judge on a real SQL engine, about 1 second)
- `src/pulse/coverage/fin-b03-route-retired.test.mjs` (11 tests: the real handler, the lane wiring, the audit)
- `src/pulse/coverage/fin-b03-route-retired.pg.test.mjs` (7 tests, Postgres, skips without a database)
- `src/pulse/coverage/fin-b03-route-retired-kit.mjs` (tests only: the scratch engine and the made-up rows)
- `ops/workflows/finish-853-2026-10-14/manifest-b03.md` (this file)

## Shared lines touched (integrator: please merge these)

Unchanged from cycle 0.

| File | Change |
|---|---|
| `src/pulse/na-conditions.mjs` | One new code `catalog-route-retired-action` in `NA_CONDITIONS`, placed just before `no-sender`. `verify: "lane"`. About 18 lines. |
| `src/pulse/na-conditions.test.mjs` | Four edits that keep the closed list honest: the sorted code list gained the new code and the title says "fifteen"; the lane-code loop gained it and the title says "ten lane codes"; the sentence samples gained one entry. If another batch also adds a code, merge the arrays by hand. |
| `src/pulse/coverage/gap-door-batch-routes.mjs` | A header note, one import block, `gapChecks()` became `gapChecks(ctx = {})` and routes the one retired row to the new judge, and a new `export const naVerify`. `ROUTE_GAP_ROWS`, `CHECK_IDS` and `EXPECTED_ROUTE_GAP_COUNTS` are untouched (still 135 rows). |
| `src/pulse/coverage/gap-door-batch-routes.test.mjs` | One import, and in "every missing route result emits one exact not-proved row" the retired row is expected to be `skip` with "no database in this run" while every other row is still `NOT_PROVED`. Nothing was removed. |

Not touched: `generated.json` (`npm run pulse:catalog` produced no diff), `door-proof.mjs`, `display-proof-cases.mjs`,
`modules.mjs`, `tripwires*.mjs`, count guards in `door-batch-route-result.test.mjs`.

Note for the integrator: the catalog still lists this row as "monitor stays red until an intended-method
fake-data test judges this named result". That text is the recipe and `door-batch-route-result.test.mjs` requires
it for every row in the lane. The live lane is the one that tells the truth ("retired, nothing to judge"). If
you want the catalog text to say "retired" too, that needs a recipe change and a change to that guard.

## Commands run (cycle 1)

- `node --test src/pulse/coverage/fin-b03-route-retired.sql.test.mjs`: 18 of 18 pass (about 1 second, no heavy imports).
- `node --test src/pulse/coverage/fin-b03-route-retired.test.mjs`: 11 of 11 pass (real handler, lane wiring, audit).
- `node --test src/pulse/coverage/fin-b03-route-retired.pg.test.mjs` with no `DATABASE_URL`: 7 skipped, 0 failed.
  **This is not a Postgres result.** See "Not proved here".
- The break runner (every row in the table above): 40 of 40 red, and the files were restored each time
  (`cmp` against a saved good copy, `git diff` clean on `api/closer-deck.mjs` and `gap-door-batch-routes.mjs`).
  The first pass ran the older single test file against S1 to S9 and was red on all of them; the table is the
  second pass against the final code.
- Regression group, same run as the pulse guards: `fin-b03-route-retired` (3 files), `gap-door-batch-routes`,
  `na-conditions`, `self-audit`, `scorecard`, `modules`, `tripwires`, `quiet-hours`, `s1-door-contracts`,
  `door-batch-route-result`, `src/http/routes.test.mjs`: 263 tests, 256 pass, 0 fail, 7 skipped (the pg file).
- `node --test src/pulse/daily-pulse.test.mjs src/pulse/coverage/run-slices.test.mjs src/pulse/coverage/gap-catalog-*.test.mjs src/pulse/coverage/gap-door-batch-routes.test.mjs src/pulse/coverage/link.test.mjs`: 100 of 100 pass.
- `npm run lint`: 3,567 files and inline scripts parse clean.
- `npm run pulse:catalog`: ran, `generated.json` unchanged (no diff).
- `node scripts/pulse/count-not-proved.mjs` (offline): `{"total":852,"byLane":{"gap-door-batch-routes":134,"gap-catalog-display":680,"gap-catalog-flow":23,"gap-catalog-reads":15}}`.
- Not run: `npm run pulse:prove` (it reads the live database; this batch is told to stay off it), and any
  `.pg.test.mjs` against a database (none on this Mac; the live database is off limits).

## Product findings (not fixed)

1. The catalog row text for `closer-deck send_ebook` is stale: it describes an action the owner retired on
   2026-10-11. The map files `ops/workflows/coverage-every-surface-2026-10-10/routes-1.json` and `desks-f.json`
   (the "Send e-book email" present.html row) still list it. Retiring those rows from the map is a catalog
   change, not a test.
2. `closer_deck_ebook_sent_at` is still read by `src/pulse/coverage/gap-closer.mjs` (deck-used history). It is
   correct as history, but nothing writes it any more, so that read is only for the past.
3. `payment_links.description` is free text typed by staff, so "was this an e-book" can only be asked by words.
   If the owner ever sells an item called e-book through a custom pay link on purpose, this row will go red on it.
   That is by design while the e-book offer is retired, and it is the cue to retire this check with the offer.
