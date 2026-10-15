# Monday is 100%

**Owner law (2026-10-14):** By **Monday 2026-10-19** the whole company is 100% coded, wired and working, and the heartbeat proves it. Then we refactor. Chris set the goal. It is decided. Do not re-open it and do not add a "100% is impossible" rider.

## What 100% means here

- Every item on the heartbeat is **green** or a **verified "nothing to judge"**. Zero Broken. Zero Not proved. Zero Not checked.
- Every money and customer item has a **live deep check**: it reads real saved data and goes red when a real result is wrong. A fake-data practice test is not enough for these.
- Every real break the checks found is fixed, or sits on a short list of decisions only Chris can make.
- The alert road works: a real break reaches Chris by email (texts return when Twilio does).
- The whole board stays clean for 48 hours (Saturday and Sunday) before refactor starts Monday.

## How agents work toward it

- Order of work: money, then customer messages, then customer records, then staff tools. Ranked list: `ops/workflows/heartbeat-ranked-2026-10-14.md`.
- Run the work in parallel with Sonnet agents, checkers that break the product on purpose, and an Opus oversight agent. Codex builds, Claude tests.
- Spend tokens where they buy a real check. No polling, no re-doing finished work.
- Chris walks the money and customer items one by one to confirm each is accurate.
- Every day, say in one line how far the board is from 100%: Broken, Not proved, Not checked, and the decisions waiting on Chris.

## Never

- Call a fake-data test "deep" or "proof" to Chris.
- Report the goal done while any item is Broken, Not proved or Not checked.
- Start the refactor before the 48-hour clean watch is over.

## Example

```text
Sunday 8 p.m. The board shows 0 Broken, 0 Not proved, 0 Not checked for 48 hours.

❌ Start the refactor Saturday because most items are green.
✅ Wait out the 48 hours. Monday morning, report the numbers and start the refactor.
```
