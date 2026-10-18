# App improvements (sales process) — shared board

Added 2026-10-17. Items come from `TODO.md` ("App improvements (sales process)"), so they are inside the Oct 15–29 feature freeze.

## Status

| Workflow | Owns | Status | Waits on |
|---|---|---|---|
| A. Backend | `lead_app_status` table, status endpoint, one-time login link | pending | Chris answers workflow questions (CLAUDE.md §3a) |
| B. Setter dashboard | per-lead checklist, timer since booking, call attempts, booked-but-not-installed flag, hide status after lead exits | pending | A (read endpoint) |
| C. Phone app | post install, login, and notification status; pre-permission screen | pending | A (endpoint shape) |
| Coordinator | this board | claimed (this session) | none |

A and C can start together once the endpoint shape is agreed. B starts after A's read endpoint exists.

## What is already in the repo (looked up 2026-10-17)

- `db/migrations/481_client_apns_devices.sql` holds iPhone push tokens. It is keyed to a client login session, so a row means: installed, logged in, notifications allowed. A lead who denied or was never asked has no row.
- `src/push/native-store.mjs` registers a device. `src/http/native-push-device.test.mjs` tests it.
- `public/app/closer-dashboard.html` is the closer's dashboard. There is no setter dashboard page yet.
- There is no setter journey file in `docs/journeys/` (only `role-closer-*`). Per CLAUDE.md §4, any step the code needs that the intended journey does not name means stop and ask.
- Latest migration is `481`. The next file must be a new number.

## Open decisions (only Chris can answer)

1. Does a booked lead already have a login account, or does the app create one on first open? (Question 1 of the workflow questions.)
2. Deferred deep link (Branch or similar) for leads who have not installed the app, or skip it for now? Blocks the one-time login link only.

## Rules every workflow follows

- Back end first: workflow answers, then migration, then read endpoint plus test against a real `DATABASE_URL`, then one-page flow in `docs/journeys/app-sales-process-flow.md`, then screens (CLAUDE.md §3a).
- Every new route or page gets a heartbeat row in the same change (CLAUDE.md heartbeat law).
- Notification status keeps being collected after a lead exits the sales process. Only the setter dashboard hides it.
- The app reports on every open and every return to the app.
- Claim a task here before starting. Write a change manifest here before reporting done.

## Paste-ready prompts

### A. Backend

```
Read CLAUDE.md, AGENTS.md, and ops/workflows/app-sales-process-2026-10-17.md in the fundhub-platform repo. You own workflow A (backend) only. Claim it on the board first.
Goal: store per-lead app status (installed, logged_in, notif_status allowed/denied/not_asked, last_seen_at) and expose one endpoint the iPhone app posts to on every open and every return to the app, plus a read endpoint for the setter dashboard.
Follow CLAUDE.md §3a: ask Chris the workflow questions one at a time until you are 95% sure, then migration (next number after 481), read endpoint, test against a real DATABASE_URL, heartbeat row, then docs/journeys/app-sales-process-flow.md.
Reuse src/push/native-store.mjs patterns. Do not touch the dashboard or the iPhone app. Write your manifest on the board when done.
```

### B. Setter dashboard

```
Read CLAUDE.md, AGENTS.md, docs/rules/UI-STANDARDS.md, and ops/workflows/app-sales-process-2026-10-17.md. You own workflow B (setter dashboard) only. Do not start until workflow A's read endpoint is marked done on the board.
Build a setter dashboard modeled on public/app/closer-dashboard.html: per-lead checklist (installed, logged in, notifications allowed) auto-filled from the backend, no manual check-off; timer since booking; call attempt counter; flag on booked-but-not-installed leads; hide app status once the lead exits the sales process.
Show a marked draft first (CLAUDE.md page-edits rule). Add the heartbeat row. Write your manifest on the board when done.
```

### C. Phone app

```
Read CLAUDE.md, AGENTS.md, and ops/workflows/app-sales-process-2026-10-17.md. You own workflow C (iPhone app) only. Agree the endpoint shape with workflow A on the board before coding.
Build: post install and login status on first login; post notification status (allowed, denied, not_asked) on every open and every return to the app; a custom pre-permission screen before the iOS notification popup.
Write your manifest on the board when done.
```
