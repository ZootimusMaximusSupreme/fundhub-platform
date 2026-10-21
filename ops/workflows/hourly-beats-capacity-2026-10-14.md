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

## Fix 3 — built 2026-10-20 (two hourly shifts)

Fixes 1 and 2 were already live (deadline counts from the beat's own start; three read boxes). By 2026-10-20 there were
26 beats, and about 12 more beat groups were on the way. Measured before the split, one run with all 26:

- Mac, plain: 22.7 s of the 39 s box time; with `--read-delay=120`: **8 beats cut**.
- Live, 21 beats (pulse_beats, last 24 hours): 21.7 s median, 25.2 s p90 of box time per run.

What was built (branch `worktree-agent-a430378483f13f158`):

- `src/pulse/beats/shifts.mjs` — ONE literal list: which beat runs in which shift. Every beat is in exactly one shift.
  `src/pulse/beats/shifts.test.mjs` fails for a beat in no shift, in two shifts, a shift that names a beat that is not
  listed, or an empty shift.
- `netlify/functions/pulse-hourly.mjs` runs shift A at minute 7. New `netlify/functions/pulse-hourly-b.mjs` runs
  shift B at minute 37. Both call the same `runPulse` with `only`. Same boxes, same texting hours, same incidents.
- Heartbeat law: `pulse-hourly-b` is in `NETLIFY_JOBS` (`37 * * * *`, red after 3 hours), the alerts send path
  names both heartbeats in `src/pulse/tripwires.mjs`, and the 5-minute backup circuit (`pulse:runner-stale`,
  `src/pulse/instant-watch.mjs`) reads both receipts and names the shift that stopped. Catalog row added
  (`function:pulse-hourly-b`).
- `npm run pulse:prove -- --beats` builds both shift functions, checks every beat is in exactly one shift and each
  function runs exactly its shift, then runs each shift on its own (its own 22 s budget, 13 s window, three boxes),
  with every old guard per shift. It prints `box time used` for each shift.

Measured after the split (Mac load average 60 to 90 during these runs, so the numbers run high):

| Shift | Beats | Plain, 3 runs | 120 ms delay, 2 runs | Live estimate (p90) |
|---|---|---|---|---|
| pulse-hourly (:07) | 10 | 13 to 17 s of 39 s (33 to 45%), run 6 to 8 s | 23 to 25 s (60 to 64%), 0 cut | about 18 s (47%) |
| pulse-hourly-b (:37) | 16 | 10 to 14 s of 39 s (26 to 35%), run 4 to 6 s | 27 to 28 s (69 to 72%), 0 cut | about 16 s (41%) |

Each shift has about 20 s of box time free: room for the ~12 beat groups on the way (about 15 to 25 s in all).

**For anyone adding a beat:** append it to `BEAT_FILES` as before, then add its id to the shift in
`src/pulse/beats/shifts.mjs` with the most room (the prove prints each shift's box time). Keep beats that break from
one cause in the same shift. Until it has a shift, `shifts.test.mjs` and the ship proof fail.

Leftover (not done here): the 120 ms delay proof shows `apply-links` red at "pick" because the 2 s prefetch cannot
load the 990 saved bank links through the delayed proof connection. That was true before the split too.

## Fix 4 — built 2026-10-21 (four hourly shifts)

43 beats once W5, W6 and W7 landed. Asked for a third shift; measured that three are not enough for the 120 ms
read-delay proof, so there are four, a quarter hour apart. Same runner, same guards, every beat in exactly one shift.

| Shift | Minute | Beats |
|---|---|---|
| pulse-hourly | 7 | apply-links, bank-links, bank-outreach, funding-trip, money-funding, money-operations, money-tasks, partner-pages, partner-trip |
| pulse-hourly-d | 22 | brief-link, customer-records, doors-live, engine-alive, invoice-checkout-retirement, invoice-notice-recovery, pipeline-boards, pipeline-facts, roadmap-delivery, roadmap-pages, soft-pull |
| pulse-hourly-b | 37 | auth-links, call-bookings, checkout-doors, client-portal, consent-capture, db-health, lead-handoff, lead-pipe, money-alerts, money-checkout, pay-links, pay-webhook |
| pulse-hourly-c | 52 | blueprint-delivery, built-funnels, contract-signing, email-path, inquiry-trip, message-health, native-push, repair-trip, text-path, vendor-keys, whop-billing |

Why four, in numbers (sum of each beat's own time; each shift has 39 s):

- Normal run estimate (live p90 for the 21 live beats, the builders' unloaded Mac times for the 22 new ones): 66.6 s in
  all. Three shifts would be 57% each, four are 43% each.
- 120 ms delay (this Mac): about 114 s in all. Three shifts hold 117 s (97% even if perfectly packed; a three-shift run
  cut 4 beats: text-path, whop-billing, pipeline-boards, repair-trip). Four hold 156 s (73%).

Per shift (estimate normal / measured delay / when the last beat ends with 3 workers):

| Shift | Normal estimate | Delay estimate | Measured normal (3 bundle runs) | Measured 120 ms (2 runs) |
|---|---|---|---|---|
| pulse-hourly | 18.3 s (47%) | 27.2 s (70%) | 10.9 to 11.6 s (28 to 30%) | 22.3 to 22.9 s (57 to 59%) |
| pulse-hourly-b | 18.3 s (47%) | 29.5 s (76%) | 9.1 to 19.9 s (23 to 51%) | 28.8 to 30.1 s (74 to 77%) |
| pulse-hourly-c | 12.3 s (31%) | 28.0 s (72%) | 8.2 to 11.5 s (21 to 29%) | 27.5 s (70%) |
| pulse-hourly-d | 17.6 s (45%) | 29.2 s (75%) | 10.6 to 14.8 s (27 to 38%) | 25.1 to 26.2 s (64 to 67%) |

All 5 proofs OK (load 25 to 125). Heavy-load proof (`--slow-apply-links=10500 --read-delay=120`) OK, 66 to 85%.
Room for W8 (~6 to 8 s): every shift has at least 20 s free in a normal run; put W8's beats in pulse-hourly-c first
(most room), then pulse-hourly-d.

Same-cause beats stay together: messages (text-path, email-path, vendor-keys, message-health) in C; banks plus
funding and partner money (apply-links, bank-links, bank-outreach, money-funding, funding-trip, partner-trip,
partner-pages) in A; lead pipe (lead-pipe, lead-handoff, call-bookings), checkout (money-checkout, checkout-doors,
pay-links, pay-webhook) and sign-in (auth-links, client-portal) in B; roadmap (soft-pull, roadmap-delivery,
roadmap-pages) and pipeline (pipeline-boards, pipeline-facts) in D; trips (repair-trip, inquiry-trip) in C.

Known, not a shift problem: pipeline-boards makes about 25 reads. At 120 ms per round trip it uses its own time budget
and skips its count-true and dead-stage steps (green, 9.0 s, with skips). Fewer reads in that beat would fix it.

`PENDING_SHIFT_BEATS` (src/pulse/beats/shifts.mjs) is empty now; a beat whose file has not landed can wait there with
its shift, and the test names the shift when it lands.
