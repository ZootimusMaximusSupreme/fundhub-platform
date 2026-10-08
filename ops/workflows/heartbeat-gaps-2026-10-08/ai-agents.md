# AI agents tripwire

One check. Id: `ai-agents`.

It reads agent rows, agent runs, and the Bland voice webhook answer. It asks the call route with GET only. It reports PASS, FAIL, or skip.

## What turns it red

- An agent with a script, a runtime, and a trigger still on is retired.
- A run failed (including a Bland rejection) and nothing tried it again after 15 minutes.
- `/api/agent-call` answers 500.
- The latest Bland voice webhook answer in the last day is 500.

Shape of each row: `{ id, status, detail, suggestedFix }`.

## What this check watches

Live agent editor rows, agent runs, and Bland voice failures.

Recon (`AG-07`, `cron.daily-pulse`) stays on the morning pulse. This check leaves that row alone.

Old GoHighLevel rows (`GHL-`) stay retired on purpose. This check leaves them alone.

Slice 24 already checks that the agent workflows are named on the pulse list. This check does not do that again.

## Proof

`node --test src/pulse/coverage/gap-ai-agents.test.mjs`
