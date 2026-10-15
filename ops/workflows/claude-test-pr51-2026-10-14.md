# Claude test of PR #51 (hourly capacity follow-up) — 2026-10-14

Clean checkout of `87de6e5976f00528a8206b8902163b3d6aa66d11`, `npm ci`, run from a throwaway worktree (removed).
Run on the Mac while 26 other agents were running (load average 22 to 90), so timings are worse than a quiet run.

## Result: behavior passes, one test does not guard its finding

| Check | Result |
|---|---|
| Unit tests named in the manifest (6 files) | 172 pass, 0 fail, 0 skipped |
| `prove --beats` x3, live data, read only | OK x3. 15 beats, 3 red (existing business reds), 0 cut, 4.8 to 5.6 s. 3 boxes, 44 reads, 0 errors, 0 refused, 0 commits, all rolled back and destroyed, pool 0 |
| `prove --beats --slow-apply-links=10500 --read-delay=120` | OK. 15 beats, 0 cut, 14.3 s, apply-links 10,500 ms. 3 boxes, 43 reads, pool 0 |
| Break-on-purpose (7 breaks) | 5 red as they should be. 2 stayed green (below) |

## The 7 breaks

| # | Break | Tests |
|---|---|---|
| M1 | static lanes instead of one shared queue | red (2 tests) |
| M2 | `boxProblems.every` changed to `.some` (finding 2) | **STAYED GREEN** |
| M3 | always open 3 boxes (finding 3) | red (2 tests) |
| M4 | boxes not closed in `finally` (finding 4) | red (7 tests) |
| M5 | failed worker keeps taking beats | red |
| M6 | remove `if (phaseClosed) return` in `startEntry` | stayed green: redundant guard (the only caller checks `phaseClosed` in the same tick with no await). Harmless. Not a test gap. |
| M7 | proof settings query skips the delay wrapper (finding 5) | red |

## The one real gap (finding 2)

`plan.dbDown = dbDown && dbReds >= DB_DOWN_AT (3) && due > 0` in `src/pulse/alerts.mjs:181`.
The test "one failed box makes only its first beat red" makes ONE red beat, so `dbReds` is 1 and the text can
never say "the database is not answering", with or without the fix. The assertion proves nothing.
Needed: a case with 2 of 3 boxes failed AND at least one more beat red with a `threw: db:` detail from the healthy
box (so `dbReds` >= 3 while a box is still healthy). The text must NOT say the database is not answering.
With `.some` instead of `.every` that case must go red.

## Not part of this PR

PR #51 CI: `screens (real browser)` failed in `e2e/calendar.spec.mjs` (4 timeouts at 10 s). The PR changes no screen,
route or e2e file. `tests` is `cancelled` on every push to main too, so main gives no baseline for it.

## Verdict

Behavior is correct and holds under a 120 ms delay on every query plus a 10.5 s beat. Ready to merge once the
finding-2 test is real. Nothing was merged, deployed or pushed.

## Retest at `d5af94d46` (same day) — PASS

Only `src/pulse/runner.test.mjs` (+33 lines, new case: three `threw: db:` reds with one healthy box must not say the
database is not answering) and the manifest changed. Runner code is identical to the `87de6e597` code proved live above.

| Check | Result |
|---|---|
| Unit tests (6 files), clean `npm ci` | 173 pass, 0 fail, 0 skipped |
| M2 (`.every` to `.some`) | now RED (new test 2 fails). Finding 2 is guarded |
| M1, M3, M4, M5, M7 | all RED |
| M6 (redundant `phaseClosed` guard) | green: equivalent mutant, harmless |

Verdict: PR #51 is ready to merge. Nothing merged, deployed or pushed by Claude.
