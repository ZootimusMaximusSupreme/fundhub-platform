# Batch 03 manifest — route row, closer-deck send_ebook

Branch `fin/b03`, built from `fin/base` at `2f4f574a0`. Nothing was pushed or merged.
Lane: `gap-door-batch-routes`. Rows in the batch: 1. Product code changed: none.

## Numbers

| | Before | After |
|---|---|---|
| Rows of this batch that say NOT_PROVED (`node scripts/pulse/count-not-proved.mjs`, offline) | 1 | 0 |
| All four lanes, same script | 853 | 852 (route lane 135 to 134) |

Offline, with no database, the row says `skip` ("no database in this run"). On the live pulse it says
`na` (nothing to judge) or `FAIL`. It cannot say `PASS`.

## The row

| Row id | Outcome | What it is |
|---|---|---|
| `catalog-route:routes-1.json:route:closer-deck:POST action=send_ebook {client_id, amount_cents} (mint an ad-hoc priced pay link and send it)` | **na-verified**, backed by a live read that goes `FAIL` on the first wrong result | The action is gone. See below. |

### Why this row is not a "prove the route works" row

The owner retired the e-book offer on 2026-10-11 (commit `9b9f6fa88`, `docs/journeys/CHANGELOG.md`, 2026-10-11 line).
`api/closer-deck.mjs` now answers `send_ebook` with 400 `unknown_action`, and `sendDeckEbook` is deleted. The row
still describes "mint an ad-hoc priced pay link and send it", a result that no longer exists. No fake-data test can
prove it, and attaching the existing refusal test as "proof" of the row would be false. The earlier slice 1
builder left it NOT_PROVED for that reason (finding 1 in `manifest-s1.md`), and
`s1-door-contracts.test.mjs` still guards that no test is attached as a proof of it. That guard is unchanged and
still passes, because the row stays in the red lane.

What is left to judge is that the retired action **stays off**, and it leaves a trace:
the old action wrote `closer_deck_ebook_sent_at` on the client file (`clients.custom_fields`). Nothing writes that
field now (`gap-closer.mjs` only reads it, for history).

### The live check (what the morning pulse runs)

`src/pulse/coverage/fin-b03-route-retired.mjs`, called from `gap-door-batch-routes.mjs` `gapChecks(ctx)`:

- One read-only SELECT on `clients`: how many client files carry `closer_deck_ebook_sent_at` (history), and how
  many carry it at or after `2026-10-12T16:36:00` UTC, or carry it with no readable time (wrong).
- The cutoff is the first live ship that carried the retirement commit: `bfd16774`, logged 2026-10-12 09:36
  Arizona in `ops/ship-log.md` (the test checks the constant against that log line).
- `bad = 0` returns `na`, code `catalog-route-retired-action`, with the count of old sends in the sentence.
- `bad > 0` returns `FAIL` by row id: "N client files show an e-book send saved at or after ..., The closer deck
  sent an offer that was retired."
- A failed read or no database returns `skip` with the reason. Never `PASS`.
- `naVerify["catalog-route-retired-action"]` (exported from `gap-door-batch-routes.mjs`) runs the same read again
  each morning, so the "nothing to judge" claim is re-checked true, as the owner law requires. It cannot be talked
  into a different action, control, map or route (the proof args must equal the one retired entry).

### The practice test (fake data, runs in CI)

`src/pulse/coverage/fin-b03-route-retired.test.mjs`, test "the real closer-deck handler refuses send_ebook for
every role that may use the deck, and does nothing": the real handler, a stand-in database, `fetch` trapped. For
closer, sales manager, owner and admin it answers 400 `unknown_action`, does not list the e-book in the refusal,
and inserts or updates nothing (no payment link, no message, no marker). A second test shows a served action on
the same stand-in is not refused as unknown, so the refusal is the action's own.

## Files added

- `src/pulse/coverage/fin-b03-route-retired.mjs` (the retired-action list, the SQL, the judge, the verifier)
- `src/pulse/coverage/fin-b03-route-retired.test.mjs` (16 tests)
- `ops/workflows/finish-853-2026-10-14/manifest-b03.md` (this file)

## Shared lines touched (integrator: please merge these)

| File | Change |
|---|---|
| `src/pulse/na-conditions.mjs` | One new code `catalog-route-retired-action` in `NA_CONDITIONS`, placed just before `no-sender`. `verify: "lane"`. About 18 lines. |
| `src/pulse/na-conditions.test.mjs` | Four edits that keep the closed list honest: the sorted code list gained the new code and the title says "fifteen"; the lane-code loop gained it and the title says "ten lane codes"; the sentence samples gained one entry. If another batch also adds a code, merge the arrays by hand. |
| `src/pulse/coverage/gap-door-batch-routes.mjs` | A header note, one import block, `gapChecks()` became `gapChecks(ctx = {})` and routes the one retired row to the new judge, and a new `export const naVerify`. `ROUTE_GAP_ROWS`, `CHECK_IDS` and `EXPECTED_ROUTE_GAP_COUNTS` are untouched (still 135 rows), so other route batches do not collide with this one on the count guards. |
| `src/pulse/coverage/gap-door-batch-routes.test.mjs` | One import, and in "every missing route result emits one exact not-proved row" the retired row is expected to be `skip` with "no database in this run" while every other row is still `NOT_PROVED`. Nothing was removed. |

Not touched: `generated.json` (the catalog recipe for the row is unchanged, `npm run pulse:catalog` produced no
diff), `door-proof.mjs`, `display-proof-cases.mjs`, `modules.mjs`, `tripwires*.mjs`, count guards in
`door-batch-route-result.test.mjs`.

Note for the integrator: the catalog still lists this row as "monitor stays red until an intended-method
fake-data test judges this named result". That text is the recipe and `door-batch-route-result.test.mjs` requires
it for every row in the lane. The live lane is the one that tells the truth ("retired, nothing to judge"). If
you want the catalog text to say "retired" too, that needs a recipe change and a change to that guard; I did not
make it.

## Break it on purpose (all red, all restored)

Each break was made, `fin-b03-route-retired.test.mjs` run, red seen, file put back (`git checkout` for tracked
files, a saved copy for the new file).

| # | Break | Red tests |
|---|---|---|
| 1 | `api/closer-deck.mjs` serves `send_ebook` again | the handler refusal test |
| 2 | company condition removed from the SQL | "another company's late send" |
| 3 | cutoff comparison removed from the SQL | 5 tests (FAIL, company, scope, naVerify, audit) |
| 4 | unreadable-time clause removed from the SQL | "no readable time ... is red" |
| 5 | marker condition (`IS NOT NULL`) removed from the SQL | "no e-book send", "history" |
| 6 | cutoff moved two days earlier | ship-log check, "history" |
| 7 | `bad > 0` ignored (always na) | 4 tests |
| 8 | naVerify always true | naVerify test, audit test |
| 9 | naVerify accepts any action or control | "the proof cannot name another action" |
| 10 | a failed read swallowed as zero | "a failed read is skip", naVerify test |
| 11 | N/A `problem()` accepts anything | "the proof cannot name another action" |
| 12 | lane ignores the retired row (old behavior) | 6 or more tests |

The SQL is not run by Postgres here (there is no local Postgres on this Mac). The stand-in keeps a row only while
the SQL text carries that row's condition, the same way `s1-proof-kit.mjs` does, so each condition above is held
by a test. The SQL text itself was written to be safe on the real table: it uses text comparison in the "C"
collation after a shape check, so a strange saved value cannot make the read throw.

## Commands run

- `node scripts/pulse/count-not-proved.mjs`: before 853 (batch 1 of 1 open), after 852 (batch 0 open).
- `node --test src/pulse/coverage/fin-b03-route-retired.test.mjs`: 16 of 16 pass.
- `node --test src/pulse/coverage/gap-door-batch-routes.test.mjs src/pulse/na-conditions.test.mjs src/pulse/self-audit.test.mjs src/pulse/scorecard.test.mjs src/pulse/coverage/modules.test.mjs src/pulse/tripwires.test.mjs`
  with the new test: 203 of 203 pass.
- `node --test src/pulse/daily-pulse.test.mjs src/pulse/coverage/run-slices.test.mjs src/pulse/coverage/gap-catalog-*.test.mjs`
  (data, display, flow): 64 of 64 pass.
- `npm run pulse:catalog`: ran, `generated.json` unchanged.
- The group command (`node --test` over every file under `src/pulse/catalog`, plus `gap-catalog*.test.mjs` and
  `gap-door-batch*.test.mjs`): 1,683 tests, 1,681 pass, 2 fail, 0 skipped. Both failures are slow-Mac timeouts
  (load average 40 to 70 from the sibling batches) and neither touches this batch:
  - "the focused proof test runs every executable test named by every case" ran 567 s. Inside it the staff
    browser batch finished 379 of 380 and lost `teleprompter-take-flow.spec.mjs:1419` ("recording still paints
    and rolls on a browser without video-frame callbacks"). Run alone with `CI=1 E2E_PORT=47931`: passes.
  - "every test named by a flow proof passes with fake data or local reads" lost `src/sales/closer-deck.test.mjs`
    to the 30 s inner timeout (the same failure the slice 1 and 2 manifests recorded). Run alone: 27 of 27 pass.
- `npm run lint`: 3,564 files parse clean.
- Not run: `npm run pulse:prove` (it reads the live database; this batch is told to stay off it).

## Product findings (not fixed)

1. The catalog row text for `closer-deck send_ebook` is stale: it describes an action the owner retired on
   2026-10-11. The map files `ops/workflows/coverage-every-surface-2026-10-10/routes-1.json` and `desks-f.json`
   (the "Send e-book email" present.html row) still list it. Retiring those rows from the map is a catalog
   change, not a test.
2. `closer_deck_ebook_sent_at` is still read by `src/pulse/coverage/gap-closer.mjs` (deck-used history). It is
   correct as history, but nothing writes it any more, so that read is only for the past.
