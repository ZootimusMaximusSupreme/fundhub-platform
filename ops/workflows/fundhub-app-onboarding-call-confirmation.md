# Fundhub app onboarding + portal call confirmation

Owner GO: 2026-10-17. Branch: `codex/two-ios-apps-launch`.

## Parallel work

1. Sign-in/download truth (read-only). Prompt: "Trace company app download → first sign-in → saved session. Decide whether the email-link action is redundant. Report exact code evidence and the smallest recommended copy/flow change. Do not edit product code." Agent owns `ops/workflows/fundhub-app-onboarding-auth.md` only. Status: complete. Download alone does not identify the client; first email sign-in remains, later Face ID resumes. There is no native Sign up button to remove.
2. Portal call confirmation (this session). Prompt: "Let a signed-in client confirm their own upcoming call inside the portal only when it is not yet confirmed. Reuse the existing booking and call-confirmed data. Prove client scoping, repeat clicks, no-booking and already-confirmed states; do not publish until the owner sees the page draft." Status: built and in PR #56; owner go-live choice pending.
3. Push setup (parallel agent; owner added during build). Prompt: "Inspect the native company iOS app and current push backend. Complete safe in-repo push setup in separate files; prove registration and delivery paths, and report the exact remaining Apple/account step if credentials are needed. Do not touch portal files or deploy." Status: running; details in `ops/workflows/fundhub-push-setup.md`.

Discovery and separate builds can run together. Release waits for UI review, portal tests, and push proof.

## Builder gate

1. Role: client only.
2. Job: confirm an existing upcoming call from the portal.
3. First question: "Is my call booked, and have I confirmed it?"
4. Reuse: `bookings` table, `/api/bookings`, `/api/read/portal-summary`, the portal pre-call card, and `clients.custom_fields.call_confirmed` set by inbound YES/CONFIRM SMS.
5. Data: the client's own future `bookings` row and existing confirmation flag. No new table or field. Extend the existing bookings route for the client's confirmation action.
6. Product files planned: `api/bookings.mjs`, `api/read/portal-summary.mjs`, `public/app/client-portal.html`, `src/handlers/comms.mjs`; focused tests in `src/http/` and `src/handlers/comms.test.mjs`; intended journey `docs/journeys/client-call-confirmation-intended.md`. This board and UI evidence live under `ops/workflows/`.
7. Risk: a client confirms the wrong call or sees a stale confirmed state after rebooking. Proof: scoped handler tests, event-reset tests, portal UI click test, four UI states at desktop/phone, and release checks.

## Release status

- Code: portal confirmation built; focused handler tests (134/134), portal Playwright (1/1), lint, TypeScript, and diff check pass. Full `npm test` stalled after more than eight minutes without progress and was stopped; it is not a pass. Scratch-database E2E was not run without `DATABASE_URL`.
- Review draft: marked `ops/workflows/build-evidence/client-call-confirmation/390-unconfirmed.png` shown; owner go-live choice pending.
- GitHub: commit `6ab201151` pushed to [PR #56](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/56).
- Live: pending. Do not label live before deploy and browser proof.

Leftover outside this page: inbound SMS `YES` confirms only `call_outcome=booked`, not `rescheduled`; see `src/workflows/dpc-03-inbound-reply-router.mjs`. The new portal button works for either booked or rescheduled calls.
