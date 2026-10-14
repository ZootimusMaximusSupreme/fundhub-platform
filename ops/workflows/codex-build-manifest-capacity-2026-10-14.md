# Codex hourly-beats capacity manifest — 2026-10-14

Review branch: `codex/heartbeat-tripwire-repair-2026-10-13` (draft PR; never `main`)

Base: `origin/main` at `b70570cfc`. Work was built in the isolated worktree `/private/tmp/fundhub-heartbeat-capacity-20261014`; current `origin/main` was merged without conflicts before the change. No product feature, beat, deadline, screen, route, customer behavior, dependency, secret, send path, database write, deploy file, or live data was added or changed.

## What changed

### 1. Each beat's deadline starts when that beat starts

- Changed `src/pulse/runner.mjs` so a queued beat does not create its context or enter `runBeat` until its lane reaches it. Its existing `deadlineMs` therefore starts when the beat starts, not while it waits behind earlier reads.
- A closed 13-second phase prevents a still-queued beat from starting after the phase ends. An already-running beat is still reported honestly as cut when the phase ends.
- Added focused tests in `src/pulse/runner.test.mjs` for a delayed 15-beat run, a measured break that must remain red, and a queued same-lane beat that must never start after the phase cut.

### 2. Fifteen beats run across three read-only connections

- Changed `src/pulse/runner.mjs` to open exactly three independent read boxes concurrently and assign beats round-robin to three sequential lanes. Each box still executes `BEGIN READ ONLY`, verifies read-only mode, rolls back, and destroys its connection. No box commits.
- Kept `out.box` backward compatible as one aggregate report and added its three underlying reports for exact safety proof.
- Updated `src/pulse/beats/beat-db-health.mjs`, `docs/journeys/heartbeat-flow.md`, and `docs/journeys/CHANGELOG.md` to describe the three read-only lanes.

### 3. The proof has a real-network capacity check

- Changed `scripts/pulse/prove.mjs` to accept `--read-delay=120`, applied before every extended-protocol beat read.
- The proof now requires exactly three boxes, every beat under half its existing deadline, every box read-only/rolled back/destroyed, zero commits, and zero connections left in the proof pool.
- The existing write-refusal probe was not weakened. A real measured failure remains red.

### 4. Shared work record

- Added `ops/workflows/hourly-beats-capacity-build-2026-10-14.md` with the approved workflow split, ownership, and evidence.
- Added this manifest.

## Exact proof commands and results

- `node --test src/pulse/runner.test.mjs src/pulse/beats/readbox.test.mjs src/pulse/beats/ctx.test.mjs src/pulse/beats/contract.test.mjs src/pulse/beats/beats.test.mjs` — 159 passed, 0 failed, 0 skipped.
- `npm run lint` — 3,561 files and inline scripts parsed cleanly.
- `npx tsc --noEmit` — exit 0.
- `npm run pulse:prove -- --beats` run 1 — final `OK`; 15 beats, 3 real reds, 0 deadline cuts, 10,825 ms; 3 boxes, 44 reads, 0 SQL errors, 0 refused reads, 0 commits, all rolled back and destroyed, pool 0.
- `npm run pulse:prove -- --beats` run 2 — final `OK`; 15 beats, 3 real reds, 0 deadline cuts, 9,991 ms; 3 boxes, 44 reads, 0 SQL errors, 0 refused reads, 0 commits, all rolled back and destroyed, pool 0.
- `npm run pulse:prove -- --beats` run 3 — final `OK`; 15 beats, 3 real reds, 0 deadline cuts, 9,686 ms; 3 boxes, 44 reads, 0 SQL errors, 0 refused reads, 0 commits, all rolled back and destroyed, pool 0.
- `npm run pulse:prove -- --beats --read-delay=120` — final `OK`; 15 beats, 3 real reds, 0 deadline cuts, 11,524 ms; every beat under half its deadline; 3 boxes, 44 reads, 0 SQL errors, 0 refused reads, 0 commits, all rolled back and destroyed, pool 0.
- `node scripts/pulse/run-beat.mjs --probe` — `PASS`; the first wall refused all 14 write-shaped statements before they were sent; Postgres refused the zero-row INSERT, UPDATE, DELETE, temporary table, and read-mode changes with read-only transaction errors; 0 commits; rolled back and destroyed.
- `env -u DATABASE_URL npm test` — exit 0; unit runner exit 0, Postgres runner exit 0; Postgres section 83 passed, 0 failed, and 1,005 expected no-database skips. The run used no `DATABASE_URL` and did not connect to a database.
- `git diff --check` — passed.

The three real red results were not hidden or changed: `brief-link` found a stale latest sent text; `email-path` found three missing email template ids; `text-path` found two missing SMS template ids. They are existing business-state failures, not capacity or deadline failures.

## Plainly not finished

- Claude has not yet tested this branch from a clean checkout.
- Nothing was merged, deployed, or pushed to `main`.
- The post-ship live hourly check was not run because this task explicitly stops before deploy.
- The three real business-state reds above were not repaired; that is outside this capacity change.
- No production data cleanup or database test was run. The proof paths were read-only and the explicit write probe verified refusal; no live row was changed.
