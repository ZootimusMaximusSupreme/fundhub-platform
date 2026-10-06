# Marketing machine build — board (spec v3)

Spec: `docs/specs/marketing-machine-2026-10-04.md` (approved by Chris, §17 all defaults).
Goal (Chris, 2026-10-05): "use the dashboard to run marketing, not Claude Code."
Finish line: spec §15 (Monday batch → approve on phone → Shoot Day → videos cut and captioned → Load all approved → numbers next morning).

Board rule (spec §0.3): only the main session (orchestrator) writes this board. Workers report claim, change manifest and blockers in their final message.
Models (owner order 2026-10-05): Opus builds, Fable reviews and polishes.

## Already done before this board (2026-10-05 batches, live on main 96be0809)

- Command Center page, Today view, Write ad copy, Write offer (M10, M11, M12; migration 409 `marketing_jobs`, seed 296).
- Ad numbers by ad set + name, roadmap lane, Meta purchases / link clicks / landing page views saved (migrations 406–408).
- Report tie-out (Arizona days), dying-ad buzz, next-take table, ClickFunnels night job, heartbeat machine checks, take joiner (M6), Meta event fixes.

## Lanes and migration numbers (spec §0.5)

| Lane | Builds | Migration numbers |
|---|---|---|
| A | M0, M1 back end, M2 back end | 410–415 (406–409 used today) |
| B | M3, M4 back ends | 416–423 |
| C | CI fix (M0 step 6), M6a, M6b | none |
| D | M5, M7, M8 back ends | 424–429 |
| E | every screen | none |

Note: production also holds migrations 430–433 from another session (files not in this repo). Do not use 430+.

## Wave 0 (running)

| Id | Work | Status |
|---|---|---|
| C1 | CI fix (M0 step 6): fresh database builds, unit suite green, pg suite runs and blocks | claimed |
| G | Ground: map M0–M5 + Command Center tabs against the repo; plan units; Fable critique | claimed |

## Units (filled in from the plan)

## Blockers / only-Chris items (spec §16)

- The intended journey `docs/journeys/marketing-machine-intended.md` was approved in the archived chat but never committed. A hook blocks agents from writing `*-intended.md`.

## Change manifests
