# Fulfillment execution — bureau response document ownership (2026-10-29 UTC)

**Owner:** independent fulfillment lane. **Status:** OPEN — production not certified. Supplemental evidence to `ops/workflows/fulfillment-execution-e2e-2026-10-28.md`; the live #210 PR is currently editing that primary board, so this branch does not overwrite it.

## Reproduced source-level failure (before proposed patch)

`docs.received(kind=bureau_response)` triggers `src/workflows/repair-bureau-response.mjs` → `onBureauResponseDocsReceived` → `processBureauResponse`. Previously `loadDocumentBytes` called `resolveStorageTarget({ documentId, versionId })` with no organization or client ownership check. The helper explicitly returns raw object-storage credentials and its SQL accepts document IDs across all customers/orgs. A forged, delayed, stale, or misrouted event carrying another customer's document ID could fetch their confidential letter and send it into the AI model under the receiving customer's identity. The downstream path could queue a retake/results email, advance repair dispute status, or log an incorrect reply. The previously existing unit tests bypassed this document access by injecting bytes and using non-UUID document IDs; they provided **no cross-tenant proof**.

**This is a source-reproduced unsafe call path, not evidence of actual misuse or an observed production leak.** Never use live clients to reproduce it.

## Acceptance matrix — exact scenarios

| ID | Action / expected invariant | Engineering verdict | External/live verdict |
|---|---|---|---|
| R-07A | `docs.received` refers to a bureau-response PDF owned by event org/client, not expired, current version | Candidate PASS with new synthetic unit+PG tests; CI pending | **NOT LIVE PROVED**: authentic upload, model job, staff/client role-read and production version require authorized read-only evidence |
| R-07B | Event org is right but uploaded response belongs to another client | **FAIL in pre-fix source**, proposed guard refuses before object-store, model, messaging or repair edits; fake and disposable-PG coverage | **NOT LIVE PROVED** |
| R-07C | Document belongs to a different organization | **FAIL in pre-fix source**, proposed guard requires `documents.org_id` and `client_id` both match | **NOT LIVE PROVED** |
| R-07D | Event is from same client but points to their photo ID, bank statement, contract or other non-bureau document | **FAIL in pre-fix source**, proposed `kind=bureau_response` check prevents model upload and repair events | **NOT LIVE PROVED** |
| R-07E | Event version ID belongs to a different document or different organization, despite a valid parent ID | **FAIL in pre-fix source**, proposed version join checks exact document and org; second storage target check also validates org/client | **NOT LIVE PROVED** |
| R-07F | Document expired or missing; event has malformed UUIDs | **FAIL in pre-fix source**, fail closed with `bureau_response_document_unavailable`, no side effects | **NOT LIVE PROVED** |
| R-07G | Valid document uploaded twice / replayed payload | Ownership tested; **NOT LIVE PROVED** end-to-end dedupe of parse insert, individual item updates, notifications and provider outcomes | **NOT LIVE PROVED** |
| R-07H | Letter image content integrity and provider storage target | Proposed read supplies expected checksum to `store.get` and rechecks owner; checksum and object-store integrations are **NOT LIVE PROVED** | **NOT LIVE PROVED** |
| R-07I | Staff audit / client portal sees the correct bureau response, escalation round and reply under correct tenant after refresh | No authenticated production browser session tested | **NOT LIVE PROVED** |
| R-07J | AI model data-handling/privacy compliance and upload classification are verified before release | Legal/security compliance assessment not completed by this code-only change | **NOT LIVE PROVED** |

## Patch and test scope

- `src/repair/response-agent.mjs`: reject malformed/non-owned document, wrong kind, wrong-version and expired records before raw bytes, AI calls, emails or dispute advancement. Scope org and client in actual SQL, verify version join and raw storage-target ownership. Preserve valid retake and parser flow.
- `src/repair/response-agent.test.mjs`: make previously mocked synthetic uploads real UUIDs and model an owned document SQL row.
- `src/repair/response-agent-owner-guard.test.mjs`: negative scenarios and valid retake through a mock model; verify no side effects on foreign, expired, wrong kind/version documents.
- `src/repair/response-agent-owner-guard.pg.test.mjs`: require `CI=true` and loopback `/fundhub_ci` only, shadow public tables with temporary tables, roll back all inserts; prove actual org/client/kind/expiry/version SQL. No Supabase, model, mail, bureau or customer data touched.

**Pre-merge gate:** all 14 required GitHub Actions checks, including non-skipped Postgres and browser, must be successful on the exact head; merge only if protected branch permits. **Post-merge:** combined-main CI, successful matching production deployment, read-only authorized staff/client status and actual provider receipts. All production steps remain NOT LIVE PROVED until evidenced. This lane does not send the front-of-house owner SMS.
