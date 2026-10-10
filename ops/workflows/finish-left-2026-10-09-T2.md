# T2 — workflow list tests (2026-10-09)

Branch: `fix/T2-2026-10-09`. Owner: builder T2. Status: done.

## What was wrong

Four tests were red. Each one counts the workflows the app runs.

| # | Test | File |
|---|---|---|
| 1 | the registry accounts for every registered workflow | `src/journeys/runner/index.test.mjs` |
| 2 | every workflow is either fired or named in neverFired | `src/journeys/runner/index.test.mjs` |
| 3 | the coverage report names every unreached workflow explicitly | `src/journeys/runner/index.test.mjs` |
| 4 | index serves exactly the workflows on disk, and the count is pinned | `src/workflows/index.test.mjs` |

## Root cause

Two workflows were switched on in `src/workflows/index.mjs` on 2026-10-07 and the
tests that pin the list were not moved with them.

1. `evening-brief` came in with `8cf8518a1` ("Turn the morning and evening briefs on").
   That commit added the id to `EXPECTED_WORKFLOW_IDS` in `src/workflows/index.test.mjs`.
   It did not move `REGISTERED` in `src/journeys/runner/index.test.mjs`.
2. `pulse-instant-watch` came in with `eee0270dd` ("Finish company pulse awareness").
   That commit moved neither pin.

Proof of the order (measured):

- At `17c9a2b54` (2026-10-06) the pinned id list held 98 ids and the runner pin was 98. They agreed.
- Now `functions.length` is 100. The pinned id list held 99 (it had `evening-brief`, not `pulse-instant-watch`). The runner pin was still 98.
- So test 4 failed on exactly one id (`pulse-instant-watch`), and tests 1 to 3 failed on 98 against 100.

Nothing in the code was wrong. Both new workflows are real and on purpose.
The pins are how a person writes down "yes, this job now runs in production".

## What changed (tests only, no product code)

- `src/workflows/index.test.mjs`: named `pulse-instant-watch` in `EXPECTED_WORKFLOW_IDS`, and added a history entry that says what it does and what it cannot do.
- `src/journeys/runner/index.test.mjs`: `REGISTERED` 98 to 100, with two history lines (98 to 99 for `evening-brief`, 99 to 100 for `pulse-instant-watch`).

I read both workflow files before writing the history lines.

- `pulse-instant-watch` (`src/workflows/pulse-instant-watch.mjs`, cron `*/5 * * * *`): runs `runInstantWatch` in `src/pulse/instant-watch.mjs`. It does GET requests on health, login, the client control panel (apply door) and the roadmap sales funnel, and reads the stuck-outbound count. If a critical check is red it texts Chris, once an hour per failure fingerprint, inside 6 a.m. to 10 p.m. Arizona only. Its only write is one `agent_runs` row per alert. It fixes nothing.
- `evening-brief` (`src/workflows/evening-brief.mjs`, cron `EVENING_BRIEF_CRON`): saves the 9 p.m. Arizona brief row through `runMorningBrief` with kind `evening`. It reuses this morning's systems check.

## How the journey runner classifies them

The runner has no hand-written fired / neverFired list. `neverFired` is computed in
`src/journeys/runner/registry.mjs` from whatever no walked journey reached. Both new
workflows are crons with no event trigger, so no journey can reach them and they land in
`neverFired`. That is the correct result for a scheduled job, and the same note every
other sweeper carries. Both export `handle()`, so `unrunnable` stays empty (the test
asserts that and passes).

## Proof

Run in this worktree (`node_modules` linked from the main checkout):

- `node --test src/workflows/index.test.mjs src/journeys/runner/index.test.mjs`: 30 tests, 30 pass, 0 fail, 0 skipped. All four target tests are green.
- Neighbours: `src/journeys/runner/*.test.mjs`, `src/pulse/instant-watch.test.mjs`, `src/pulse/heartbeats.test.mjs`, `src/pulse/tripwires.test.mjs`, `src/workflows/evening-brief.test.mjs`, `src/pulse/registry.test.mjs`: 99 tests, 98 pass, 1 fail. The one fail is not mine (see leftovers).
- `npm run lint`: 3217 files parse clean.
- No test was skipped, deleted or weakened. No product code changed. No database, no send, no live call.

## Leftovers (not fixed, not mine)

1. `src/pulse/registry.test.mjs` "registry: every registry row names a real handler or desk file" fails in this worktree only. `PULSE_REGISTRY` names `/leads/c01cb7592c8bb994130158e897e99bf1/`. That page is `public/leads/c01cb7592c8bb994130158e897e99bf1/index.html`. It exists in the main checkout but is not tracked by git (it is listed in `.git/info/exclude` as `public/leads/`), so a fresh worktree does not have it. It is a worktree artifact, not a real break. Not touched. If this registry row should point at a tracked file, that is a separate decision.
2. Repo-wide `npm test` was not run (the task named the four tests and the neighbours). I did not measure the full suite.
3. The history comment at the top of `src/workflows/index.test.mjs` says the list is "Sorted". It is not (for example `evening-brief` sits after `daily-pulse`, and `finance-os-*` ids are out of order). Not touched.
4. The runner pin and the id list can drift again the same way, because two files hold the same fact. A future commit that adds a workflow must move both. Nothing here changes that on purpose, since "registering a job is a visible decision" is what the pins are for.

## Journeys

No journey changed. No `-actual.md` edit and no changelog line are needed: this is a test pin, not a flow.
