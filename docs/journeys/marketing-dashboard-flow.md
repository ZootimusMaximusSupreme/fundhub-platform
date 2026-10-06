# Marketing Command Center — what the back end does today

Required by `CLAUDE.md` §3a step 4. Written 2026-10-05 from the code on branch
`m10-dashboard-backend` (slice 1, back end only). The plan is
`docs/specs/marketing-dashboard-plan-2026-10-05.md`; the JSON shape is
`docs/specs/marketing-today-contract.md`.

Drawn from code, not from the plan. Anything the code does not do yet is marked
**NOT BUILT** rather than drawn as if it ran.

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
  D --> S[spend: today, last 7, prior 7, last 30<br/>from ad_metrics_daily, whole company]
  D --> L[last_sync: Meta connection + newest ad-day]
  F & H1 & H2 & S & L --> Z[200 with as_of and waiting]
  F -->|files not on server| W[that part null + named in waiting]
  S -->|table missing / no rows in 30 days| W
  L -->|table missing / never synced| W
  W --> Z
  D -->|database not answering| E[503 db down]
```

- A window with no saved ad-days is `null`, never `0`.
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
  C1 -->|POST creative/run, or the runner every 2 min| C2[running]
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

## U20 M5 11.1: metric definitions (`src/marketing/metrics.mjs`)

Written 2026-10-06 from the code on branch `mm-u20-metric-definitions`. Read only:
nothing here writes a row, calls Meta or calls a model. No endpoint yet (U31/U32
call these readers). The words for each number are in `docs/marketing/metrics.md`.

How one lead becomes numbers on its ad:

```mermaid
flowchart TD
  T[client_ad_attribution row<br/>first touch, one per client] --> N{ad_id = our ad number?}
  N -->|NULL| U[unmapped lead<br/>readTotals.unmapped.leads]
  N -->|number| D{lead day in from..to?<br/>Arizona day of captured_at}
  D -->|no| X[not counted]
  D -->|yes| C{demo client?}
  C -->|yes| X
  C -->|no| L[lead on that number]
  L --> W[results counted only before<br/>captured_at + 14 days]
  W --> B[booked: bookings booked / rescheduled / noshow / completed<br/>by client_id, else attendee email]
  W --> S[showed: call_outcomes outcome not no_show]
  W --> SA[sales: sales status active]
  W --> R[roadmaps: readSloPaid's two predicates, lifted]
  W --> M[cash: transactions succeeded, cents<br/>reported cash: call_outcomes cash typed in]
  L --> MA{younger than 14 days at now?}
  MA -->|yes| MT[maturing]
  MA -->|no| ST[settled]
```

How spend reaches a number, and how the two meet:

```mermaid
flowchart LR
  AM[ad_metrics_daily<br/>ad_id = ads.id, date = Meta's Arizona day] --> J[JOIN ads<br/>ads.fundhub_ad_number]
  J -->|number| SP[spend per number<br/>summed over every ads row with it]
  J -->|NULL| UM[unmapped spend<br/>readTotals.unmapped]
  SP --> F[FULL JOIN on number]
  LD[leads per number<br/>counted once, apart from spend] --> F
  F --> ROW[readAdNumbers row]
  ROW --> RT[ratio helpers<br/>null when a side is unknown or the bottom is 0]
```

Page events (`readFunnelEvents`): `events` named `funnel.*`, actor `person`, not
demo, by the event's Arizona day → ad number from the visit's own tags (leading
digits of `utm_content`, else the 407 Meta match) → funnel and step from
`src/funnel/pages.mjs`.

Gaps between the spec and the live data (recorded, not fixed) are listed in
`docs/marketing/metrics.md` under "Measured gaps": bookings has 0 rows while 74
`booking.created` events carry no client; call_outcomes has 0 rows; cash here is
transactions while `adAttributionRollup` counts payment links; "25% hold" is not
ad-spine's `hold_rate`; 2-second plays are stored on 0 of 69 ad-days.

## NOT BUILT (on this branch)

- The page `public/app/marketing-command-center.*` (workflow M11).
- Running a flywheel stage from the page (slice 2). The flywheel rows are read only.
- The offer generator (workflow M12).
