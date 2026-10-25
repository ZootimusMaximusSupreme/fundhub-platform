# Closer Dashboard Calculators

Two pure-function ESM cores, no dependencies, deterministic (no LLM calls). Run all tests: `node --test`.

- **`deal-funding.mjs`** (1a) — *how much can this contact access, and how do we allocate it?*
- **`deal-math.mjs`** (1b) — *does the deal pencil for the client month-to-month?*

---

## Deal Funding Calculator (`deal-funding.mjs`, 1a)

`calcFunding({ cards, requestedAmount, utilizationThreshold, minPaymentPct, horizons })` returns four blocks:

1. **`totalAvailableCredit`** — sum of available headroom (`max(0, limit − balance)`) across all matched cards.
2. **`allocation`** — waterfall draw, **lowest APR first**, until `requestedAmount` is filled. Reports `totalDrawn`, `shortfall`, `fullyFunded`, and per-card `draw`.
3. **`payMethodComparison`** — draw-weighted blended APR, then per horizon (default 12/24/36mo) a side-by-side of **lump sum vs interest-only vs minimum payments**: monthly outflow, total interest, total paid, remaining balance.
4. **`guardrail`** — **hard stop** if any card or the aggregate crosses `utilizationThreshold` (default 0.30, per-org configurable). Returns per-card `newUtilization`, `aggregateUtilization`, and a `message`. This is the "would this draw kill the next funding round" gate.

```js
import { calcFunding } from './deal-funding.mjs';
const r = calcFunding({
  cards: [
    { lender: 'Amex',  creditLimit: 15000, currentBalance: 0,    apr: 0.1899 },
    { lender: 'Chase', creditLimit: 20000, currentBalance: 2000, apr: 0.2499 },
  ],
  requestedAmount: 20000,
  utilizationThreshold: 0.30,
});
// r.totalAvailableCredit, r.allocation.draws, r.payMethodComparison.horizons, r.guardrail.hardStop
```

---

## Deal Math Calculator (`deal-math.mjs`, 1b)

Pure-function ESM module (`deal-math.mjs`) that answers the closer's core question: "Given approved funding, fee structure, and down payment, what does the client actually pocket and what are the monthly obligations?" It takes closer-entered inputs (approved amount, fee %, down payment, intro card term, post-intro APR, and optional amortization params) and returns three output blocks: (1) **cash position** — net cash to client after fee, broken into down-payment vs. proceeds-funded portions; (2) **monthly obligation** — intro-period minimum payment schedule (steps down as balance declines) plus post-intro interest-only figure; and (3) **the cliff** — a flagged object indicating whether post-intro interest exceeds the minimum payment (negative amortization risk), rendered un-collapsible by any wrapping UI. Any input left blank causes the dependent output to return `null` rather than a guessed number. No external dependencies; run tests with `node --test deal-math.test.mjs`.

## Input / Output Shape

```js
import { calcDeal, reconcileFee } from './deal-math.mjs';

const result = calcDeal({
  approvedFunding: 250000,   // required
  feePct: 0.10,              // default 0.10 (overridden if feeDollar provided)
  feeDollar: undefined,      // explicit dollar fee overrides feePct
  downPayment: 3000,
  feeFromProceeds: true,     // default true
  pctOn0Intro: 1.0,          // default 1.0
  introMonths: 12,           // default 12
  postIntroApr: 0.249,       // default 0.249
  minPaymentPct: 0.02,       // default 0.02
  amortApr: undefined,       // null output if omitted
  amortTermMonths: undefined,
});

// result.cashPosition  → { netCashToClient, fee: { total, paidDown, fromProceeds } }
// result.monthly       → { intro: { month1Payment, balanceAtIntroExpiry, schedule }, postIntro, amort }
// result.cliff         → { triggered, interest, minPayment, message }
```
