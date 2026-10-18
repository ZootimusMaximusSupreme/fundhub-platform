# Portal sign-in — professional layout refinement

Sole retained builder: `/root/page_portal_login`. Scope: `public/portal-login.html`, `public/portal-login-ios.css`, focused `e2e/page_portal_login.spec.mjs`, this page's evidence. No auth backend, credentials, account permissions, password page or shared foundation changed.

## Result

Matches the Fundhub Mac Welcome family: warm `#f8f8f6` canvas, compact near-black rounded system type, one Fundhub identity, deliberate spacing, 52px black primary action and white outlined secondary, neutral divider, restrained 3px spectrum at the lower edge. Removed violet gradient, floating card/shadow and oversized welcome. Explicit task heading and existing real email magic-link form. Password choice now visible through the existing `/login.html?next=%2Fapp%2Fclient-portal.html` route. Both choices fit above the fold at 1440/390/320 × 844. No fabricated inline password form/API.

## Before/after inventory matrix

| Control/state/contract | Before | After / proof |
| --- | --- | --- |
| Email required, type=email, autocomplete, query prefill | Existing | IDs, attributes, handler and prefill unchanged; explicit label retained |
| Submit `POST /api/auth/magic-link`, JSON `{email}` trimmed | Existing | Inline script byte-identical to branch HEAD; fixture POST assertion passes |
| Sending label, disabled action | Existing | Preserved; all three widths pass |
| Generic account-private sent panel, hidden form/lede | Existing | Preserved; all three widths pass; password fallback remains available |
| API/network/rate limit errors, retry; escaping | Existing handler | Untouched; fixture error/retry passes; backend rate-limit unit assertion passes |
| Token landing `POST /api/auth/magic-link-verify` | Existing | Unchanged; expired-token test passes |
| Strip credential before verify; expired/network restores form; never infer email | Existing | Unchanged; URL/body/empty-email assertions pass |
| `fh_token`, `fh_account`, `fh_role`, stale identity removal | Existing | Unchanged; session replacement assertion passes |
| Clear offline `fh_demo`/`fh_demo_staff` on real login | Existing | Unchanged; fixture assertion passes |
| Validated redirect handling / fallback portal | Existing | Inline auth and redirect helpers unchanged; own success redirect test passes |
| Existing password sign-in | Unavailable from portal entry | Clear secondary link to real existing login, exact `next` asserted at each width; existing password success/error tests pass |
| Home link, metadata, favicon/noindex | Existing | Retained; one Fundhub brand |
| Keyboard/touch/accessibility | Label/status/alert/focus | Preserved; Enter submits from focused button; 52px controls; overflow checks pass |
| Dedicated public activation at first paint | Existing static opt-in | Retained; measured CLS 0 |

No page-owned entitlements, uploads, downloads, signature, consent, agreements, payments, courses, booking, advisor/chat, score, PWA, push or referral features existed here. Portal destination and all downstream behavior are preserved through unchanged authentication. No API route or heartbeat surface added.

## Verified

- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_portal_login.spec.mjs e2e/login.spec.mjs --workers=1`: **9 passed**, 0 skipped (3.7s). Own five cases plus four existing login tests. Every email API write intercepted; no real message sent.
- `node --test src/auth/magic-link.test.mjs`: **13 passed**, 0 skipped. No database behavior claim.
- Authentication inline script compared byte-for-byte with branch HEAD: **unchanged**.
- 15 page screenshots: 1440/390/320 × empty/sending/error/sent plus marked review at each width. Marked views draw a red box around restored password choice and a short caption; unmarked views are the actual page.
- Visually inspected actual 1440 and 390 renders. Phone and desktop show both sign-in choices clearly; browser asserts narrow 320 overflow and password above fold.
- Existing shared lab runner: portal LCP **608ms**, CLS **0**, TTFB **6.7ms**, transfer **26,708 bytes**, JavaScript **9,444 bytes**. 390px, 150ms latency, 1.6Mbps, 4x CPU, safe mocked API fixture. Own extracted result: `page-portal-login-lab.json`.

## Limits

INP, production backend performance, real account login, DB-based verification and real email delivery unrun. Combined lint/TypeScript and repository-wide regression owned by lead. Existing shared lab runner also writes its existing `client-portal-ios-redo/performance-lab.json`; lead notified to reconcile incidental shared evidence. No commits, deployments or source permission changes.
