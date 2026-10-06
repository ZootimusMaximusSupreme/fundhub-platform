# Marketing Command Center — what the back end does today

Required by `CLAUDE.md` §3a step 4. Written 2026-10-05 from the code on branch
`m10-dashboard-backend` (slice 1, back end only). The plan is
`docs/specs/marketing-dashboard-plan-2026-10-05.md`; the JSON shape is
`docs/specs/marketing-today-contract.md`.

Drawn from code, not from the plan. Anything the code does not do yet is marked
**NOT BUILT** rather than drawn as if it ran.

Updated 2026-10-05 on branch `cc-slice0-today-truth` for slice 0 of
`docs/specs/command-center-design-2026-10-05.md` ("Today tells the truth"): whole-day
spend windows, `prior_30_days`, the ClickFunnels time, measured costs, the stage counts
and review cards, the page that reads them, and `max_jobs: 1` on Write ad copy.

## The Today read — `GET /api/marketing/today`

Read only. Each part reads in its own short transaction (`asStaff()`), so one part
that cannot be read does not take the others with it.

```mermaid
flowchart TD
  A[GET /api/marketing/today] --> B{signed in?}
  B -->|no| B1[401]
  B -->|yes| C{owner or admin?<br/>ROLE_SETS.MARKETING}
  C -->|no| C1[403, nothing read]
  C -->|yes| D[today = Arizona's day]
  D --> F[flywheel: marketing/flywheel/*<br/>evaluate + render from scripts/flywheel/status.mjs]
  D --> H[house partner fundhub-house]
  H -->|found| H1[copy: last 10 copy pieces + last 5 copy jobs]
  H -->|found| H2[copy_ready: switch, writer row, Anthropic key, budget]
  H -->|missing| H3[copy empty, copy_ready false, waiting: copy]
  F --> F2[each stage: its front-matter counts<br/>+ the text under ## Review card]
  D --> S0[newest saved ad-day = spend.through]
  S0 --> S[spend: today, then last 7 / prior 7 / last 30 / prior 30<br/>whole days ending on spend.through<br/>from ad_metrics_daily, whole company]
  D --> L[last_sync: Meta connection + newest ad-day]
  D --> CF[clickfunnels_synced_at:<br/>analytics_connections.last_synced_at]
  D --> CO[costs.offer: newest done marketing_jobs offer run<br/>seconds, tokens, dollars]
  H -->|found| CC[costs.copy: house partner's last 5<br/>partner_ai_usage rows, purpose creative]
  CO & CC --> PR{model price on file?<br/>src/marketing/model-prices.mjs}
  PR -->|yes| PR1[cost in whole cents]
  PR -->|no / no run| PR2[cost null: the page prints unknown]
  F2 & H1 & H2 & S & L & CF & PR1 & PR2 --> Z[200 with as_of and waiting]
  F -->|files not on server| W[that part null + named in waiting]
  S0 -->|no saved ad-day at all| W
  S -->|table missing| W
  L -->|table missing / never synced| W
  CF -->|table missing| W
  CO -->|marketing_jobs missing| W
  W --> Z
  D -->|database not answering| E[503 db down]
```

- A window with no saved ad-days is `null`, never `0`.
- The 7 and 30 day windows end on the newest day with saved numbers, not on today, so
  both sides of every comparison are whole days. Only `today` is today.
- A cost is `null` when no run was measured, or when a run's model has no price with a
  source in `src/marketing/model-prices.mjs` (today only `claude-opus-5-5` has one).
- A table or column that is not in the database yet (Postgres 42P01 / 42703 / 42883)
  makes that part `waiting`. Any other database error is a 503 (connection) or a 500.

## Write ad copy — the job states (existing Creative Factory path)

Nothing new in the states. What changed in slice 1: the writer's backup to Anthropic,
the copy writer row, and the house partner's switch (`db/seed/296`).

```mermaid
flowchart TD
  C0[POST creative/generate<br/>asset_kind=copy, house partner] --> G{marketing switch on?}
  G -->|no| G1[403 suite_off, nothing saved]
  G -->|yes| C1[generation_jobs: queued]
  C1 -->|POST creative/run max_jobs 1 from the page:<br/>claims at most one job, or the runner every 2 min| C2[running]
  C2 --> R{copy writer row?}
  R -->|no| C9[failed: no active provider]
  R -->|yes| M[OpenAI first]
  M -->|answers| T[words]
  M -->|says no credit| A[Anthropic once,<br/>OpenAI key left out of that call]
  M -->|any other failure| X[error]
  A -->|answers| T
  A -->|fails| X
  X -->|tries left| C1
  X -->|no tries left| C9b[failed, with the reason]
  T --> C3[creative_assets kind=copy<br/>compliance: pending]
  C3 -->|screen finds nothing| C4[passed]
  C3 -->|a rule fires| C5[blocked, reasons kept]
  C4 -->|a person approves| C6[approved]
```

## The page — `public/app/marketing-command-center.*` (Today view)

What the page reads, and when. Drawn from `public/app/marketing-command-center.js`.

```mermaid
flowchart TD
  P0[page opens] --> P1[GET marketing/today<br/>+ GET ad-videos?status=awaiting_approval]
  P0 --> P2[GET marketing/offer/generate]
  P1 -->|200| P3[paint: spend tiles, as-of line, Waiting on you,<br/>Offer and market rows, cost lines, footer clock]
  P1 -->|first load fails| P4[banner in words, every number unknown]
  T1[every 5 minutes while the tab is visible] --> P1
  T2[tab comes back into view or gets focus<br/>more than 30 s after the last read] --> P1
  P1 -->|a reload fails after a good load| P5[keep the last numbers<br/>banner: This page shows the last load from 3:02 PM]
  P1 -->|ad-videos fails| P6[one line in Waiting on you: The video list did not load]
  P3 --> W1[Waiting on you: videos first, then flywheel rows<br/>each with where it is done; redo rows offer Copy the chat command]
  P3 --> R1[Read it on each stage row: unfolds its review card in place]
  P3 --> X1[Write ad copy: creative/generate, then creative/run max_jobs 1]
  P2 --> X2[Write offer: POST, then GET ?id= every 10 s]
```

- Nothing on the page approves a video or a flywheel step. The videos row says
  approving is not on the page yet, and when the text message's links ran out
  (`approval_expires_at`). Approving a stage still runs in chat; the row says so.
- No inner scroll box: long ad copy and the offer fold behind Show more.

## NOT BUILT (on this branch)

- Running a flywheel stage from the page, approving one, tweaking one (design slice 5).
  The flywheel rows are read only.
- Approving or rejecting a video from the page (design slice 2). Only the count, the
  ads and the dates are shown.
- `GET marketing/costs` and the cost ledger (design slice 1). Until then the cost lines
  come from `GET marketing/today` `costs`, as above.
