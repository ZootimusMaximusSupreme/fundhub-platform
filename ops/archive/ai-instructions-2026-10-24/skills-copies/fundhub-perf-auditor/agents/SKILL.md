---
name: fundhub-perf-auditor
description: Read-only performance audit against docs/rules/PERF-STANDARDS.md. Triggers - perf audit, speed audit, why is this slow, load time, lighthouse, page speed, core web vitals.
---

# Fundhub Perf Auditor

Read-only. Findings only. Ground truth is `docs/rules/PERF-STANDARDS.md`. Same discipline as fundhub-auditor and fundhub-ui-auditor — audit and fix never mix (audit-vs-fix-router applies).

## Prime rules

1. READ-ONLY on app/config/env/tests. No fixes, no commits, no branches.
2. **Every finding cites a number.** Lighthouse score, a metric value, or a specific network waterfall entry with its size and blocking time. "Feels slow" is not a finding.
3. Measure on **mobile emulation, Slow 4G, 4x CPU throttle**. Desktop-on-wifi numbers are not evidence. Run each page 3 times, report the median — single runs are noise.
4. Test the LIVE site. Localhost has no network latency and will lie.
5. Save the full Lighthouse JSON + HTML report per page to the evidence folder. The board cites paths.

## Per-page capture

- Lighthouse: performance score, LCP, INP (or TBT as proxy), CLS, TTFB, Speed Index
- The LCP element (what it actually is — often a font or hero image)
- Total bytes, and the breakdown: JS / CSS / images / fonts / third-party
- Longest blocking resources, top 5 by blocking time
- Count of render-blocking requests in `<head>`
- Count of inline `style=` attributes (style-recalc cost, and a cacheability finding)
- Third-party scripts with individual sizes

## Finding format

| Page | Metric | Budget | Measured | Cause | Evidence | Severity |

Severity: **CRITICAL** = funnel page over budget (direct ad-spend leak) · **HIGH** = CRM page 2x over budget, or render-blocking resource in head · **MEDIUM** = single budget miss with a clear cause · **LOW** = polish under budget.

## Priority order (say this on the board)

Funnel pages first — they cost money per visitor. CRM screens second. Rank all findings by estimated seconds saved, not by how easy they are to fix.

## Workflow

1. Funnel: apply.fundhub.ai/watch, apply, book, thank-you.
2. CRM: the 39 screens in public/app/, logged in per primary role.
3. Board: `ops/workflows/perf-audit-<date>.md`. Evidence: `ops/workflows/perf-audit-evidence/<page>/`.
4. Pattern findings (same cause across many pages — e.g. one blocking font, inline styles everywhere) get ONE row listing affected pages.
5. Fan out in groups. Stop when the board is written.
