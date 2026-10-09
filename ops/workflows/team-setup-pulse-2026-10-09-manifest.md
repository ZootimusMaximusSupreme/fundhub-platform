# Manifest: closer and setter calendar setup in the pulse (2026-10-09)

Builder: Sonnet. Branch: `build/CS-closer-setup-2026-10-09` (cut from main at `a49e36ca3`).
Repair round 2: branch `build/CS-closer-setup-r2-2026-10-09`, cut from `aa0e518f3`. Its changes are listed in the section "Repair round 2" at the end. Where an older line below is no longer true, it says so and points there.
Board: `ops/workflows/team-setup-pulse-2026-10-09.md` (section "Corrected design", items 1 to 7).
Item 8 (the data) is NOT done. The writer was never run against the live database.

## Files

| File | New or edit | What |
|---|---|---|
| `src/pulse/coverage/gap-closer-setup.mjs` | new | The lane. Two rows, one SELECT and one GET side by side. Read only. Round 2 repaired it (see the end). |
| `src/pulse/coverage/gap-closer-setup.test.mjs` | new | 55 tests after round 2 (45 before), plus 4 more that run only with `DATABASE_URL` (SQL on the real engine over fixture rows). Page fixture copied from the live tag. |
| `src/pulse/coverage/modules.mjs` | edit | One literal line, placed BEFORE `gap-closer.mjs` (see deviations). |
| `scripts/closer-setup-ask.mjs` | new | The writer: `open`, `snooze`, `close`, each with `--dry-run`. |
| `scripts/closer-setup-ask.test.mjs` | new | 33 tests after round 2 (24 before), fake db only. |
| `docs/journeys/heartbeat-flow.md` | edit | One table row (reminder lane, not a tripwire), one paragraph under it, heading "Two kinds" became "Kinds of check". |
| `docs/journeys/CHANGELOG.md` | edit | One line at the top. |
| `ops/workflows/pulse-hourly-lanes-2026-10-09/card-gap-closer-setup.md` | new | The manifest card: `{ hourly: false, web: true, reason: "a person does not answer faster by the hour; the 6 a.m. run is enough" }` (69 characters). `src/pulse/lanes/manifest.mjs` does not exist yet, so a card, not a row. |
| `src/lib/no-unfenced-transmit.test.mjs` | edit (not on the board list) | One line in `ALLOWED_RAW_FETCH`: `"src/pulse/coverage/gap-closer-setup.mjs": PULSE_GAP_READS`. Needed because the lane calls `fetchImpl(`, which the fence test flags. Same entry every read-only gap lane has. **The orchestrator must add this file (that one line) to the lane's owned list on the board.** Proved needed in round 2: with the line removed, the fence test names `src/pulse/coverage/gap-closer-setup.mjs` (and the two older names below); with it, only the two older names. Round 2 left the line exactly as it was. |

Not touched: tripwires, baseline, registry, heartbeats, beats, na-conditions, daily-pulse, self-audit, morning-brief, gap-calls, gap-funnels, run-slices, rules. No TRIPWIRES entry. No hourly beat.

## Exports with exact shapes

`src/pulse/coverage/gap-closer-setup.mjs`

```
CHECK_IDS       frozen ["closer-setup:calendar-late", "closer-setup:booking-page-host"]
ASK_SOURCE      "closer-calendar-ask"
ASK_BODY_PREFIX "closer-calendar:"
GRACE_DAYS      3
DEFAULT_FUNNEL_URL "https://apply.fundhub.ai"
PAGE_PATH       "/funding-book-call"
PAGE_TIMEOUT_MS 10000          READ_TIMEOUT_MS 8000
ASKS_SQL        the one SELECT (tag /* gap-closer-setup:asks */), params [orgId, ASK_SOURCE, ASK_BODY_PREFIX]
parseIsoTime(value)       -> Date | null   (round 2) only a full ISO time with a zone, like 2026-10-07T17:41:33Z; a
                             real day only (Feb 31 is null). The writer uses it too, so both read times one way.
parseAskBody(body)        -> { staffId: string, askedAt: Date | null } | null
                             askedAt is null unless the time part passes parseIsoTime (round 2; it was "any Date").
readBookingBlock(html)    -> the first application/json script's event_type object | null
                             (round 2: the script's type attribute is read as an attribute, not found by pattern)
gapChecks(ctx)            -> [calendarLateRow, bookingPageHostRow], always both, always in CHECK_IDS order
                             row = { id, status: "PASS"|"FAIL"|"skip", detail, suggestedFix, customerSees? }
                             customerSees only on FAIL. suggestedFix is a string with "\n" between lines.
```

ctx it reads: `db`, `scope`, `orgId`, `now`, `fetchImpl` (or `fetch`), `env.FUNNEL_URL`. Test hooks: `readTimeoutMs`, `pageTimeoutMs`.

`scripts/closer-setup-ask.mjs`

```
COMMANDS   ["open", "snooze", "close"]
EVENT_NAME "Funding Strategy Meeting"      MAX_DAYS 60
parseArgs(argv)  -> { command, staff, askedAt, graceDays, days, until, task, dryRun, help, errors[] }   (task: round 2)
run(args, { db, orgId, now, createTask, log })
                 -> { ok: true, action, dryRun, ...plan } | { ok: false, refused: true, reason }
main(argv)       -> exit code (0 ok or dry-run, 1 refused)
```

Rules, as built:

- Lane `calendar-late`: PASS when no open ask; PASS with "day N of M" while inside `due_at`; PASS when the person is a host on the page (any time, name match ignores case, spacing, accents and hyphens; a part of a name does not match); FAIL when past `due_at`, not a host, and the page was read; skip when past `due_at` and the page was not read, or when the ask rows were not read. `due_at` is the red-after time; if null, ask time + `GRACE_DAYS`. The ask time comes from the body, not `created_at`.
- Lane `booking-page-host`: FAIL when the page lists no host, or when the picked host shows no place; PASS otherwise (detail: "place shown for <picked host>: <place>"); skip when the page is not read, has no booking block, or has no host list.
- Both lane rows are skips with a reason, never missing, with no ctx, a dead db, a dead network or a hung read (8 s) or hung page (10 s).
- Writer `open`: IS NOT DISTINCT FROM pre-check (exact body), plus a check for any other open ask for the same person; `createTask` with `clientId: null`, title `Waiting: <name> calendar on the booking page`, `sourceWorkflow: ASK_SOURCE`, `assigneeRole: "owner"`, body `closer-calendar:<staff id>:<asked ISO>`, `dueAt = asked + GRACE_DAYS` (or `--grace-days`), detail `Asked by email on <date>. Needs: ClickFunnels invite, calendar connected, added as host on Funding Strategy Meeting.` `created_at` is not in the INSERT. Refuses an unknown or not-active staff id. Round 2: `--asked-at` and `--until` must be a full ISO time with a zone; `--asked-at` more than 60 days back is refused; `close` takes an optional `--task <ask id>`.

## Tests and results, round 1 (run in this worktree; round 2 results are in the last section)

| Run | Result |
|---|---|
| `node --test src/pulse/coverage/gap-closer-setup.test.mjs` | 45 pass, 0 fail, 1 suite skipped (needs DATABASE_URL) |
| same file with `--env-file=.env` (SELECT-only CTE fixtures on the live engine) | 49 pass, 0 fail, 0 skipped |
| `node --test scripts/closer-setup-ask.test.mjs` | 24 pass, 0 fail |
| `src/pulse/coverage/modules.test.mjs` | 4 pass |
| `src/pulse/self-audit.test.mjs` (loads every lane, every id emitted with a dead db and dead network) | 101 pass |
| `src/pulse/tripwires.test.mjs` | 7 pass |
| `src/pulse/heartbeat-law.test.mjs` | 2 pass |
| `src/pulse/coverage/run-slices.test.mjs` | 25 pass |
| `src/pulse/coverage/gap-closer.test.mjs` (neighbour lane) | 16 pass |
| `npm run lint` | 3217 files parse clean |

Proof the tests break when the logic breaks (each mutation made, tests run, file restored): lane "never late" 10 tests fail; "never joined" 2; "host row never fails" 2; "place never judged" 1; "ignore body time" 7; "due fallback" 2; "late on skip" 1. Writer "dry-run writes" 1; "inactive allowed" 1; "unknown allowed" 1; "no second-open check" 1; "snooze dry-run writes" 1.

Live read-only proof, no write, no second GET: the lane's own SQL ran in `BEGIN READ ONLY` as the staff scope (0 rows today, as expected: no ask exists yet). The lane then ran on the saved copy of the real 161 KB page with that live read: both rows PASS, 1 statement, 1 GET, 133 ms.

## Deviations from the board, and why

1. `modules.mjs` line goes BEFORE `gap-closer.mjs`, not after. `src/pulse/coverage/run-slices.test.mjs` ("the morning pass runs every gap file") needs the list in sorted file order, and `gap-closer-setup.mjs` sorts before `gap-closer.mjs` (`-` is before `.`). After it, that test fails.
2. `customerSees` is "No buyer is hurt yet. Booked calls still go to the hosts already on the booking page." The board text names Chris. The integrator rule says no staff name in `customerSees`. Fix line 1 was the board text word for word in round 1. Round 2 changed its first words from "A closer" to "A team member" (see Repair round 2, item 6).
3. The SELECT uses `LEFT JOIN staff`, not `JOIN`. An ask whose staff row is gone is kept (it can turn red, with a note) instead of vanishing into a false green.
4. `suggestedFix` has a third line naming the writer (`snooze` or `close`). Lines 1 and 2 are the board text.
5. `booking-page-host` also FAILs when a host is listed and the picked host shows no place. The board names the empty-host FAIL; "the detail names whose place was read" implied the place is judged. Remove the one branch if that is not wanted.
6. Writer: `snooze` and `close` do not need the person to be active (only an open ask). If they did, the ask for a person who left could never be dropped and the red would stand. `open` refuses unknown and not-active staff as asked.
7. Writer `open` also refuses a second open ask for the same person (the lane reads one ask per person).

## For the integrator (item 8, not run)

Each first with `--dry-run`, then without:

```
node --env-file=/Users/chrisstanbridge/Developer/fundhub-platform/.env scripts/closer-setup-ask.mjs open --staff 968bb01e-0079-4508-aded-8a361d54ecbb --asked-at 2026-10-07T17:41:33Z
node --env-file=/Users/chrisstanbridge/Developer/fundhub-platform/.env scripts/closer-setup-ask.mjs open --staff 6ccdca88-60af-4b7e-af15-28259ead4786 --asked-at 2026-10-07T17:41:35Z
```

Both rows are due 2026-10-10 17:41 UTC. The first red is the Oct 11 6 a.m. Arizona run. `tasks.detail` exists on live (checked by a read-only column list), so the `detail` insert variant works.

Still to run by the integrator: `npm run pulse:prove` (not run here; the bundle proof is the integrator's gate), `npm test`, `npm run ship` once.

## Could not do or verify

- The bundle proof (`npm run pulse:prove`) and the full `npm test` were not run here. The pulse folder and scripts folder tests were run (2930 tests; the 4 failures below are not from this change, and one that was, run-slices ordering, is fixed).
- The 6 a.m. real-server behaviour (26 s step cut, bundled import) is unproven until the bundle proof runs. The lane has no imports and no file reads, so the bundle risk is low.
- Name matching is exact (case, spacing, accents and hyphens ignored; a part of a name such as "Justice N." does not match). If ClickFunnels spells a host differently from the staff row, the row stays red until the staff name or the ask is fixed.
- A reply to the email cannot be seen by the lane. An agent gives more days with `snooze`.

## Leftover (not this change, not touched, one card)

These fail on `main` at `a49e36ca3` without this change. Measured here in the worktree:

1. `src/lib/no-unfenced-transmit.test.mjs` "nothing reaches the network except through ..." names `src/pulse/funnel-doors.mjs` and `src/pulse/instant-watch.mjs` (neither is on `ALLOWED_RAW_FETCH`). Added by the texting-hours and launch-day tripwire commits.
2. `npx tsc --noEmit`: 1 error, `src/marketing/filmed-receive.mjs(159,75)` TS2345.
3. `scripts/daily-pulse.test.mjs` "--db hands the pulse a db and a staff scope": expects 5 staff scopes, gets more (fails with the original `modules.mjs` too).
4. `src/pulse/registry.test.mjs` "every registry row names a real handler or desk file": `leads/c01cb7592c8bb994130158e897e99bf1/index.html` exists only on the Mac (git-ignored), so a worktree has no copy. The hourly-lanes spec already names this one.
5. `scripts/ship.test.mjs` "machine-only folders" failed once in a 2930-test batch and passes alone (35 of 35): a flake under load.

## Repair round 2 (2026-10-09, branch `build/CS-closer-setup-r2-2026-10-09`)

An independent checker read round 1 and listed 10 findings (1 blocker, 9 low). Each one, and what was done:

| # | Finding | Done |
|---|---|---|
| 1 | Blocker: `src/lib/no-unfenced-transmit.test.mjs` is not on the owned list | **No code change, by design.** The line is needed (proved: removed, the fence test names the lane; kept, it does not). The orchestrator must add that one file to the owned list on the board. See the Files table. |
| 2 | `open --asked-at` took anything JavaScript could parse (`7` saved a 2001 ask; a date with no time was read as UTC midnight) | Fixed. Only a full ISO time with a zone is taken (`parseIsoTime`, exported from the lane, one rule for both files). A day that does not exist (Feb 31) is refused. An ask more than 60 days back (`MAX_DAYS`) is refused. Same strict rule on `snooze --until`, which had the same looseness (the checker named only `--asked-at`; `--until 7` was already caught by "must be in the future", `--until 2026-10-20` was read as UTC midnight). |
| 3 | `parseAskBody` read a loose time (`...:7` gave 2001) so it did not fall back to `created_at` | Fixed. The time part goes through `parseIsoTime`; no match gives `askedAt: null`, so the saved day is used. |
| 4 | Two open asks for one person: `snooze` and `close` both said "Close the extras first", and `close` could not | Fixed. `close --staff <id> --task <ask id>` closes the one named (the ask id must be an open ask for that person; a bad or foreign id is refused; `--task` goes with `close` only). The refusal now lists the ask ids and the exact command. Closing every open ask was not chosen: closing one and snoozing the other keeps one ask alive. |
| 5 | `\btype` also matched inside `data-type="application/json"`, and `type="application/json; charset=utf-8"` was refused | Fixed. The script tag's attributes are read one by one (`isJsonScript`): the first `type` attribute decides, `data-type` is a different name, a charset is allowed, quotes or no quotes. This is stricter than the single pattern the checker suggested: a value that only says `type=application/json` inside another attribute is not the type either. Tested with the decoy first, and with the real saved live page (200, 161,348 bytes; event 14234, host 14784 Chris Stanbridge, place Google Meet). |
| 6 | Words: (a) two periods after a host name that ends in one; (b) a parenthesis inside a parenthesis in the page skip; (c) "3 days ago" for 3.8 days; (d) fix line 1 says "A closer" when the late person is Sarah, a sales manager | (a) Fixed (`noDot`). (b) Fixed: the two page-code reasons are now one level ("...booking block is not in it; ClickFunnels may have changed the page code"), so the wrapped line has one pair of parentheses. (c) Fixed: whole Arizona calendar days, so Oct 7 to the Oct 11 run is "4 days ago"; same day says "today", never "0 days ago". The "day N of M" count in the green row is unchanged on purpose (it follows the due time and the tests pin it). (d) Changed to "A team member is past due to join the booking page." This is a deliberate step away from the board's "word for word" fix line 1; it is one string in `FIX_LATE` and one pinned test line to put back if the board text must stand. |
| 7 | Hyphen: "Mary-Ann Lee" against "Mary Ann Lee" stayed red | Fixed (hyphens and the Unicode dashes count as a space). Part of a name ("Justice N.", "Justice") still stays red, as the board accepts. |
| 8 | `FUNNEL_URL` with a path or query broke the address (`https://x.example/x?y/funding-book-call`) | Fixed. Only the origin is used: `new URL(PAGE_PATH, new URL(given).origin).href`. A login in the address is dropped. A value that is not an address uses the default, as before. |
| 9 | Design note: `booking-page-host` is not in TRIPWIRES, so after day 1 a red on it sorts behind the `audit:*` rows | **Not changed, as the checker said.** Orchestrator's call: keep as designed, or later give `closer-setup:booking-page-host` a customer rank. It is outside this lane's files. |
| 10 | For the record: counts in this worktree | No action. |

### Changed files in round 2

- `src/pulse/coverage/gap-closer-setup.mjs`: new export `parseIsoTime`; `parseAskBody` uses it; `isJsonScript` replaces the type pattern; `pageUrl` uses the origin; `norm` treats a hyphen as a space (and the combining-mark range is now written as `̀-ͯ` instead of the raw marks); `arizonaDay` and `daysAgo` and `noDot` (private); two page-code reasons flattened; fix line 1 says "A team member". `ASKS_SQL` is byte for byte unchanged (so the 4 database tests are not affected).
- `scripts/closer-setup-ask.mjs`: strict `--asked-at` and `--until` via `parseIsoTime`; 60 day look-back limit; `--task` on `close`; refusal text for two open asks; usage and header text.
- `src/pulse/coverage/gap-closer-setup.test.mjs`: 10 new tests; 2 existing assertions changed on purpose, nothing skipped or loosened: "3 days ago" is now "4 days ago" (the finding, item 6c), and the pinned fix line 1 is "A team member ..." (item 6d).
- `scripts/closer-setup-ask.test.mjs`: 9 new tests (24 to 33); none changed.
- `docs/journeys/CHANGELOG.md`: one line.
- This manifest.

Not touched in round 2: `src/lib/no-unfenced-transmit.test.mjs` (see item 1), tripwires, baseline, registry, heartbeats, beats, na-conditions, daily-pulse, self-audit, morning-brief, gap-calls, gap-funnels, run-slices, rules, `modules.mjs`.

### Round 2 results (run in this worktree)

| Run | Result |
|---|---|
| `node --test src/pulse/coverage/gap-closer-setup.test.mjs` | 55 pass, 0 fail, 1 suite skipped (the 4 database tests need `DATABASE_URL` and are not run here; `ASKS_SQL` did not change) |
| `node --test scripts/closer-setup-ask.test.mjs` | 33 pass, 0 fail |
| `modules.test`, `self-audit.test`, `tripwires.test`, `heartbeat-law.test`, `run-slices.test`, `gap-closer.test`, `heartbeats.test`, `beats/beats.test`, plus the two above | 268 tests, 268 pass, 0 fail |
| `node --test "src/pulse/**/*.test.mjs"` (whole pulse folder) | 2768 tests, 2702 pass, 1 fail, 65 skipped. The 1 failure is `registry: every registry row names a real handler or desk file` (the git-ignored `leads/c01cb…/index.html`; leftover item 4). The 65 skips are database tests with no `DATABASE_URL`. |
| `node --test src/lib/no-unfenced-transmit.test.mjs` | 1 fail: names only `src/pulse/funnel-doors.mjs` and `src/pulse/instant-watch.mjs` (leftover item 1). The lane is not named. |
| `npm run lint` | 3217 files parse clean |
| `npx tsc --noEmit` | 1 error, `src/marketing/filmed-receive.mjs(159,75)` (leftover item 2; file not touched) |
| Saved live page (one GET, 200, 161,348 bytes, 0.56 s) through the repaired lane with a fake empty ask list | both rows PASS; 1 SELECT (fake) and 1 GET |

Mutation proofs for the new tests (each break made, the test file run, the file restored byte for byte): loose body time (1 test fails); a day that rolls over (2); the old type pattern (2); hyphen not a space (1); FUNNEL_URL path kept (1); 24 hour blocks for "days ago" (2); trailing period kept (1); "A closer" back in fix line 1 (2); a parenthesis inside a parenthesis (1). Writer: loose `--asked-at` (1); no 60 day limit (1); loose `--until` (1); `--task` ignored (3); `--task` closes the first ask, not the named one (2); `--task` allowed on `snooze` and `open` (1); a bad `--task` reaches the database (1). All 16 caught.

### Could not do or verify in round 2

- `npm run pulse:prove`, the full `npm test`, and the 4 database-engine tests in the lane test were not run (the bundle proof and the live engine are the integrator's gates; the SQL did not change).
- The writer was not run against the live database. Item 8 (the two `open` commands) is still the integrator's. The two commands in "For the integrator" already use the strict time shape and are inside the 60 day limit.
