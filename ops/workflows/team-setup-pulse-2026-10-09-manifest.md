# Manifest: closer and setter calendar setup in the pulse (2026-10-09)

Builder: Sonnet. Branch: `build/CS-closer-setup-2026-10-09` (cut from main at `a49e36ca3`).
Board: `ops/workflows/team-setup-pulse-2026-10-09.md` (section "Corrected design", items 1 to 7).
Item 8 (the data) is NOT done. The writer was never run against the live database.

## Files

| File | New or edit | What |
|---|---|---|
| `src/pulse/coverage/gap-closer-setup.mjs` | new | The lane. Two rows, one SELECT and one GET side by side. Read only. |
| `src/pulse/coverage/gap-closer-setup.test.mjs` | new | 45 tests, plus 4 more that run only with `DATABASE_URL` (SQL on the real engine over fixture rows). Page fixture copied from the live tag. |
| `src/pulse/coverage/modules.mjs` | edit | One literal line, placed BEFORE `gap-closer.mjs` (see deviations). |
| `scripts/closer-setup-ask.mjs` | new | The writer: `open`, `snooze`, `close`, each with `--dry-run`. |
| `scripts/closer-setup-ask.test.mjs` | new | 24 tests, fake db only. |
| `docs/journeys/heartbeat-flow.md` | edit | One table row (reminder lane, not a tripwire), one paragraph under it, heading "Two kinds" became "Kinds of check". |
| `docs/journeys/CHANGELOG.md` | edit | One line at the top. |
| `ops/workflows/pulse-hourly-lanes-2026-10-09/card-gap-closer-setup.md` | new | The manifest card: `{ hourly: false, web: true, reason: "a person does not answer faster by the hour; the 6 a.m. run is enough" }` (69 characters). `src/pulse/lanes/manifest.mjs` does not exist yet, so a card, not a row. |
| `src/lib/no-unfenced-transmit.test.mjs` | edit (not on the board list) | One line in `ALLOWED_RAW_FETCH`: `"src/pulse/coverage/gap-closer-setup.mjs": PULSE_GAP_READS`. Needed because the lane calls `fetchImpl(`, which the fence test flags. Same entry every read-only gap lane has. |

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
parseAskBody(body)        -> { staffId: string, askedAt: Date | null } | null
readBookingBlock(html)    -> the first application/json script's event_type object | null
gapChecks(ctx)            -> [calendarLateRow, bookingPageHostRow], always both, always in CHECK_IDS order
                             row = { id, status: "PASS"|"FAIL"|"skip", detail, suggestedFix, customerSees? }
                             customerSees only on FAIL. suggestedFix is a string with "\n" between lines.
```

ctx it reads: `db`, `scope`, `orgId`, `now`, `fetchImpl` (or `fetch`), `env.FUNNEL_URL`. Test hooks: `readTimeoutMs`, `pageTimeoutMs`.

`scripts/closer-setup-ask.mjs`

```
COMMANDS   ["open", "snooze", "close"]
EVENT_NAME "Funding Strategy Meeting"      MAX_DAYS 60
parseArgs(argv)  -> { command, staff, askedAt, graceDays, days, until, dryRun, help, errors[] }
run(args, { db, orgId, now, createTask, log })
                 -> { ok: true, action, dryRun, ...plan } | { ok: false, refused: true, reason }
main(argv)       -> exit code (0 ok or dry-run, 1 refused)
```

Rules, as built:

- Lane `calendar-late`: PASS when no open ask; PASS with "day N of M" while inside `due_at`; PASS when the person is a host on the page (any time, name match ignores case, spacing and accents); FAIL when past `due_at`, not a host, and the page was read; skip when past `due_at` and the page was not read, or when the ask rows were not read. `due_at` is the red-after time; if null, ask time + `GRACE_DAYS`. The ask time comes from the body, not `created_at`.
- Lane `booking-page-host`: FAIL when the page lists no host, or when the picked host shows no place; PASS otherwise (detail: "place shown for <picked host>: <place>"); skip when the page is not read, has no booking block, or has no host list.
- Both lane rows are skips with a reason, never missing, with no ctx, a dead db, a dead network or a hung read (8 s) or hung page (10 s).
- Writer `open`: IS NOT DISTINCT FROM pre-check (exact body), plus a check for any other open ask for the same person; `createTask` with `clientId: null`, title `Waiting: <name> calendar on the booking page`, `sourceWorkflow: ASK_SOURCE`, `assigneeRole: "owner"`, body `closer-calendar:<staff id>:<asked ISO>`, `dueAt = asked + GRACE_DAYS` (or `--grace-days`), detail `Asked by email on <date>. Needs: ClickFunnels invite, calendar connected, added as host on Funding Strategy Meeting.` `created_at` is not in the INSERT. Refuses an unknown or not-active staff id.

## Tests and results (run in this worktree)

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
2. `customerSees` is "No buyer is hurt yet. Booked calls still go to the hosts already on the booking page." The board text names Chris. The integrator rule says no staff name in `customerSees`. Fix line 1 is the board text word for word.
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
- Name matching is exact (case, spacing and accents ignored). If ClickFunnels spells a host differently from the staff row, the row stays red until the staff name or the ask is fixed.
- A reply to the email cannot be seen by the lane. An agent gives more days with `snooze`.

## Leftover (not this change, not touched, one card)

These fail on `main` at `a49e36ca3` without this change. Measured here in the worktree:

1. `src/lib/no-unfenced-transmit.test.mjs` "nothing reaches the network except through ..." names `src/pulse/funnel-doors.mjs` and `src/pulse/instant-watch.mjs` (neither is on `ALLOWED_RAW_FETCH`). Added by the texting-hours and launch-day tripwire commits.
2. `npx tsc --noEmit`: 1 error, `src/marketing/filmed-receive.mjs(159,75)` TS2345.
3. `scripts/daily-pulse.test.mjs` "--db hands the pulse a db and a staff scope": expects 5 staff scopes, gets more (fails with the original `modules.mjs` too).
4. `src/pulse/registry.test.mjs` "every registry row names a real handler or desk file": `leads/c01cb7592c8bb994130158e897e99bf1/index.html` exists only on the Mac (git-ignored), so a worktree has no copy. The hourly-lanes spec already names this one.
5. `scripts/ship.test.mjs` "machine-only folders" failed once in a 2930-test batch and passes alone (35 of 35): a flake under load.
