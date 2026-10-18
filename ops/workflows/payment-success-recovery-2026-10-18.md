# Payment Success recovery — 2026-10-18

Restored the completed page from the original builder's retained patch after the source executor went offline. This is recovery of the already-tested page, not a new redesign.

## Source identity

- Recovery branch: codex/recover-payment-success, based on main0998ff49969c6e2663a6e1851b4634ab5896113d.
- Core commit: a4f92ac57ac4f045ead54f2f6e80f4a63702a0c9.
- public/app/payment-success.html blob: 402cfccf464463e0bbf005fa4c73b4ab49e36ae0. Its prefix matches the retained final local diff exactly.
- A programmatic string comparison confirms the inline payment/account script is identical to main except the original aria-busy setter and checking flag.
- Shared navigation, sidebar bytes, fonts, API handlers and server code were not edited.

## Preserved inventory

| Feature | Preserved behavior |
| --- | --- |
| Public return page | No CRM shell or staff navigation |
| Read API | GET /api/read/entitlements?limit=200 with optional validated client_id |
| Authentication | fh_token Bearer and credentials: same-origin |
| Account fallback | Valid query UUID, then fh_account.clientId/client_id; malformed values discarded |
| Role/scope boundary | Active own-client rows; unknown scope cannot mix two people |
| Baseline | First successful read remembers codes; old access is never called newly opened |
| New access | Only subsequent new codes produce Just opened on your account |
| Empty/held | Six reads, honest wait state, conditional instructions and Check again |
| Loading | Local progress state and attempt count, plus aria-busy |
| 401/403 | Stops after one read; truthful cannot-check state and portal route |
| Network/error data | Six bounded attempts, then unreachable; no invented success |
| Retry | Existing again ID/handler, original baseline retained |
| Portal | Existing back ID and relative client-portal.html with known client_id |
| Reference | Existing refline ID, plain-text ref, hidden when absent |
| Escaping | Entitlement names and codes remain escaped |
| Payments/refunds | No payment endpoint, payment write, refund action or entitlement authority added; page cannot confirm payment |

Warm neutral page structure, system-rounded typography inherited from shared branding, a white status card and one black portal action are restored exactly. The footer spectrum remains restrained. Payment state copy remains unchanged.

## Historical checks from the original completed executor

These were actually run before the executor went offline. They are historical results, not claimed reruns of this GitHub recovery.

- Original-source captures: 2 passed at 1440 and390.
- Final e2e/payment-success-layout.spec.mjs: 18 passed in25.2s, covering1440/390/320 × full/empty/loading/error, keyboard retry, touch portal navigation, auth/scope/escaping, real three-second cadence and stop at six.
- src/payments/commas-api.test.mjs: 24 passed,0 skipped, mocked providers only.
- Changed test syntax, inline script syntax and scoped diff check: passed.
- src/pulse/coverage/gap-portal.test.mjs:78 passed,1 failed. The unrelated portal-login asset expectation at line868 expected only /fh.css while the page also named client-ios.css, portal-login-ios.css and client-ios.js. Reported to lead; no unrelated test was changed.

## Current recovery checks and limitations

GitHub fetch verified the pushed page matches the reconstructed content and original completed blob prefix. Only page source, its focused test and this note are committed on the recovery branch. No deploy, real payment, customer write, outbound send or credential operation occurred.

The original14 red-box/caption screenshots are stranded with the offline executor. They have not been recreated or presented as current evidence. The restored test retains its opt-in capture helper to produce new marked evidence in an available browser runtime. Browser tests, lint and TypeScript could not be rerun in the unavailable original executor. Lead owns current shared-font/head/sidebar reconciliation and combined release verification.
