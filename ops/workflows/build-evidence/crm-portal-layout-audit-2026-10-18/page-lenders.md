# Lenders workspace — recovered source

Recovered from the assigned builder's retained tool arguments onto production base 0998ff49969c6e2663a6e1851b4634ab5896113d. This is page-only source recovery. The current production sidebar is left intact for root's shared foundation integration. Every existing static ID is retained; the legacy clock ID/handler remain hidden while the shared header owns visible identity, scope, Search, Chat and Account.

## Feature preservation matrix

| Contract | Preserved behavior / presentation refinement |
| --- | --- |
| Product tables | Exact seven values: OnlineBizCC, InBranchBizCC, BizLOC_Stated, BizLOC_Documented, PersonalCC, PersonalLoans, PersonalLOC |
| Six filters | Existing fTable/fBureau/fTier/fActive/fState/fQ IDs and exact lender_table/bureau/priority_tier/active/state/q keys; Enter submits |
| Whole lender book | GET /api/read/lenders without a limit; all returned rows remain |
| Client scope | GET /api/read/lender-matches with client_id and optional lender_table; no change to match semantics |
| Inline record | Same seven editable data-f fields and logo fallback; states grouped with requirements; full name/value retained |
| Save/create | POST /api/lenders save/id/patch and create/selected-table/name/active bodies; null/boolean/tier semantics preserved |
| CSV import | Same toggle/cancel/run IDs, CSV body, imported/updated/issues response details; focus returned on Cancel |
| CSV export | Exact six-filter query plus format=csv; same lenders.csv Blob download |
| Mismatch queue | Same pending/mismatch-only query, lender/table/expected/observed/source/client/notes, and confirmed/corrected/dismissed statuses and IDs |
| Bureau routing | Same GET/POST endpoints; code/name/service/IVR/menu/hold/active fields; existing save versus new upsert; zero versus null preserved |
| Proxy Apply | Only client scope + application_url + FHProxyApply; same client/lender IDs and data attributes; no direct bank link or bank launch during fixtures |
| Permissions | No API, auth, role, shared shell or navigation changes; owner/admin/funding_advisor lender gates remain |
| States | Explicit loading skeleton, empty, load error and retry for list/review/bureau; no error-shaped data counted as successful emptiness |
| Layout | Warm neutral page, compact editable desktop table, labeled phone record cards, all three named views visible, optional phone filter disclosure |

## Exact files recovered

- public/app/lenders.html
- public/app/lenders.css
- e2e/lenders-layout.spec.mjs
- src/pulse/catalog/proofs/fin-b14-lenders.test.mjs
- This page-specific evidence/feature note.

The focused existing proof only replaces obsolete layout assumptions: seven unique editable fields are checked regardless of grouping, the named Updated cell replaces a numeric column index, and a dropped read now requires the error/retry state rather than misleading sign-in speculation. No behavioral proof is removed.

## Verification status

**Recovery has not been run in Chromium, Node tests, lint, TypeScript or live accounts.** The executor/filesystem is unavailable. Root must run fresh checks after integration with the current shared foundation. In-memory V8 syntax parsing and source checks during recovery are not runtime/browser proof.

Historical, prior to executor loss: 25/25 lender Playwright cases and 47/47 focused Node/role/proxy proofs passed. Those are retained history, **not new passes for this commit**. The 18 historical screenshots are unavailable as files and are not recreated or represented as current proof.

The restored focused Playwright test can regenerate 18 red-box/caption screenshots (1440/390/320 × full/empty/loading/error/review/bureau) using LENDERS_CAPTURE=1 after integration:

    PLAYWRIGHT_CHROMIUM=/path/to/chromium LENDERS_CAPTURE=1 node node_modules/@playwright/test/cli.js test e2e/lenders-layout.spec.mjs e2e/lenders.spec.mjs e2e/fin-b15-lenders-dismiss.spec.mjs e2e/lenders-inquiry-ops.spec.mjs --grep 'lenders.html|Dismiss|Confirm and Corrected|a Dismiss|px |contracts|client scope|errors offer'

Focused existing deeper proof command:

    node --test --test-concurrency=1 src/pulse/catalog/proofs/fin-b14-lenders.test.mjs src/pulse/catalog/proofs/fin-b07-apply-dialog.test.mjs src/pulse/catalog/proofs/s4-lenders.test.mjs src/http/lenders-role-gate.test.mjs src/pulse/catalog/proofs/fin-b14-rows.test.mjs

The S4 Node harness historically did not read PLAYWRIGHT_CHROMIUM; use the runner's provisioned Chromium/default cache or root's existing runtime preload. Do not install or change shared harness merely to make the page's historical result appear green.

## Retained known defects

The existing catalog intentionally pins these source-known defects; they remain unchanged and are not claimed fixed:

1. An HTTP-refused export can still download its response body as lenders.csv.
2. Adding a bureau row redraws and loses unsaved edits in other bureau rows.
3. An emptied lender name is still posted as null.

These KNOWN BREAK tests remain in the focused proof and their rows remain unattached. No real customer, lender, bank, money, database or outbound writes. No deployment or main/shared/workflow changes.
