# FinanceOS trends — flow

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
    C[Connections tab] --> G12[GET /api/money/trends?range=12m]
    G --> D[daily: cash personal / business / not sure yet, debt, cards used % — a missing day is null]
    G --> M[monthly: money in vs out per kind from bank_transactions]
    G12 --> SL[sales: merchant net per month — null before the first connection]
    D --> L[Line charts — gaps break the line, estimated is dashed, cash never summed]
    M --> L
    SL --> L
```

Same gate as `/api/money/overview`: a client session reads its own file only;
staff need owner / admin / sales_manager and `?client_id=` in their org.
