# Meet tape → transcript → closer context

Lane only. Read only. Fundhub.

One tripwire: Recon (AG-07) and the existing `meet-transcript-sweeper`. This file does not start a job, transcribe a file, or call an AI. It does not time the sweeper again. A late sweeper stays on the existing job heartbeat check.

Wait the code already allows: 3 times the sweeper schedule. The schedule is `*/10 * * * *`, so the wait is 30 minutes.

| id | What it reads | Red when |
|---|---|---|
| `meet:recording-no-transcript` | Meet file still waiting on words, or a sales call with a recording link and an empty transcript | Still empty after 30 minutes |
| `meet:transcript-unreadable` | Words on the file, or words on a sales call | `fetchContext` would not load them (it reads the last 3 calls in `src/agents/context.mjs`) |
| `meet:transcriber-failed` | Last `job_heartbeats` row for `meet-transcript-sweeper` | That row says `error`. No row yet is skip, not red |

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

Files: `src/pulse/coverage/gap-meet.mjs`, `src/pulse/coverage/gap-meet.test.mjs`. Not wired into the shared pulse runner (that file was left alone).

## Test

`node --test src/pulse/coverage/gap-meet.test.mjs`

11 passed, 0 failed.

## Live read (2026-10-08)

2 companies. 3 checks each. 6 PASS, 0 FAIL, 0 skip. No recording stuck past the wait. No transcript the closer context cannot read. Last transcriber run finished ok at 2026-10-08T22:50:02.160Z.
