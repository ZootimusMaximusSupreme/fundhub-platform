# Company Brain and Drive sync

Lane only. Read only. One tripwire: Recon (AG-07) on the morning pulse. No second watchdog.

Do not run a new Drive sync. Do not upload.

## Checks

| id | What it looks at | FAIL when |
|---|---|---|
| brain:drive-last-error | `brain_drive_sync.last_error` for this company | any last_error is set |
| brain:drive-sync-stale | `brain_drive_sync.last_sync_at` | no scan, or the last scan is older than 30 min (3 times the 10 min Meet sweeper) |
| brain:search-read-route | GET `/api/read/company-brain` and GET `/api/read/company-brain-affiliate` | either door answers 500, or any status the morning ping treats as down |

PASS, FAIL, or skip. Shape is `{ id, status, detail, suggestedFix }`.

A missing database skips the two Drive reads. A missing fetch skips the route probe. The probe is GET only. It does not call the sync door or the upload door.

## Files

- `src/pulse/coverage/gap-brain.mjs`
- `src/pulse/coverage/gap-brain.test.mjs`

## Test

`node --test src/pulse/coverage/gap-brain.test.mjs`

7 tests, 7 pass, 0 fail, 0 skipped. No Drive sync. No upload.
