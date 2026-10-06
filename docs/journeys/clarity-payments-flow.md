# Clarity Payments + the money helper — flow

Owner-set 2026-10-06: a Clarity Payment is any debt a client owes Fundhub LLC or
a subsidiary, including buy now, pay later (BNPL) plans. When a payment is late,
the money helper checks in first, then a person (the CSM) takes over.

Code: `db/migrations/443_clarity_payments.sql`, `src/finance/clarity-payments.mjs`,
`src/finance/money-agent.mjs`, `src/workflows/finance-os-money-agent.mjs`,
`api/money/payments.mjs`, `public/app/money-payments.html`.

## A plan

```mermaid
stateDiagram-v2
    [*] --> open: staff add_plan (plan + schedule in one statement; schedule must add up)
    open --> open: staff record_payment (oldest unpaid payment first)
    open --> settled: record_payment pays the last cent
    open --> settled: staff mark_settled
    settled --> [*]
```

## One unpaid payment (the helper runs daily at 16:30 UTC)

```mermaid
flowchart TD
    A[Unpaid payment] --> B{Days from due date}
    B -->|more than 3 before| W[Nothing today]
    B -->|0 to 3 before| R[Reminder text — Clarity only; cards use the card due texts]
    B -->|1 to 2 late| L1[Late check-in text]
    B -->|3 to 6 late| L2[Second check-in text]
    B -->|7 or more late| T[CSM task — no more texts about it]
    R --> G{Opted out, escalation, or a person already on it?}
    L1 --> G
    L2 --> G
    G -->|yes| H[Held — logged, no text]
    G -->|no| C[Claim row in money_agent_log]
    C --> Q[sendTemplated queues the text; the dispatcher sends]
    T --> K[createTask role csm]
```

Every step is a row in `money_agent_log`. Caps live in the database: each rung
of each payment once ever; one helper text per client per day.

A plan linked to an invoice (`invoice_id`) is left to the AR ladder
(`src/workflows/ar-collections.mjs`) — the helper does nothing on it.

## Talk to a person

```mermaid
flowchart LR
    P[Client taps Talk to a person] --> T[CSM task, one per client per day]
    T --> S[Helper holds texts while the task is open]
```
