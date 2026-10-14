# PR #48 hourly capacity follow-up — 2026-10-14

## Goal

Repair the five review findings from `ops/workflows/pr48-review-findings-2026-10-14.md`, add the three missing tests, and hand one draft PR to Claude from the archive tag `archive/pr48-hourly-capacity-71d7727ff`.

## Rules

- Review branch: `codex/pr48-hourly-capacity-followup-2026-10-14`.
- No merge, deploy, push to `main`, live database write, removed beat, raised deadline, weakened test, screen change, or new product feature.
- Every read box remains `BEGIN READ ONLY`, rolls back, and is destroyed.
- Claude tests the draft PR from a clean checkout next.

## Shared context

- The archive tag already contains the first capacity repair.
- The review file was added after the tag and was read from current `origin/main`; it is not merged into this branch.
- Required runner fixes: one shared beat queue with three box-owning workers; database-down text only when every box fails; open no more boxes than beats; close every opened box through `try/finally`.
- Required proof fix: `--read-delay` delays every database round trip, including read-box transaction and savepoint statements.
- Required tests: one box-open failure does not claim the whole database is down; a 10.5-second first beat does not cut the other beats; a mid-run crash closes every opened box.

## Workflows

### Workflow 1 — runner and runner tests

Owner: runner agent

Status: complete

Files: `src/pulse/runner.mjs`, `src/pulse/runner.test.mjs`

Prompt:

> From tag `archive/pr48-hourly-capacity-71d7727ff` on branch `codex/pr48-hourly-capacity-followup-2026-10-14`, fix the shared three-worker queue, database-down rule, box count, and `try/finally` cleanup. Add the runner tests named in Claude's review. Do not touch proof, docs, manifests, git, live data, or other files. Keep all boxes read-only and every real failure red. Record exact files and tests on the shared board.

### Workflow 2 — delayed proof

Owner: proof agent

Status: complete

Files: `scripts/pulse/prove.mjs` and its existing direct test file only

Prompt:

> From tag `archive/pr48-hourly-capacity-71d7727ff` on branch `codex/pr48-hourly-capacity-followup-2026-10-14`, make `--read-delay` delay every database round trip, including transaction, verification, savepoint, release, rollback, and runner read statements. Update the proof's expected box count to `min(3, beat count)`. Add the smallest direct test for this behavior. Do not touch runner, docs, manifests, git, live data, or other files. Record exact files and tests on the shared board.

### Workflow 3 — independent review

Owner: review agent

Status: complete

Scope: read-only

Prompt:

> Read Claude's PR #48 findings from current `origin/main`, then inspect the finished runner and proof diffs after the other agents report. Verify all five findings and three missing tests are covered, the pool worst case stays below 40 of 60, and no read-only wall or honest red result was weakened. Do not edit app code. Record gaps and commands on the shared board.

### Workflow 4 — integration and handoff

Owner: this session

Status: complete

Work: integrate, run focused and full checks, run three normal proofs plus slow-first and delayed proofs, write `ops/workflows/codex-build-manifest-capacity-2-2026-10-14.md`, commit, push one review branch, open one draft PR, and stop for Claude.

## Evidence log

- 2026-10-14: isolated worktree created directly from `archive/pr48-hourly-capacity-71d7727ff` at commit `71d7727ff`.
- 2026-10-14, Workflow 2: changed `scripts/pulse/prove.mjs` so `--read-delay` wraps every database query round trip in the hourly proof (setup, settings verification, savepoints, beat and runner reads, releases, rollback-to-savepoint, and final rollback). The expected read-box count is now `min(READ_BOX_COUNT, selected beat count)`. Added a direct source guard in `scripts/pulse/prove-policy.test.mjs` that fails if any hourly proof database query bypasses the delayed wrapper or the dynamic box-count rule disappears. `node --test scripts/pulse/prove-policy.test.mjs`: 8 passed, 0 failed, 0 skipped. `node --check scripts/pulse/prove.mjs`: passed. No live proof or database write was run by this workflow.
- 2026-10-14, Workflow 2 initial follow-up: added `--slow-apply-links=10500`, which keeps the full loaded beat list and replaces only `apply-links` with a deterministic declared-step fixture. Its timing must be at least the requested hold and below its unchanged deadline. The first run kept the normal under-half timing rule during artificial delay and honestly exited 1 because `money-funding` took 5,030 ms after 30 delayed round trips, above half of its unchanged 9,000 ms deadline. The later reviewer follow-up below replaced that synthetic-margin mistake with the unchanged real deadline for every real beat during artificial-delay stress; normal proofs still require half-deadline headroom.
- 2026-10-14, Workflow 2 investigation: a sandboxed local proof stopped after the cold-load line with exit 0 because the configured Supabase host failed DNS lookup (`getaddrinfo ENOTFOUND aws-1-us-west-2.pooler.supabase.com`) and `prove.mjs`'s global `uncaughtException` listener swallowed the rejected top-level await. The same listener is present in archive tag `archive/pr48-hourly-capacity-71d7727ff`, so this is not caused by this branch and was not changed.
- 2026-10-14, Workflow 2 reviewer follow-up: normal proof runs still require every beat to finish under half its unchanged deadline. When `--read-delay` is nonzero, all real beats use their full unchanged deadline because the proof is deliberately adding latency to every transaction, savepoint, read, release, and rollback. The built-in single fixture keeps the normal half-deadline rule, and the injected slow apply-links beat keeps its own lower-bound, proof-detail, and unchanged full-deadline guards. There is no money-funding or other beat-specific exemption. `node --test scripts/pulse/prove-policy.test.mjs`: 10 passed, 0 failed, 0 skipped. `node --check scripts/pulse/prove.mjs`: passed. `git diff --check -- scripts/pulse/prove.mjs scripts/pulse/prove-policy.test.mjs`: passed.
- 2026-10-14, Workflow 2 combined acceptance: `node --env-file=.env scripts/pulse/prove.mjs --beats --repo --slow-apply-links=10500 --read-delay=120` exited 0 with `OK`: 15 beats, 3 honest existing reds, 0 cut, 14,295 ms total; apply-links 10,501 ms; 3 boxes, 43 reads, 0 errors/refusals/commits, all read-only at close, rolled back, destroyed, and pool 0. `money-funding` was 4,981 ms against its unchanged 9,000 ms deadline; `money-operations` was 5,252 ms against its unchanged 12,000 ms deadline. No message was sent and no database write was attempted.
- 2026-10-14, Workflow 1: changed `src/pulse/runner.mjs` to use one shared beat queue with up to three box-owning workers, open `min(3, beat count)` boxes, report the database down only when prefetch is down or every box failed, and close every opened box through `try/finally`. Changed `src/pulse/runner.test.mjs` with the three missing cases: one failed box remains a beat-level red, a literal 10.5-second first beat does not cut the other 14 beats, and a planned crash after box opening still rolls back and destroys all three clients. Updated the old fixed-lane cut test for the shared queue and asserted one beat opens one box. `node --check src/pulse/runner.mjs && node --check src/pulse/runner.test.mjs`: passed. `node --test src/pulse/runner.test.mjs`: 56 passed, 0 failed, 0 skipped. `node --test src/pulse/runner.test.mjs src/pulse/beats/readbox.test.mjs src/pulse/beats/contract.test.mjs`: 117 passed, 0 failed, 0 skipped. `git diff --check -- src/pulse/runner.mjs src/pulse/runner.test.mjs`: passed. No live database or provider was used.
- 2026-10-14, Workflow 1 review follow-up: a worker whose box failed now runs at most its first assigned beat when another box is healthy, then exits so it cannot drain the shared queue into false reds. When every box failed, all workers still drain the queue so every unreadable beat stays honestly red. Strengthened the partial-open test to eight beats with delayed healthy workers: exactly one red, seven green, and no whole-database-down text. Re-ran `node --test src/pulse/runner.test.mjs`: 56 passed, 0 failed, 0 skipped. Re-ran `node --test src/pulse/runner.test.mjs src/pulse/beats/readbox.test.mjs src/pulse/beats/contract.test.mjs`: 117 passed, 0 failed, 0 skipped. `node --check` and `git diff --check` passed.
- 2026-10-14, Workflow 1 final review follow-up: replaced the setup-only crash proof with an injected crash after all three workers have active beats. `runPulse` now closes the phase, cancels its timer, and aborts every active harness before the `finally` block closes the boxes. The test proves all three boxes roll back and are destroyed, the queued fourth beat never starts, no extended-protocol read reaches a closed box after return, and no late rejection is unhandled. `node --check src/pulse/runner.mjs && node --check src/pulse/runner.test.mjs`: passed. `node --test src/pulse/runner.test.mjs`: 56 passed, 0 failed, 0 skipped. `node --test src/pulse/runner.test.mjs src/pulse/beats/readbox.test.mjs src/pulse/beats/contract.test.mjs`: 117 passed, 0 failed, 0 skipped. `git diff --check -- src/pulse/runner.mjs src/pulse/runner.test.mjs`: passed.
- 2026-10-14, Workflow 3 independent verdict: PASS, no open review gap. The shared queue has up to three box-owning workers; a slow first beat cannot hold a fixed row behind it. `dbDown` is true only when prefetch failed or every requested box failed. Box count is `min(3, beat count)`. The protected runner region closes every successfully opened box in `finally`, while a box that opens after its timeout has its own late-close callback. The proof's delay wrapper is the only direct query path inside `proveBeats`, so setup, settings, savepoint, read, release, rollback-to-savepoint, read-box, and final rollback queries all receive the delay. The three requested tests are present and exercise eight-beat partial-open recovery, a literal 10.5-second first beat with all later beats finishing, and cleanup after a planned crash following box opening. The read-only wall was not weakened: the read-box tests still prove `BEGIN READ ONLY`, no commit, rollback, and destroy. Pool ceiling is below the requested 40 of 60 for one hourly invocation: the production shared pool is hard-capped at 10 connections (three are held by boxes), and the proof uses a three-connection box pool plus at most two direct clients. Independent command `node --test src/pulse/runner.test.mjs src/pulse/beats/readbox.test.mjs scripts/pulse/prove-policy.test.mjs`: 94 passed, 0 failed, 0 skipped. `node --check src/pulse/runner.mjs`, `node --check scripts/pulse/prove.mjs`, and `git diff --check`: passed. No live database, provider, deploy, merge, or Git write was used by this review.
- 2026-10-14, Workflow 4 integration: focused suite 172 passed, 0 failed, 0 skipped; lint parsed 3,561 files and inline scripts; TypeScript exited 0; `env -u DATABASE_URL npm test` exited 0 with both runners green and no database connection; three normal bundled proofs were `OK` in a row; the final bundled 10.5-second apply-links plus 120 ms every-round-trip proof was `OK` with all 15 beats, 0 cut, 14,419 ms, three read-only boxes, 43 reads, zero errors/refusals/commits, rollback/destroy true, and pool 0. Journey docs and the required manifest were updated. Git push and draft PR are the remaining handoff actions.
- 2026-10-14, final cleanup follow-up: the crash test now throws only after all three workers have active beats. Runner cleanup first closes the shared phase, cancels the timer, and aborts unfinished harnesses, then rolls back and destroys every box. The test proves queued work never starts, late extended reads stay at zero, and no unhandled rejection appears. Final focused suite: 172 passed, 0 failed, 0 skipped. Final lint: 3,561 files and inline scripts parsed cleanly. Final TypeScript: exit 0. Final `env -u DATABASE_URL npm test`: unit exit 0 and Postgres exit 0 (83 passed, 1,005 expected no-database skips). Final production-bundle slow-plus-delay proof: `OK`, 15 beats, 0 cut, 15,106 ms, 3 boxes, 43 reads, zero errors/refusals/commits, read-only at close, rolled back/destroyed, pool 0.
