# Client Success call queue — source recovery

Recovered by the original sole page builder from retained tool arguments onto `codex/recover-csm-queue`, based on `0998ff49969c6e2663a6e1851b4634ab5896113d`.

This restores the completed page work after executor/filesystem loss. The current branch's original sidebar is retained byte for byte; shared header, navigation, token and API files are not changed. Integration depends on the shared workspace foundation in PR #71.

## Files

- `public/app/csm-queue.html`: clear Calls to make hierarchy, compact shift strip, due-date queue, separate client context, read-only refresh, accessible interview panel, draft/focus preservation.
- `public/app/csm-queue.css`: recovered page-scoped desktop/phone layout. Local system typography replaces Google font requests.
- `e2e/csm-queue-layout.spec.mjs`: recovered safe fixtures and state/control tests. Generates marked review captures when run.
- This feature note. The existing `e2e/csm-queue-clicks.spec.mjs` is unchanged.

## Feature preservation matrix

| Area | Preserved or recovered behavior |
| --- | --- |
| Authentication and role scope | Existing cookie/Bearer helper, demo-token exclusions and shared staff/client gates untouched; no sample/customer records added |
| Shift | GET /api/shifts; POST action-only clock_in/clock_out; no staff/org IDs sent; pending, failure and success states retained |
| Queue | GET /api/read/csm-queue; API order retained; count, singular/plural, overdue-call count and Blueprint exception count retained |
| Claim | PATCH /api/tasks with id + claim:true; unassigned-only control; claimed-by-you/teammate; re-read after success/refusal |
| Client context | Name/code fallback, product ownership, exact balance strings, unknown null versus measured zero retained |
| Timing | Call due date remains separate from invoice lateness; relative/absolute/no-date and timestamp tooltips preserved |
| Blueprint | Coach/prep sources; assigned CSM name and you/teammate/unassigned branches; unrelated workflow has no interview |
| Interview | GET /api/read/customer-insights?limit=1 supplies question bank; mid/post questions and default channels retained |
| Channels | call / google_meet / ai_reachout options retained |
| Save | POST /api/customer-insights: client_id, task_id, stage, channel, trimmed answers, nullable notes; requires 201 + ok |
| Validation/refusal | Empty answers send nothing; refused save retains form; existing human-readable server errors retained |
| Form state | Keyboard Enter opens/closes; focus enters channel and returns on close/save; shift/read repaint preserves open draft |
| Read states | Full, empty, loading and error remain distinct; unknown is never rendered as zero; pending queue cannot become falsely empty after shift action |
| Links | client-control-panel.html?client_id=<id>; client-control-panel.html fallback; conditional meeting_url with new tab + noopener |
| New page action | Refresh queue repeats only existing reads; no new API or customer write behavior |

All 17 static IDs from the current production source survive. qTitle and qRefresh are the only new static IDs. Original sidebar text was compared before/after and is unchanged. The recovered inline JavaScript and focused test body parse in the code runtime; this is source parsing, not a browser/test-suite pass.

## Validation status

Historical pre-loss evidence: 25 safe browser cases passed at 1440/390/320, including original clock/claim/save controls, full/empty/loading/error, no horizontal overflow, 44px page targets, keyboard/touch and unsaved draft preservation. Those historical results are not new verification of this recovery commit. Old screenshot files are unavailable and are not claimed as recovered.

Not run after recovery: browser suite, repository lint/TypeScript, backend/Postgres or live account/device checks, because the executor/filesystem is unavailable. Root owns fresh GitHub Actions verification on the integration branch. No production deployment or real customer, bank, payment or outbound operation was performed.

Run after integration with shared foundation:

```sh
npx playwright test e2e/csm-queue-layout.spec.mjs e2e/csm-queue-clicks.spec.mjs
npm run lint
```

Use the CI-installed browser or PLAYWRIGHT_CHROMIUM where needed. The repository Playwright configuration starts the offline static server; all API requests in the fixtures are intercepted.

Pre-existing scope limit: the queue page consumes its default read page and does not expose the endpoint's pagination envelope. No pagination behavior is added or removed.
