# No API spend for now

**Owner call (2026-10-06):** The Anthropic API account behind the dashboard ran out of credit. Chris: "we just won't use API for now, I can't afford. We will use Lithos AI when I have money." Also: "we will use Claude Code or Cursor to execute the functions since we are strapped for cash."

## Always

- Run dashboard AI jobs through the local bridge: `MARKETING_AI_RUNNER=local` leaves them queued, and `npm run marketing:run-queue` on the Mac runs them with the `claude-code` provider ($0 API cost).
- Keep non-AI work going: funnel push, tracking, screens, numbers, ships.
- Build real agents (for example FinanceOS) through the shared `callModel` and the `claude-code` provider. Role-play and simulation run through that bridge.

## Never

- Ask him to add Anthropic credit.
- Start dashboard jobs that call the paid model on the live system.
- Remove or change the Anthropic key (CLAUDE.md "Never remove a key").
- Build a Lithos AI provider until he asks.
