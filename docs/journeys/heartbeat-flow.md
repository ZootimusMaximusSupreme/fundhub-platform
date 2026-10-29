# Heartbeat — how a tripwire gets from code to Chris's phone

Traced from code on 2026-10-11: `src/workflows/daily-pulse.mjs`, `src/pulse/daily-pulse.mjs`, `src/pulse/coverage/run-slices.mjs`, `src/pulse/coverage/modules.mjs`, `src/pulse/catalog/compiler.mjs`, `src/pulse/instant-watch.mjs`, `src/ops/morning-brief.mjs`. The law is `.claude/rules/heartbeat-on-every-build.md`.

## In plain words

The human Setter Dashboard is watched at its page and read/write API doors:
`/app/setter-dashboard.html`, `/api/read/setter-dashboard`, and
`/api/setter-dashboard`. The write door is pinged with GET only; its 405 is
expected and never sends a text. Completion and same-staff send behavior are
proved by `src/setter/dashboard.test.mjs` and `src/setter/send-actions.test.mjs`.

- A **check** asks one yes-or-no question about the company. "Does the login page answer?" "Did every paid client get the portal?"
- A **tripwire** is a check that goes red before a customer hits the break.
- Every morning at **6:00 a.m. Arizona**, one job runs more than 1,000 checks. Every red one goes in the text to Chris.
- Every **5 minutes**, a small watch runs 5 checks (health, login, apply page, roadmap sales page, outbound sends). If one breaks, Chris gets a text right away. At most one text an hour for the same break.
- Most checks only run at 6 a.m. A break at noon shows up in the next morning's text, unless it is one of the 5.
- The pulse **only reports**. It never fixes anything. Chris, or an agent he asks, fixes reds.

## Kinds of check

| Kind | What it proves | Where it lives | Example |
|---|---|---|---|
| Ping | The door answers. Blind to wrong data. | `src/pulse/registry.mjs`, `src/pulse/heartbeats.mjs` | `reg:portal-login.html` answers 200 |
| Deep (the tripwire) | The customer's result is right. | `src/pulse/coverage/gap-*.mjs` | `payments:paid-no-entitlement`: a paid client has no portal access |
| Reminder lane (not a tripwire) | A person's setup step is late. No buyer is hurt. | `src/pulse/coverage/gap-closer-setup.mjs` | `closer-setup:calendar-late`: a closer was asked on Oct 7, the 3 days are over, and the booking page still lists no such host |

Anything that touches money or a paying customer needs a deep check. A ping alone is not enough.

A person's setup step (for example "connect your calendar so booked calls land on it") is a **reminder lane**, not a tripwire. It has no entry in the tripwire map and no hourly beat, because nobody gets the step done faster by the hour. The ask is one owner task per person (`scripts/closer-setup-ask.mjs`), with a due day. The 6 a.m. lane reads the open asks and the live booking page: green while waiting ("day 2 of 3"), red after the due day, green again once the person is a host on the page. A **skip** there (the page could not be read, or ClickFunnels changed its page code) is not a pass: it lands inside the red `audit:not-checked` line, so it is never hidden. ClickFunnels has no API call to invite a team member, connect a calendar or add a host, so a person clicks those steps and the pulse only watches that they happened.

The tripwire map (`src/pulse/tripwires.mjs`) is where every page, route, job and send is sorted: money or customer names its deep check, the rest says why it is not customer-facing. A new one fails the tests until it is sorted. That is what sews the tripwires into every build.

The client marketing-push switch is watched in both clocks. The morning `marketing-push:preference-shape` tripwire and the hourly `native-push` beat read saved client choices and go red if a present choice is not a true or false value. The hourly beat also checks that the switch route requires sign-in, before it checks APNs setup. Neither check claims a notification reached a phone.

## Whole-company catalog

Claude's 20 map files hold 3,975 rows. Thirty-three rows clearly name another row they repeat, leaving 3,942 unique company items. The compiler gives every item one stable id and one recipe. It links existing tests, deep lanes, hourly beats and pings. A money or customer item needs deep proof. A staff-only item needs an end-to-end test. A claim with no executable proof stays red.

The catalog does not fake 3,942 green checks. The fresh compile reports 3,919 wired items and 23 red items, with coverage split into 880 none, 560 ping, 1,694 end-to-end and 808 deep. A recipe may raise a row to deep or end-to-end proof only when it names a real executable test, gap lane, or hourly beat, states the exact result it checks, and uses a safe runner. A status ping alone never counts as result proof. The morning pulse reports the count through `gap-catalog.mjs`. The full item list is in `src/pulse/catalog/generated.json`. `npm run pulse:surface -- <id>` runs the proof for one item. Every ship rebuilds the catalog in memory and stops if the saved copy is stale, the map shrank, a row has no recipe owner, or ids repeat.

The display-result lane imports its exact result and tracking cases from that same built catalog. The compiler resolves source-map and proof-builder files before shipping; the live lane reads none of those checkout files. It reads the retired Decline Autopsy redirect and its menu with GET requests, and a wrong redirect or dead menu stays red. The catalog also carries the current customer/money tripwire surfaces missing hourly beat coverage. `catalog:hourly-proof-linked` reports those gaps red in the morning; a legacy exemption in a build test does not mean a surface has hourly proof.

`npm run pulse:catalog:prove` is the cheap batch proof. By default it compares the working catalog with the committed catalog, runs only proof targets that changed, and runs each shared test, browser spec, lane, or beat once. Node tests and Playwright browser specs use their own runners. `--all` proves every wired row. `--report` only prints the grouped red count.

A proof helper may not vanish from the morning pulse. Empty tables use a closed, rechecked `catalog-data-empty` reason. Shared code-only door proof lanes return an honest red row until a live key check, job receipt, or provider receipt proves the live result.

GitHub's pre-deploy proof receives the real Meta and Commas read keys through Actions secrets. Twilio and Resend stay only on the live server when GitHub has no full copy: that CI row is named as runner-only, is never counted green, and a real vendor refusal still stays red in the live pulse.

The funnel lane limits live reads to eight at once, so one host cannot stall the whole 15-second lane. The CRM-link lane starts its page, logo, and pipeline checks together. A dead CRM static file gets two five-second tries instead of two 15-second tries, so it still turns red without holding the full lane past Netlify's clock. These changes keep the same rows and checks; they only remove needless waiting.

## The picture

```mermaid
flowchart TD
    BUILD["Agent builds a page, route, job or send"] --> PING["Ping row in the same change<br/>registry.mjs · heartbeats.mjs · SEND_PATHS"]
    BUILD --> CATALOG["Whole-company catalog recipe<br/>one stable item id"]
    BUILD --> MONEY{"Touches money or<br/>a paying customer?"}
    MONEY -->|Yes| DEEP["Deep check<br/>src/pulse/coverage/gap-lane.mjs<br/>PASS test + FAIL test"]
    DEEP --> MAP["Named in the tripwire map<br/>src/pulse/tripwires.mjs"]
    MONEY -->|No| NCF["NOT_CUSTOMER_FACING<br/>with a reason"]
    MAP --> TESTS
    NCF --> TESTS
    MONEY -->|No| TESTS
    DEEP --> LIST["On the literal list<br/>src/pulse/coverage/modules.mjs"]
    PING --> TESTS["Tests fail the build if a row is missing<br/>registry.test · heartbeats.test · modules.test · tripwires.test"]
    CATALOG --> TESTS
    LIST --> TESTS
    TESTS --> PROVE["npm run pulse:prove<br/>builds the real bundle, runs every step,<br/>read-only, on live data"]
    PROVE -->|OK| SHIP["npm run ship"]
    PROVE -->|Problem| BUILD

    SHIP --> SIX["6:00 a.m. Arizona<br/>clock job daily-pulse<br/>(cron-clock starts it in cron-worker-background)"]
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

    FIVE["Every 5 minutes<br/>instant watch"] --> CRIT{"health, login, apply,<br/>roadmap sales, outbound,<br/>both hourly shift receipts still OK?"}
    CRIT -->|No| NOW["Text Chris now<br/>at most once an hour per break"]
```

The two pulse clocks close a circuit. The hourly pulse checks that the 5-minute workflow clock is alive. The 5-minute instant watch reads the newest receipt of each hourly shift (`pulse-hourly`, `pulse-hourly-b`, `pulse-hourly-c` and `pulse-hourly-d`). If either shift has not returned a receipt for more than three hours, `pulse:runner-stale` goes red, names that shift, and uses the instant watch's owner alert. Before a shift's first receipt ever exists, it waits for that shift instead of inventing a pass or a break.

## Where the crons run (changed 2026-10-20)

Every cron used to run on Inngest. Its free plan is 50,000 executions a month and the crons cost
about 300,000, so on 2026-10-20 (owner: "stop burning ingests") every cron moved to one Netlify
clock. Inngest now runs event workflows only (`inngestFunctions` in `src/workflows/index.mjs`).
Board: `ops/workflows/inngest-diet-2026-10-20.md`.

```mermaid
flowchart TD
    TICK["Every 5 minutes<br/>netlify/functions/cron-clock.mjs"] --> DUE{"Which CLOCK_JOBS crons<br/>name a minute in this slot?"}
    DUE -->|none| CR["job:cron-clock receipt"]
    DUE -->|each due job| POST["POST /.netlify/functions/cron-worker-background<br/>job + slot, signed with CRON_WORKER_SECRET"]
    POST -->|202| WORK["Worker checks the signature and slot,<br/>runs the job's own handler (15 min limit)"]
    POST -->|refused or no answer| ERR["Error receipt for that job<br/>naming why"]
    WORK --> REC["job_heartbeats row<br/>same job id, runner netlify"]
    REC --> PULSE["Morning pulse: red at 3x the schedule<br/>engine-alive beat: red after 20 quiet minutes"]
    ERR --> PULSE
    CR --> PULSE
```

The two payment queues keep their own Netlify sweepers (`commas-inbox-sweeper`,
`whop-billing-inbox-sweeper`), now every 5 minutes; their Inngest twins are retired.

The `cortana-booking-feed` job also runs on this five-minute clock. Its
`job_heartbeats` receipt goes red if a send fails, and the delivery ledger in
`cortana_booking_sends` keeps that booking eligible for the next pass.

## The hourly pulse (added 2026-10-09)

Every hour four small Netlify scheduled functions (outside Inngest, so they run even if Inngest is down) test the company on purpose. **Shifts (two on 2026-10-20, four on 2026-10-21):** the beats no longer fit one run's 13 s window, so they are split in one literal list, `src/pulse/beats/shifts.mjs`. `netlify/functions/pulse-hourly.mjs` runs shift A at minute 7, `netlify/functions/pulse-hourly-d.mjs` runs shift D at minute 22, `netlify/functions/pulse-hourly-b.mjs` runs shift B at minute 37 and `netlify/functions/pulse-hourly-c.mjs` runs shift C at minute 52. A beat whose file has not landed waits on `PENDING_SHIFT_BEATS` with its shift. Every beat is in exactly one shift (a test and the ship proof fail otherwise), so each beat still runs once an hour, and each shift gets its own 13 s window and 22 s budget. The pulse is the **read-only half**: each beat reads data through one of three boxes where Postgres itself refuses writes, and reads the web with GET and HEAD only. A beat cannot save, send or call a vendor with a write.

```mermaid
flowchart TD
    CLOCK["Every hour, four shifts (src/pulse/beats/shifts.mjs)<br/>pulse-hourly :07, pulse-hourly-d :22, pulse-hourly-b :37, pulse-hourly-c :52<br/>each runs only its own beats, same runner"] --> PRE["Prefetch: default org, open incidents,<br/>last results, saved bank links (2 s)"]
    PRE --> BOX["Open up to 3 read boxes<br/>never more boxes than beats<br/>BEGIN READ ONLY, staff scope, always rolled back"]
    BOX --> BEATS["Three workers pull this shift's beats from one shared queue<br/>each beat gets its own deadline when it starts<br/>13 s phase inside the 22 s run"]
    BEATS --> B1["apply-links<br/>40 bank Apply pages an hour"]
    BEATS --> B2["pay-webhook<br/>door, sweeper, stuck inbox"]
    BEATS --> B3["vendor-keys<br/>Twilio, Resend, Commas accept the keys"]
    BEATS --> B4["text-path and email-path<br/>queue moving, templates ready, dispatcher alive"]
    BEATS --> B5["doors-live and checkout-doors<br/>money doors and pages answer right"]
    BEATS --> B6["db-health and engine-alive<br/>database and both pulse clocks answer"]
    BEATS --> B7["brief-link<br/>the link in today's morning text really opens"]
    BEATS --> B8["funding-trip and partner-trip<br/>both complete money journeys"]
    BEATS --> B9["money-funding, money-checkout,<br/>money-operations: all W1/W2 checks"]
    B1 --> DECIDE["Decide: new break, still broken, fixed"]
    B2 --> DECIDE
    B3 --> DECIDE
    B4 --> DECIDE
    B5 --> DECIDE
    B6 --> DECIDE
    B7 --> DECIDE
    B8 --> DECIDE
    B9 --> DECIDE
    DECIDE --> TEXT["TEXT FIRST (6 s): Chris, and ntfy if the text fails"]
    TEXT --> REC["Then save (2.5 s): pulse_beats, pulse_incidents, pulse_bank_links"]
    REC --> BEAT["job heartbeats pulse-hourly, -b, -c, -d<br/>each red at the 6 a.m. check if it stops for 3 hours"]
    DECIDE -.->|database down| FALL["No state: text every hour while red"]
```

- **`checkout-doors` (added 2026-10-10, coverage batch W2).** Every hour it asks three questions a buyer would feel, read only: does the funnel till (`GET /api/public/funnel-checkout`) say checkout is ready with a price and a live buy button for autopsy, board and trial; does the repair checkout door answer a GET with its own 405 (so the route is mounted); and do the newest waiting paid-service checkout links answer a HEAD. It never presses Pay and never charges a card. Its `damp` is 2. The morning twin is `src/pulse/coverage/gap-checkout.mjs`, and both judge with `src/pulse/beats/lib/checkout-doors.mjs`.
- **`blueprint-delivery` and `whop-billing` (2026-10-20 candidate, not live proof).** The hourly reads check real assigned Blueprint advisors, unfinished monthly-result delivery, overdue Whop inbox receipts and paid Whop orders missing canonical access. Daily twins are `gap-blueprint.mjs` and `gap-whop-billing.mjs`. These beats do not create a pull, payment, provider call, client message or repair, and do not prove a financed buyer or owner alert was received.
- Up to three workers each own one read-only box and pull the next beat from one shared queue. A slow beat holds only its worker; the other workers keep taking later beats. A beat's deadline starts only when a worker takes it, never while it waits in the queue. Runs with fewer than three beats open only as many boxes as they need, and every opened box closes in a guaranteed cleanup step.
- **One text per break across the shifts.** Incidents, damping and the 50-minute claim are per beat, and a run only judges the beats it ran. A beat lives in one shift, so one run an hour touches its incident; the other shift never texts, claims or closes it. Beats that break from one cause (the message templates and keys; the bank links; the lead pipe; the checkout doors and pay links; the funding and partner money and pages; the roadmap pull, pack and pages; sign-in and the portal; the pipeline boards and facts; the repair and inquiry trips) sit in the same shift, so one cause is one text. With the whole database down there is no saved state, so each shift says so in its own run.
- A beat with `damp 2` (vendor keys, doors, bank links) must be red twice in a row before it texts, so one vendor blip does not wake Chris.
- A break texts at once, texts again every hour ("still broken, hour N") and texts once when fixed.
- **Texting hours (owner law 2026-10-09):** every text and buzz to Chris goes out only from 6:00 a.m. to 10:00 p.m. Arizona time (`inTextWindow` in `src/pulse/quiet-hours.mjs`). At night the hourly pulse still checks, opens the incident and damps, but sends nothing and claims nothing; the 6:07 a.m. run sends one text ("BROKEN since 2:07 a.m."). A break that opens and heals at night gets no "fixed" text. A break he WAS told about that heals at night stays open, and the 6:07 a.m. run sends its one FIXED text and closes it. The 5-minute watch skips the text and writes no alert row, so a door still down at 6:00 a.m. is texted on that run. The briefs, the finished-ad text, `/api/ops/notify-owner` (202 held) and the teleprompter text hold the same way. `src/pulse/quiet-hours.test.mjs` fails the build if a file that texts Chris's number skips the check.
- When the fix is done, the four learning fields on the incident and an entry in `docs/lessons/pulse-lessons.md` record what broke and what now guards it.
- **Not built yet (on purpose):** the write-through half, where a signed test signal travels through the doors that save data inside a rolled-back box. It needs locks inside the Node process that have never run on a real Postgres. It waits until proven on a scratch database and watched once. Also not built: GitHub issues and the Claude "pulse fixer" session (they wait on an owner decision about a private repo).

## Whole trips (L4, added 2026-10-10, coverage batch W8)

A deep check asks one question about one thing. A **trip check** follows one customer from the first step to the last and names the **first step that is missing**. There are five, one lane each, read only, at 6 a.m.: `trip:funding`, `trip:repair`, `trip:inquiry`, `trip:partner`, `trip:roadmap` (`src/pulse/coverage/gap-trip-*.mjs`, walked by `src/pulse/coverage/trip-kit.mjs`).

```mermaid
flowchart TD
    START["A customer started a trip in the last 60 days<br/>(paid the diagnostic, bought repair, got a case, applied, paid the roadmap)"] --> READ["One SELECT reads a time for each step<br/>(or nothing, if the step did not happen)"]
    READ --> WALK["Walk the steps in order"]
    WALK --> OWE{"First missing step: who owes it?"}
    OWE -->|"The system (a handler or job)"| CLOCK{"Its wait has run out?<br/>(the wait is another lane's own number)"}
    CLOCK -->|Yes| RED["RED: names the customer and the step"]
    CLOCK -->|No| WAIT["Waiting, counted by step"]
    OWE -->|"A person or the customer"| STALL{"A clock the code already<br/>defines says it is overdue?"}
    STALL -->|"Yes (a repair stage clock, a 72 hour idle case)"| RED
    STALL -->|No| WAIT
    WALK --> SKIP{"A step the code cannot skip<br/>was skipped, or the board shows<br/>a step no record backs?"}
    SKIP -->|Yes| RED
    WAIT --> GREEN["Green line: N started, F finished, W waiting at ..., E ended"]
    NOBODY["Nobody started the trip in the window"] --> EMPTY["Green line: nobody started, so nobody is stuck<br/>(not a nothing-to-judge row)"]
```

- **A waiting customer is never red.** Waiting on a person or on the customer is counted by step in the green line. A step goes red only when the company owes it and its wait is over, or when a clock the code already defines (the repair stage clocks in `src/repair/sla.mjs`, gap-inquiry's 72 hour idle case and call sweeper wait, the 72 hour portal sign-in wait) says it is overdue.
- **Every wait is another lane's own number.** The kit adds none. Each system step names where its wait comes from (the paid-to-card wait and the round wait are `gap-pipeline-facts.mjs`; the funded-to-bill wait is `gap-money-funding.mjs`; the pack's 2 hours is `gap-underwrite.mjs`).
- **The funded steps use the money lane's rule** (`roundProblems`), and the pack steps use the underwrite lane's judges (`judgePackFiles`, `judgePackEmail`), so a trip and its lane can never disagree.
- **An empty trip is a plain green line, not a "nothing to judge" row.** When nobody started a trip in the window the line says `Nobody started the funding trip in the last 60 days, so nobody is stuck`. That is on purpose. The audit re-checks every "nothing to judge" row again inside 2.5 seconds, all together, and three more of them pushed it past its deadline in the proof (50 workflow rows then read "not true any more"). The first customer on a trip is its first real test.
- Test clients, sim and e2e partners, demo rows and archived clients are left out. A trip that started more than 60 days ago is for a person to clean up by hand.

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
    [*] --> FAIL: the answer is wrong — broken in the text
    [*] --> NOT_PROVED: no exact result test yet — counted, never green
    [*] --> skip: the check could not read (it says why)
    [*] --> not_checked: a job with no last-run time saved yet
    FAIL --> PASS: someone fixed it
```

`skip` is never a pass. A check that can only pass, or only skip, is not a tripwire.
`NOT_PROVED` is the explicit proof backlog, not a softer name for a measured break. It is saved in the existing `not_checked` storage state with `not_proved: true`, so it stays in every daily total without a database change. A raw `FAIL` is always broken even if bad metadata tries to mark it not proved. The morning text and report page show separate **Broken** and **Not proved** counts; technical skips remain separate and still make the self-audit red.

## Traps already paid for (2026-10-08)

1. **A folder scan ships empty.** The live bundle carried 0 of 70 check files, and nothing said so. Now every file is a literal import in `modules.mjs`, and a test checks the list.
2. **26 seconds per step.** All the checks in one step took about 61 s. Netlify cuts at 26 s, so no text would have gone out. Now each lane is its own step.
3. **No repo files at run time.** Checks that read source files passed on a laptop and went red on the server. `npm run pulse:prove` runs from the real bundle to catch this.
