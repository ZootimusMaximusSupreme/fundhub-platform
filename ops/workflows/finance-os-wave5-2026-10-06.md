# FinanceOS — wave 5: the platform layer (2026-10-06)

Chris: "go on all of it." Direction (wins): `docs/finance/finance-os-direction-2026-10-06.md` — last section "FinanceOS platform — owner vision".
FinanceOS is a layer on top of the Capital Blueprint: upsell and downsell, same method, two doors.

Orchestrator merges, wires tabs into `/app/financeos.html`, regenerates journeys/diagrams, ships, proves, and gives Chris an honest "will this work" verdict at the end. Agents never merge, push, ship, edit `public/app/financeos.html`, or run `npm run journeys`.

Cap is 5 agents at once. H5 + H6 (wave 4b) are still running, so W1–W3 start now and W4–W5 start when H5/H6 finish.

| # | Unit | Status | Migration # |
|---|---|---|---|
| W1 | Waypoints timeline — month view with dated pins (`GET /api/money/plan`) + plan-source registry | claimed | 460 |
| W2 | Bank strategy — banks to open by location, card stacking, next funding round, relationship tracker (`GET /api/money/banks`) | claimed | 461 |
| W3 | Fundability — score now, projected, per business (`GET /api/money/fundability`) | claimed | 462 |
| W4 | Payment strategy — live payoff math, goal date → monthly amount (`GET/POST /api/money/strategy`) | queued | 463 |
| W5 | "Ready to get funded" → CSM, Blueprint upsell / FinanceOS side-sell, "Do task" buttons | queued | 464 |
| W6 | REAL FinanceOS money agent on the existing agent framework (`src/agents/`): Agent Editor row, tools, shadow → live, Claude Code bridge brain, role-play simulation harness | queued | 465 |
| W7 | REAL money movement in Plaid sandbox (Transfer): propose → client approves → transfer → events, ledger, limits | done on branch `worktree-agent-a34b07153f7a265f4` (not merged) | 466 |

## Shared contract — plan pins

Every unit that has a dated action exposes a plan source module `src/finance/plan-sources/<name>.mjs`:

```js
export const name = "bank-strategy";            // unique
export async function pins(db, { orgId, clientId, from, to, env }) {
  return [{
    id: "stable-unique-id",                       // idempotent across calls
    date: "2026-10-20",                           // YYYY-MM-DD
    kind: "open_account|deposit|pay_down|apply|due|checkpoint|other",
    title: "Open a business checking at Bank X",
    detail: "Why, in one plain sentence",
    amount_cents: 2000000,                        // or null
    bank: "Bank X",                               // or null
    container_id: "uuid|null",
    status: "planned|done|missed",
    source: "bank-strategy"
  }];
}
```

W1 owns `src/finance/plan-sources/index.mjs` and its own sources (existing waypoints, card/loan dues, Clarity installments). W2/W4 ship their source files; the orchestrator adds them to the index at merge.

## Section contract (same as wave 2)

Each UI part is `window.FinanceOS.sections.<name> = { title, mount(el, ctx) }`, `ctx = { clientId, apiGet, apiPost }` (`{status, body}`), returns `{ reload }`, no header/nav inside, styles scoped under one class. A thin standalone shell page is fine for screenshots.

## Rules every unit follows
- Never invent a rule, amount, bank, score, or step. Every recommendation cites the repo source (doc, CSV, engine) it came from. If the source does not exist, the value is staff-set or shown as "not set" — and the report says so.
- Sample clients: one realistic file (`.claude/rules/sample-clients-consistent.md`). Never stitch two files.

## Owner (2026-10-06, evening): build it real, now
"Really build the code. Really build the ability to do it. Really set up the AI agent… so we can role-play and see how it works simulated." Not mock-ups. Sandbox + role-play are how we test; production switches on later (Plaid approval, AI brain funding).
- AI brain today: no Anthropic API credit (memory: no-api-spend). The repo already routes model calls to `claude -p` on Chris's Mac (`src/agents/claude-code.mjs`, `scripts/marketing-run-queue.mjs`). The money agent uses the same shared client (`callModel` in `src/agents/model.mjs`), so it thinks via the Mac bridge now and via the API or Lithos later — no code change.
- Money movement: every transfer needs the client's approval (the "Do task" press on that exact transfer) and stays inside set limits.

## Manifests
(orchestrator fills in)

### Merged so far
- H5 merchant API-key pull (migration 457, workflow 95) — merged.
- H6 trends + line graphs (migration 458, workflow 96) — merged. Backfill `scripts/finance-os-backfill-trends.mjs --apply` after ship.

### Fix in the final pass (sample-data law)
- Test client's sandbox bank v2: stored transactions don't add up to its balances, so rebuilt history dips below zero (~−$17,929 personal Jul 13, ~−$10,920 business Jul 11). One sample file must agree with itself → make a consistent sandbox bank (balances = sum of activity) before showing trends.

### Merged (wave 5)
- W1 plan, W2 banks, W3 fundability, W4 strategy, W5 next steps + ready-to-fund + seam (migration 464) — merged and wired as tabs: Overview · Next steps · Plan · Banks · Strategy · Fundability · Accounts · Credit · Connections · Payments · Setup.
- S1 consistent sample person — merged. Test Test: bank v3 item `1b353a67-…` (v2 closed), credit file `crs_results b894f4be-…` (simulated, 702/709/706, FUNDING_PLUS_REPAIR, $19,799). Numbers agree across Overview / Trends / Credit / Plan / Strategy.
- S1 could not reconcile: SBA loan payment not in business checking (would double-count as a bill); Chase Ink has no due/minimum; Clarity sample is "owed to Fundhub LLC" which is this person's own business; survey answers vs business info; two engine funding numbers ($19,799 tier vs $132,000 stacking) are both engine output.

### W7 manifest (branch `worktree-agent-a34b07153f7a265f4`, not merged)
- Proposals stay in W5's `money_agent_tasks` (464) via `proposeTransfer`. 466 adds `money_transfers` (one per APPROVED proposal, `agent_task_id` unique FK, opened in the same transaction as the client's yes; the trigger refuses one that does not match the approved row), `money_transfer_events` (append-only, written by trigger, UPDATE/DELETE/TRUNCATE revoked and blocked), `money_transfer_sync_cursors`, and a unique index `bank_accounts (id, client_id)` for the two ownership keys. No `money_agent_log` CHECK change (uses 464's words).
- Code: `src/finance/money-transfers.mjs` (engine) + `money-transfers-store.mjs`, `src/banking/plaid-transfer.mjs` (provider), Plaid calls in `src/banking/providers/plaid-http.mjs` (production host refused unless `PLAID_ENV=production` AND `FINANCE_OS_TRANSFERS_LIVE=1`).
- Route `money/transfers`: GET; POST `approve` (client's own login only, not an authorized rep), `cancel` (client or staff), `propose` (staff, through `proposeTransfer`). Pulse key added.
- Workflow `finance-os-money-transfers` (`*/15 * * * *`) → REGISTERED 97, diagrams regenerated. Does nothing while the caps are unset.
- Section `FinanceOS.sections.transfers` (`public/app/money-transfers.{js,css,html}`); in shell.js money lists, DESK_FILES, NO_SIDEBAR, staff-nav list.
- To wire (orchestrator): `["transfers", "Transfers"]` in TABS and `"money-transfers.html": "transfers"` in PAGE_TAB (financeos.js), mount + css link in financeos.html, financeos-screen.test lists. W5's `money-next.js` still says "You can say yes here once money moving is turned on" for a `needs_approval` row — point it at the Transfers tab when wiring.
- After ship (sandbox role-play): set `FINANCE_OS_TRANSFER_MAX_CENTS` and `FINANCE_OS_TRANSFER_DAILY_MAX_CENTS` on Netlify, then `node scripts/finance-os-sandbox-transfer.mjs` (dry run) → `--apply` for the test client's $20.00 Personal Checking ••1101 → Business Checking ••2202 (approval recorded as `sandbox_role_play`, never `client`).

### Leftovers W7 saw (not touched, not verified)
- 464: `money_agent_tasks.to_account_id` / `from_account_id` reference `bank_accounts` with no ON DELETE action, so a bank-login revoke or an erasure that deletes those accounts is refused while a task points at them.
- 461: `bank_relationship_deposits` is called append-only with `GRANT SELECT, INSERT`, but 104's default privileges already gave fundhub_app UPDATE/DELETE and nothing revokes them.

### Live proof after ship 6234ead8 (2026-10-07 ~05:00 UTC)
- Migrations 457–466 applied; `/api/health` pending 0.
- Trends backfill `--apply` on Test Test: 174 estimated account-days + 88 rollups; personal $2,170 → $13,385, business $10,330 → $21,406, never below zero.
- Money moves: `scripts/finance-os-sandbox-transfer.mjs --apply` — $20.00 Personal Checking ••1101 → Business Checking ••2202 through Plaid sandbox Transfer: authorized → submitted → debit settled → funds available → credit settled. **SETTLED.** 13 ledger events in `money_transfer_events`. Approval recorded as `sandbox_role_play`.
- Money helper: live turn through the Mac bridge (`claude -p`), brain = ai, status answered. Grounded numbers ($500 late Clarity payment, Visa $94 due Oct 25, 38.7% used, UnderwriteIQ sentence verbatim), actions: reminder pin + a transfer PROPOSAL needing approval.

### Fix in the final pass
- Helper proposed a transfer INTO a credit card (Personal Visa minimum). Plaid Transfer can't pay cards (W7 hides the approve button for card/loan targets). The helper should only propose depository → depository moves, and turn card payments into a reminder.
