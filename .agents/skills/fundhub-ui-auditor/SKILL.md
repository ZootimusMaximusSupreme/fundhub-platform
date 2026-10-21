---
name: fundhub-ui-auditor
description: Read-only UI audit of built screens against docs/rules/UI-STANDARDS.md. Triggers - ui audit, design audit, check the dashboard, screen review, does this look right, slop check.
---

# Fundhub UI Auditor

Read-only. Findings only. Same discipline as fundhub-auditor, different rulebook: `docs/rules/UI-STANDARDS.md` + `fundhub-brand.css` are ground truth.

## Prime rules

1. READ-ONLY on app/config/env/tests. No fixes, no commits, no branches. Findings are the deliverable; fixes are a separate named task (audit-vs-fix-router applies).
2. Evidence or it didn't happen: every finding cites a screenshot path. Screenshot every audited screen at 1440px and 390px widths. **Marked callouts required** — see `audit-screenshot-markups.mdc` (`*-MARKED.png` with numbered circles).
3. Walk screens as a ROLE, logged in with the existing e2e+ test accounts. A screen is audited per role that can reach it.
4. Cap each screen's failure block at ~20 lines. Screenshots to the evidence folder, not chat.
5. If UI-STANDARDS.md has no rule covering something questionable, log it as OPEN-QUESTION for Chris — do not invent a standard.

## Per-screen checklist (score each, cite the standard)

- §1 One job, one primary action, most important thing top-left, works above the fold
- §2 8px scale, even card grid, grouping by proximity not borders
- §3 3-4 text sizes, metric values dominant over labels, tabular numerals
- §4 Nav ≤7 items for this role, no items the role can't use, location visible
- §5 Every visible control works for THIS role (click it — 403/no-op = CRITICAL), buttons verb-named, destructive separated + confirmed
- §6 All four states present: loading / empty / error / full — empty state has no fake data, error messages true
- §7 Metrics have comparisons, right chart types, table alignment, data-ink
- §8 Standard placements (settings, search, profile, filters)
- §9 Default view is the daily 20%, advanced collapsed
- §10 Screen answers its role's first question of the day

## Finding format (append to the named board)

| Screen | Role | Standard | Expected | Observed | Evidence | Severity |

Severity: CRITICAL = dead/forbidden control, false error text, fake data as real · HIGH = wrong hierarchy, missing state, role sees unusable nav · MEDIUM = spacing/grid/type violations · LOW = polish.

## Workflow

1. Enumerate screens reachable per role (reuse route probes in ops/workflows/e2e-verify-run5-evidence/_tools/ where present).
2. Screenshot, check, write findings. Fan out per role as parallel agents if >2 roles.
3. Stop when the board is written. Chris names fixes; ui-standards.mdc governs the rebuild.
