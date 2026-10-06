# Offer generator flow — the states one "Write offer" run moves through

Required by `CLAUDE.md` §3a step 4. Written 2026-10-05 from the code in this commit
(`api/marketing/offer/generate.mjs`, `netlify/functions/marketing-offer-background.mjs`,
`src/marketing/offer-*.mjs`, `db/migrations/409_marketing_jobs.sql`).

The screen (the dashboard's Offer card) is a window onto this page. The contract it calls
is `docs/specs/marketing-offer-contract.md`.

## The record

One run is one `marketing_jobs` row with `kind = 'offer'`.

| Column | What it holds |
|---|---|
| `status` | `queued` · `running` · `done` · `failed` (`marketing_jobs_status_ck`) |
| `payload` | the inputs actually used: campaign, the three summaries, where each came from |
| `result` | the winning offer, the review card, the scores, all six candidates, token use |
| `error` | a plain sentence. Required when `failed` (`marketing_jobs_failed_reason_ck`) |

Two rules live in the database, not the screen:

- `done` needs a `result` (`marketing_jobs_done_result_ck`).
- Only one offer run in flight (`queued` or `running`) per company (`marketing_jobs_one_offer_in_flight_uq`).

## The flow

```mermaid
flowchart TD
  P[Owner or admin presses Write offer<br/>POST /api/marketing/offer/generate] --> G{Signed in as owner or admin?}
  G -->|no session| X401[401, nothing saved]
  G -->|other role| X403[403, nothing saved]
  G -->|yes| K{Anthropic key set?}
  K -->|no| X503[503 no_model, nothing saved]
  K -->|yes| I{Inputs: supplied, or the flywheel files.<br/>Avatar found?}
  I -->|bad campaign or no avatar| X400[400 with the reason, nothing saved]
  I -->|yes| T{Table live?}
  T -->|no: before the ship| XNR[503 not_ready, nothing saved]
  T -->|yes| S[Close any run older than 16 minutes as failed]
  S --> R{A run already in flight?}
  R -->|yes| SAME[202 already_running: the same run comes back]
  R -->|no| Q[(queued)]
  Q --> W{Wake the background writer<br/>with the owner's own session}
  W -->|cannot| F1[(failed: The writer could not be started …)] --> X502[502 worker_unreachable]
  W -->|202 accepted| A[202 started: page polls GET ?id=]
  Q -->|writer checks the session and claims it| RUN[(running)]
  RUN --> C1[Call 1: six offers, one per lever]
  C1 -->|fewer than 3 complete, or the call failed| F2[(failed: reason in plain words)]
  C1 --> C2[Call 2: four judges score the blinded set]
  C2 -->|no offer scored, or the call failed| F2
  C2 --> AG[Plain code: average, weight, pick the winner,<br/>flag a run-off within 5%, name an unjudged offer]
  AG --> C3[Call 3: write the winner up,<br/>graft in the losers' best parts]
  C3 -->|failed or wrong shape| KEEP[Keep the winner as first written<br/>and say so on the review card]
  C3 --> PC[Plain code: every price checked against src/config/offers.mjs;<br/>review card built]
  KEEP --> PC
  PC --> D[(done: offer + review card saved)]
  RUN -->|no word for 16 minutes| F3[(failed: The writer stopped without finishing …)]
  D --> V[GET shows the offer on the Offer card]
```

## What is not in this flow

- **Approve, tweak and redo** from the review card. The card prints the line; nothing on
  the server records the answer yet. The dashboard plan puts that in slice 2
  (`POST marketing/flywheel/approve`, `POST marketing/flywheel/tweak`).
- **Writing `marketing/flywheel/<campaign>/03-offer.md`.** Not written by the run itself. Since
  unit GL (2026-10-06), Approve on the Ideas card's offer row writes it from the newest
  finished run through the repo outbox, and keeps the stamp on the run as
  `result.stage_file` (drawn in `marketing-dashboard-flow.md`, "GL Blueprint glue").

```mermaid
flowchart LR
  D[(done: offer + review card saved)] --> W{"newest run for the campaign,<br/>never written as step 3?"}
  W -->|yes| R["Ideas row 3: Done, a new offer is ready; Approve on"]
  R --> A["Approve → outbox replace 03-offer.md (status approved, job: run id)<br/>+ result.stage_file on this run"]
```
- **Avatar and ad research runs.** They stay in chat (they need live web research). This
  flow only reads what they already saved.

## Not verified on a real database

No Postgres on the Mac where this was written. The in-memory test
(`src/http/marketing-offer-generate.test.mjs`) runs the real handler, auth and SQL text;
the Postgres proof of the SQL and the four database rules is
`src/http/marketing-offer-generate.pg.test.mjs`, which runs in CI.
