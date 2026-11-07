# Decline defense — flow

Capital Blueprint launch unit B1. How it works and the tool contract: `docs/finance/decline-defense.md`. Tables: `db/migrations/470_blueprint_decline_defense.sql`.

## A decline

```mermaid
stateDiagram-v2
    [*] --> Read: client pastes the letter (FinanceOS) / staff record it (control panel)
    Read --> Refused: not a Capital Blueprint buyer (403)
    Read --> Same: same letter, or a decline already on this application
    Same --> [*]: nothing new written
    Read --> Open: decline + plan saved, ops task created once (funding advisor)
    Open --> Open: steps marked done / skipped, blanks written, call date set (staff)
    Open --> Approved: outcome approved_on_recon (staff) — application → Approved
    Open --> StillDeclined: outcome still_declined (staff) — application → Denied
    Open --> ReapplyLater: outcome reapply_later + date (staff) — application → Denied
    StillDeclined --> NextSequenceNote: note for the next funding sequence
    ReapplyLater --> NextSequenceNote: note with the re-apply date
    Approved --> Open: outcome set back to open (staff)
    StillDeclined --> Open
    ReapplyLater --> Open
    NextSequenceNote --> [*]: a note only — never sets the next funding sequence date
```

## Reading a letter

```mermaid
flowchart TD
    T[Pasted text] --> M[Mask the client's own numbers]
    M --> C{What does it read as?}
    C -->|approval / counteroffer| P1[Needs a person — no reconsideration call]
    C -->|request for papers| N[Calling PENDING call + papers steps]
    C -->|decline, or unclear and the person says it was a no| D[Reconsideration plan]
    D --> R{Each reason-like line}
    R -->|matches a category| K[Reason + the letter's words + its sources]
    R -->|matches nothing| U[Unknown part → needs a person]
    K --> S{Category has a sourced line?}
    S -->|yes| W[Worded step citing its source]
    S -->|no| B[Blank for the ops person]
```

## Events and writes

| Event | Who | Writes |
|---|---|---|
| `paste` | client or staff | `blueprint_declines` + `blueprint_decline_steps`; `tasks` (once) |
| `record` | staff | the same; linked application → Denied (`application_decisions` row) |
| `link_letter` | client or staff | `letter_document_id`; the send-the-letter step closes |
| `step` | staff | one step's status / written words |
| `schedule` | staff | `recon_on`; the open task's `due_at` |
| `outcome` | staff | outcome columns; linked application → Approved / Denied |

## Applications tracker (Finance OS wave 3, unit O, 2026-11-07)

The "Your bank applications" card on the same page (Finance OS → Applications), built from code: `src/finance/applications-tracker.mjs`, `public/app/money-applications.js`. Same door, no new route: `GET /api/blueprint/declines` carries `view.tracker`; `POST` takes `track_add`, `track_update`, `track_add_account` (client or staff, no Capital Blueprint needed). Table: `db/migrations/576_finance_applications.sql`.

```mermaid
stateDiagram-v2
    [*] --> Applied: client adds one they applied for (finance_applications)
    [*] --> FundhubRow: Fundhub sends one in a round (applications, read only here)
    Applied --> Pending: client changes status
    Applied --> Approved: client changes status (+ limit, last 4, day answered)
    Applied --> Denied
    Pending --> Approved
    Pending --> Denied
    FundhubRow --> Approved: staff bank answer / bank evidence (src/applications/status.mjs)
    FundhubRow --> Denied
    Approved --> OnAccounts: card or line of credit that counts
    Approved --> LoanNote: a loan — the client adds it on Accounts once it funds
    OnAccounts --> [*]
```

```mermaid
flowchart TD
    A[Approved card or line of credit] --> L{Already linked to an account?}
    L -->|yes| X[Nothing new]
    L -->|no| P{A Plaid card at the same bank fits?}
    P -->|one: same last 4, or the only card first seen on or after the day applied| K[Link that Plaid account — raw.fundhub_application]
    P -->|more than one| Q[Add nothing — ask for the last 4]
    P -->|none| S[Stand-in account: createManualBankAccount, approved limit, balance unknown]
    S --> R{Later Plaid read shows the same card?}
    R -->|one match| C[Stand-in becomes that Plaid row in place, before the upsert — same id and history]
    R -->|none or more than one| S
```

| Event | Who | Writes |
|---|---|---|
| `track_add` | client or staff | one `finance_applications` row; if approved card/line, one `bank_accounts` row or a link on a Plaid row |
| `track_update` | client or staff, the client's own rows | status, approved amount, last 4, day answered; the same account step |
| `track_add_account` | client or staff | the same account step for an approval from before this shipped |
| staff bank answer `Approved` | staff / bank evidence | after the status save, the same account step (`syncApprovedApplication`, never throws) |
| Plaid account read | system | a matching stand-in turns into the Plaid row (`claimStandInsForPlaid` in `saveAccounts`) |

UNVERIFIED on a real database: the unique index `bank_accounts_fundhub_application_uq` and the savepoint path inside the bank-evidence transaction (no Postgres in the build session; the `.pg` tests skip).
