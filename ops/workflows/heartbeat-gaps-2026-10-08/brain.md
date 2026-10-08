# Company Brain search

Lane only. Read only. One tripwire: Recon (AG-07) on the morning pulse. No second watchdog.

Do not run a new Drive sync. Do not upload.

## Already watched (not repeated here)

| Break | Who already watches it |
|---|---|
| Drive sync `last_error` set | `meet-transcript-sweeper` in `src/pulse/machine.mjs` (`checkMeetTranscripts`) reads `brain_drive_sync.last_error`. |
| Drive scan older than the job allows | The same check. Red after 30 minutes (3 times the 10 minute sweeper). |
| Search / read door answers 500 | The morning list pings `read/company-brain` and `read/company-brain-affiliate` (`reg:` rows). |

## Checks

| id | What it does | FAIL when |
|---|---|---|
| `brain:search-staff` | Runs the real staff search door (`api/read/company-brain.mjs`) on the real database. | The door throws, answers 500, or answers anything but 200 with `ok: true`. |
| `brain:search-affiliate` | Runs the real affiliate search door (`api/read/company-brain-affiliate.mjs`) the same way. | Same. |

How: the door's own code runs. The sign-in step and the AI step are swapped out. The search vector is a fixed stub, so no AI call is made and nothing is spent. Chat history saving is switched off, so nothing is written. The search SQL runs read only, limit 1.

PASS, FAIL, or skip. Shape is `{ id, status, detail, suggestedFix }`.
No database skips both rows. It makes no web calls at all.

## Files

- `src/pulse/coverage/gap-brain.mjs`
- `src/pulse/coverage/gap-brain.test.mjs`

## Test

`node --test src/pulse/coverage/gap-brain.test.mjs`

## Review — Claude, 2026-10-08

What was wrong:
- All three checks were copies. The two Drive checks read the same table, with the same 30 minute line, as `meet-transcript-sweeper`. The door check did a GET on the same two doors the morning list already pings.
- The door check could never see a real fault. Both search doors only take POST. A GET answers 405 whether search works or not.
- The tests used canned answers.

What changed:
- Removed all three. Replaced them with two checks that run the real search doors on the real database, with no AI call and no write.
- 7 tests (same count). They run the real door code, check no web call and no write is made, and check each FAIL path: a crashed read, a 500, an error body, and a leaked non-affiliate chunk.

Live result after (production database, read only): prod 2 PASS, 0 FAIL, 0 skip. Staff view the same. The staff search read 1 row. The affiliate search read 0 rows (the allowlist is empty today, so that is right). No web call. No write tried.

How it was proved:
- Broke one thing at a time on the real database: renamed the search table (both red), renamed the allowlist table (only the affiliate row red). Each went red with the real error text.
- 8 deliberate breaks in the code. The tests caught 7. The 8th removes the "no history" stub, which changes nothing today because the door already refuses to save history when there is no staff id.

Test result: 7 pass, 0 fail, 0 skipped.
