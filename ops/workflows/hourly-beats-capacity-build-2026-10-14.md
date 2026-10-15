# Hourly beats capacity build — 2026-10-14

## Goal

Make all 15 hourly beats run honestly within capacity by starting each beat's deadline when that beat starts and spreading beats across three read-only database connections.

## Shared rules

- Branch published for review: `codex/heartbeat-tripwire-repair-2026-10-13`
- No merge, deploy, push to `main`, live database write, weakened beat, removed beat, or raised deadline.
- Claude tests the draft PR after Codex hands it off.

## Parallel workflows

### Workflow 1 — runner change

Status: complete

Prompt:

> In `/private/tmp/fundhub-heartbeat-capacity-20261014`, inspect the hourly beat runner and read-box code. Implement the smallest clean change that starts each beat's deadline when that beat starts and spreads all beats across exactly three read-only connections. Keep every beat, deadline, self-test, fail path, and write refusal intact. Add focused pass/fail tests. Do not edit docs, manifests, screens, unrelated files, or use a live database. Report files and commands.

### Workflow 2 — capacity and safety proof

Status: complete

Prompt:

> In `/private/tmp/fundhub-heartbeat-capacity-20261014`, independently review the hourly capacity code and tests without editing implementation files. Identify the exact tests needed to prove three read-only connections, per-beat deadline start, 120 ms artificial read delay, true failures still red, and write probes still refused. Report concrete gaps and commands. Never connect to a live database.

### Workflow 3 — integration and handoff

Status: complete

Prompt:

> Integrate the smallest safe implementation, run focused tests, three consecutive beat proofs, lint, TypeScript, and relevant unit tests without a live database. Write `ops/workflows/codex-build-manifest-capacity-2026-10-14.md`, commit, push one review branch, open one draft PR, and stop for Claude.

## Ownership

- Workflow 1: implementation agent
- Workflow 2: read-only audit agent
- Workflow 3: this session

## Evidence log

- 2026-10-14: latest `origin/main` merged into the isolated worktree without conflicts.
- 2026-10-14: runner opens exactly three read-only boxes and assigns the 15 beats round-robin to three sequential lanes. Each beat context and deadline begins only when that lane starts the beat.
- 2026-10-14: focused pulse suite passed 159 tests with 0 failures and 0 skips. Independent safety review found no race or read-only regression.
- 2026-10-14: three normal bundle proofs and one proof with 120 ms added before every database read finished `OK`; each ran 15 beats with 0 deadline cuts, all beat times below half their deadlines, and all three boxes rolled back and were destroyed.
- 2026-10-14: the write probe passed both refusal walls with 0 commits. Lint parsed 3,561 files and inline scripts; TypeScript exited 0.
