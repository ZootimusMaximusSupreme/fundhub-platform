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
