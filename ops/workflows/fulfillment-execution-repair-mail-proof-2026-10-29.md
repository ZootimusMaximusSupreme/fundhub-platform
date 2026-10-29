# Fulfillment execution — repair letter ID ownership proof (2026-10-29)

**Lane:** fulfillment execution only. This supplements `ops/workflows/fulfillment-execution-e2e-2026-10-28.md`, which is actively owned by PR #210; this PR does not edit that active file.

## Source-reproduced failure and narrow fix

`src/repair/send.mjs:claimLetterForMailing` previously treated a zero-row owner-scoped `UPDATE dispute_letters` as authorized to send. Its follow-up `SELECT` returning no rows also returned `claimed: true`. A staff request containing a **foreign client's, foreign organization's, or nonexistent explicit letter ID** could therefore reach the PostGrid adapter; the later `UPDATE` only modified owner-matching rows, so provider acceptance could have no correct matching mailing record. Replays could re-mail the same envelope. This is a source-level risk, **not evidence a real customer was harmed**.

The patch refuses all explicit letter IDs unless a same-org, same-client database row was actually claimed. Unknown/mismatched IDs are `letter_not_found_or_not_owned`; a failed lookup is `claim_failed`; an existing but nonclaimable row is `letter_not_claimable`. A missing database client refuses `claim_db_unavailable`. The legacy ad-hoc no-ID manual route remains unchanged to avoid silently disabling a different production workflow; it still lacks the stored-letter dedupe guarantee and requires separate product/operational review.

## Acceptance (source and isolated CI, NOT LIVE PROVED)

| Action | Required condition | Evidence/verdict |
|---|---|---|
| Staff repair send with explicit nonexistent letter ID | No outbound adapter; no mailing record | **FAIL baseline; fix proposed**, `src/repair/send-foreign-letter.pg.test.mjs` disposable SQL transaction; full CI pending |
| Staff send using a different client ID in same org | No adapter, no cross-client mail, original letter unchanged | **FAIL baseline; fix proposed**, same test |
| Staff send using another org's letter ID | No adapter, no cross-org mail, original letter unchanged | **FAIL baseline; fix proposed**, same test |
| Existing valid ready letter | Claim first; one adapter call, record accepted mailing | **NOT LIVE PROVED**; historical `src/repair/send-double-mail.pg.test.mjs` verifies duplicate prevention in isolated SQL, not actual PostGrid receipt |
| Ad-hoc send without saved letter ID | Must not generate duplicate physical letters on replay | **NOT LIVE PROVED / UNRESOLVED**; preserved behavior rather than altering a production route without product confirmation |
| Production mailer, role screen, provider receipt, and deployed `main` | Positive read-only proof | **NOT LIVE PROVED**; no production send or customer write authorized |

This isolated branch does not modify A/R, front-house, or any active fulfillment PR #210 files. Merge only after all required checks pass. A green CI is not mail-provider delivery proof.
