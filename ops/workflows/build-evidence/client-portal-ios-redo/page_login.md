# Password sign-in — before/after feature matrix

Owner: page_login. Route: `/login.html`; client presentation only for exact `next=/app/client-portal.html`, or verified client activation from shared foundation. Staff default page remains unchanged in appearance and behavior. The public marker grants no session or permissions.

| Existing feature/control/state | After | Proof |
| --- | --- | --- |
| Email/password required form, autofill | Original inputs/IDs and validation retained; client labels added | Browser empty + entered states |
| Password Show/Hide | Original shared toggle retained; client touch target enlarged | Browser Show then submit hides password |
| POST `/api/auth/login`, loading/disabled submit | Original signIn/storeSession/failure logic untouched | Browser pending reply + keyboard Enter |
| 401/error messaging, retry controls | Original handler retained; styled alert live region | Browser failed reply |
| Role/account/token storage; `next` redirect | Original handler retained | Browser successful mock verifies client role and clientId |
| Forgot-password reveal, email prefill/focus | Original handler retained | Browser reveal + prefill/focus |
| POST `/api/auth/reset`, sending/sent/not-sent messages | Original handler retained | Browser safe mocked sent/not-sent replies |
| GET `/api/auth/login` server-gated demo roster, role switch actions | Original roster and openAs handler retained; no credentials added | Browser disabled and enabled server roster |
| Support email, forgotten password, back-to-site links | Original links retained | DOM preserved |
| Staff default styling and auth behavior | No client marker on ordinary login; page CSS scoped | Browser default isolation |

## Verification

`PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_login.spec.mjs --workers=1` — five safe-mock browser cases cover 1440, 390, 320 widths; empty/loading/error/full, keyboard, password toggle, reset feedback, staff isolation and client session navigation. Screenshots named `page_login-*` alongside this file. No live accounts, writes, messages, or credentials used.

The first run exposed a test selector using visible Show text instead of its accessible Show password name; fixed test. Another mock path glob matched the login `next` query; fixed to exact pathname. These were test harness errors; no auth logic was changed. Final run: **5 passed (3.5s)**. Reviewed the 390px screenshot visually. Red-box review images identify the retained client sign-in controls; raw state screenshots remain available. Lead owns repository lint/TypeScript/combined regression checks. Database and live auth integration were not proved by mocked browser tests.
