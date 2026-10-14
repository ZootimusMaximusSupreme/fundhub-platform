# Codex hourly-capacity follow-up manifest — 2026-10-14

Review branch: `codex/pr48-hourly-capacity-followup-2026-10-14` (draft PR; never `main`)

Source: tag `archive/pr48-hourly-capacity-71d7727ff` at `71d7727ff`. The review findings were read from `origin/main`; `main` was not merged into this branch. No screen, route, product feature, beat, beat deadline, send path, secret, database writer, or live data changed.

## The five findings

### 1. One shared queue with three workers

- `src/pulse/runner.mjs` now has up to three workers. Each worker owns one read-only box and pulls the next beat from one shared queue.
- A beat's own deadline still starts when a worker starts it. A 10.5-second first beat holds only one worker; the other workers finish the rest.
- A worker whose box failed reports one honest beat-level database failure and then leaves the queue to healthy workers. If every box failed, the workers still finish the queue so every unreadable beat stays red.

### 2. Whole-database-down text only when every box failed

- `src/pulse/runner.mjs` now passes `dbDown: !dbUp || boxProblems.every(Boolean)` to the alert decision.
- One failed box stays one named beat failure. It no longer says the whole database is down.

### 3. Open no more boxes than beats

- `src/pulse/runner.mjs` opens `Math.min(READ_BOX_COUNT, list.length)` boxes.
- `scripts/pulse/prove.mjs` expects the same dynamic count. The one-beat outside watch therefore opens one box, not three.

### 4. Always close every opened box

- `src/pulse/runner.mjs` wraps box setup and the full beat phase in `try/finally`.
- Every box that opened is rolled back and destroyed in the `finally`. A box that opens after its open timeout has its own late-close callback.

### 5. Delay every database round trip in the proof

- `scripts/pulse/prove.mjs` routes every hourly-proof query through one `queryRoundTrip` wrapper. The artificial delay now covers transaction setup, settings checks, savepoints, reads, releases, rollback-to-savepoint, read-box close checks, and final rollback.
- Normal proofs keep the strict under-half-deadline headroom rule. Artificial-delay stress runs judge real beats against their full unchanged deadlines because the delay is deliberately added to every round trip. Cuts, actual deadline failures, SQL refusals, leaks, sends, and writes still fail. There is no beat-specific exception.
- `--slow-apply-links=10500` replaces only that beat's run with a declared-step 10.5-second capacity fixture while keeping all 15 listed beats in the run. It must last at least 10.5 seconds and stay below the unchanged 12-second deadline.

## The three missing tests

- `src/pulse/runner.test.mjs`: one of three boxes fails with eight beats — exactly one beat is red, seven are green, and the text does not say the database is down.
- `src/pulse/runner.test.mjs`: the first beat takes a literal 10.5 seconds — all 15 beats finish and none is cut.
- `src/pulse/runner.test.mjs`: a planned crash after three workers are active — active work is aborted, queued work and late reads stay stopped, and every opened client rolls back and is destroyed.

The same file also proves a one-beat run opens one box and that a queued beat never starts after the shared phase closes. `scripts/pulse/prove-policy.test.mjs` pins the one delayed query path, dynamic box count, full-list slow fixture, unchanged deadlines, and absence of a `money-funding` exception.

## Documentation and connection ceiling

- `docs/journeys/heartbeat-flow.md` now describes the shared queue, up-to-three boxes, deadline start, and guaranteed cleanup.
- `docs/journeys/CHANGELOG.md` records the actual heartbeat behavior change.
- One production hourly invocation uses the shared pool capped at 10 connections; three are held by read boxes. The proof uses a three-connection box pool plus at most two direct read clients. Both stay below 40 of the available 60 connections.

## Exact checks and results

- `node --test src/pulse/runner.test.mjs src/pulse/beats/readbox.test.mjs src/pulse/beats/ctx.test.mjs src/pulse/beats/contract.test.mjs src/pulse/beats/beats.test.mjs scripts/pulse/prove-policy.test.mjs` — 172 passed, 0 failed, 0 skipped.
- Independent review: `node --test src/pulse/runner.test.mjs src/pulse/beats/readbox.test.mjs scripts/pulse/prove-policy.test.mjs` — 94 passed, 0 failed, 0 skipped.
- `npm run lint` — 3,561 files and inline scripts parsed cleanly.
- `env -u DATABASE_URL npx --no-install tsc --noEmit` — exit 0.
- `env -u DATABASE_URL npm test` — exit 0; unit runner exit 0; Postgres runner exit 0 with 83 passed, 0 failed, and 1,005 expected skips because `DATABASE_URL` was unset. This command could not reach any database.
- `node --env-file=.env scripts/pulse/prove.mjs --beats` run 1 — final `OK`; 15 beats, 3 honest existing reds, 0 cut, 6,582 ms; 3 boxes, no SQL errors/refusals/commits, all rolled back and destroyed, pool 0.
- The same command run 2 — final `OK`; 15 beats, 3 honest existing reds, 0 cut, 4,667 ms; 3 boxes, no SQL errors/refusals/commits, all rolled back and destroyed, pool 0.
- The same command run 3 — final `OK`; 15 beats, 3 honest existing reds, 0 cut, 5,981 ms; 3 boxes, no SQL errors/refusals/commits, all rolled back and destroyed, pool 0.
- `node --env-file=.env scripts/pulse/prove.mjs --beats --repo --slow-apply-links=10500 --read-delay=120` — final `OK`; 15 beats, 3 honest existing reds, 0 cut, 14,295 ms; apply-links 10,501 ms; 3 boxes, 43 reads, 0 errors/refusals/commits, all read-only at close, rolled back and destroyed, pool 0.
- Final production-bundle acceptance after the mid-run cleanup fix: `node --env-file=.env scripts/pulse/prove.mjs --beats --slow-apply-links=10500 --read-delay=120` — final `OK`; 15 beats, 3 honest existing reds, 0 cut, 15,106 ms; apply-links 10,502 ms; 3 boxes, 43 reads, 0 errors/refusals/commits, all read-only at close, rolled back and destroyed, pool 0.
- `git diff --check` — passed.

The three real reds stayed visible: `brief-link` found the newest sent text was stale; `email-path` found three missing email template ids; `text-path` found two missing SMS template ids. They are existing business-state failures, not capacity failures, and this branch did not repair or hide them.

## Plainly not finished

- Claude has not yet tested this branch from a clean checkout.
- Nothing was merged, deployed, or pushed to `main`.
- The post-ship live hourly run was not run because this task stops before deploy.
- The three existing business-state reds above were not repaired; they are outside this capacity repair.
- The acceptance proofs did read the configured production database, but only inside `BEGIN READ ONLY`; they made no production database write or cleanup. No insert, update, delete, charge, message, email, AI call, Plaid call, event, or live send was run. Web proof used GET/HEAD and message proof used fake sinks.
