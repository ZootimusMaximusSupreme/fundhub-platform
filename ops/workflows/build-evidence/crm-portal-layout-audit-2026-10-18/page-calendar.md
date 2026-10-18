# Calendar — professional workspace rebuild

Owner-authorized single-page work, branch `codex/crm-portal-layout-professional`. Builder `/root/page_calendar`. Completed 2026-10-18. No commit, deployment, real API write, new endpoint, backend edit, or shared-file edit was performed.

## Files

- `public/app/calendar.html`: presentation structure, native date/view controls, keyboard appointment selection, focus retention, truthful status wording, AM/PM display, and reload action for a failed read.
- `public/app/calendar-workspace.css`: new page-specific responsive layout. Replaces the inline layout rather than stacking another legacy theme on top of it.
- `e2e/calendar.spec.mjs`: native button selector and human-readable schedule status assertions; all existing feature assertions retained.
- `e2e/calendar-workspace.spec.mjs`: new focused responsive, keyboard, state, and mocked-write proof, with automatically marked screenshots.
- This note and `calendar/*.png`: page-specific evidence.

The shared shell owns page identity, client scope, navigation, Search, Chat, and account controls. The page adds schedule actions without duplicate branding or account controls. The former debug footer and LIVE badge became a selected-date summary and explicit schedule state.

## Contracts inventoried before editing

| Contract | Exact existing path or control | Result |
| --- | --- | --- |
| Session and roles | Shared `shell.js`; existing staff nav and current role gates | Unchanged. Calendar does not introduce its own role permission logic or demo data. |
| Open and completed work | `FHData.taskQueue({done:false,limit:200})` and `{done:true,limit:200}` → `GET /api/tasks?done=…&limit=200` | Unchanged; deferred `data.js`, DOMContentLoaded ordering, deduplication, 200-row cap, and open/completed failure distinction retained. |
| Claim | `PATCH /api/tasks` with `{id,claim:true}` | Unchanged bearer authentication, one-write-at-a-time guard, row feedback, server re-read, and server permission/shift gates. |
| Complete | `PATCH /api/tasks` with `{id,done:true}` | Unchanged payload and re-read; completed work continues to contribute to the appropriate date. |
| Task write failures | 401, `no_active_shift`, `already_claimed`, 403, 404, 503, network failure | Existing plain-language answers retained. |
| Day/Week | `#seg [data-v=day|week]` | Same view behavior; spans become native buttons with `aria-pressed`. |
| Previous/next/Today | `.navbtn`, `.today-btn` | Same ±1 day / ±7 day and real-today calculations; native buttons with current day/week accessible names. |
| Select day | `.ws-day[data-ymd]` | Existing click/Enter/Space activation retained; selected/today states stay separate, selected day gets `aria-pressed`, keyboard focus survives repaint. |
| Select appointment | `.evt[data-task-id]`; `#thenList .then-row[data-task-id]` | Existing click behavior retained. Event title is a native selection button; Then now implements its advertised keyboard button behavior. |
| Join call | `#unJoin`; `meeting_url || join_url`; `window.open(url,"_blank","noopener")` | Unchanged enable/disable and target logic. Existing shared CSS hides disabled Join Call. |
| Client file | `#unFile` → `client-control-panel.html?client_id=` + encoded client id | Unchanged; absent client keeps the action disabled. |
| Undated work | `#statNoDateTile`, `#statNoDate`, `#noDateTitle`, `#noDateList` | Existing count, cap warning, 12-row list limit, hidden-empty state, Claim, and Mark done retained. |
| Coverage | Authenticated `GET /api/shifts?roster=1` → `#covList` | Unchanged staff, role, shift time, empty and network-failure states. |
| Time/date | Existing local-date selection and `America/Phoenix` time formatting | Date calculations unchanged; appointment/Then/week/Up Next time labels now include AM/PM. Arizona/MST is visible. |
| Metrics | `#statBooked`, `#statDone`, `#statLeft`; hidden `#statNoshow`, `#statShow` | Same null/zero rules; unavailable counts remain dashes, unsupported outcome metrics remain hidden. |
| Loading/failure | `pendingNote`, `emptyNoteAll`, `openFailed`, `doneFailed`, `loadFailed`, `FHData.banner` | Retained; loading gains neutral placeholders, failure gains a reload button that performs reads only. |
| Scheduling | Existing page reads task-based appointments; it has no appointment-create/reschedule endpoint or booking form | No invented scheduling controls or unrequested writes added. |

## Before / after matrix

| Area | Before | After | Proof |
| --- | --- | --- | --- |
| Date navigation | Click-only divs and span view switch | Native buttons, explicit day/week names, pressed state, ≥40px targets | Keyboard Enter/Space and one-/seven-day navigation checks |
| Phone schedule | Tall stacked totals; flex/overflow structure drops the main schedule out of the usable phone flow | One row of date totals, seven-day orientation strip, scrollable single-column agenda and details | 390/320 full/day/details screenshots; no page overflow |
| Appointment readability | Dense rows; long names and task actions compete horizontally | Wrapped client/task text with separate action row and selected appointment boundary | Long-name 320px fixture and screenshots |
| Week | Two appointment names followed by non-interactive “+ more” | Full seven-day agenda with every loaded appointment visible on its day | Third appointment is asserted visible in Week at all three sizes |
| Client context | Dark briefing block repeats dense text; clock lacks AM/PM | Readable white detail panel, exact AM/PM, black Join Call, outlined Client file | Existing meeting/client-file tests plus selected-appointment keyboard checks |
| Honest states | Working open/completed failure logic and unsupported metric dashes | Same logic; readable schedule status and inline failure reload | Existing split-read tests; new partial and reload checks |
| Task actions | Claim/Mark done already write the correct API | Same writes and refusal semantics, now usable in the phone agenda and undated list | Existing four write/refusal tests plus phone keyboard undated Claim/Done test |
| Shared product frame | Duplicate legacy brand/status/footer chrome | Shared header stays the single page identity/account/search frame | 1440/390/320 rendered evidence |

## Verification

Passed after implementation:

```text
PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium E2E_PORT=43127 \
  npx playwright test e2e/calendar.spec.mjs e2e/calendar-claim-done.spec.mjs e2e/calendar-workspace.spec.mjs
30 passed (11.2s)

node --test src/http/calendar-paint.test.mjs
9 passed; 0 failed; 0 skipped

git diff --check -- public/app/calendar.html e2e/calendar.spec.mjs
passed
```

The final evidence-only refinement re-ran `e2e/calendar-workspace.spec.mjs` (9 focused tests) and passed. It only adds red review markers and positions the captured state in view. All `/api/**` calls in browser fixtures are intercepted, including exact PATCH writes; no external customer data or live write was used. New focused checks fail on JavaScript page errors.

An intermediate new check correctly failed because Week still omitted the third appointment; the implementation now renders every loaded appointment and that check passes. Another intermediate render exposed the shared `stat-tiles` mobile grid override; the page now uses a calendar-specific summary container, with a check that all visible totals occupy one row. No failing feature proof was removed. The existing span selector changed to the equivalent native button selector; LIVE/PARTIAL assertions now check “Schedule ready” / “Completed calls unavailable” alongside the existing count and banner checks.

Root owns combined lint, TypeScript, and cross-page regression checks; this builder did not run or claim those. Database-backed tests, a live deployment, and real-device testing were not run. Browser evidence is Chromium at 1440×1000, 390×844, and 320×844. Existing local-calendar date grouping and Phoenix time formatting remain as they were; this visual work does not alter that pre-existing contract.

## Marked review evidence

All screenshots are mock fixtures. Red rectangles and captions identify the issue or verified replacement. Before images were captured before this page changed; shared shell work was already present. After images are generated by the focused test and capture the final integrated shell available during the run.

| Width | Before | After: controls | After: day | After: details | After: week |
| --- | --- | --- | --- | --- | --- |
| 1440 | [before](calendar/before-1440-full.png) | [controls](calendar/after-1440-full.png) | [agenda](calendar/after-1440-day.png) | [details](calendar/after-1440-details.png) | [week](calendar/after-1440-week.png) |
| 390 | [before](calendar/before-390-full.png) | [controls](calendar/after-390-full.png) | [agenda](calendar/after-390-day.png) | [details](calendar/after-390-details.png) | [week](calendar/after-390-week.png) |
| 320 | [before](calendar/before-320-full.png) | [controls](calendar/after-320-full.png) | [agenda](calendar/after-320-day.png) | [details](calendar/after-320-details.png) | [week](calendar/after-320-week.png) |

| Width | Empty | Loading | Error |
| --- | --- | --- | --- |
| 1440 | [empty](calendar/after-1440-empty.png) | [loading](calendar/after-1440-loading.png) | [error](calendar/after-1440-error.png) |
| 390 | [empty](calendar/after-390-empty.png) | [loading](calendar/after-390-loading.png) | [error](calendar/after-390-error.png) |
| 320 | [empty](calendar/after-320-empty.png) | [loading](calendar/after-320-loading.png) | [error](calendar/after-320-error.png) |

Repository note: `ops/workflows/build-evidence/` matches an existing ignore rule. The note and images exist on disk; integration must force-add this page's evidence if it is to be committed. The builder did not alter `.gitignore` or stage files.
