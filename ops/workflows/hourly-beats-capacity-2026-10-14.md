# Hourly beats are over capacity — 2026-10-14

Found 2026-10-14 ~8:45 a.m. Arizona while shipping the proof round (tests only, 700 rows proved). The ship guard (`npm run pulse:prove -- --beats`) failed twice on GitHub's runner. The same thing shows on the live server's own hourly run at 8:07 a.m.

## What is wrong

PR #41 took the hourly pulse from 10 beats to 15. All beats share ONE database connection (the "read box", `src/pulse/beats/readbox.mjs`: statements run one at a time, first in first out). Every beat's deadline (9 to 12 s, `deadlineMs` in each beat) starts when the run starts, not when that beat gets its turn. The whole beats phase is 13 s (`BEATS_PHASE_MS`, `src/pulse/runner.mjs`).

43 reads in a queue on one connection no longer fit. Beats at the back of the queue hit their deadline before they begin, and go red with "deadline N ms passed before any step began".

## Evidence (read only)

- Live hourly run 8:07 a.m. Arizona: `db-health` red ("deadline 10000 ms passed before any step began"), `money-funding` red, `partner-trip` red. These are false alarms; the database is healthy (14 of 60 connections, nothing slow).
- `db-health` took 8.0 s, 9.5 s and 8.4 s at 5:07, 6:07 and 7:07 a.m. (it took 2.7 s to 5.8 s when there were 10 beats).
- GitHub ship runs 38590554067, attempts 1 and 2: first run `db-health`, `money-funding`, `partner-trip` hit their deadlines; the re-run `money-operations` did, and the site's own pages timed out from the runner.

## Why it matters

- A red hourly beat texts Chris "BROKEN". With texts dead (Twilio account not active) nothing goes out today. When Twilio is back, a false "8 checks are red at once" text goes out every hour.
- The ship guard now blocks every ship until the beats proof passes, so nothing can ship, including the tests-only proof round already on `main`.

## Fix (Codex builds, Claude tests)

Pick the smallest honest fix, in this order of preference:
1. Count each beat's deadline from the moment it starts running, not from the run start.
2. Open 3 read boxes (3 connections, all `BEGIN READ ONLY`) and spread the 15 beats across them. The pool has room (14 of 60 in use).
3. Only if still needed: split the beats between two scheduled functions (the `only` option already exists in `runPulse`).

Rules: read only stays read only; no beat is weakened or removed; no deadline is simply raised to hide the queue; clean small diff.

## Acceptance (what Claude will test)

- `npm run pulse:prove -- --beats` says OK three runs in a row, and every beat's `ms` is under half its deadline.
- Same proof run with 120 ms of artificial delay added to every read: still no beat hits its deadline. This is the real-network case.
- A beat that is truly broken still goes red at its own step (selfTest fail paths unchanged); the box still refuses writes (`--probe`).
- Live: the hourly run after the ship shows 15 beats with no "deadline" step.
