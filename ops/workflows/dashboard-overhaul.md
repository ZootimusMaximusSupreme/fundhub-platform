# Dashboard UX finish — 2026-10-19

## Owner feedback

Keep the clean professional CRM. Check all pages and Kanban. Cut excess explanation on social/marketing screens. Apply the brand pastel rainbow beneath the sidebar wordmark. Show the small Fundhub F mark by Calendar and use the brand mark for the logged-in menu control.

## Workflows

| Lane | Scope | Owner | State |
| --- | --- | --- | --- |
| A | Shared sidebar/header brand fixes; integrate and verify | Root | verified review draft |
| B | Shorten social/marketing UI explanations; preserve actions and real behavior | Copy agent | complete; verified review draft |
| C | Read-only page completion and Kanban scan; record exact remaining pages | Scan agent | complete; 36 published / 25 not integrated |

B and C run in parallel with A. Final browser proof waits for changes. This branch starts at `842ebfc6e` from current `origin/main`. Existing owner edits in the primary iOS checkout are untouched.

## Copy-paste prompts

### A — shared branding

Read the Fundhub repair skill, UI standards and brand source. Change only the shared sidebar/header identity requested in the owner feedback: the actual pastel brand spectrum, the existing F mark and logged-in menu identity. Preserve partner branding and navigation behavior. Verify desktop/phone and produce marked review screenshots. Root owns integration and final proof.

### B — social/marketing words

Read the Fundhub repair skill and current marketing journeys. Shorten explanatory interface copy in Social Studio and Marketing Command Center, including existing tab files where necessary. Keep every action and factual meaning. Put optional instructions behind existing disclosure controls where possible; do not redesign or add features. Own only social/marketing copy files and exact copy tests. Write findings/results to `ops/workflows/dashboard-ux-polish/copy.md`.

### C — completion and Kanban scan

Read the UI audit skill, current page manifest and release checkpoint. Check current source and existing automated proof for the full CRM/client page inventory and the Kanban. Do not edit product files or start duplicate page builders. Record what is integrated/live, retained but pending, unfinished and actually broken, with precise evidence. Write results to `ops/workflows/dashboard-ux-polish/scan.md`.

## Release

The existing 36-page checkpoint is already live. These new edits will have a concrete marked preview before any new production publication.

## Result

- [Marked before/after review](dashboard-ux-polish/README.md): the sidebar pastel rainbow, F menu mark beside Calendar, shorter Social Studio/Ideas/Scripts/Settings copy and one clear Kanban read-error recovery message.
- Selected Social instruction blocks: 365 → 123 words (66% less), with actions, costs, scheduling and approval meaning retained.
- Final Kanban/branding browser command: 40/40 passed, no skips. Earlier partner-brand/role/sidebar geometry suite: 16/16 passed, including four branding cases later strengthened and included in the final 40. Marketing: all 101 distinct browser cases passed (99 initial; two updated copy expectations rechecked), plus controlled Teams/Social proof.
- Targeted source/handler/sidebar/brand/copy checks passed. TypeScript passed. Final lint parsed 4,005 files and inline scripts clean. `git diff --check` passed.
- Live read-only scan: all 36 checkpoint HTML responses returned successfully and matched the published checkpoint. All 61 source pages and directly linked local resources exist. This does not prove all controls, roles or customer workflows across every page.
- KBN-01 was measured by the finished scan, then repaired as a separate small Kanban copy change. Raw internal error wording is removed; failed counters remain unknown. Its strengthened browser proof passes on desktop and phone.
- The full rebuild remains 36/61 integrated and published. The [completion scan](dashboard-ux-polish/scan.md) lists the 25 pending original page results. No new builders were started for those pages.
- New edits are not deployed. Live verification of the new draft follows the owner's publication choice. The existing owner session was used only for read-only inspection of Team & Access and Social Studio; no production writes or sends occurred.
