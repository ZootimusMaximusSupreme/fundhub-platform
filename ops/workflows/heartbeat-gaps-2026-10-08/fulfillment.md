# Fulfillment gaps — staff desks

Fundhub staff fulfillment only. Funding desk and credit repair desk: queue, next step, docs, apply. Not letter copy. Not inquiry.

Read only. Recon (AG-07) is the one tripwire. No second watchdog. Do not apply to a real lender. Do not upload.

This lane does not repeat slice 33. Slice 33 only checks that the desk doors are on the morning list.

## Checks

| id | Break | FAIL when |
|---|---|---|
| fulfillment:next-action | File sitting with no next step past the wait the code already defines | A non-demo funding or repair queue file has a blank next step, and it is past its clock. Repair clocks are `src/repair/sla.mjs` (`isBreached`). Example: letters generated may sit 30 minutes; a bureau answer may sit 5 days after the due date. Funding queue clocks are 3 times the next-action catch-up (`*/5`, so 15 minutes), the same red window the job heartbeat already uses. Demo rows are left out. |
| fulfillment:api | Fulfillment API 500 | A GET to the queue, next-step, docs, repair-case, or apply-read door answers 500, another dead status, or cannot be reached. 200, 400, 401, 403, and 405 mean the door is up. This check does not POST. It does not open apply launch or upload. |
| fulfillment:apply-blocked | Apply step blocked with no reason stored | An application is `Missing Docs` or `Action Required` and both the condition text and the decision note are blank, or a proxy apply row is `failed` or `mismatch` and both error fields are blank. |

No database in the run: the two row checks are `skip`. No fetch in the run: the API check is `skip`.

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`. A FAIL names Recon (AG-07) and does not add another watcher.

## Files

- `src/pulse/coverage/gap-fulfillment.mjs`
- `src/pulse/coverage/gap-fulfillment.test.mjs`

## Prove

`node --test src/pulse/coverage/gap-fulfillment.test.mjs`
