# AI agents tripwire

Two rows. Ids: `ai-agents:retired`, `ai-agents:failed-runs`.

They read agent rows and agent runs. They never call, never retire, never write. Status is `PASS`, `FAIL`, or `skip`. Each row is `{ id, status, detail, suggestedFix }`.

## What turns each row red

| Row | FAIL when |
|---|---|
| `ai-agents:retired` | An agent with a script, a runtime, and a trigger still on is retired. |
| `ai-agents:failed-runs` | A run by a real agent failed in the last 7 days, is older than 15 minutes, and nothing tried it again. |

No database in the run: both are `skip`. A read that throws is a `FAIL`, never a `PASS`.

## Already watched (this lane does not repeat it)

- Recon (`AG-07`, `cron.daily-pulse`) stays on the morning pulse. Slice 02 and the job heartbeats own it.
- The call route `/api/agent-call` and `/api/agents` are pinged every morning by the registry (`reg:agent-call`, `reg:agents`). A GET on the call route only reaches a 405, so it can only show that the route loads.
- Slice 24 checks the agent workflows are named on the pulse list.
- Document reads (`docs.received`) have their own retry queue. `doc-check-retry-sweeper` retries every 20 minutes. The documents lane (`documents:stuck-processing`) watches that queue. They are left out of `ai-agents:failed-runs` on purpose.
- Phone dials for Setter Josh (AG-04) are the calls lane (`calls:ai-dial-no-failure`).
- Old GoHighLevel rows (`GHL-`) stay retired on purpose and are skipped.

## Not watched, and why (honest limits)

- **The agent call route answering 500.** The lane brief asked for it. It cannot be watched read only from here. A GET only reaches a 405 (the registry already pings that). A POST would place a real phone call, and this pulse never does that. The calls lane covers a dial that never finishes.
- **A Bland voice webhook answering 500.** There was a row for it. It is gone. The webhook router saves a copy of a delivery only when the answer was 200 ("verified traffic only"). A 400, a 401 or a 500 is never saved. So the database can only ever show 200 for Bland, and the row could never turn red. Live check: every saved delivery that has a status says 200. A Bland 500 leaves nothing to read. Seeing it needs a new signal in the calls lane, for example a dial with no `call.completed` event after some hours.
- **`no_api_key` is not counted as a failure, on purpose.** The AI spend is on hold. A live agent with no model key writes that outcome by design. A red every morning would be noise until credit is back.
- **A draft agent with a trigger on is not caught.** Only `retired` is. The runtime does nothing for `draft` or `retired` alike. No draft agent has a trigger on today. Adding `draft` would turn red for an agent that is still being built, so it was left out.
- **A failed message run can stay red for up to 7 days.** Nothing retries a `message.inbound` run. It clears when a later run for the same event or the same client and trigger shows up, or when 7 days pass.
- Today only `DOC-CHECK` has a live trigger row among the non-GHL agents. So `ai-agents:retired` can only fire for `DOC-CHECK` right now. Setter Josh (AG-04) was retired on purpose on 2026-09-26 and has no trigger row. That is not a break.
- `bland_rejected`, `transport` and `no_call_id` are in the outcome list but the code that writes `agent_runs` does not write them today. They are there for later. Today the writers use `runtime_error`, `model_error`, `empty_model_reply`, and `openai <status>` or `anthropic <status>` text.

## Files

- `src/pulse/coverage/gap-ai-agents.mjs`
- `src/pulse/coverage/gap-ai-agents.test.mjs`

## Prove

`node --test src/pulse/coverage/gap-ai-agents.test.mjs`

## Review — Claude, 2026-10-08

First pass:

- The check sent `BEGIN READ ONLY` and `ROLLBACK` on the shared database pool. The two could land on different connections and leave one stuck in a transaction. That has broken the live pool before. Now every read is one plain SELECT.
- It was one row. Now each break has its own row.
- The call route probe repeated the registry ping and could never reach the call logic. It is gone.
- A failed run was judged against all of history, and a script row in `agent_runs` (`live-playwright-sweep`) could count as an "agent". Now: last 7 days, real agent rows only.
- A failed document read would have gone red here and in the documents lane at once. Document reads are left to their own queue.
- Anthropic errors were not in the outcome list. They are now.

Second pass (the checker found one more):

- **`ai-agents:bland-webhook` could never FAIL. Removed.** The router only saves a Bland delivery when the answer was 200, and the Bland code only answers 200, 400 or 401. So a saved Bland row always says 200. The test that fed it a made-up 500 proved nothing, because the live database cannot hold that value. The board claimed the break was covered. It was not. Now it says so above.
- The tests now check the query text itself: Recon, GHL, document reads, the join to real agents, the 7 day window, the 15 minute wait, and each way a later run clears a failure. A deleted rule in the query now breaks a test.
- Two more guards: the plain database handle wins over the staff scope, and the exact list of failure outcomes is pinned. A time that is not a real date is never counted (tested with text, not only null).
- Checker point on `no_api_key` and `draft`: judged and written down above as choices, not changed.
- Checker point that the fix is not committed or shipped: true. The pulse that runs at 06:00 uses what is committed and shipped. The fix is in the working folder only. Someone must commit and ship it. This session does not commit or ship.

Proof:

- Live, read only, as the app role: prod 2 pass, 0 fail, 0 skip. Staff and bare runs match (2 pass each). Plain and staff reads match (27 agents, 20 triggers, 328 runs), so the role is not blind. 0 query errors, 0 write tries.
- Tests: 21 pass, 0 fail, 0 skipped. 25 deliberate breaks of the code were tried in a scratch copy. All 25 were caught.
- The query text did not change this pass, so the earlier made-up-rows proof of the SQL still stands (retired with and without a trigger, Recon, GHL, no prompt, other company, failures inside and outside the windows, a later retry by event, by "retry of", and by client, an agent not in the table, a document read).
