# F-05 inquiry cleanup — focused fulfillment acceptance supplement (2026-10-28)

**Parent audit:** [fulfillment-execution-e2e-2026-10-28.md](fulfillment-execution-e2e-2026-10-28.md). **Lane:** fulfillment execution only. **Status:** OPEN / NOT LIVE PROVED. This supplemental matrix avoids editing the parent board while the separate #192 fulfillment PR is still changing it; integrate this evidence back into the parent board after #192 merges.

## Reproduced source-level defect

In main before this PR, `src/workflows/f-05-inquiry-cleanup-gate.mjs` changed `inquiry_log.status` to `Pending Removal` where `client_id = $1`, excluding only `Removed` and `Pending Removal`. It did **not** filter `org_id`, `is_open` or `confirmed_at`. A cleared row could be marked pending again, and a mismatched tenant row with the same client UUID could be modified. Its generic `resolveClient` also permitted a downstream round-approval event to create an unrecognized customer (when email-only) or patch an explicit client ID before tenant membership was checked.

**Repair on this PR:** demand an existing same-org client, including email-only legacy fallback; do not create/backfill/patch contacts from `round.approved`. Filter the `inquiry_log` write by both tenant and customer. Preserve rows with `is_open=false`, `confirmed_at` set or terminal statuses (Removed/Cleared/Confirmed/Deleted). Keep open `New`/`Active`/`unconfirmed` rows eligible and retain idempotent `Pending Removal` behavior. This is NOT a claim that the round was funded or that a bureau actually removed an inquiry.

## Exact acceptance matrix (isolated tests, no production writes)

| ID | Event / role | Expected database behavior | Evidence & current verdict |
|---|---|---|---|
| F05-01 | `round.approved`, funding ops, tenant A client A | Open `New`/`Active` `inquiry_log` rows become `Pending Removal`; only those rows count as updated | `f-05-inquiry-cleanup-gate.test.mjs` open-inquiry scenario; `*.pg.test.mjs` local TEMP transaction. **NOT LIVE PROVED** until blocking CI and deployment verified. |
| F05-02 | Same event replay | 0 extra updates, no new customer, no new task, no provider send | Mock replay and real-PG replay test, CI pending. **NOT LIVE PROVED** |
| F05-03 | Foreign `org_id` row with same `client_id` (defense in depth) | Do not change foreign row, even for damaged cross-tenant data | Local mock and real PG foreign-row fixture, CI pending. **NOT LIVE PROVED** |
| F05-04 | Event says tenant B but client UUID belongs to tenant A | Refuse before mutation; no fallback to tenant A | Mock and real-PG rejection, CI pending. **NOT LIVE PROVED** |
| F05-05 | `Removed`, `Cleared`, `Confirmed`, `Deleted`, or `confirmed_at` set | Preserve exact status and external evidence; never resurrect as open | Mock + real PG fixtures, CI pending. **NOT LIVE PROVED** |
| F05-06 | `is_open=false`, even if status is `Active` | Do not reopen confirmed/closed work | Mock + real PG, CI pending. **NOT LIVE PROVED** |
| F05-07 | Legacy `round.approved` with existing email only | Resolve already-existing same-org client case insensitively, then update its open inquiries | Mock + real PG, CI pending. **NOT LIVE PROVED** |
| F05-08 | Unknown email, missing org, or missing client | No new CRM/customer row, no inquiry write or real messaging; reason returned to workflow | Mock + real PG unknown email and missing-org fixtures, CI pending. **NOT LIVE PROVED** |
| F05-09 | Live inquiry specialist queue and client portal | Queue reflects exact `inquiry_log` statuses after deployed flow, no stale pending on previously cleared row | **NOT LIVE PROVED** — requires authorized read-only role and event/row trace. |
| F05-10 | Production provider effects | No false letter-sent, bureau-accepted, cleared, or funding-completed claim from changing status | **NOT LIVE PROVED** — production provider/bureau receipts not collected. |

**Test isolation:** `src/workflows/f-05-inquiry-cleanup-gate.pg.test.mjs` explicitly permits only localhost/loopback `test`/`scratch`/`_ci` database names; uses transaction-local temporary shadow tables and ROLLBACK. Real Postgres service in GitHub Actions is disposable and is **not** Supabase production. CI must include the exact new `.pg.test.mjs` case **running, not skipped**, plus full blocking checks. Browser tests/normal unit tests alone cannot prove external fulfillment.

**Separation:** Front-of-house owns purchase and assignment; A/R owns receivables. This fix does not touch #187 or #192 source files, invoice code, client-facing HTML, payment routing, secrets, or production data. No actual bureau requests, emails, SMS, lender submissions, or payment operations are authorized by this proof.
