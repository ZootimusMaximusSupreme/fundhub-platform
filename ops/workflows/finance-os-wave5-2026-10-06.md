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

## Manifests
(orchestrator fills in)
