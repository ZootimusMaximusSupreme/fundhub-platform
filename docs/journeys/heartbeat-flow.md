# Heartbeat — how a tripwire gets from code to Chris's phone

Traced from code on 2026-10-09: `src/workflows/daily-pulse.mjs`, `src/pulse/daily-pulse.mjs`, `src/pulse/coverage/run-slices.mjs`, `src/pulse/coverage/modules.mjs`, `src/pulse/instant-watch.mjs`, `src/ops/morning-brief.mjs`. The law is `.claude/rules/heartbeat-on-every-build.md`.

## In plain words

- A **check** asks one yes-or-no question about the company. "Does the login page answer?" "Did every paid client get the portal?"
- A **tripwire** is a check that goes red before a customer hits the break.
- Every morning at **6:00 a.m. Arizona**, one job runs about 970 checks. Every red one goes in the text to Chris.
- Every **5 minutes**, a small watch runs 5 checks (health, login, apply page, roadmap sales page, outbound sends). If one breaks, Chris gets a text right away. At most one text an hour for the same break.
- Most checks only run at 6 a.m. A break at noon shows up in the next morning's text, unless it is one of the 5.
- The pulse **only reports**. It never fixes anything. Chris, or an agent he asks, fixes reds.

## Two kinds of check

| Kind | What it proves | Where it lives | Example |
|---|---|---|---|
| Ping | The door answers. Blind to wrong data. | `src/pulse/registry.mjs`, `src/pulse/heartbeats.mjs` | `reg:portal-login.html` answers 200 |
| Deep (the tripwire) | The customer's result is right. | `src/pulse/coverage/gap-*.mjs` | `payments:paid-no-entitlement`: a paid client has no portal access |

Anything that touches money or a paying customer needs a deep check. A ping alone is not enough.

The tripwire map (`src/pulse/tripwires.mjs`) is where every page, route, job and send is sorted: money or customer names its deep check, the rest says why it is not customer-facing. A new one fails the tests until it is sorted. That is what sews the tripwires into every build.

## The picture

```mermaid
flowchart TD
    BUILD["Agent builds a page, route, job or send"] --> PING["Ping row in the same change<br/>registry.mjs · heartbeats.mjs · SEND_PATHS"]
    BUILD --> MONEY{"Touches money or<br/>a paying customer?"}
    MONEY -->|Yes| DEEP["Deep check<br/>src/pulse/coverage/gap-lane.mjs<br/>PASS test + FAIL test"]
    DEEP --> MAP["Named in the tripwire map<br/>src/pulse/tripwires.mjs"]
    MONEY -->|No| NCF["NOT_CUSTOMER_FACING<br/>with a reason"]
    MAP --> TESTS
    NCF --> TESTS
    MONEY -->|No| TESTS
    DEEP --> LIST["On the literal list<br/>src/pulse/coverage/modules.mjs"]
    PING --> TESTS["Tests fail the build if a row is missing<br/>registry.test · heartbeats.test · modules.test · tripwires.test"]
    LIST --> TESTS
    TESTS --> PROVE["npm run pulse:prove<br/>builds the real bundle, runs every step,<br/>read-only, on live data"]
    PROVE -->|OK| SHIP["npm run ship"]
    PROVE -->|Problem| BUILD

    SHIP --> SIX["6:00 a.m. Arizona<br/>Inngest job daily-pulse"]
    SIX --> ORG["Step coverage-org"]
    ORG --> SLICES["Step coverage-slices"]
    SLICES --> LANES["One step per gap lane<br/>each under 26 s"]
    LANES --> RUN["Step run-pulse<br/>pings, job clocks, plus every lane's rows"]
    RUN --> CARD["Scorecard saved for the day"]
    CARD --> TEXT["Morning brief text to Chris (480)"]
    TEXT --> RED{"Any red?"}
    RED -->|Yes| FIX["Fixed before a customer hits it"]
    RED -->|No| GREEN["Green day"]

    LANES -.->|a lane that dies| SKIP["One skip row, the text still goes"]

    FIVE["Every 5 minutes<br/>instant watch"] --> CRIT{"health, login, apply,<br/>roadmap sales, outbound<br/>still OK?"}
    CRIT -->|No| NOW["Text Chris now<br/>at most once an hour per break"]
```

## The hourly pulse (added 2026-10-09)

Every hour at minute 7 a small Netlify scheduled function (`netlify/functions/pulse-hourly.mjs`, outside Inngest, so it runs even if Inngest is down) tests the company on purpose. The pulse is the **read-only half** (8 beats): each beat reads data through a box where Postgres itself refuses writes, and reads the web with GET and HEAD only. A beat cannot save, send or call a vendor with a write.

```mermaid
flowchart TD
    CLOCK["Every hour at minute 7<br/>pulse-hourly (Netlify scheduled function)"] --> PRE["Prefetch: default org, open incidents,<br/>last results, saved bank links (2 s)"]
    PRE --> BOX["Open ONE read box<br/>BEGIN READ ONLY, staff scope, always rolled back"]
    BOX --> BEATS["Run all 8 beats at once (13 s)"]
    BEATS --> B1["apply-links<br/>40 bank Apply pages an hour"]
    BEATS --> B2["pay-webhook<br/>door, sweeper, stuck inbox"]
    BEATS --> B3["vendor-keys<br/>Twilio, Resend, Commas accept the keys"]
    BEATS --> B4["text-path and email-path<br/>queue moving, templates ready, dispatcher alive"]
    BEATS --> B5["doors-live<br/>10 money doors and pages answer right"]
    BEATS --> B6["db-health<br/>pool writable, grants, connections"]
    BEATS --> B7["brief-link<br/>the link in today's morning text really opens"]
    B1 --> DECIDE["Decide: new break, still broken, fixed"]
    B2 --> DECIDE
    B3 --> DECIDE
    B4 --> DECIDE
    B5 --> DECIDE
    B6 --> DECIDE
    B7 --> DECIDE
    DECIDE --> TEXT["TEXT FIRST (6 s): Chris, and ntfy if the text fails"]
    TEXT --> REC["Then save (2.5 s): pulse_beats, pulse_incidents, pulse_bank_links"]
    REC --> BEAT["job heartbeat pulse-hourly<br/>red at the 6 a.m. check if it stops for 3 hours"]
    DECIDE -.->|database down| FALL["No state: text every hour while red"]
```

- A beat with `damp 2` (vendor keys, doors, bank links) must be red twice in a row before it texts, so one vendor blip does not wake Chris.
- A break texts at once, texts again every hour ("still broken, hour N") and texts once when fixed.
- **Texting hours (owner law 2026-10-09):** every text and buzz to Chris goes out only from 6:00 a.m. to 10:00 p.m. Arizona time (`inTextWindow` in `src/pulse/quiet-hours.mjs`). At night the hourly pulse still checks, opens the incident and damps, but sends nothing and claims nothing; the 6:07 a.m. run sends one text ("BROKEN since 2:07 a.m."). A break that opens and heals at night gets no "fixed" text. A break he WAS told about that heals at night stays open, and the 6:07 a.m. run sends its one FIXED text and closes it. The 5-minute watch skips the text and writes no alert row, so a door still down at 6:00 a.m. is texted on that run. The briefs, the finished-ad text, `/api/ops/notify-owner` (202 held) and the teleprompter text hold the same way. `src/pulse/quiet-hours.test.mjs` fails the build if a file that texts Chris's number skips the check.
- When the fix is done, the four learning fields on the incident and an entry in `docs/lessons/pulse-lessons.md` record what broke and what now guards it.
- **Not built yet (on purpose):** the write-through half, where a signed test signal travels through the doors that save data inside a rolled-back box. It needs locks inside the Node process that have never run on a real Postgres. It waits until proven on a scratch database and watched once. Also not built: GitHub issues and the Claude "pulse fixer" session (they wait on an owner decision about a private repo).

## Run receipts for event workflows (added 2026-10-09)

Crons leave a receipt in `job_heartbeats`. A workflow that an **event** starts used to leave none, so its `wf:` row could only say "nothing to judge" or "not checked". Now every run leaves two receipts in `workflow_runs` (migration 478), written by the **Run evidence** add-on on the shared Inngest client (`src/pulse/run-evidence.mjs`). The add-on never changes what a workflow returns and never throws into it. Every write has a timer (800 ms for the start mark; 500 ms to 5 s for the finish mark), and after 3 failed writes it stops for 10 minutes and logs one `[run-evidence]` line.

```mermaid
flowchart TD
    BUS["The bus writes an events row,<br/>then hands the event to Inngest<br/>(data.id = the events row id)"] --> RUN["Inngest calls the workflow"]
    RUN --> START["First request of the run that this container sees:<br/>START mark (run id, workflow, events row id).<br/>A lost write is tried again on the next request."]
    RUN --> FINISH["Last request of an attempt:<br/>FINISH mark (ok or error,<br/>final?, skipped?, redacted why)"]
    START --> TBL[("workflow_runs")]
    FINISH --> TBL
    EVT[("events")] --> WF
    TBL --> WF["6 a.m. wf: row for each workflow<br/>(2 reads for all 65)"]
    WF --> R1{"Last run failed for good<br/>15+ minutes ago?"}
    R1 -->|Yes| RED1["RED: last run failed"]
    R1 -->|No| R2{"An event 15+ minutes old,<br/>after receipts began,<br/>and no run carries its id?<br/>(a repeat funnel post does not count)"}
    R2 -->|Yes| RED2["RED: event came,<br/>no receipt shows it started"]
    R2 -->|No| R3{"A run started and never finished?<br/>no-sleep: over 30 minutes<br/>sleeper: over its longest wait + 1 day"}
    R3 -->|"Yes, and receipts were still<br/>being written after its deadline"| RED3["RED: started, never finished"]
    R3 -->|"Yes, but the app cannot write receipts,<br/>or none was written after the deadline"| SK2["not checked: receipts<br/>may have been paused"]
    R3 -->|No| R4{"Last 3 runs all skipped?"}
    R4 -->|Yes| RED4["RED: every run skipped"]
    R4 -->|No| R5{"A run finished ok,<br/>or one is asleep by design?"}
    R5 -->|Yes| GREEN["GREEN with the times"]
    R5 -->|No| R6{"Any event in 3 days?"}
    R6 -->|No| NA["nothing to judge<br/>(no-demand, the audit re-checks)"]
    R6 -->|Yes| SK["not checked: the event came before<br/>receipts began, or receipts cannot be read"]
    AUD["audit:run-recorder"] -.->|can the app still write them?<br/>is the add-on on the client?<br/>did events come and no run get written?| TBL
```

- A failure with a retry still coming is "retrying" (green, pending), never red. A run is final when it returned, threw its last attempt, threw a NonRetriableError, or a step already used up its retries. A failure saved as "retry coming" with no later attempt after a day is final too, so it cannot read "retrying" for ever.
- ClickFunnels sends one post per survey screen. The app stores a repeat post (same event name, address and funnel, inside 6 hours) and starts no run on purpose. Those repeats are left out of "event came, no receipt shows it started". Today that is `survey.submitted` and `entry.captured`.
- A lost finish write can look like a lost run. So a run with no finish mark is called lost only when receipts were still being written after its deadline. Otherwise the row says "not checked: receipts may have been paused".
- The times in these rows are Arizona time, the clock Chris reads.
- The 17 workflows that sleep are on the `SLEEPERS` list in `src/pulse/workflow-runs.mjs` with their longest wait. A test reads the bundled workflow files and fails when a sleeper is missing, or when a workflow with `cancelOn` is.
- An event that came **before** receipts began cannot be judged by receipts. Its workflow reads "not checked" until receipts are a day old or a new event comes. That is the honest answer, not a guess.
- **The switch-off with no deploy:** `REVOKE INSERT, UPDATE ON public.workflow_runs FROM fundhub_app;`. Writes then fail fast and quietly, every workflow keeps running, `audit:run-recorder` goes red, and the `wf:` rows say "receipts are switched off" (not checked) instead of "no receipt shows it started" or "started, never finished". Undo with the matching `GRANT`.

## The states of one check

```mermaid
stateDiagram-v2
    [*] --> PASS: the answer is right
    [*] --> FAIL: the answer is wrong — red in the text
    [*] --> skip: the check could not read (it says why)
    [*] --> not_checked: a job with no last-run time saved yet
    FAIL --> PASS: someone fixed it
```

`skip` is never a pass. A check that can only pass, or only skip, is not a tripwire.

## Traps already paid for (2026-10-08)

1. **A folder scan ships empty.** The live bundle carried 0 of 70 check files, and nothing said so. Now every file is a literal import in `modules.mjs`, and a test checks the list.
2. **26 seconds per step.** All the checks in one step took about 61 s. Netlify cuts at 26 s, so no text would have gone out. Now each lane is its own step.
3. **No repo files at run time.** Checks that read source files passed on a laptop and went red on the server. `npm run pulse:prove` runs from the real bundle to catch this.
