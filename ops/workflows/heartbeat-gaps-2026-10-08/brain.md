# Company Brain search

Lane only. Read only. One tripwire: Recon (AG-07) on the morning pulse. No second watchdog.

Do not run a new Drive sync. Do not upload.

## Already watched (not repeated here)

| Break | Who already watches it |
|---|---|
| Drive sync `last_error` set | `meet-transcript-sweeper` in `src/pulse/machine.mjs` (`checkMeetTranscripts`) reads `brain_drive_sync.last_error`. |
| Drive scan older than the job allows | The same check. Red after 30 minutes (3 times the 10 minute sweeper). |
| Search / read door is up at all | The morning list pings `read/company-brain` and `read/company-brain-affiliate` (`reg:` rows). Those are GET pings on doors that only take POST. A 405 counts as up, so they cannot see a 500 on a real search. The two search checks below cover that. |

## Checks

| id | What it does | FAIL when |
|---|---|---|
| `brain:search-staff` | Runs the real staff search door (`api/read/company-brain.mjs`) on the real database. | The door throws, answers 500, or answers anything but 200 with `ok: true`. |
| `brain:search-affiliate` | Runs the real affiliate search door (`api/read/company-brain-affiliate.mjs`) the same way. | Same. |
| `brain:embed-key` | Looks at the OpenAI key the runtime holds for Company Brain (the same one the real embed step reads). Sends nothing to OpenAI. | The key is missing, or it is a row of 4 or more asterisks (a mask). Skips when the run has no `env`. |

How: the door's own code runs. The sign-in step and the AI step are swapped out. The search vector is a fixed stub, so no AI call is made and nothing is spent. That stub hides one thing: a real question that cannot be turned into a vector. `brain:embed-key` covers that, by reading the key. Chat history saving is switched off, so nothing is written. The search SQL runs read only, limit 1.

PASS, FAIL, or skip. Shape is `{ id, status, detail, suggestedFix }`.
No database skips both search rows. `brain:embed-key` needs only `env`, so it still answers with no database. It makes no web calls at all.

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

### Second pass — after the checker

What was wrong:
- Gap. The fixed stub hides the most likely way real search fails: the question cannot be embedded because the OpenAI key is missing or is only a mask. The real door answers 502 then, and both search rows still read PASS.
- The table said the morning list pings can see a door answering 500. They cannot (GET on a POST-only door, 405 counts as up). The first review in this file already said so.
- One break in my own test run lived on: taking out the "no chat history" stub changed nothing, so no test noticed.

What changed:
- New row `brain:embed-key`. Reads `ctx.env` only (never the process env). Same key order as the real embed step: `OPENAI_API_KEY`, then `COMPANY_BRAIN_OPENAI_API_KEY`. FAIL if missing or a mask. The key is never printed. No call to OpenAI, no spend. Not watched anywhere else in the pulse (searched `src/pulse`).
- Table row fixed.
- The parts the check swaps into the doors are now exported for tests (`__test`), and a test pins that they save no history.
- 10 tests, up from 7. Needs `env` in the pulse context to do anything; without it the row skips and says why.

Live result after (production database, read only): prod 2 PASS, 1 FAIL, 0 skip. Staff view the same. Bare (no db, no env): 0 PASS, 0 FAIL, 3 skip. 0 SQL errors, 0 writes, 0 web calls.

The FAIL is `brain:embed-key`, and it reads this Mac's `.env`, where `OPENAI_API_KEY` is a row of 16 asterisks plus 4 letters. The Netlify CLI shows the same, but Netlify hides secret values, so I cannot say what the Netlify function really holds. Kept as a FAIL, not called a false alarm, because the data agrees with a broken embed step:
- Newest `brain_chunks` row: 2026-09-19. Nothing searchable since.
- Every `brain_files` row created after 2026-09-19 (243 of them) has zero chunks.
- `failed_events` has an OpenAI 429 "no credit" from 2026-09-18.
- Owner note, 2026-09-17: the stored OpenAI key was a mask and OpenAI answered 401.
Cause is not proven. It could be the mask, the empty OpenAI account, or both. This check can only see the mask. If the Netlify key is real but the account has no credit, this row reads PASS and search is still down. A sure test would need a real OpenAI call, which this lane may not make.

The 8th break from the first pass (remove the no-history stub) is harmless today. It is now pinned by a test, so it no longer survives.

Left over, not fixed (outside this lane's three breaks): Company Brain has not saved a new searchable chunk since 2026-09-19 while the Drive sync keeps adding files. Nothing in the pulse says so by name.

How it was proved:
- 17 deliberate breaks in the code (mask rule, missing key, key name, process-env fallback, history stub, trim, skip paths, dropped rows, door checks, stub vector, limit, roles). The tests caught all 17.
- Live tool run above.

Test result: 10 pass, 0 fail, 0 skipped.
