# Dashboard UX finish — 2026-10-19

## Astra one-page comparison — 2026-10-20

Owner request: redo one page using GPT-6 Astra extra-high, then show the comparison before any go-live choice. Approved with GO; no repeated split gate. This is a separate draft, not a replacement for the current live CRM.

| Lane | Owner | Exact scope | Dependency |
| --- | --- | --- | --- |
| A | Astra xhigh agent | Team & Access alternative only, inside `ops/workflows/dashboard-ux-polish/astra-comparison/` | Existing page and shared brand contract |
| B | Root (this session) | Same-data baseline, safe local preview, desktop/phone comparison and independent UI review | Baseline runs alongside A; final comparison waits for A |

Isolated checkout: `/private/tmp/fundhub-astra-comparison.t8PMKZ`, branch `codex/astra-team-access-comparison`. Primary dirty iOS checkout and pending polish release remain untouched.

Progress: baseline captured at 1440 and 390 using 27 fictional staff. Both widths passed role/email filters, person drawer, cancel, permissions and clock tabs, and telemetry picker/refresh; no browser errors or sideways page scroll. Original loading presentation shows an empty roster rather than a loading panel; this stays an observed baseline limitation. Latest owner says to show the comparison first, so the prior polish release is held with its fixes preserved. No merge or production change has been made.

### Seven-part build plan

1. Role: signed-in Fundhub owner.
2. One job: manage the team and see who can access what.
3. First question: who is on the team, and what can they reach?
4. Reuse: existing `public/app/staff-teams.html`, shared shell/sidebar, official wordmark/F mark, Nunito and pastel spectrum, existing roster/editor/permission/clock behavior.
5. Data: existing page endpoints only; preview uses clearly labeled fictional fixture data and local in-memory actions. No production reads containing customer data or writes.
6. Files: agent owns `astra-comparison/team-access.html`, `team-access.css`, and `design-notes.md`; root owns `preview-server.mjs`, `fixtures.mjs`, `capture.mjs`, `comparison.html`, `review.md`, and `evidence/` in that same folder, plus this board. No production page, route, database, shared style, or dependency edits.
7. Risk/proof: preserve IDs, permissions and action semantics; compare identical data at 1440 and 390, capture full/empty/loading/error, check controls against local fake APIs. Root grades independently. Preview is not production-readiness or live workflow proof.

### A — self-contained prompt

Work in `/private/tmp/fundhub-astra-comparison.t8PMKZ` only. Create one separate Team & Access redesign for owner comparison using GPT-6 Astra with xhigh reasoning. Read the Fundhub builder skill at `/Users/chrisstanbridge/Developer/fundhub-platform/.agents/skills/fundhub-builder/SKILL.md`, repo CLAUDE.md section 0, `docs/rules/UI-STANDARDS.md`, `docs/rules/PERF-STANDARDS.md`, `public/app/fundhub-brand.css`, owner-scope rule, current owner intended journey, and current `public/app/staff-teams.html`. Keep the clean professional CRM (not iOS/glass), official branding and controls. Copy the page into `ops/workflows/dashboard-ux-polish/astra-comparison/team-access.html`, preserve endpoint/auth/permission semantics and JS IDs, and make a materially better layout with short copy. Put new styles in `team-access.css` at that path; load it via `/__comparison/team-access.css`. Relative original app assets must work when served at `/app/staff-teams.html?variant=astra`. Own only those two files and `design-notes.md`. Preserve all current behaviors and four states; no invented product capabilities. No new dependencies, real staff/customer writes, deployment, commits, or shared app edits. Root owns the fixture server and audit. Report ready paths and changes quickly; root needs a visible draft now, not a full product redesign.

### B — self-contained prompt

Work in `/private/tmp/fundhub-astra-comparison.t8PMKZ`. Keep live unchanged. Capture the original Team & Access page and the Astra alternative using identical clearly fictional team fixtures and a local-only server. Root owns preview/capture/fixtures/comparison/review files in `ops/workflows/dashboard-ux-polish/astra-comparison/`. Read UI audit skill and standards. Compare 1440/390 layouts and state behavior; keep review evidence marked with exact red callouts. Show the concrete draft comparison beside the chat. Do not change the Astra implementation while auditing it. Save results and limitations on this board. No production writes, deployment or unrelated repairs.

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
- The next full [PR run 39377752898](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39377752898) exposed the same asynchronous-request test issue in Ideas: no-database shard 2 captured its request list before Write now reached the fake API (180/181 browser cases passed). A full local reproduction then found the same issue after the Deep research cost confirmation. Six request-readiness polls now cover the affected cost-confirm/retry snapshots in that file; original pre-confirm zero checks, exact counts, bodies, costs and result text remain intact. No marketing product code or API fixture changed.
- After those waits, the complete S5 registry/browser proof passed **2/2 outer checks**, zero failures/skips (117.7 seconds), including every mapped required browser case. The Write now case also passed **40/40** fresh repeats, twenty per viewport. The separate full PR Screens job passed **1,666 cases / 3 skipped**, 21.3 minutes; no timeout. The three existing skipped cases are not claimed as proof.
- Extra local no-database groups passed: shard 4 **3,831 passed / 2 skipped / 0 failed**; shard 0 **5,630 passed / 2 skipped / 0 failed**. These do not replace the real-Postgres jobs. Full generated logs: `/private/tmp/dashboard-release-unit4.log`, `/private/tmp/dashboard-release-unit0.log`.
- The a331 PR run finished **13 passed jobs / 1 known Ideas test failure**. Main moved to `e8b2a1a34` while checks ran (heartbeat test stability and private-page ship injection). Root merged that main update, retained its ship/push fixes, and resolved the one overlapping avatar wait by keeping main's equivalent polling assertion. The other five Ideas request waits remain. Public dashboard files are unchanged by this sync.
