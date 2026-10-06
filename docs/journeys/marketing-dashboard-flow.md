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

## U01 API contract for every marketing/* route

Added 2026-10-05 by plan unit U01. This adds no step, state, route or screen. It writes down the
request and answer shape of every `marketing/*` route in spec v3 (M1 to M8), plus
`POST marketing/jobs/retry` and the `resume_ad` action on `campaigns/write`, so the back-end units
and the screens build to one shape.

- Doc: `docs/specs/marketing-machine-api.md` (46 routes).
- Twin: `src/marketing/api-contract.mjs` (`CONTRACT`, `assertMatchesContract`, `exampleResponse`).
- Test: `src/marketing/api-contract.test.mjs` fails when the doc and the module drift apart.

What is in the code today, traced through `ROUTES` in `netlify/functions/api.mjs`:

| Routes | Owner | In ROUTES today |
|---|---|---|
| `GET marketing/today` | existing; U32 adds keys | yes (existing keys only; the M5 keys are UNVERIFIED until U32 lands) |
| `POST campaigns/write` | existing; U15 adds `resume_ad` | yes (pause, resume, update_budget only; `resume_ad` is UNVERIFIED until U15 lands) |
| settings, funnels | U03 | no |
| scripts, script, approve, edit, reject, order | U25 | no |
| scripts/fix, ideas, batches, write-now, rules, jobs/retry | U26 | no |
| batches/next | U23 | no |
| health | U22 | no |
| angles, funnels/stats | U32 | no |
| ads, ad | U31 | no |
| meta/load, meta/load-status | U28 | no |
| shoot, shoot/mark, videos/*, video, map, pages/* | deferred | no |

Every route marked "no" is a shape only. Each owner unit adds its own flow section here when its
route lands. Gaps between the spec, the design doc and the fixed shapes are listed in the
contract's section 8.
## U03 Settings, funnels, and one save per press

Drawn from code on branch `mm-u03-settings-funnels`: `api/marketing/settings.mjs`,
`api/marketing/funnels.mjs`, `src/marketing/http.mjs`, `src/marketing/settings-store.mjs`,
`src/marketing/offer-facts.mjs`, migration `410_marketing_settings_funnels.sql`, seed
`297_marketing_funnels.sql`. Spec §6 Step 3, §7.8, §17. Owner and admin only on both
routes (requireAuth, then requireRole `ROLE_SETS.MARKETING`).

### Settings — `GET/POST /api/marketing/settings`

```mermaid
flowchart TD
  G[GET marketing/settings] --> G1{row for this company?}
  G1 -->|no| G2[insert the defaults<br/>ON CONFLICT DO NOTHING<br/>enabled false, Monday 07:00 Arizona,<br/>3 a day x 7 days, size_rule total, floor 91]
  G1 -->|yes| G3[200 settings]
  G2 --> G3
  P[POST marketing/settings<br/>request_id, updated_at, patch] --> V{every key known<br/>and every value right?}
  V -->|no| V1[400 invalid, field patch.key<br/>nothing saved]
  V -->|yes| W[withRequest: one staff transaction]
  W --> S{updated_at = the saved one?}
  S -->|no| S1[409 stale + current<br/>rolled back, nothing saved]
  S -->|yes| S2[save; format_style merges;<br/>updated_by = who; updated_at moves on]
  S2 --> R[200 settings]
```

- `enabled` goes true only when the patch says so — Chris's tap in Settings. No seed
  or migration sets it.
- Times are `HH:MM`. Money caps are whole dollars (model bills only).

### Funnels — `GET/POST /api/marketing/funnels`

```mermaid
flowchart TD
  G[GET marketing/funnels] --> F[funnels of this company]
  G --> C[synced Meta campaigns<br/>+ spend over the last 7 Arizona days<br/>null when no ad-day saved, never 0<br/>+ the funnel that holds each one]
  G --> A[synced Meta ad sets]
  G --> T[as_of = last Meta sync]
  P[POST marketing/funnels<br/>request_id, funnel:key + fields] --> V{fields known and right?}
  V -->|no| V1[400 invalid, field funnel.x]
  V -->|yes| W[withRequest: one staff transaction]
  W --> K{a funnel with this key?}
  K -->|no| N{name, landing_url, lane sent?}
  N -->|no| V1
  N -->|yes| M[make it]
  K -->|yes| U{updated_at sent and still the saved one?}
  U -->|no| S1[409 stale + current]
  U -->|yes| X[change only the fields sent]
  M --> D{a campaign id already<br/>on another funnel?}
  X --> D
  D -->|yes| V2[400 funnel.meta_campaign_ids<br/>rolled back]
  D -->|no| R[200 funnel]
```

- Seed 297 makes `book_call` (https://apply.fundhub.ai/watch, lane sorting, book a call,
  offer `funding_dfy`, mix standard 2 : sorting 1) and `roadmap_147`
  (https://apply.fundhub.ai/roadmap, lane uwiq, offer `slo_roadmap`, mix standard 1) in the
  default company, once. `meta_campaign_ids` stay empty until Chris maps them.
- `offerFacts(offer_key)` reads each price from `src/slo/offer.mjs` or
  `src/config/offers.mjs`. No price is typed in `src/marketing/`.

### One save per press — `withRequest` (every marketing write)

```mermaid
flowchart TD
  Q[a write with request_id] --> L[BEGIN as staff<br/>lock this request_id]
  L --> F{request_id saved before?}
  F -->|same company + route| A[return the saved answer<br/>fn never runs]
  F -->|other company or route| B[400 invalid, field request_id]
  F -->|no| R[run the change]
  R -->|throws| X[ROLLBACK: no change, no saved answer]
  R --> I[INSERT marketing_requests — last statement]
  I -->|primary key clash: a copy saved first| Y[ROLLBACK, return the first saved answer]
  I --> C[COMMIT, return the answer]
```

### Gaps between the spec and this code (findings, not reconciled)

- **Roadmap lane.** The spec seeds `roadmap_147` with lane `uwiq`; live roadmap visitors
  read lane `slo` (406/407). The seed uses the spec value until Chris answers the yes/no
  on the board. Numbers (M5) group by funnel, not lane.
- **offer_key values** (`funding_dfy`, `slo_roadmap`) are plan-chosen; the spec names the
  column, not the values.
- **One funnel per campaign.** The code refuses a Meta campaign that is already on another
  funnel of the same company, so a campaign's spend cannot count twice. The spec does not
  say this either way.
- **UNVERIFIED in a real database on this Mac** (no Postgres here): the SQL is proved by
  `src/http/marketing-settings.pg.test.mjs` and `marketing-funnels.pg.test.mjs` in GitHub CI.
## U04 Jobs, buzzes, model cost and shoots — the records (migration 411)

Drawn 2026-10-05 from the code on branch `mm-u04-jobs-buzzes-usage`:
`src/marketing/jobs.mjs`, `src/marketing/job-kinds.mjs`, `src/marketing/notify.mjs`,
`src/marketing/model-usage.mjs`, `db/migrations/411_marketing_buzzes_usage_shoots.sql`.
These are libraries and tables only. **No route, clock or worker calls them yet**: the
worker that claims jobs and sends buzzes is U22, the Retry button's route is U26, the
writer that logs model cost is U24. Those calls are marked UNVERIFIED below.

### A queued job (marketing_jobs, table from 409; claim index from 411)

`attempts` counts runs that went wrong (a failure, or a claim nobody finished). Claiming
and requeueing do not count. Kind `offer` is never touched by any of this: it runs on the
Write offer path above (`src/marketing/offer-store.mjs`).

```mermaid
stateDiagram-v2
  [*] --> queued: enqueueJob (refuses kind 'offer')
  queued --> running: claimJobs — one statement, FOR UPDATE SKIP LOCKED, due now, never 'offer'
  running --> done: finishJob(result) — saves an empty result when the handler returned nothing
  running --> queued: requeueJob(runAfter) — wait loop, attempts unchanged
  running --> queued: failJob, 1st or 2nd time — attempts+1, run_after +1 min then +5 min, reason kept
  running --> failed: failJob 3rd time — "Tried 3 times and it still failed. Last error: …"
  running --> failed: failJob with final true — reason as given (e.g. cost cap reached)
  running --> queued: reclaimStale — claim older than 16 min, attempts+1
  running --> failed: reclaimStale 3rd time — "The worker stopped without finishing 3 times …"
  failed --> queued: retryJob — same company only, kind in the list passed, attempts 0, error and result cleared, due now
```

- `nextRunAfter({kinds})` reads the earliest queued `run_after` (never `offer`), so the
  worker can wait inside its pass for a job due in a few seconds. UNVERIFIED: no worker yet (U22).
- `JOB_KINDS` (`src/marketing/job-kinds.mjs`) is **empty**. A kind not in it is never
  claimed by the worker and cannot be retried from the screen. U24, U28 and U35 add kinds.
- Retry button → `POST marketing/jobs/retry` → `retryJob`: UNVERIFIED, the route is U26.

### A buzz (marketing_buzzes, 411)

```mermaid
stateDiagram-v2
  [*] --> waiting: queueBuzz — send_after = now, or 07:00 Arizona when inside quiet hours (one waiting per company + kind + group; a repeat refreshes the words)
  waiting --> sending: sendDueBuzzes — due, none of that kind sent in 10 min, one per kind per pass; lease: attempts+1, send_after +5 min
  sending --> sent: send() answered ok:true AND status 'sent' — sent_at set
  sending --> waiting: anything else (ok:false, other status, a throw) — last_error kept, send_after = +5 min, pushed past quiet hours
  sending --> given_up: 5th failed attempt — failed_at set, never tried again
  sent --> [*]
  given_up --> [*]
```

- `send()` is always passed in. The worker will pass notify-fanout's `send`
  (`src/ad-videos/notify-fanout.mjs`); tests pass a fake. UNVERIFIED: no worker yet (U22).
- Which events buzz (scripts ready, videos ready, stuck) is decided by the callers
  (U24, U35, M3). UNVERIFIED: none of them call `queueBuzz` yet.

### Model cost (marketing_model_usage, 411)

```mermaid
flowchart TD
  C[a model call returns] --> L[logUsage: model = the model that SERVED it]
  L --> P{price known?<br/>MODEL_PRICES: claude-opus-5-5, claude-sonnet-5-5}
  P -->|yes| R1[cost_usd = tokens x price]
  P -->|no| R2[cost_usd NULL, never 0]
  R1 & R2 --> S[costStatus: batch total + this Arizona calendar month]
  S --> W[NULL rows counted at the highest known rate<br/>unpriced_rows reported]
  W --> K{at or over max_batch_cost_usd / max_month_cost_usd?<br/>missing cap = 40 / 300}
  K -->|yes| X[batch_capped / month_capped true]
  K -->|no| Y[keep writing]
```

UNVERIFIED: the writer that logs every call and stops at a cap is U24; Write now's refusal is U26.

### A shoot (marketing_shoots, 411)

Table only. States `planned | filming | uploaded | done`, enforced by the database; a done
shoot must have `finished_at`. Nothing reads or writes it yet (Shoot Day routes and screen
are later units). UNVERIFIED.

### Gaps between the spec and this code (findings, not reconciled)

- Spec §6 Step 3 lists `marketing_buzzes` without `attempts`, `last_error`, `failed_at`;
  the plan added them because notify-fanout's `send()` resolves `{ok:false}` instead of
  throwing. Built as the plan says.
- Spec §6 Step 4 says "After 3 attempts, a job fails". Here an attempt is a run that went
  wrong, not a claim, so wait loops (requeue) never use up tries.
- `group_key` is `NOT NULL DEFAULT ''` (spec lists it with no type) so "one waiting per
  group" also holds when no group is given.
## U05 M0 step 2: repo outbox (412), GitHub client provider, path allow-list, edit ops, lease-based drain (pooler-safe), worker wake

Drawn 2026-10-05 from the code on branch `mm-u05-repo-outbox`: `src/repo/outbox.mjs`,
`src/repo/allow-list.mjs`, `src/repo/edit-ops.mjs`, `src/messaging/providers/github-repo.mjs`,
`src/marketing/wake.mjs`, `db/migrations/412_repo_outbox.sql`. Spec §6 Step 2 and §2 item 8
("every save goes to the database and the repo").

**Nothing calls this yet.** The save routes (U25, U26, U35) call `enqueueRepoWrite` and
`wakeWorker`; the worker (U22) calls `drainOutbox` at most once a minute. Those boxes are
marked **NOT BUILT** below. Live commits also need `GITHUB_REPO_TOKEN` (only Chris can make it,
spec §16) and `MARKETING_WORKER_SECRET`; neither is set by this unit.

### A save, from the app to the repo

```mermaid
flowchart TD
  S["A save in the app — NOT BUILT (U25, U26, U35)<br/>inside the caller's transaction"] --> P{"path on the allow-list?<br/>normal form only"}
  P -->|no| P1["refused (RepoPathError), nothing saved"]
  P -->|yes| V{"replace: JSON loads, registry passes parseRegistry?<br/>edit: a known op aimed at its own file?"}
  V -->|no| V1["refused (EditOpError / OutboxError), nothing saved"]
  V -->|"op id already used for this same save"| V2["the saved row is returned, nothing new"]
  V -->|yes| E["repo_outbox row: waiting<br/>same transaction as the database change"]
  E -->|"the transaction rolls back"| X["no row"]
  E -->|"the transaction commits"| W["wakeWorker: POST /.netlify/functions/marketing-worker-background<br/>header x-fundhub-worker"]
  W -->|"MARKETING_WORKER_SECRET unset or masked"| W1["no-op; the clock wakes the worker later"]
  W --> D["drainOutbox — the worker, NOT BUILT (U22)"]
```

### One drain pass (`drainOutbox`)

```mermaid
flowchart TD
  D["drainOutbox"] --> T{"GITHUB_REPO_TOKEN set and not masked?<br/>(GITHUB_TOKEN is never read)"}
  T -->|no| T1["skipped no_token — nothing claimed, rows keep waiting"]
  T -->|yes| C{"claimOutbox: one short transaction<br/>pg_try_advisory_xact_lock, one global key"}
  C -->|"lock taken, or a claim younger than 10 min on any waiting row"| C1["skipped busy"]
  C -->|"nothing waiting"| C2["skipped empty"]
  C -->|yes| CL["claimed: claimed_at, claim_id, attempts + 1"]
  CL --> G["getRef, then listCommits (last 20)"]
  G -->|"blocked by the ADAPTERS dry-run fence"| H["claim cleared, attempt not counted<br/>skipped dry_run"]
  G --> TR{"id already in an 'Outbox:' trailer?"}
  TR -->|yes| DONE1["committed with that commit's sha (never twice)"]
  TR -->|no| A["read each edited file at the head<br/>apply rows in id order<br/>JSON parses, registry passes parseRegistry"]
  A -->|"a row the file cannot take"| R["that row only: error kept, claim cleared<br/>retried next pass"]
  A --> TREE["createTree: base_tree + files inline<br/>allow-list checked again"]
  TREE -->|"same tree as the head"| DONE2["committed at the head, no empty commit"]
  TREE --> CM["createCommit: author Fundhub app<br/>message 'app: …', trailer 'Outbox: ids', ends '[skip ci]'"]
  CM --> U["updateRef refs/heads/GITHUB_BRANCH, force false"]
  U -->|ok| DONE3["committed: committed_sha + committed_at"]
  U -->|"422 not a fast forward, or 409"| G2{"tries left (3 in all)?"}
  G2 -->|yes| G
  G2 -->|no| RT["claim cleared, error kept — next pass retries"]
  U -->|"5xx, no answer, 429, rate limit"| RT
  U -->|"any other 422 (branch protection), 401, 403, 404"| ER["error recorded for the health card<br/>claim kept, expires after 10 min (no hammering)"]
```

- No lock and no transaction is held across any GitHub call. A drain whose lease was taken
  over writes nothing: every update is limited to rows that still carry its `claim_id`.
- The health card that shows `error` and the dry-run hold is U22 — **NOT BUILT**.
- Fallback reads: `netlify.toml` now bundles RULES.md, VOICE.md, RECIPES.md, angles.json,
  banned-live.json, registry.json and `marketing/broll/catalog.json` with every function. The
  code that falls back to them is in the readers (U24, U26) — **NOT BUILT**.

### Gaps between the spec and this code (findings, not reconciled)

- Spec §6 Step 2 says the drain "takes `pg_try_advisory_lock`". Built instead as
  `pg_try_advisory_xact_lock` plus a 10-minute lease, per the plan's critique fix B1: a session
  lock leaks on the Supabase transaction pooler.
- Spec §6 Step 2 cites `parseRegistry` at `src/ads/registry.mjs:108`; it is at :118 today.
- A save that does not fit its file (for example an edit to a Part 0 rule number that is not
  there) is retried every pass with its reason on the row. There is no "gave up" state; the
  spec names none.
- `docs/journeys/marketing-machine-intended.md` is not on main, so this was checked against
  the spec text, not the intended journey.
## U06 M0 step 4 model client: callModel provider 'anthropic'

Drawn 2026-10-05 from `src/agents/model.mjs` (`callModel` → `callAnthropicForced`)
on branch `mm-u06-anthropic-model-client`. Spec §6 step 4 "The model client" and
§4 trap 8. No screen. Nothing calls this path yet; the writer (U24) is its first
user.

What it does, in plain words:

- `callModel({ provider: 'anthropic', ... })` only ever calls
  `api.anthropic.com`. An OpenAI key in the same env is ignored.
- Without `provider`, `callModel` is the same code as before (OpenAI first, then
  Anthropic). A test pins the old Anthropic request body byte for byte.
- A missing key, a masked key (it holds `*`), a forced tool choice (`'any'` or a
  named tool), a non-Claude model name or a bad option is refused before
  anything is sent. The error starts `not sent:`.
- Every request carries `output_config.effort` (default `medium`), a timer
  (default 10 minutes) that aborts the request, and `max_tokens` (default 16000,
  because thinking counts toward it). It never carries `thinking`,
  `temperature`, `top_p`, `top_k` or `budget_tokens`.
- `cache: true` sends the system prompt as one block marked
  `cache_control: ephemeral`.
- `outputSchema` goes out as `output_config.format` (`json_schema`); the parsed
  reply comes back as `json`, or the error `no_json`.
- `tools` go out with `strict: true`, `additionalProperties: false` and a
  `required` list on every object. The first `tool_use` input comes back as
  `toolInput`; no tool call (choice `auto`) is the error `no_tool_call`.
- On claude-opus-5-5, claude-opus-5, claude-sonnet-5-5 and claude-fable-5-1 it
  asks for `fallbacks: "default"` with the beta header
  `server-side-fallback-2026-07-01` unless `fallbacks: false`. `servedModel` is
  the model that answered.
- Every result has `usage` with input, output, cache-read and cache-write tokens.

```mermaid
flowchart TD
  A[callModel with provider] --> P{provider is 'anthropic'?}
  P -->|no| N1[not sent: unknown provider]
  P -->|yes| K{ANTHROPIC_API_KEY set and not masked?}
  K -->|no| N2[not sent: key missing or masked<br/>mode shadow, no call]
  K -->|yes| V{model is claude-*, effort valid,<br/>maxTokens and timeoutMs valid,<br/>toolChoice auto or none, tools named}
  V -->|no| N3[not sent: plain reason<br/>forced tool choice lands here]
  V -->|yes| B[build body: model, max_tokens, system or cached system block,<br/>user message, strict tools, output_config effort + format,<br/>fallbacks default on the four listed models]
  B --> S[POST api.anthropic.com/v1/messages<br/>with AbortSignal]
  S -->|timer fires| T[anthropic timeout error<br/>temporary]
  S -->|fetch throws| U[network error, status null<br/>temporary]
  S -->|HTTP not ok| H[anthropic STATUS: body<br/>429 and 5xx temporary]
  S -->|HTTP 200| R{stop_reason}
  R -->|refusal| RF[refused: category named]
  R -->|max_tokens| MT[cut off: raise maxTokens]
  R -->|other| C{what was asked for}
  C -->|outputSchema, no tool call| J{reply parses as JSON?}
  J -->|yes| OK1[json set]
  J -->|no| NJ[error no_json]
  C -->|tools, choice auto, no schema| TU{tool_use block?}
  TU -->|yes| OK2[toolInput set]
  TU -->|no| NT[error no_tool_call]
  C -->|plain text| OK3[text set]
  OK1 --> Z[result: text, json, toolInput, stopReason,<br/>servedModel = response.model, usage x4, status]
  OK2 --> Z
  OK3 --> Z
```

UNVERIFIED: that Anthropic accepts this exact request shape. Fake-fetch tests
prove what is sent, not that the vendor takes it. The orchestrator's one small
live call after the ship is the proof (a 400 means the shape is wrong).

Gaps against the spec (findings, not reconciled):

- Spec §6 step 4 lists `tools` and `toolChoice`, and §7.6 speaks of a forced
  `save_script` tool. Forced tool use is HTTP 400 on claude-opus-5-5 and
  claude-sonnet-5-5 (claude-api skill), so only `auto` and `none` are accepted
  and the writer gets `outputSchema` instead.
- The spec names no default model, `maxTokens`, timeout or effort for this
  path. The defaults above come from the claude-api skill.
## U08 Ship stays in step with GitHub (spec M0 step 8)

Drawn 2026-10-05 from `scripts/ship.mjs`, `scripts/ship-machine-paths.mjs`,
`scripts/netlify-ignore-machine-only.mjs` and the `[build] ignore` line in
`netlify.toml`, on branch `mm-u08-ship-pull-push`. Ops only, no screen.

Machine-only folders (one list, `MACHINE_ONLY_PATHS`, read by both ship and the
Netlify skip rule): `marketing/ads/scripts/machine/`, `marketing/ads/ideas/`,
`marketing/ads/videos/`, `marketing/brain/`, `ops/page-requests/`. Rule, voice and
registry files (`marketing/ads/RULES.md`, `VOICE.md`, `registry.json`,
`banned-live.json`, `angles.json`) are not on it, so they still ship.

### `npm run ship`

```mermaid
flowchart TD
  S[npm run ship] --> B{on main and the tree clean?}
  B -->|no| X1[stop: ship from main / commit first]
  B -->|yes| D{--dry?}
  D -->|yes| P0[says it would pull; pulls nothing]
  D -->|no| P1[git pull --ff-only origin main<br/>no prompt, no editor, 90 s limit]
  P1 -->|works, or already up to date| H
  P1 -->|no answer in 90 s: no second try| R
  P1 -->|cannot fast-forward| P2[git pull --rebase=merges --autostash origin main]
  P2 -->|works| H
  P2 -->|clash, error or no answer| A[list clashing files<br/>git rebase --abort]
  A --> R{back on main, same commit, clean tree?}
  R -->|yes| L2[one line naming the clashing file, git's reason,<br/>or no answer: shipping this Mac's main as it is] --> H
  R -->|no| X2[stop: the pull could not be undone,<br/>nothing deployed]
  P0 --> H
  H[read the commit to ship] --> K{changed since the last ship, leaving out<br/>ops/ship-log.md and the machine-only folders?}
  K -->|no| N[Nothing to ship, exit 0]
  K -->|yes, or git errors| C[lint + guards, database, netlify deploy --prod,<br/>/api/health pending 0, Inngest]
  C --> LOG[append ops/ship-log.md<br/>commit: ship: head is live]
  LOG --> F[git fetch origin main<br/>no prompt, 90 s limit]
  F -->|fails| Q1[one line: did not push]
  F -->|works| I{GitHub's main inside this Mac's main?}
  I -->|no| Q2[one line: did not push,<br/>it would overwrite GitHub's newer commits]
  I -->|yes| PUSH[node scripts/github-push-whole-repo.mjs<br/>main, every local branch, every tag; 10 min limit]
  PUSH -->|works| OK[one line: pushed]
  PUSH -->|fails| Q3[one line with the reason, token hidden]
  Q1 & Q2 & Q3 & OK --> E[ship ends; the deploy stands]
```

- A failed pull never stops the ship. The only stop in the pull step is a folder left
  half way through a pull, because deploying it would ship a broken tree.
- The push runs only after the ship-log commit. Nothing after it can stop the ship or
  undo the deploy.
- Why the push is checked first: `github-push-whole-repo.mjs` leases `main` on the copy
  it fetches a moment before, so on its own it would overwrite GitHub commits this Mac
  does not have (the outbox's saves). Ship pushes only when GitHub's main is already
  inside this Mac's main; the next ship pulls first.
- A rebase copies this Mac's local commits, including the commits of branches merged
  locally since the last push. The merge commits stay merges, but the old branch tips
  are no longer inside `main` afterwards.

### Netlify build started by a GitHub push

```mermaid
flowchart TD
  G[Netlify starts a build from a GitHub push] --> IG[ignore = node scripts/netlify-ignore-machine-only.mjs]
  IG --> E1{CACHED_COMMIT_REF and COMMIT_REF both set,<br/>plain commit ids, different?}
  E1 -->|no| BUILD[exit 1: build]
  E1 -->|yes| DF[git diff --name-only --no-renames between them]
  DF -->|git fails, or no files| BUILD
  DF --> M{every changed file in a machine-only folder?}
  M -->|no| BUILD
  M -->|yes| SKIP[exit 0: build skipped]
  LAP[npm run ship on the Mac:<br/>netlify deploy --build] -.->|Netlify's CLI never runs the ignore command| ALWAYS[always builds]
```

- A commit that changes only `ops/ship-log.md` is "nothing to ship" for `npm run ship`
  but builds on Netlify (the skip list is the machine-only folders only).
- **UNVERIFIED:** whether the live site still starts builds from GitHub pushes at all
  (repo link, stop_builds). This unit did not read the site's build settings; the
  orchestrator's precondition records them.
- **UNVERIFIED:** Netlify's own handling of the exit code (0 skips, 1 builds) is from
  Netlify's docs, not seen on a live build.
## U22 M0 step 4: marketing clock + background worker (in-pass waits) + GET marketing/health (heartbeats 415)

Drawn 2026-10-06 from the code on branch `mm-u22-marketing-clock`:
`src/marketing/clock.mjs` (tick), `src/marketing/worker.mjs` (runPass, the door),
`netlify/functions/marketing-clock.mjs`, `netlify/functions/marketing-worker-background.mjs`,
`api/marketing/health.mjs`, `db/migrations/415_marketing_heartbeats.sql`. Spec §6 Step 4,
§8.3 (health card), §2 item 4 (buzzes). Back end only: the health card screen is lane E.

### The clock (`marketing-clock`, every 15 minutes, a 30-second scheduled function)

```mermaid
flowchart TD
  T["Netlify cron */15 * * * *<br/>marketing-clock.mjs → tick()"] --> S["read every company's marketing_settings<br/>(never makes a row)"]
  S --> B{"enabled? (read as the weekly-batch switch only)"}
  B -->|false| BD["batch part: log 'disabled', plan nothing"]
  B -->|true| BO["batch part: 'on', plan nothing yet<br/>(weekly scheduling is U35 — NOT BUILT)"]
  BD & BO --> W["count waiting work (all companies):<br/>repo_outbox rows not committed · buzzes due ·<br/>queued jobs due of a JOB_KINDS kind (never 'offer') ·<br/>running claims older than 16 min"]
  W --> HB["'clock' heartbeat on every company the machine serves<br/>(settings row, a waiting save, or an open job)"]
  HB --> K{anything waiting?}
  K -->|no| N["log 'nothing waiting'; no wake"]
  K -->|yes| WK["wakeWorker: POST /.netlify/functions/marketing-worker-background<br/>header x-fundhub-worker"]
  WK -->|"MARKETING_WORKER_SECRET unset or masked"| WN["no-op, logged; nothing runs"]
  T -->|"database error"| E["log it, still answer 200 — the next tick is the retry"]
```

- The clock imports no model, GitHub, Meta or texting module (`clock.test.mjs` walks the imports).
- It queues nothing in this unit. The only row it writes is its heartbeat.

### One worker pass (`marketing-worker-background`, up to 15 minutes)

```mermaid
flowchart TD
  D["POST from the clock, a save's wake, or the last pass"] --> G{"x-fundhub-worker = MARKETING_WORKER_SECRET?<br/>(unset or masked secret = closed door)"}
  G -->|no| X["404 'no', nothing runs"]
  G -->|yes| H1["'worker' heartbeat: running"]
  H1 --> R["reclaimStale: claims older than 16 min → queued (or failed on the 3rd); never 'offer'"]
  R --> L{"minute 9 yet?"}
  L -->|yes| STOP["stop taking work"]
  L -->|no| DR{"last drain (any pass) a minute or more ago?<br/>('outbox_drain' heartbeat)"}
  DR -->|yes| DO["drainOutbox → record the result on 'outbox_drain'<br/>('busy' moves the time, keeps the last real result)"]
  DR -->|no| BZ
  DO --> BZ{"30 s since the last buzz check?"}
  BZ -->|yes| SB["sendDueBuzzes with notify-fanout send()"]
  BZ -->|no| CL
  SB --> CL["claim per group: writer up to 3 at once, every other group 1<br/>(one short transaction: advisory xact lock, count running, SKIP LOCKED claim, never 'offer')"]
  CL --> RJ["run each claimed job's handler (JOB_KINDS run(job, ctx))<br/>return → finishJob · throw → failJob (final:true fails at once)"]
  RJ --> F{"jobs still running?"}
  F -->|yes| WT["wait for one to end, at most 15 s"] --> L
  F -->|no| NX{"earliest queued run_after, or the next drain minute<br/>when saves wait and the last drain was not held,<br/>falls before minute 9?"}
  NX -->|yes| SL["wait until then (a job due but unclaimable: 5 s)"] --> L
  NX -->|no| IDLE["stop: idle"]
  STOP & IDLE --> FIN["let running jobs finish (killed at 15 min; reclaimStale takes them back)"]
  FIN --> RW{"a queued job due within the next 9 minutes?"}
  RW -->|yes| WAKE["wake the next pass"]
  RW -->|no| END
  WAKE --> END["'worker' heartbeat: done, with what the pass did"]
```

- A job that re-queues itself 10 seconds out (U28's Meta video poll) runs again in the same
  pass. NOT BUILT: no job kind is registered yet (`JOB_KINDS` is empty until U24, U28 and U35),
  so today a pass drains, sends buzzes and ends.
- Concurrent passes are safe: claims skip locked rows, the outbox drain holds a 10-minute
  lease, buzzes take a lease, and the group caps count running jobs in the database.

### GET /api/marketing/health

```mermaid
flowchart TD
  Q["GET /api/marketing/health"] --> A{"signed in?"}
  A -->|no| E401["401"]
  A -->|yes| RL{"owner or admin (ROLE_SETS.MARKETING), with a company?"}
  RL -->|no| E403["403, nothing written"]
  RL -->|yes| TX["one short staff transaction"]
  TX --> S1["settings row (made with defaults on the first read)"]
  S1 --> PS["'page_seen' heartbeat: who read it"]
  PS --> RD["read: heartbeats · this company's jobs (never 'offer') ·<br/>repo_outbox · last Meta sync · cost this month and the newest batch"]
  RD --> OUT["200 {clock, worker, outbox, sync, model, as_of}"]
  OUT --> HR{"held_reason"}
  HR -->|"GITHUB_REPO_TOKEN unset or masked"| NT["'no_token'"]
  HR -->|"last drain held by the dry-run fence"| DRY["'dry_run'"]
  HR -->|otherwise| NUL["null"]
  TX -->|"a marketing_* table not live yet"| E503["503 not_ready"]
```

### Gaps between the spec and this code (findings, not reconciled)

- **The clock and `enabled`.** Spec M0 step 4 says the clock "does nothing while `enabled` is
  false". This unit reads `enabled` as the weekly-batch switch only: with it off the batch part
  logs "disabled" and plans nothing (M0 Done #4), but the clock still wakes the worker for saves,
  due buzzes, due jobs and stale claims, because those come from Chris's own taps (Write now,
  rule edits, script saves) and must work while the weekly schedule is off. For Chris to see once.
- Spec §6 Step 4 says the clock's self-wake `fetch` goes on `ALLOWED_RAW_FETCH`. The clock calls
  `wakeWorker` (`src/marketing/wake.mjs`, already on that list from U05), so no new entry.
- Spec says "runs up to 3 writer jobs at once". The other groups (loader, system) run 1 at a time
  each, per the plan brief; the spec does not name them.
- Heartbeats for the clock, the worker and the drain are written on every company the machine
  serves; the health card reads its own company's. `marketing_heartbeats.org_id` cascades when a
  company is deleted (a status light, not a record). The spec names no heartbeat table; the plan
  contract does (415).
- `sync.last_sync_at` is the later of the Meta connection's `last_synced_at` and the newest
  `ad_metrics_daily.synced_at`. `model.last_batch_cost_usd` is the newest `marketing_batches`
  row's cost; null when there is no batch.
- Buzz retries use the one company's quiet hours when exactly one company has settings, else the
  spec default (21:00-07:00 Arizona). A new buzz already waits through quiet hours when queued.
- `docs/journeys/marketing-machine-intended.md` is not on main, so this was checked against the
  spec text and the plan contract, not the intended journey.

## U26 Retry a stuck step — `POST /api/marketing/jobs/retry`

Generated from the code on 2026-10-06 (branch `mm-u26-ideas-rules-retry`): `api/marketing/jobs/retry.mjs`,
`retryJob` in `src/marketing/jobs.mjs`, `JOB_KINDS` in `src/marketing/job-kinds.mjs`. Spec §8.3 (Today
lists each machine stage with Retry; Chris runs marketing from the dashboard, never from Claude
Code). Owner and admin only (requireAuth, then requireRole `ROLE_SETS.MARKETING`). Today's
`stuck_jobs` (plan unit U32) carry the ids this route takes.

```mermaid
flowchart TD
  P["POST marketing/jobs/retry<br/>request_id, job_id"] --> U{"job_id is an id?"}
  U -->|no| X["400 invalid, field job_id"]
  U -->|yes| T["one staff transaction (withRequest)"]
  T --> F["SELECT the job FOR UPDATE<br/>this company only"]
  F --> K{"found, not 'offer',<br/>kind in JOB_KINDS?"}
  K -->|no| NF["404 not_found<br/>(another company's job, the Write offer path, a kind the worker does not know)"]
  K -->|yes| S{"status failed?"}
  S -->|no| NX["400 invalid, field job_id<br/>(queued, running or done)"]
  S -->|yes| R["retryJob: failed → queued<br/>attempts 0, error, result, claimed_at, finished_at cleared, due now"]
  R --> OK["200 {ok, job:{id, kind, status:'queued'}}"]
  OK --> W["COMMIT, then wake the worker"]
```

- Free: a retry spends nothing by itself; the job's own handler checks the cost caps when it runs.
- A repeated request_id answers the first 200 and changes nothing, even if the job failed again since.
- **UNVERIFIED in a real database on this Mac** (no Postgres here): proved by
  `src/http/marketing-jobs-retry.pg.test.mjs` in GitHub CI. Today JOB_KINDS is empty, so every
  live job answers 404 until units U24, U28 and U35 register their kinds.

### Batch history and Write now on the dashboard

`GET marketing/batches` and `POST marketing/batches/write-now` are drawn in `ad-script-flow.md`,
section "U26 Ideas, rules, Fix and Write now". `write_now_ready` is false until `start_batch` is in
JOB_KINDS, so the Today and Scripts screens show no Write now button that cannot produce drafts.

## X3 The flywheel on the dashboard (Ideas: Offer and market card back end)

Drawn 2026-10-06 from the code on branch `mm-x3-ideas-flywheel`: `api/marketing/flywheel.mjs`,
`api/marketing/flywheel/{run,approve,tweak,spend-read,campaign}.mjs`, `src/marketing/flywheel/*`
(reader, stages, store, steps, copy-stage, strategy-stage, spend-read, campaigns, stamp, save,
doctrine, copy-checks, stage-job), `src/marketing/job-kinds.mjs` (`flywheel_stage`),
`src/repo/{allow-list,edit-ops}.mjs`, `scripts/flywheel/status.mjs` (`evaluateFiles`).
Design `docs/specs/command-center-design-2026-10-05.md` §3.2 row 6, §5, §6 slice 5. Owner and admin
only on every route (requireAuth, then requireRole `ROLE_SETS.MARKETING`). Back end only: the
Ideas tab screen is unit X8.

### Where the stage files are read from (every answer names its source)

```mermaid
flowchart TD
  R["readFlywheel(campaign)"] --> T{"GITHUB_REPO_TOKEN set and not masked?"}
  T -->|no| B["bundle-fallback: marketing/flywheel/** shipped with the function"]
  T -->|yes| REF["getRef: the branch's commit"]
  REF -->|error| B
  REF --> L["listFolder marketing/flywheel @commit: the campaigns"]
  L --> F["getContents x8 @commit (ETag cache): 00-OWNER-NOTES, 01-avatar, the word bank, 02 to 06"]
  F -->|error| B
  F --> P["lay on top: repo_outbox rows of this company not yet committed<br/>(replace = the new file, edit = re-applied) → source 'outbox-pending'"]
  B --> PB["lay on top: every flywheel row of this company, committed too<br/>(both edit ops are idempotent)"]
  P & PB --> S["states: scripts/flywheel/status.mjs evaluateFiles (the same rules as npm run flywheel:status)"]
```

### The six rows and what each button does

```mermaid
flowchart TD
  G["GET marketing/flywheel?campaign="] --> V["six rows: label_words, state_word, sentence,<br/>can_run{ok, reason}, run{step, step_word, cost_so_far_usd}, review_card_md, files"]
  RUN["POST marketing/flywheel/run {campaign, stage, request_id}"] --> W{stage}
  W -->|1 or 2| NB["409 not_built: 'Not on this page yet: it ships in slice 5a / 10.'"]
  W -->|3| OF["hand to POST marketing/offer/generate with the campaign's own files (kind 'offer')"]
  W -->|6| SR["spend read now, one staff transaction → 200"]
  W -->|4 or 5| GATE{"step 3 approved? (5: 3 and 4)"}
  GATE -->|no| BL["409 blocked, the reason printed"]
  GATE -->|yes| KEY{"Anthropic key? month cap left?"}
  KEY -->|no key| NM["503 no_model"]
  KEY -->|cap reached| CH["409 cap_hit"]
  KEY -->|yes| J["one staff transaction: advisory lock (company, campaign, stage) →<br/>a queued/running flywheel_stage row? answer it : insert one"]
  J --> A202["202 {started, already_running, job, poll}; wake the worker after the commit"]
  AP["POST marketing/flywheel/approve {campaign, stage}"] --> AE["file there? → outbox edit set_front_matter_key status: approved<br/>(the body hash does not change, nothing downstream goes out of date)"]
  TW["POST marketing/flywheel/tweak {campaign, stage, note}"] --> TN["outbox edit append_line_under_heading '## Notes':<br/>'YYYY-MM-DD | stage N | note' (append only, a repeat writes once)"]
  TN --> TR["re-run where it can: 4/5 a job with the note in its payload · 6 the read now ·<br/>3 the offer path with the line in its notes · 1/2 not yet (reason given)"]
  CA["POST marketing/flywheel/campaign {key}"] --> CN["offer key → folder (UWIQ_DELIVERABLES → capital-blueprint) →<br/>outbox replace 00-OWNER-NOTES.md with 'Offer key: …' (201; exists → 200)"]
```

### Steps 4 and 5 on the worker (job kind `flywheel_stage`, group writer)

```mermaid
flowchart TD
  C["worker claims flywheel_stage → stage-job.mjs run(job)"] --> D{"payload.stage has a runner? campaign a folder name?"}
  D -->|no| FF["fail now (final), plain reason"]
  D -->|yes| ST["runSteps: start at result.state, else payload.resume (kept for Retry), else fresh"]
  ST --> CAP{"before every batch: run spend + batch worst case under the run cap<br/>(max_batch_cost_usd, $40) and the month cap ($300)?"}
  CAP -->|shrink to fit| CALL["callModel provider 'anthropic', explicit model, maxTokens, timeout;<br/>one marketing_model_usage row per call (served model, job_id)"]
  CAP -->|not one call fits| STOP["'Stopped at the $40 run cap while …' : result.stopped_at_cap, place kept, failed (final)"]
  CALL --> SAVE["save the place in result (one statement)"]
  SAVE --> SL{"2-minute slice used?"}
  SL -->|yes| BACK["requeueJob (no attempt counted), due now → the next claim resumes"]
  SL -->|no| NEXT["next step"]
  NEXT --> CAP
  NEXT --> OUT["save step: stamp (stage, version+1, draft, input hashes, counts) →<br/>repo_outbox replace 0N-*.md, op id flywheel:job:file → job done with the evidence"]
```

- Step 4 (copy.js port): inputs → angles (Opus) → write per reason (Sonnet) → humanize per piece
  (banScan in code with rules-data.mjs lists; up to 3 attack and rewrite passes; still dirty or
  figures sanded off = dropped) → verify (closing-line collisions dropped by code, then three
  lenses) → assemble (Opus) → save `04-copy.md`.
- Step 5 (ad-strategy.js port): inputs (offer, copy, the company's own 30-day totals as staff, the
  ground files from GitHub or beside the code; missing ones listed) → ground (Sonnet) → plans x2
  (Opus, doctrine bundled in `doctrine.mjs`) → checks (`screenTargeting` run in code on each plan,
  then three lenses) → repair once → assemble → save `05-ad-strategy.md`.
- Step 6 (spend read): `readAdNumbers` + `readTotals` + Meta purchases per number, 30 Arizona days
  ending yesterday, as staff; the conclusion is code (watch-curve law words, no benchmark) →
  `06-spend.md` through the outbox.
- Quick copy: `src/creative/providers/copy.mjs` is forced to Claude (`claude-sonnet-5-5` unless a
  Claude model is configured); `POST creative/run` adds `check` (checkScriptText strict, in words)
  to every copy asset and `model` to every job.

### Gaps between the design and this code (findings, not reconciled)

- **Stages 1 and 2 do not run here.** Units X1 (avatar, kind `avatar`) and X2 (market research,
  `flywheel_stage` stage 2) own them; `STAGE_RUNNERS[1|2]` is null and the routes answer
  `not_built` with the row's sentence. X1/X2 add their runner lines (`stages.mjs`,
  `stage-job.mjs`) rather than new routes.
- **One run in flight per campaign and stage is held in code** (advisory transaction lock plus a
  look), not by the partial unique index the design names: X3 has no migration number. The index
  belongs in the `marketing_jobs` follow-up migration (design slice 10).
- **The run cap for steps 4 and 5 is the batch cap** (`max_batch_cost_usd`, $40). The design names
  no cap of its own for them.
- **Retry clears `result`** (U04 `retryJob`), so the runner keeps its place in `payload.resume`
  as well; a retried run picks up there.
- **The spend read reads every ad in the account.** Ads are not tied to one flywheel campaign yet
  (no column links them); the file says so.
- **Step 5's ground files** (`ops/workflows/ads-waterfall-projections-2026-08-26.md`,
  `ops/workflows/ads-revenue-model-2026-08-24.md`, `marketing/ads/ascension/ascension-ads.md`) are
  read from GitHub; with no token they are read only where the function bundle has them (the
  `ops/` files are not in `included_files`), and the run lists them as missing. The revenue model
  file is not in the repo at all.
- **The doctrine** is the repo's excerpts only (`ascension-ads.md` §1 and §5, the Drive index
  lines); the full SOPs are in Drive and are not read. The plans are told so.
- **GET marketing/angles** is unit U32's (`mm-u32-angles-funnel-stats`, not merged here);
  **GET/POST marketing/batches/next** is unit U23's. Not built twice.
- **GET marketing/flywheel/job?id=** (design slice 5a) is unit X1's; `GET marketing/flywheel`
  carries each row's run instead.
- `docs/journeys/marketing-machine-intended.md` is not on main, so this was checked against the
  design and spec text, not the intended journey.
- **UNVERIFIED on this Mac** (no Postgres): the routes and the worker run against real tables
  are proved by `src/http/marketing-flywheel.pg.test.mjs` in GitHub CI.
