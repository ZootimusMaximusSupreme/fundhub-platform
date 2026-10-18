# Consent Capture retained-source recovery

Original sole builder: /root/page_consent_capture. Recovery starts exactly at main0998ff49969c6e2663a6e1851b4634ab5896113d on codex/recover-consent-capture. Original executor is offline; source was recovered from this builder's retained conversation source, not rebuilt with a second builder. Base HTML retained current shared/sidebar markup. Page font inherits shared --sans; shared font/sidebar integration belongs to lead.

Source commits: d20402a1c4f318e57834b75dc8cf1023daf50906 (CSS), 2d50f98414bd9b472e02904999ba8ecd820eee0d (HTML). Test head52a5bf00be50f119265626af7bb8109da4328840.

## Feature preservation matrix

| Existing contract/control | Recovered behavior |
| --- | --- |
| Staff-only consent desk; clients use inline portal consent | Same shell boundary; role regression asserts client redirect and zero capture writes |
| Four independent kinds, unknown defaults to soft pull | Unchanged |
| GET /api/consent/capture?client_id=…&kind=…; same-origin credentials | Unchanged |
| Disclosure server text/version; escaped rendering | Unchanged |
| Loading, empty, valid, expired, revoked and transport/API refusal | Same state logic and feedback |
| Typed name, checkbox, signature method | All IDs/handlers retained; aria-pressed added |
| Required name/ink, canvas clear and optional expiry | Retained |
| POST grant client_id/kind/action/capture_method/granted_name/consent_version/optional expires_at | Unchanged |
| History validity/date/method/name/recorder/expiry/revoked reason | All retained in responsive record layout |
| Withdraw prompt, mandatory reason, cancellation; POST revoke consent_id/client_id/reason | Unchanged |
| Back links with client_id and dispute portal return | Unchanged |
| Technical consent URL instructions | Retained under expandable explicit label |
| Save success/error messages | Retained; polite live region added |

## Exact owned paths

- public/app/consent-capture.html
- public/app/consent-capture-workspace.css
- e2e/consent-capture-workspace.spec.mjs
- This note

No APIs, shared CSS/JS, sidebar/navigation, permissions, disclosures or payloads changed. No live consent, legal signature, customer, money or outbound writes. Mock browser signature is a fixture only.

## Verification and review

Original cloud runtime focused run:20 passed (15.9s), existing17 click/kind regressions +3 layout cases. This is historical evidence, not a fresh recovery pass. Original screenshots cannot be fetched from the offline executor. Fresh GitHub Actions proof is lead-owned and pending at note creation; root reports successful source integration run39172918800. Do not claim fresh browser/database/performance passes from this note.

Recovered browser spec covers1440/390/320 loading/empty/full/error, keyboard picker, drawn fixture signature, touch Clear, required ink, exact refused-grant payload, expandable instructions, no page overflow and client role redirect. It attaches12 rendered fixture screenshots through Playwright test.info attachments for GitHub Actions artifact preservation. Existing consent-capture-clicks.spec.mjs and consent-capture-kinds.spec.mjs supply all kinds, expiry, revoke/cancel/refusal regression coverage.

Lead must run combined lint/TypeScript/browser checks with current shared assets. No production deploy was run by this page builder.
