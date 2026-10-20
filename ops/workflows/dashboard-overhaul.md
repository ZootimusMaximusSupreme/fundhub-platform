# Dashboard UX finish — 2026-10-19

## Owner feedback

Keep the clean professional CRM. Check all pages and Kanban. Cut excess explanation on social/marketing screens. Apply the brand pastel rainbow beneath the sidebar wordmark. Show the small Fundhub F mark by Calendar and use the brand mark for the logged-in menu control.

## Workflows

| Lane | Scope | Owner | State |
| --- | --- | --- | --- |
| A | Shared sidebar/header brand fixes; integrate and verify | Root | verified review draft |
| B | Shorten social/marketing UI explanations; preserve actions and real behavior | Copy agent | complete; verified review draft |
| C | Read-only page completion and Kanban scan; record exact remaining pages | Scan agent | complete; 36 published / 25 not integrated |
| D | Independent read-only PR release checks | release_checks | running; root owns any repairs |

B and C run in parallel with A. Final browser proof waits for changes. This branch starts at `842ebfc6e` from current `origin/main`. Existing owner edits in the primary iOS checkout are untouched.

## Copy-paste prompts

### A — shared branding

Read the Fundhub repair skill, UI standards and brand source. Change only the shared sidebar/header identity requested in the owner feedback: the actual pastel brand spectrum, the existing F mark and logged-in menu identity. Preserve partner branding and navigation behavior. Verify desktop/phone and produce marked review screenshots. Root owns integration and final proof.

### B — social/marketing words

Read the Fundhub repair skill and current marketing journeys. Shorten explanatory interface copy in Social Studio and Marketing Command Center, including existing tab files where necessary. Keep every action and factual meaning. Put optional instructions behind existing disclosure controls where possible; do not redesign or add features. Own only social/marketing copy files and exact copy tests. Write findings/results to `ops/workflows/dashboard-ux-polish/copy.md`.

### C — completion and Kanban scan

Read the UI audit skill, current page manifest and release checkpoint. Check current source and existing automated proof for the full CRM/client page inventory and the Kanban. Do not edit product files or start duplicate page builders. Record what is integrated/live, retained but pending, unfinished and actually broken, with precise evidence. Write results to `ops/workflows/dashboard-ux-polish/scan.md`.

## Release

The existing 36-page checkpoint is already live. The marked preview is saved. Chris authorized publication with "PLEASE GO, STOP ASKING ME (NEW RULE)", then approved the release split and repeated GO. Root owns the rule update and release; `release_checks` independently reads PR checks; live verification waits for deployment. No further routine approval gate applies.

Release prompts: "Save the new rule and finish PR #76" (root); "Read PR #76 checks and report exact blockers without edits" (release_checks); "After deployment, verify the published branding, shorter copy and Kanban behavior" (root).

## Result

- [Marked before/after review](dashboard-ux-polish/README.md): the sidebar pastel rainbow, F menu mark beside Calendar, shorter Social Studio/Ideas/Scripts/Settings copy and one clear Kanban read-error recovery message.
- Selected Social instruction blocks: 365 → 123 words (66% less), with actions, costs, scheduling and approval meaning retained.
- Final Kanban/branding browser command: 40/40 passed, no skips. Earlier partner-brand/role/sidebar geometry suite: 16/16 passed, including four branding cases later strengthened and included in the final 40. Marketing: all 101 distinct browser cases passed (99 initial; two updated copy expectations rechecked), plus controlled Teams/Social proof.
- Targeted source/handler/sidebar/brand/copy checks passed. TypeScript passed. Final lint parsed 4,005 files and inline scripts clean. `git diff --check` passed.
- Live read-only scan: all 36 checkpoint HTML responses returned successfully and matched the published checkpoint. All 61 source pages and directly linked local resources exist. This does not prove all controls, roles or customer workflows across every page.
- KBN-01 was measured by the finished scan, then repaired as a separate small Kanban copy change. Raw internal error wording is removed; failed counters remain unknown. Its strengthened browser proof passes on desktop and phone.
- The full rebuild remains 36/61 integrated and published. The [completion scan](dashboard-ux-polish/scan.md) lists the 25 pending original page results. No new builders were started for those pages.
- PR [#76](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/76) holds the polish. Publication is authorized and release checks are in progress; do not call it live until deployment and live proof pass. The existing owner session was used only for read-only inspection of Team & Access and Social Studio; no production writes or sends occurred.

## Release-check repairs

- Failed evidence is retained: [PR run 39376848941](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39376848941), no-database shard 4, read the previous handoff panel immediately after selecting an Agent step; the row-accounting assertion then also failed. The corresponding push shard passed. An earlier [push run 39375289724](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39375289724) read the old budget after two unfinished drawer refreshes.
- Only test synchronization changed. The step picker now waits for its exact selected row and title before reading the original exact fields. The campaign test waits for each response-driven detail repaint before the next action and checks the typed 30000 value before the unchanged exact 30000 request assertion. No finance or Journey product behavior changed; no assertion was removed or weakened.
- Fresh affected-file checks: Journey editor **28/28 passed**, no skips; Campaign Manager browser **54/54 passed**, no skips. Final dashboard/Kanban rerun **40/40 passed**. Lint parsed 4,005 files/scripts and TypeScript passed before these test-only changes; changed test files parse clean and diff check passes.
- Live proof checks the Social connection help separately from its unchanged form controls; all exact shorter-copy expectations remain. Required deployed score is seven cases, separate from the earlier teleprompter score.
