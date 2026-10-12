# Heartbeat alignment — 2026-10-11

## Task list

| Workflow | Owner | Status |
|---|---|---|
| Heartbeat implementation map | This session | done |
| Rules and journey map | Pending parallel workflow | pending |
| Confirmed mismatch summary | Pending parallel workflow | pending |

## Shared context brief

User asks whether the repository heartbeat work is present and whether we are aligned on how it works. This is discovery only. No product code changes are authorized.

## Change manifests

_To be added by each workflow._

## Blockers and open questions

_None recorded._

## Implementation map — Workflow 1

### Main pieces

- `src/pulse/heartbeats.mjs` lists 35 Inngest jobs and 9 Netlify jobs. A job is late after 3 times its schedule. The reader only reports; it does not restart jobs.
- `src/pulse/registry.mjs` holds the page and route ping registry. Current exported registry count: 397.
- `src/pulse/tripwires.mjs` sorts surfaces into customer-facing deep checks or documented internal/non-customer-facing items.
- `src/pulse/coverage/modules.mjs` is the literal import list for deep coverage lanes.
- `src/pulse/beats/index.mjs` loads 10 hourly beat files. The beats are read-only and are guarded by `src/pulse/beats/beats.test.mjs`.
- `netlify/functions/pulse-hourly.mjs` runs the hourly read-only pulse at minute 7 and records the `pulse-hourly` job heartbeat.
- `netlify/functions/pulse-outside-watch.mjs` runs only `engine-alive` every 5 minutes and records the `pulse-outside-watch` heartbeat.
- `src/workflows/client.mjs` attaches both `Job heartbeat` and `Run evidence` middleware to the shared Inngest client.
- `src/pulse/self-audit.mjs` checks that the morning manifest is complete, lanes finish, N/A claims remain true, workflow receipts work, and the morning report was sent.
- `src/pulse/workflow-runs.mjs` reads event-workflow receipts from `workflow_runs`.
- `src/pulse/daily-pulse.mjs` and `src/workflows/daily-pulse.mjs` run the 6 a.m. coverage and audit path.

### Schedule wiring

- `src/workflows/index.mjs` registers the daily pulse at `TZ=America/Phoenix 0 6 * * *`.
- `netlify.toml` registers `pulse-hourly` at `7 * * * *` and `pulse-outside-watch` at `*/5 * * * *`.
- The matching `SWEEP_CRON` constants are checked by focused tests.

### Verification

Ran:

`node --test src/pulse/heartbeats.test.mjs src/pulse/pulse-hourly.test.mjs src/pulse/pulse-outside-watch.test.mjs src/pulse/heartbeat-law.test.mjs src/pulse/beats/beats.test.mjs`

Result: 62 tests passed, 0 failed, 0 skipped.

### Scope note

This confirms the heartbeat machinery and its focused guards are present and internally aligned. It does not prove the live Netlify/Inngest schedules are currently firing, and it does not prove every business surface has a deep check. Those need live pulse proof and the separate coverage inventory.
