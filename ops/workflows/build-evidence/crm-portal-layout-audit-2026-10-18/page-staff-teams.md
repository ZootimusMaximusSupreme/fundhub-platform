# Staff & Teams layout recovery — 2026-10-18

## Source and scope

Single retained builder: `/root/page_staff_teams`. Recovery branch: `codex/recover-staff-teams`, based exactly on `0998ff49969c6e2663a6e1851b4634ab5896113d`. First reviewable source commit: `c83b9f4eb11eb8e12e8e839e592b8b1798ecd78d` ([source](https://github.com/ZootimusMaximusSupreme/fundhub-platform/commit/c83b9f4eb11eb8e12e8e839e592b8b1798ecd78d)). Follow-up includes explicit loading/error presentation, focused browser specs, and this note.

Files: public/app/staff-teams.html, public/app/staff-teams.css, public/app/staff-teams.js, e2e/staff-teams-layout.spec.mjs and this note. No shared navigation/styles/backend/board/deployment changes. Root integrates the current shared rounded font, sidebar and workspace header separately.

Read AGENTS.md, page assignment, original page/scripts, docs/rules/UI-STANDARDS.md, docs/journeys/heartbeat-flow.md, shared audit board, existing e2e/staff-teams.spec.mjs, e2e/harness.mjs, playwright.config.mjs and relevant shell/data implementation. public/AGENTS.md and public/app/AGENTS.md do not exist at the pinned base (404). The shared audit board and assignment were read from codex/crm-portal-layout-professional; the board was not modified.

## Inventory and feature preservation

| Surface | Before | After |
| --- | --- | --- |
| Roster | Real staff via FHData.staff({limit:200}); hidden count; name/email/code search; role filter; row selection | Same IDs, model, search and handlers; Admin and Setter now also discoverable in the existing role filter; explicit named edit buttons and scroll region |
| Summary | Headcount, known/unknown shifts and consent, inactive count, onShiftChip | Same calculations and IDs; one restrained summary strip, unknown remains em dash |
| Add person | First/last, notify inbox, role; phone/start readonly until saved; no reset/revoke until account exists | Same invite validation, generated login/link behavior, seven-day expiry, mail-result and prompt |
| Editor | Profile, role, employee code readonly, booked-call SMS, start date, monitoring consent; Save/Cancel/close/scrim | Same IDs and write sequencing; associated labels, native keyboard switches, focus trap, Escape close, closed editor inert |
| Security/account actions | Owner/self revoke protection; reset confirmation; server-enforced permissions; explicit refusal alerts | Original business scripts unchanged |
| Role permissions | Unavailable real matrix; explanation only | Concise truthful explanation; no invented permissions or editable matrix |
| Clock & consent | Only self gets a clock button; only owner gets consent row controls; consent grant/revoke confirmation | Same conditions, action payloads and signed notice semantics |
| Telemetry | Person selector, conditional Refresh, consent/hours/activity/sample metrics, shifts, event tables, errors | Same IDs, values, selection/refresh and null-vs-zero behavior; responsive stacked detail regions |
| Agreements | Person-scoped contracts read, status/date, signed/unsigned selection, PDF download | Same contract IDs, parameters, file selection and download |
| Shared shell | Original aside, nav links, brand/sidebar imports, shell.js and data.js | Retained. Local ST codes and nominal debug footer removed. Add person moved into task intro; shared header remains shell-owned |
| Read states | Initial empty table, shared failure banner, real empty/loaded roster | Explicit local loading and error state observes existing FHData._parts.roster only; no extra requests, data substitution or success claim |

### Exact API and permissions contracts

| Read or action | Retained contract |
| --- | --- |
| Session | GET /api/auth/session with stored bearer token; principal staff, role owner; local account fallback |
| Roster | GET /api/read/staff?limit=200; hiddenCount; real role/status/consent/open_shift mapping |
| Own shift read | GET /api/shifts with bearer token, applies only self row |
| Clock | FHData.write('/api/shifts', {action:'clock_in' or 'clock_out'}); signed-in session only, never another staff ID |
| Telemetry | GET /api/staff/telemetry?staff_id=encoded ID with bearer token |
| Consent | FHData.write('/api/staff/monitoring-consent', {staff_id,action:'grant' or 'revoke'}); owner gate and confirmation retained |
| Agreements | FHData.read('contracts',{view:'contracts',staff_id,limit:50}) |
| Agreement file | FHData.read('contracts',{file:'contract',id,signed:0 or 1}); returned PDF base64 downloaded as application/pdf |
| Profile/SMS | /api/auth/staff-update with staff_id,name,email,phone,start_date,notify_booked_call_sms |
| Role | /api/auth/staff-role with staff_id and exact mapped role key |
| Invite | /api/auth/invite with name,role,notify_email; original response.email/invitePath/mailed behavior |
| Revoke | /api/auth/suspend with staff_id; confirmation; owner/self protected |
| Password reset | /api/auth/admin-reset with email; confirmation; returned resetPath copied with one-hour expiry |

Owner/Admin/Closer/Funding Advisor/Inquiry Specialist/Setter/Sales Manager role mappings remain unchanged. Owner has no writable role key. External-principal restrictions remain in shared shell and server; this layout does not weaken them. No real staff, customer, money, bank or outbound operation was invoked.

## Design

Warm #f8f8f6 canvas, near-black text/actions, rounded system type, white rounded surfaces, quiet dividers. Task intro puts Add person first; secondary work is reached through labelled keyboard tabs. Desktop roster remains a table; at 390/320, a named focusable horizontal region keeps all five columns and all clock actions available without page overflow. Four telemetry metrics become two columns and shift/event details stack. The mobile editor uses available width and scrolls its body while preserving its action footer.

## Checks and evidence

| Check | Result |
| --- | --- |
| Original inline/external script blocks retained exactly | PASS in code-mode string comparison: all four original blocks remain byte-identical |
| Original HTML IDs retained | PASS in code-mode string comparison: every original ID retained |
| New page module syntax | PASS: parsed with JavaScript Function constructor in code mode |
| New spec syntax | PASS: parsed after removing its import statements in code mode; this is syntax-only, not browser execution |
| Existing e2e/staff-teams.spec.mjs | UNRUN in this recovery session |
| New e2e/staff-teams-layout.spec.mjs (25 cases) | UNRUN in this recovery session |
| Rendered 1440/390/320, touch and keyboard | UNRUN; root GitHub Actions integration run required |
| Lint/TypeScript/full regressions | UNRUN; root combined check required |
| Marked before/after screenshots | NOT CAPTURED; no working executor/browser in this recovery session |
| Deployment/live-account proof | NOT PERFORMED |

New specs mock every /api/** request and block font CDNs; every non-read request is captured and refused unless that test explicitly supplies a mock result. They cover three sizes with full/empty/loading/error states, search/role filtering, touch targets, keyboard row/editor/tab access and focus containment, telemetry zero vs null, empty shifts/events, telemetry refusal, own-clock/owner-consent/nonowner gates, profile/SMS/role payloads, invite refusal, reset/revoke confirmation/refusal, and signed agreement download.

Suggested root run: `npx playwright test e2e/staff-teams.spec.mjs e2e/staff-teams-layout.spec.mjs`. Run through repository Playwright config so its static server shares the browser process network namespace. Do not convert an unrun check into a pass.

## Remaining limits

The cloud executor is disconnected (exec-server 409 environment_offline, Environment is not connected). This recovery deliberately uses GitHub connector source operations only and does not claim a local build or browser run. GitHub Actions result and visual review are pending root integration. No screenshots or live usability claim exists yet. Existing server-side permissions remain the authority; this page still has no verified permission matrix endpoint. The original business scripts, including their error handling and data-update ordering, were intentionally preserved rather than silently repaired by a layout change. Shared header/font/sidebar reconciliation is root-owned.
