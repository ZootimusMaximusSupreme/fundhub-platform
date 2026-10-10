# Meet tape → transcript → closer context

Lane only. Read only. Fundhub.

One tripwire: Recon (AG-07) and the existing `meet-transcript-sweeper`. This file does not start a job, transcribe a file, or call a model.

Wait the code already allows: 3 times the sweeper schedule. The schedule is `*/10 * * * *` (imported from the sweeper), so the wait is 30 minutes.

## Already on the morning list (not repeated here)

- Machine row `meet-transcript-sweeper` (`src/pulse/machine.mjs`): red when a Meet file in Company Brain still has no words 30 minutes after it was indexed, and when Drive has not been scanned for 30 minutes.
- Job row `job:meet-transcript-sweeper` (`checkJobHeartbeats`): red when the sweeper is late **or when its last run ended in an error**.

## Checks

| id | What it reads | Red when |
|---|---|---|
| `meet:recording-no-transcript` | Logged sales calls (`call_outcomes`) with a recording link | Still no transcript on the call after 30 minutes, and no words in Company Brain for that link or that client's Meet file. Last 14 days. Demo calls left out. |
| `meet:transcript-unreadable` | Clients with Meet words from the last 14 days: a transcript on a call, or a Meet recording or transcript file with text in Company Brain that is past the wait and has a call to hold it | The real `fetchContext` (`src/agents/context.mjs`) shows no transcript in its last 3 calls for that client, or it throws. Up to 15 clients a morning. |

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

Files: `src/pulse/coverage/gap-meet.mjs`, `src/pulse/coverage/gap-meet.test.mjs`.

## Test

`node --test src/pulse/coverage/gap-meet.test.mjs`

## Review — Claude, 2026-10-08

**What was wrong**

- Two of the three checks read repo source files from disk to learn the sweeper schedule and the "3 calls" limit. The shipped function has no source files. In production both would have said FAIL ("could not read") every morning.
- `meet:transcriber-failed` was a copy. `job:meet-transcript-sweeper` already goes red when the last sweeper run ended in an error. Two red rows for one fault.
- Half of `meet:recording-no-transcript` was a copy too. The machine row already counts Meet files that wait over 30 minutes for words.
- `meet:transcript-unreadable` copied the "last 3 calls" rule into SQL instead of asking the real `fetchContext`. If someone changed the limit, the check would keep saying PASS. Two other cases cried wolf: a client whose transcript is on an old call, and a transcript that arrived a minute ago.
- The old tests returned a made-up count for every query. They never ran the SQL.

**What changed**

- The wait comes from the sweeper's own `SWEEP_CRON`, imported. No file reads.
- `meet:transcriber-failed` removed. The machine row and the job row already cover it.
- `meet:recording-no-transcript` keeps only the part nobody else sees: a call with a tape link and no words.
- `meet:transcript-unreadable` finds the clients that have Meet words, then runs the real `fetchContext` for each (up to 15) and asks if a transcript shows. Words older than 14 days age out. A file inside the 30 minute wait, a client with no call to hold the words, and demo clients are left out.
- Tests now include a block that runs the real SQL and the real `fetchContext` on Postgres over fixture rows (skips without `DATABASE_URL`).

**Live proof (read-only, as `fundhub_app` inside `BEGIN READ ONLY`)**

- Prod mode: 2 PASS, 0 FAIL, 0 skip. Staff mode matches. No SQL errors. No writes. It did not read a repo file.
- Why PASS is honest today: no call has a recording link and `call_outcomes` is empty, so no client has Meet words to check. The database was reset. That is why I ran fixtures too.
- Fixture run on the real engine with the real `fetchContext`: 20 cases, all matched. A tape link with no words after 2 hours is FAIL; after 10 minutes, PASS. Words in Company Brain with the newest call empty is FAIL; stamped on the call, PASS. A transcript only on the 4th newest call is FAIL (fetchContext reads 3). A Gemini notes file counts. Demo, old, not-a-Meet file, and a `fetchContext` that throws (FAIL) were all checked.
- Tests: 14 pass, 0 fail without a database. 18 pass, 0 fail with `DATABASE_URL`.

**Left for Chris (not a check problem)**

- If a Meet recording sits unprocessed, the machine row says so. If the sweeper crashes, the job row says so.
- The rule for what a Meet file is called is written twice: once in `src/company-brain/meet-title.mjs` (the sweeper) and once as database patterns in `meetNameSql` in `gap-meet.mjs`. They agree on the 865 real file names today. If the sweeper's naming rule ever changes, change `meetNameSql` too, or this check will quietly use the old rule.

## Second pass — Claude, 2026-10-08

- The checker found this board was stale: it listed a third check that was removed, "11 passed", and a Company Brain half that no longer exists. It now matches the code: 2 checks.
- Code did not change this pass. Live: prod 2 PASS, 0 FAIL, 0 skip; staff mode matches; bare 0 PASS, 0 FAIL, 2 skip. No SQL errors, no writes.
- Tests: 14 pass, 0 fail without a database. 18 pass, 0 fail with `DATABASE_URL`.
