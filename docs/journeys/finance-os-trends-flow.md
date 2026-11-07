# FinanceOS trends — flow

## Fundhub owner company cash

The owner opens **Company cash** from the existing account menu. This is a separate company workspace; the client FinanceOS flow below keeps its existing scope. Admins and other staff do not inherit the company page or its two APIs.

`/app/company-cash.html` uses `/api/owner/company-bank` and `/api/owner/company-cash`, registered in the Netlify router. All reads and writes use the authenticated owner's org. Bank Link, exchange, selection, sync and an explicitly enabled balance refresh use the owner session without a separate staff MFA prompt. Consent confirms a Fundhub LLC business account and read-only data access. Only an eligible selected USD depository account supplies company cash. No action initiates a transfer.

The page shows the stored posted bank balance less unpaid CRS, approved ad funding and reviewed tech obligations. Missing bank data, unpriced pulls or unreviewed monthly costs leave the result unknown. A cached bank read does not claim a fresh balance. Processor receipts are not reconciled or added to bank cash. Observed recurring charges remain suggestions until the owner saves a real obligation.

An obligation becomes paid only after the owner matches the exact posted debit in the selected business account. Matching is scoped and keyset paged, so older valid payments remain reachable. Valid invoice coverage and its verification time prevent double reservation while later unpriced pulls remain uncovered. Blank prices do not become zero. The owner chooses real recipients and amounts; the build does not invent Colin's replenishment or commission rules.

Session changes and owner-role revocation clear bank data, forms, identifiers and the Plaid widget before another action. Production account/configuration activation remains distinct from source or fixture proof.

Owner (2026-10-06): "the whole Finance OS with line graphs … Finance OS tracking."
FinanceOS keeps one row per account per day and one rollup per client per day,
and the Overview draws them as lines.

Code: `db/migrations/458_finance_trend_snapshots.sql`, `src/finance/money-trends.mjs`,
`src/workflows/finance-os-trend-snapshots.mjs`, `api/money/trends.mjs`,
`public/app/money-trends.js` (drawn inside `public/app/financeos.html`),
`scripts/finance-os-backfill-trends.mjs` (one-off, dry run unless `--apply`).

## One day of history (the job runs daily at 07:30 UTC, after the 07:00 Plaid pull)

```mermaid
flowchart TD
    A[Client with an open bank account] --> S[snapshotClient]
    S --> S1[finance_account_daily: one row per open account — source snapshot]
    S --> S2[finance_client_daily: cash per kind, debt, cards used % — source snapshot]
    A --> B[backfillClient]
    B --> B1{Checking or savings with a balance and stored transactions?}
    B1 -->|no| N[No estimate — the day stays a gap]
    B1 -->|yes| B2[Work backward from the balance: posted rows only, pending and removed skipped]
    B2 --> B3[finance_account_daily rows — source backfill, estimated]
    B3 --> B4[finance_client_daily rollups — cash per kind only; debt and cards used null]
```

## Who may overwrite a row

```mermaid
stateDiagram-v2
    [*] --> backfill: backfillClient (estimated)
    [*] --> snapshot: snapshotClient
    backfill --> backfill: backfill again (new transactions arrived)
    backfill --> snapshot: snapshot the same day — a real number wins
    snapshot --> snapshot: snapshot again the same day
    note right of snapshot: an estimate never overwrites a snapshot
```

One row per (account, day) and per (client, day) — unique keys in 458.

## The read and the page

```mermaid
flowchart LR
    P[Overview tab] --> G[GET /api/money/trends?range=30d / 90d / 12m]
    P --> GD[GET /api/money/trends?from=YYYY-MM-DD&to=YYYY-MM-DD]
    C[Connections tab] --> G12[GET /api/money/trends?range=12m]
    G --> D[daily: cash personal / business / not sure yet, debt, cards used % — a missing day is null]
    GD --> D
    G --> M[monthly: money in vs out per kind from bank_transactions]
    GD --> M
    G --> AL[accounts: the open accounts for the picker]
    GD --> AL
    G12 --> SL[sales: merchant net per month — null before the first connection]
    D --> L[Line charts — gaps break the line, estimated is dashed, cash never summed]
    M --> L
    SL --> L
```

Same gate as `/api/money/overview`: a client session reads its own file only;
staff need owner / admin / sales_manager and `?client_id=` in their org.

## Any dates (Finance OS CFO build, unit A, 2026-11-07)

The 30 days / 90 days / 12 months buttons stay. Beside them, a From and a To
date field and a **Show these dates** button ask for any window.

```mermaid
flowchart TD
    F[Person picks From and To, presses Show these dates] --> CK{Page check: both real days, From not after To, 24 months or less?}
    CK -->|no| W[Words under the fields say what to fix — nothing is asked for]
    CK -->|yes| K[Kept in the tab as fos_trends_dates] --> R[GET /api/money/trends?from=…&to=…]
    R --> V{Server readWindow: the same three checks, and never range and dates together}
    V -->|no| E400[400 with plain words]
    V -->|yes| OK[days = every day from From to To; months = every month they touch]
    OK --> PM[money in vs out counts posted rows from From to To only, so the edge months can be part months]
    B[Person presses 30 days / 90 days / 12 months] --> CL[Dates forgotten; range kept as fos_trends_range] --> RR[GET …?range=…]
```

A custom read answers `range: null`, `custom: true`, and its own `from` / `to`;
no range button is pressed. A preset read answers `custom: false` as before.
A window longer than 120 days that crosses a year labels its axis with month
and year (Nov 2025), so two years never read as one.

## One account (Finance OS CFO build, unit A, 2026-11-07)

```mermaid
flowchart TD
    L[Every read returns accounts: the file's OPEN accounts] --> PK[Account picker — All accounts, then Personal / Business / Not sure yet]
    PK -->|All accounts| ALL[Today's charts: cash per kind, debt, cards used, money in vs out]
    PK -->|one account| RA[GET /api/money/trends?…&account=uuid]
    RA --> U{uuid?}
    U -->|no| A400[400]
    U -->|yes| OWN{One of this file's open accounts? — read scoped by org and client}
    OWN -->|no| A404[404, the same answer as a client outside the org]
    A404 --> RESET[Page says the account is not on this file and shows all accounts]
    OWN -->|yes| S[finance_account_daily for that account, From to To — snapshots and backfill, estimated kept]
    S --> T{Card?}
    T -->|yes| CARD[Owed and limit chart + Limit used chart: owed ÷ limit, only on days the limit is known]
    T -->|no| BAL[One balance chart — owed for a loan]
```

Names come from the overview's own rule (`buildMoneyOverview`): the name, else
the official name, then `••` and the last four when stored. The picker type is
card / checking / savings / loan, or other (money market, CD, investment).
Closed accounts are left out of the picker, as they are left out of the
overview. Limit used is the Cards used math (`cardsUsed`): an overpaid card is
0%, a $0 or unknown limit is a break. A day with no row is a break in every
line, never 0. The account choice is not kept between visits.

## Bank waypoints on the Cash chart (2026-11-07)

Chris: "we put a little waypoint with the bank logo ... you highlight over the
bank logo. It says, 'Oh, deposit money here at this time.'"

```mermaid
flowchart TD
    M[Trends area opens] --> T[GET /api/money/trends — the charts draw first]
    M --> B[GET /api/money/banks — read once, beside it]
    B --> OK{Answer has a deposit_plan list?}
    OK -->|no: failed, slow or none| SAME[Charts stay exactly as they are — no markers]
    OK -->|yes| P[Cash over time is drawn again with the plan]
    P --> R{Each row's open_by}
    R -->|none| NS[Listed under the chart: Date not set — never drawn]
    R -->|inside the dates shown| D[Marker on that day]
    R -->|after today, up to 6 months, and the dates shown reach today| F[Axis runs on past today to that day; marker there]
    R -->|before the dates, past 6 months, or the dates end before today| O[Listed under the chart: Not on these dates]
    D --> MK[Plan strip under the axis: a 44px button with the logo, or the bank name in a chip when there is no logo]
    F --> MK
    MK --> TIP[Hover, keyboard focus or a tap shows: Open bank and deposit amount by date, the bank book's reason, and the status]
```

The money lines stop at today: the days after today carry no line, no dot and
no table row, and the chart says so in words. A thin dashed guide runs up from
each marker; a thin line marks today when the axis runs past it. A planned
row has a dashed ring; opened, deposited or seasoned has a solid ring, and the
status word is in the tip. Only the all-accounts Cash chart carries the plan.
Close markers move to a second row so none sits on another; a marker near an
end is pinned inside the chart, so nothing scrolls sideways at 390 or 320.
The `deposit_plan` list is unit E's addition to `/api/money/banks`; until it
ships, the read answers without it and no markers are drawn.

Code: `planLayout`, `planStrip`, `planNotes`, `layoutPlans` and the plan read in
`public/app/money-trends.js`; styles in the same marked block of
`public/app/money-workspace.css`.

Code: `readWindow`, `trendWindow`, `accountChoices`, `pickAccount`,
`buildAccountSeries` in `src/finance/money-trends.mjs`; the gate in
`api/money/trends.mjs`; the picker, date fields and account charts in
`public/app/money-trends.js`; the toolbar block in
`public/app/money-workspace.css` (marked TRENDS START / END).
Proof: `src/finance/money-trends.test.mjs`, `src/http/money-trends.test.mjs`,
`src/http/money-trends-screen.test.mjs`, `e2e/page_money_trends.spec.mjs`.
