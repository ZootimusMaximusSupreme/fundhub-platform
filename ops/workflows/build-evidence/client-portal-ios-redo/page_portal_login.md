# Portal sign-in — page_portal_login

Scope: `public/portal-login.html`, page-owned `public/portal-login-ios.css`, `e2e/page_portal_login.spec.mjs`.

Dedicated public client entry. No staff portal/password login changed. Matches approved light system-type canvas, soft rounded white card, dark primary action, quiet typography. This is an entry screen, so it uses a readable form column rather than the authenticated app navigation. Shared client foundation activates through `data-client-public` and `data-client-page="portal-login"`.

## Before/after feature matrix

| Existing feature/control/state | After | Verification |
|---|---|---|
| Email input, native email validation, required, autocomplete | Preserved; explicit label, email keyboard, no autocapitalization added | Page test authored |
| Query `?email=` prefill | Preserved | Auth script unchanged |
| Submit / POST `/api/auth/magic-link` with trimmed email | Preserved exactly | Browser spec checks posted fixture |
| Disabled Sending state; network error permits retry | Preserved | Browser spec covers waiting/error/retry |
| Generic account-private sent panel; form hides | Preserved, live status added | Browser spec authored |
| `?t=` magic-link landing / POST `/api/auth/magic-link-verify` | Preserved exactly | Browser spec checks POST body |
| Remove token from URL before network call | Preserved exactly | Browser spec checks URL during request |
| Signing-in busy, form/lede hidden; invalid/expired/network restores form | Preserved, live status added | Existing logic unchanged; expired test authored |
| HTML-escaped API error/success content | Preserved exactly | Auth script unchanged |
| Store `fh_token`, correct `fh_account`, principal role; remove stale account/role when absent | Preserved exactly | Browser spec checks stale identity replacement |
| Remove `fh_demo` and `fh_demo_staff` on real successful sign-in | Preserved exactly | Browser spec authored |
| Redirect server `next`, fallback `/app/client-portal.html` | Preserved exactly | Browser spec checks fixture redirect |
| Back to `/` | Preserved, 48px target; additional brand home link | Static inspection |
| Noindex, favicon, Apple icon | Preserved | Static inspection |
| Keyboard, accessibility | Label, alert/status announcements, visible focus, 56px input/action | Browser spec authored |

No entitlement, payment, signing, upload, chat, booking, referral or course controls exist on this entry page. Those flows remain linked through its unchanged successful portal redirect. No new API, route, send path or heartbeat surface added; existing portal sign-in surface coverage remains applicable.

## Verification

- `node --test src/auth/magic-link.test.mjs`: **13 passed, 0 skipped** (no database suite; does not prove DB behavior).
- Inline auth script compared with source branch: unchanged; no auth/API modification.
- Page-specific Playwright suite: **5 passed** using recovered Chromium `/workspace/scratch/browser-tools/chromium`. All UI assertions reached; 12 screenshots produced at 1440 / 390 / 320 for empty, sending, error and sent states. Initial missing-browser blocker resolved.
- Authored captures: 1440 / 390 / 320, empty / sending / error / sent; native keyboard interaction, overflow assertion, failed-token privacy, successful account/session replacement.
- Full lint/TypeScript pending lead integration. Shared performance lab rerun: portal entry LCP **540ms**, CLS **0**, TTFB **6ms**, resource transfer **22,023 bytes**, JavaScript **6,292 bytes**, using 390px / 150ms latency / 1.6Mbps / 4x CPU and mocked APIs. Meets measured entry budgets; INP and live backend latency not measured. Removed external font requests; no image payload or library introduced.
- No real writes, outbound messages, accounts or credentials used by page tests; API calls mocked.

## First-paint follow-up

The shared script activated the dedicated public page after first paint, causing lab CLS 0.15745. Added static `data-client-ios` on this dedicated unauthenticated page so its already-loaded CSS applies immediately. No session, identity, API, navigation or permission behavior changed. Rerun CLS is 0. Shared lab JSON updated by its existing runner; the client-home measurement is incidental and owned by lead.
