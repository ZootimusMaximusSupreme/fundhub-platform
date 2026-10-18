# Automations page recovery — 2026-10-18

Owned by the original `/root/page_automations` builder. Isolated branch `codex/recover-automations` starts at exact base `0998ff49969c6e2663a6e1851b4634ab5896113d`. No retained implementation was found on the assignment branch; this is fresh source work after the original runtime disconnected.

Source: `f05455d345adf8953ac1bea2a693ea8ede7664a7`.
Focused test: `e1fa0ddc58ead25e2af1f5d2b9317a4786ff959e`.

## Feature matrix

| Contract | Before | After |
| --- | --- | --- |
| Registry data | GET /api/read/workflows?limit=200, bearer fh_token | Same request, token and response shape |
| Role/access | Shared shell owns session/navigation; 401/403 registry errors | Shared shell/aside retained; same denial handling |
| Workflows | Category groups, original order, five status values | Same groups and values; readable row spacing |
| Metrics | Exact registry total, can_start_today false count, trigger_seen count | Same calculations; errors clear stale metrics to unknown |
| Details | Row click, Enter and Space expand start conditions and registry data | Same controls; raw registry data uses native disclosure within expanded panel |
| Filter | Rail select hides other groups | Same selection behavior, disabled until ready |
| Timer/start distinction | Signals cannot establish execution/completion | Limitation retained; no completion/engine-health claims |
| Empty/loading/error | Loading text, empty text, error without retry | Sized loading panel; honest empty message; safe read-only Refresh |
| Phone | Narrow table with page-level horizontal scroll | Stacked labeled workflow rows; long event names wrap |
| Actions | Read-only page; no activation, scheduling or sending | Read-only Refresh only; no new write path |
| Shared files | Sidebar, shell.js, brand/sidebar imports | Aside byte-identical; shared imports and files untouched |

The duplicate dark wordmark/clock/LIVE strip and internal version/org footer were removed. The page now has a task intro, one black Refresh action, neutral metrics, the registry filter, grouped workflows and secondary diagnostics. Shared chrome remains the lead's responsibility.

## Verification status

Source was read before editing, including AGENTS.md, relevant CLAUDE notes, UI-STANDARDS.md, original assignment prompt/manifest and the lead live-font checkpoint. Owner-approved visual direction supersedes old visual rules as stated in the assignment.

In-memory source inspection confirmed that the original aside is byte-identical and the only fetch in the page remains the existing workflow GET. These are source checks, not browser proof.

Focused spec `e2e/automations-layout.spec.mjs` contains 13 cases: full/empty/loading/error at 1440,390,320; five status values; GET/token/limit; row Enter/Space and native details; rail filter; refresh; unknown versus zero; partial registry notice; unauthorized refusal. All API requests are intercepted by the existing test harness. API writes are collected and asserted absent.

**Unrun by this builder:** browser checks, lint, TypeScript, full regressions, screenshots and live account testing. The original executor is offline. Lead runs fresh browser checks through GitHub Actions after integration; no pass is claimed here. No live write, schedule, send or deployment occurred.

## Risk and next

Main risk is interaction between page layout and the current shared shell at phone widths; this needs actual integrated render proof. No API/schema/security changes. Existing registry limitations remain: data covers start signals only, and more-than-200 registry pagination is reported but unchanged.

Next: lead integrates the focused spec and runs the combined safe cloud proof, then marks actual rendered screenshot issues before any review or publication claim.
