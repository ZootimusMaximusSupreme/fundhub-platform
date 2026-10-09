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
