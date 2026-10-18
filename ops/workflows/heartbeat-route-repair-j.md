# Heartbeat Route Repair J

Date: 2026-10-18 Arizona
Branch: `codex/heartbeat-route-repair-j`
Base: `codex/heartbeat-route-proofs` at `03e8b1da15f48c05b63eea29f4ba19588214ee40`

## Workflows

| Workflow | Owns | Status |
|---|---|---|
| J1 | Inquiry and PII company isolation | complete |
| J2 | Climate county, inquiry open-only, contract sender notice, incorporation stamp | complete |
| J3 | Marketing batch cap | complete |
| J4 | Exact proofs, guards, lint, types, commit | complete |

No agent runner is available in this session, so J1-J3 are being completed in this isolated worktree without touching the dirty base checkout.

## Scope

Only these seven Route G gaps:

1. Climate geocode county result.
2. Inquiry open-only result.
3. Contract decline sender notice.
4. Soft-pull incorporation stamp.
5. Inquiry clear company scope.
6. PII company scope.
7. Marketing batch cap.

## Proof law

- Fake data or scratch database only.
- No production writes, sends, money, environment edits, or shared catalog regeneration.
- Keep a row red until its real handler-result test passes.
- Do not weaken a guard or change the catalog row's claim.

## Change manifest

- Climate geocode returns a real county from Google or Census geographies; state-centroid fallback returns `county: null`.
- Inquiry's default case list excludes Completed and Canceled; an explicit status still reads closed history.
- Contract decline writes one idempotent task assigned to the original sender, in the same transaction as the decline.
- `stamp_incorporated` is restored with staff role, company/client and business-name scope.
- `clear_inquiry` scopes lookup, inquiry update, recount, case completion and event inputs to the session company.
- PII masked read, history, reveal and store require the client to belong to the session company; underlying PII queries are scoped too.
- Marketing costs now returns `batch.cap_usd` from saved settings.
- Seven exact route proofs attached. Route gap lane measured from 8 rows to 1; the only remaining row is the separately retired `closer-deck send_ebook` action.

## Verification

- Focused product + proof suite: 1,098/1,098 passed.
- Relevant PII, inquiry, auth, climate and route guard tests passed; the climate browser test passed when rerun with its localhost listener allowed.
- `npx tsc --noEmit`: passed.
- `npm run lint`: 3,963 files and inline scripts parse clean.
- Shared generated catalog was not regenerated. No production database, send, money or environment write was used.
