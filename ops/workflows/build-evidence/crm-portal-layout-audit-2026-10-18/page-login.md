# Password sign-in — professional layout refinement

Assigned sole page builder: `/root/page_login`. Worktree `fundhub-layout`; page `public/login.html`. Read the assigned prompt, AGENTS, shared audit board, native Mac WelcomeView, current page/styles/tests and prior client journey notes before editing. Inventory below was established from the existing markup and handlers. No shared files, auth handlers, credentials, API routes, backend or real account data were changed.

## Presentation

Replaced the client-only purple gradient/large card and plain staff default with one shared working password entry: warm #f8f8f6 canvas, rounded native typography, small Fundhub mark, 32–38px welcome heading, white 50px inputs, black Sign in action and outlined existing client email-link alternative. Explicit client destination is labeled Client portal; ordinary entry says Your Fundhub account. This presentation does not assign a role or change the destination. Form labels remain visible for every role. Reset feedback now has a polite live region.

At 1440px the 420px form has deliberate breathing room; at 390/320 the same hierarchy fits the password entry and primary action above the fold (568px phone viewport; 800px desktop). No oversized card, glass, blue/purple background or decorative status diagnostics. The only color accent is the thin spectrum at the top.

## Before/after feature matrix

| Existing capability | Preserved result and proof |
| --- | --- |
| Required email/password, autocomplete | Same IDs/types/required/form; visible labels all roles; email mobile keyboard hints added; empty/filled screenshots |
| Password visibility and submit re-hide | Same `/pw-toggle.js`; browser Show/submit checks |
| POST `/api/auth/login` and disabled signing-in state | Handler unchanged; safe pending response proves loading, disabled action, keyboard Enter |
| Honest 401/403/429/500 feedback and retry | Same failureText handling; four browser response cases; action re-enabled |
| Client token/role/account storage | Same storeSession; successful safe mock verifies clientId and role |
| Client `next=/app/client-portal.html` navigation | Same allowed destination; exact-path browser destination mock |
| Staff role and default `/app/` navigation | Same handler; safe staff session test verifies owner role and `/app/` |
| Forgot-password reveal and focus/email prefill | Same link/box IDs and handler; browser verifies focus and prefill |
| POST `/api/auth/reset` pending/sent/not-sent feedback | Same request handler, states and wording; safe mocks cover sent and unsent |
| Server-gated demo choices and current-role marker | Same GET `/api/auth/login`, empty static mount, roster/openAs handlers; disabled/one enabled server fixture; existing node demo tests |
| Demo switcher role home validation | Existing `/app/<page>.html` allow pattern unchanged; existing node tests |
| Support email, public home/back link | Existing destinations retained; no outbound emails sent |
| Existing client email-link sign-in | Added visible secondary link to existing `/portal-login.html`; no new authentication flow |
| Permissions / real account data | No role conversion, samples, credentials or data writes; server remains authority |

## Verification

- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_login.spec.mjs --workers=1`: **9 passed**, zero skipped. Empty/filled/loading/error at 1440/390/320; full server-enabled roster, reset sent/unsent, keyboard, password toggle, phone primary above fold, overflow, staff/client destinations and 429/403/500 feedback. Every API intercepted; external font/resource requests blocked.
- `node --test src/http/pw-toggle.test.mjs src/http/demo-logins.test.mjs`: **47 passed**, zero skipped.
- Visually reviewed 1440px and 390px raw empty renders. Marked review screenshots identify the real password form and visible primary action. All state screenshots use prefix `page_login-` in this folder.
- Lead owns combined lint, TypeScript and integrated regressions. Live sign-in/database state, production redirect security, vendor delivery and real credentials were not tested or claimed.

## Existing source-only concern, outside layout scope

Typed sign-in currently sets destination using `next && next.startsWith('/') ? next : '/app/'`. This accepts protocol-relative `//...` strings in source. This was present before this refinement; no production probe performed. Lead was notified and directed preserving the auth handler and recording a separate leftover. Ordinary relative client/staff destinations are tested; comprehensive sanitized-next security proof is **not claimed**. There is no challenge UI or challenge handler in this page to redesign; none was invented or removed.
