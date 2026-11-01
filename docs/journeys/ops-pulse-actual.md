# ops-pulse — actual

What the code does today. Traced from `src/ops/`, `api/read/ops-pulse.mjs`, `api/ops/hire-closer.mjs`, and `public/app/ops-admin.html`. Not from the spec.

```mermaid
flowchart TD
    PAGE["ops-admin.html Money zone"] --> GET["GET /api/read/ops-pulse"]
    GET --> AUTH{requireAuth then ROLE_SETS.OPS}
    AUTH -->|not owner/admin| DENY[403]
    AUTH -->|ok| PULSE["computePulse"]
    PULSE --> KPI["computeKpis — company 8"]
    PULSE --> BARS["staff_targets 27/27 per pod × complete pods"]
    PULSE --> CLOCK["role-unit-times MODEL"]
    PULSE --> MEAS["measureMinutes Hubstaff + CRM — locked false"]
    PULSE --> CAL["loadCalendar MODEL packed rule"]
    PULSE --> GAPS["diagnoseGaps from bars + packed + bookings"]
    PULSE --> ADS["loadAdSpend from ad_metrics_daily"]
    PULSE --> MKT["marketingSnapshot spend + cost per booked"]
    PULSE --> BRIEF["briefsFromPulse ceo + owner"]
    GET --> NOWRITE[No task insert. No LinkedIn call]
    PAGE --> BTN{Write today’s C-suite tasks}
    BTN -->|not packed and no gap and no spend| HIDE[Button hidden]
    BTN -->|click| POST["POST /api/ops/hire-closer"]
    POST --> AUTH2{requireRole owner, admin + ROLE_SETS.OPS}
    AUTH2 -->|ok| ACT["actOnBrain"]
    ACT -->|packed| HIRE["actOnPacked → hire + postJob"]
    ACT -->|has_short| DIAG["createCsuiteTask kind=diagnose"]
    ACT -->|spend_cents > 0| ADSREV["createCsuiteTask kind=ads_review"]
    HIRE --> LI["postCloserLinkedIn → postJob"]
    LI -->|no connection| NC[linkedin: not_configured]
    FIRE["createCsuiteTask kind=fire|raise|bonus"] --> OWNER[assignee owner]
    FIRE -.->|not called from actOnBrain| IDLE[no auto-enqueue]
    CLOCK["Netlify cron clock, 7:15 Arizona daily"] --> MGR["runManagerKpiReview"]
    MGR -->|closer under 25% after 10 held calls| ROUTE["assigneeFor closer role, then active manager"]
    ROUTE --> DATED["One dated manager review task per closer and month"]
```

## Entry

- Screen: `public/app/ops-admin.html` section `#ops-pulse` on the Money zone
- Read: `GET /api/read/ops-pulse?period=today|7d|30d|qtd`
- Write: `POST /api/ops/hire-closer` — empty JSON body. `packed`, `org_id`, and `staff_id` on the body are refused
- Data layer: `FHData.opsPulse(period)`, `FHData.hireCloser()`
- Gate: owner and admin (`ROLE_SETS.OPS`). Job-applicant PII stays on HIRING reads, not this pulse

## Pulse (read only)

`src/ops/pulse.mjs` `computePulse`:

- Reuses `computeKpis` from `src/dashboard/kpis.mjs`
- Bars: role-level `staff_targets` monthly closer deposits and funding advisor files. Actuals from `call_outcomes` deposits and `clients.funded` this UTC month. Missing stays missing
- Clocks: `ROLE_UNITS` / `CAPACITY` with `source: "MODEL"`
- Measured minutes: `measureMinutes` → `measured_minutes`. Hubstaff `tracked_seconds` plus CRM timestamps. `n` floor 20. `locked: false` always. Does not overwrite MODEL
- Calendar: `loadCalendar` in `src/ops/hire-closer.mjs`. `beltJammed` is `calendar.packed`
- Gaps: `diagnoseGaps` — closer vs 27 deposits per pod, funding advisor vs 27 files per pod, uneven seats, bookings as a count only. Never hire a setter
- Hire profile: `hireProfileFromGaps`. Closer keeps the LinkedIn `postJob` path. Funding advisor is text only
- Ads: `loadAdSpend` reads `ad_metrics_daily`. Status `ok` or `not_configured` / `missing`. Does not write campaigns
- Marketing: `marketing` — spend, `cost_per_booked` (need 10 booked calls), `special_ad_category` fail-closed. Live Marketing API write unverified. Does not buy ads
- Fire / raise / bonus objects are always `{ auto_enqueue: false, rule_locked: false, note: "no … rule yet" }`
- Does not call `createCsuiteTask`, `postJob`, `inviteStaff`, or `suspendStaff`

## Packed rule (MODEL)

`src/ops/hire-closer.mjs`:

- `slots_per_closer_day = floor(480 / 45) = 10`
- Window: next 5 UTC weekdays
- Count: open closer-role tasks with `due_at` in that window
- Closers: `staff.role = 'closer'` and `status` active
- `due_at` count 0 → not packed
- closer count 0 and any slot → packed
- else packed when count >= closer_count × 10 × 5 × 0.9

## Write (`actOnBrain`)

`POST /api/ops/hire-closer` calls `actOnBrain`:

1. If packed: `actOnPacked` → `createCsuiteTask({ kind: "hire" })` + `postCloserLinkedIn` → existing `src/hiring/linkedin.mjs` `postJob`. One closer LinkedIn draft per month marker. Does not call `closeJob`
2. If `gaps.has_short`: `createCsuiteTask({ kind: "diagnose" })` → assignee `owner`, body `diagnose:gaps:YYYY-MM`
3. If ads status is `ok` and `spend_cents > 0`: `createCsuiteTask({ kind: "ads_review" })` → assignee `owner`, body `ads-review:YYYY-MM`

If there is no active row in `hiring_channel_connections` for LinkedIn, status is `not_configured`.

Never auto-enqueues `fire`, `raise`, or `bonus`. Never `suspendStaff`. Never writes `/api/campaigns/write`.

## Task shapes (not auto)

`src/ops/csuite-tasks.mjs`:

- Monthly: `hire`, `diagnose`, `ads_review`
- Keyed (`dedupeKey` required): `fire`, `raise`, `bonus` — assignee `owner`

## Automatic manager KPI review

`ops-manager-review` runs on the Netlify cron clock every day at 7:15 a.m. Arizona. It reads active, non-demo closers, including owner-designated Chris when his staff role is `owner`, and their real-client, non-demo `call_outcomes` for the current UTC month. A close rate below 25% after at least 10 held calls opens a review task due the next Arizona weekday at 10 a.m. The task states the held calls, paid deposits, threshold, and the need to review call quality, lead quality, and coaching history. It asks the manager to decide coaching or PIP; it does not start a PIP.

Routing uses the closer role's active named hiring manager when configured. Otherwise it follows the role's existing owner route (normally `sales_manager`) and assigns the sole active person in that role by staff ID. Multiple active managers share the role queue. If that role has nobody active, the task goes to the active owner; if neither exists, the job reports a failure rather than claiming that work was assigned. `source_workflow` plus staff, metric, and month dedupe the task. A task with `due_at` appears on the internal Calendar; no external calendar invite is created.

## Briefs

`src/ops/briefs.mjs`: CEO text starts “What needs doing today?” Owner text starts “What will be done.” Missing numbers are named missing. No invented fire trigger, raise percent, or bonus dollar. The setter line says setting is handled by a person today and the AI setter is off; it does not label current bookings as AI-set.

## UNVERIFIED

- Live LinkedIn Talent Solutions payload against a real company account (same note already on `src/hiring/linkedin.mjs`)
- Live Playwright cannot score the new route until this branch is deployed
- Live production task creation and manager Calendar visibility for `ops-manager-review`
