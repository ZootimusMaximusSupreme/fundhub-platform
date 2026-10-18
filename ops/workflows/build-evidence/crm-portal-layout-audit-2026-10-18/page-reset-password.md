# Reset password — recovered completed page

The completed single-builder reset-password redesign was recovered from this agent's retained source and tool arguments after the local executor went offline. Core HTML/CSS was pushed first as a67abad2ab957dfc21fc2e734d9bbb5815844fe5 on codex/recover-reset-password. The branch starts at main 0998ff49969c6e2663a6e1851b4634ab5896113d.

The current-main reset-password HTML was checked before recovery: blob 76b5f6700dbcfa1fba75cd0088213276681639a3 exactly matches the original pre-redesign page inspected by this builder. The API handler api/auth/reset.mjs was also fetched and its confirm contract is unchanged. No reconciliation of API behavior was needed.

## Source and scope

- public/reset-password.html
- public/reset-password.css
- e2e/page-reset-password.spec.mjs
- This recovery note.

No shared font, navigation, API, credential, session or backend files were changed. Lead owns shared rounded type and final integration. This branch is a recovery branch, not a production deployment.

Presentation retains the completed warm off-white screen, near-black primary action, rounded system typography, visible input labels, 52px fields/actions, 44px Show/Hide targets, restrained spectrum accent, and useful missing-token/success headings. Both original sign-in destinations remain.

## Before/after feature matrix

| Existing behavior | Recovery result |
| --- | --- |
| Seven original IDs: err, noToken, f, pw1, pw2, go, okMsg | All retained |
| Token read with URLSearchParams(location.search).get("token") | Same expression, no role/session gate added |
| Missing/blank token hides form | Retained; no API call; invite 7 days/reset 1 hour/one-use text retained |
| Required password fields, minimum 12 characters, autocomplete=new-password | Retained; persistent labels added |
| Shared /pw-toggle.js, Show/Hide, aria-pressed and cover on submit | Shared file retained unchanged; 44px local touch target styling |
| Mismatch text and no request | Retained; aria-invalid and confirmation focus added |
| POST /api/auth/reset with JSON {action:"confirm",token,password} | Exact endpoint, method, content type and payload retained |
| Pending Setting… and disabled submit | Retained; aria-busy added and cleared |
| API detail or invalid/expired fallback, re-enabled retry | Retained; focused alert |
| Malformed response fallback | Retained; no false success |
| Network error and retry | Retained |
| textContent for server detail | Retained; no HTML execution |
| Only data.ok shows success and hides form | Retained |
| All-device sign-out text and /login.html links | Both retained |
| Real token validity/consumption, password hashing, account scope/session revocation | Backend untouched; never replaced with client claims |

## Historical proof, retained from the completed local build

Before the executor failure, the final page and this focused spec passed:

- 10/10 offline Playwright cases using the repo config/static server and preinstalled Chromium.
- 1440x900, 390x844 and 320x844 empty, filled, pending, expired, retry/success, missing/blank token states.
- 320x568 hasTouch context: Show/Hide taps do not submit; submit reaches fixture success.
- Keyboard Tab/Enter toggles, submit, mismatch focus, error focus, success focus and back link focus.
- Exact reset payload, short-password/mismatch no-request paths, malformed JSON, network abort and literal untrusted server detail.
- No horizontal overflow or page errors in the core flow.
- 23/23 existing src/auth/invite.test.mjs and src/http/pw-toggle.test.mjs checks, 0 skipped.
- Page inline JavaScript syntax and git diff whitespace check passed.
- Marked before/after captures were visually inspected at desktop and phone sizes.

These are historical checks from the completed build, not a fresh run of the recovered GitHub branch. The old binary captures were stranded in the offline filesystem and are not claimed to be present here. The recovered spec recreates state captures and geometry metadata when run.

## Recovery-time proof and next integration

The recovered HTML's inline script and the recovered spec (with module imports removed for parsing) parse successfully in the functions V8 runtime. Source/API contracts were compared with main 0998ff4 through GitHub connector reads.

Fresh Playwright, full lint, TypeScript and integrated browser proof were not run in this recovery step because the local executor/filesystem is offline. Lead will integrate current shared rounded type and run current browser proof. No live password reset, customer data access, credential change, production write or deployment was performed.
