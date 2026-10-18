# Journeys page recovery — 2026-10-18

Builder: `/root/page_journeys`. Recovery branch: `codex/recover-journeys`, based exactly on `0998ff49969c6e2663a6e1851b4634ab5896113d`.
Initial source checkpoint: `f94b876f4814e0abd42bf179e702ceeb88165e45` (HTML and scoped CSS only).

## Scope and inventory

Read AGENTS, original Journeys assignment, shared audit board, UI standards, exact base page, owner intended journey, existing Playwright config/harness and Agent Editor fixture test. The owner approved the newer warm product direction over the old visual rules.

| Contract | Before and after |
| --- | --- |
| Navigation and access | Shared aside, shell.js, stylesheet imports and role gates retained. This is a staff editor. The run endpoint independently refuses anyone except owner/admin. No client/sample gates changed. |
| Journey selection | Client, Setter, Closer, Advisor, Affiliate, Partner; selected state and node counts retained. |
| Editing | Every step type, title/config field, delay, branches, add menu, move, delete, undo and touched-state tracking retained. |
| AI | POST /api/journeys/ask with system/user schema; pending Keep/Throw away and existing explicitly labelled local fallback retained. |
| Save | PUT /api/journeys per touched key with key/name/start/end/desc/nodes, single-brace validation, failed-save dirty state and toast retained. |
| Versions | In-memory named save/restore, history and revert retained. No new persistence claim. |
| Simulation | Browser-only playback, branch selection, stop/Escape and reports retained; nothing sent. |
| Code test | POST /api/journeys/run, owner/admin refusal, 503/error feedback, findings and held-message reasons retained. No real run invoked. |
| Loading source | GET /api/journeys; existing seed examples remain until non-empty saved rows arrive. No data semantics changed. |

Inline business scripts are byte-for-byte identical to the pinned base; checked by JS string extraction before the source commit. All original IDs and original aside are retained. New page script adds only form-label associations, arrow/Home/End tab keys, branch path labels and phone inspector/back scrolling. No API/state hooks or global edits.

## Presentation

Warm off-white workspace, rounded system type, readable title and neutral steps; actions grouped in one editor toolbar without another Fundhub wordmark. Journey picker, flow and inspector keep distinct jobs. Phone toolbar wraps all actions; inspector follows selected steps and offers Back to journey. Branch paths stack with their actual labels at 480px. Add targets remain visible and 40px; other controls target 44px. No shared navigation or shell ownership taken.

## Checks

- Source comparison completed in orchestration: inline business scripts unchanged.
- Added `e2e/journeys-workspace.spec.mjs`: mocked 1440/390/320 branches, task targets, keyboard tabs/field associations, inspector return; editing/undo/refused write; pending AI Keep/Throw away and mocked successful schema save; local simulation and run refusal; loading/empty/error fallback continuity.
- Every API request is intercepted by the existing harness. No live customer, money, bank or outbound action.
- **Unrun:** Playwright, screenshots/marked visual review, lint, TypeScript and Node regressions. Cloud executor is disconnected (`environment_offline`); no local server, build or browser run is claimed. Root runs Actions on integrated shared chrome.
- No before/after screenshots exist for this recovery; final visual acceptance remains open.

## Known pre-existing gaps

The loader silently keeps worked-example seeds when GET is pending, empty or refused. Those states are not newly implemented or passed as genuine customer data; the three fallback tests explicitly only pin continuity. The editor does not provide an honest loading/empty/error banner today. Root should track/fix that separately if behavior changes are authorized; this recovery preserves the requested business JS. Server access rules were not independently re-audited. Saved versions remain memory-only.

No deployment, migration, global/backend/nav or shared-board changes.
